# ADR-0023: Kendi kendine kayıt (self-servis) + Google ile giriş

**Tarih:** 15 Ekim 2026
**Durum:** Kabul
**İlgili:** ADR-0011 (yasal metin onayı) · ADR-0017 (hata sözleşmesi) · GOVERNANCE §2 · SPEC §4.3/§6.4/§27 · ROADMAP Faz 1 "kayıt koruması: rate limit"

## Bağlam

Ürüne giriş tek bir yoldan mümkündü: `company_applications` başvurusu → platform
onayı (`modules/company/service.ts` → `processApplication`). Bu, pilot müşteriler için
doğru bir kapıydı ama üç sorunu birlikte taşıyordu:

1. **Self-servis kayıt yok.** Satış görüşmesi yapmayan bir işletme hesap açamıyordu;
   pazarlama sayfasındaki "kayıt ol" formu (`index.html`) API'de karşılığı olmayan
   bir uca yazıyordu.
2. **Sosyal giriş yok.** Kurucu hesaplarını Google ile açmak isteyen kullanıcılar
   parola üretmek zorundaydı.
3. **Parola taşımayan hesap modeli yoktu.** `users.password_hash NOT NULL` olduğu
   sürece Google ile gelen (parolası olmayan) bir hesap veri tabanına yazılamazdı.

Kısıtlar: çok kiracılı model (her kayıt bir `tenants` satırı doğurur → bot için
bedava kaynak), KVKK aydınlatma kabulünün zorunlu olması (ADR-0011), oturumun
kendi token'larla (JWT access + HttpOnly refresh çerezi) kurulması.

## Karar

1. **`POST /v1/auth/register`** kullanıcıyı ve şirketini **tek transaction'da** açar,
   KVKK kabulü `acceptTerms: z.literal(true)` ile zorunludur, yanıtında oturum
   döner (kullanıcı ikinci kez giriş yapmaz). Şirket tohumlaması
   `IdentityService.bootstrapTenant()`'a taşındı: tenant + owner üyeliği + ücretsiz
   `core` hakkı + varsayılan `tenant_settings` + `core.welcome` e-postası (outbox).
   Aynı metot platform onaylı başvuru akışının ürettiği şemayı da üretir.
2. **Tek oturum kapısı: `issueSessionForUser(user, opts)`.** Parola ile giriş,
   kendi kendine kayıt ve Google girişi BİREBİR aynı `LoginSession`'ı üretir;
   "hesap askıda mı" denetimi de yalnızca buradadır. Ayrı token üretim yollarına
   izin verilmez.
3. **Google ID token akışı** (Google Identity Services): buton tarayıcıda bir ID
   token üretir, istemci `POST /v1/auth/google` ile gönderir, sunucu
   `google-auth-library` ile imza + `aud` + `iss` + süreyi doğrular.
   `email_verified !== true` olan claim reddedilir.
4. **Kimlik çözümleme zinciri** (hesap çoğaltmamak için sırayla):
   (a) `user_identities (provider='google', provider_account_id=sub)` kaydı → aynı
   kullanıcı; (b) kimlik yok ama doğrulanmış e-posta mevcut hesapla eşleşiyor →
   kimlik o hesaba **bağlanır**; (c) hiçbiri yok → yeni kullanıcı + şirket.
   Kalıcı anahtar Google `sub`'udur, e-posta değildir.
5. **Yeni tablo `user_identities`** (GOVERNANCE §2 → `core`): sağlayıcı kimliği
   kalıcı tutar; `users.password_hash` nullable oldu, `users.display_name` eklendi.
   Parolasız hesapta parola girişi/parola değişme/2FA kapatma açık Türkçe mesajla
   reddedilir; ilk parola "Şifremi unuttum" akışıyla belirlenir.
6. **2FA açık hesapta Google girişi reddedilir** (`FORBIDDEN`): sosyal giriş tek
   faktördür ve kullanıcının bilerek açtığı ikinci faktör kapısını baypas edemez.
7. **Oran sınırlama:** süreç içi kayan pencere `middleware/rate-limit.ts` —
   kayıt 10/saat/IP, Google 15 dk/30 istek/IP. Yeni hata kodu `RATE_LIMITED`
   (429) + standart `Retry-After` başlığı.
8. **Özellik anahtarı:** `GET /v1/auth/google/config` → `{ enabled, clientId }`.
   `GOOGLE_CLIENT_ID` tanımlı değilse `enabled: false` döner; frontend butonu hiç
   basmaz, üçüncü taraf script'i yüklenmez.
9. **Parola tabanı 8 karaktere** çıkarıldı (kayıt, sıfırlama, parola değiştirme,
   davet kabulü). Giriş `min(1)` kalır ki eski parolalar reddedilmesin.
   Önceki `max(8)` davet sınırı (parolayı 8 karaktere kesen hata) kaldırıldı.
10. **Frontend:** `/register` ekranı (`RegisterView.vue`), ortak
    `components/GoogleAuthButton.vue` (yapılandırma `enabled` dönmeden GIS script'i
    yüklenmez) ve `stores/auth.ts` içinde `signup` / `loginWithGoogle` /
    `fetchGoogleConfig`; üçü de aynı `applySession()`'dan geçer, böylece "beni
    hatırla" saklama kuralı hiçbir giriş yolunda atlanmaz.

## Alternatifler ve neden seçilmedi

| Alternatif | Neden reddedildi |
|------------|------------------|
| Yönlendirmeli OAuth (authorization code + PKCE) | Google tarafında offline erişime (refresh token) ihtiyacımız yok; oturumu kendi token'larımızla kuruyoruz. State/PKCE/yönlendirme durumu PWA + API ayrımında fazladan durum demek. ID token akışı aynı güvenlik yararını (Google tarafından doğrulanmış e-posta) tek istekle verir. |
| Kayıtta e-posta doğrulama zorunluluğu | İlk deneyimi erteler ve kendi sunucumuzda doğrulanmış Google e-postasıyla çelişir. Yerine: zorunlu KVKK kabulü + oran sınırlama. Doğrulama akışı (`auth.verify_email` şablonu) hazır; gerektiğinde kapı sıkılaştırılır. |
| Kaydı platform onayına bırakmak | Kontrollü ama self-servis değil; iki kapı yan yana çalışır (başvuru akışı durur, dokunulmadı). |
| Redis tabanlı limiter | Tek örnek deployment'ta altyapı maliyeti; dağıtık limiter ROADMAP'te açık iş olarak duruyor. Süreç içi limiter bu ölçekte yeterli. |
| Kimliği e-posta ile eşleştirmek | E-posta değişebilir/alan adı devredilebilir; tek başına anahtar olamaz → hesap çoğaltma veya devralma riski. |
| `users` tablosuna `google_sub` kolonu eklemek | Her sağlayıcı için kolon eklenir (Apple, Microsoft…); tek tablo ile ek maliyetsiz genişler. |
| Parolasız hesap için otomatik parola üretip e-postalamak | Kullanıcının kontrol etmediği parola, şifre sıfırlama akışı varken gereksiz. |

## Sonuçlar (olumlu / olumsuz)

- ➕ Kayıt, onay kuyruğu beklemeden dakikalar içinde tamamlanır; başvuru akışı
  (platform onayı) bozulmadan yan yana durur.
- ➕ Üç giriş yolu tek oturum kapısını kullandığı için "askıdaki hesap", authVersion
  ve çerez kuralları gibi güvenlik kararları hiçbir yolda unutulamaz.
- ➕ Aynı Google hesabı ikinci girişte yeni kullanıcı/şirket üretmez; e-posta
  değişse bile `sub` aynı hesaba düşer.
- ➖ Kayıt ucu açık → tenant üretimi bot hedefi; ilk savunma süreç içi limiter'dır
  ve dikey ölçekmede örnek başına çalışır.
- ➖ Parolasız hesap sayısı artar; bu hesaplar parola gerektiren akışlarda
  (2FA kapatma vb.) "Şifremi unuttum" bağlantısına yönlendirilir.
- ➖ `users.display_name` eski hesaplarda NULL'dur; arayüz e-posta önekine düşer.

## Kapanış Kriteri

- `apps/api` `npx tsc --noEmit` ve `apps/web` `npm run typecheck` temiz;
  `npx vitest run` yeşil: `tests/rate-limit.test.ts` (6) +
  `tests/identity.test.ts` içinde Google zinciri (5) ve `mapGoogleClaims` (3).
- Aynı Google hesabıyla ikinci giriş `users` ve `tenants` satırı EKLEMEZ;
  `user_identities` tek satır kalır.
- `GOOGLE_CLIENT_ID` tanımsızken `GET /v1/auth/google/config` `enabled:false`
  döner ve `/login` ekranında Google butonu render edilmez.
- 6. istek sonrası `POST /v1/auth/register` `429` + `RATE_LIMITED` + `Retry-After`
  döner.
- `npm run governance:check` temiz (`user_identities` GOVERNANCE §2'de kayıtlı).

---
*Kural: GOVERNANCE §7 (çelişki çözümü) gereği bu ADR yazıldıysa, etkilenen tüm dokümanlar aynı PR'da güncellenir.*
