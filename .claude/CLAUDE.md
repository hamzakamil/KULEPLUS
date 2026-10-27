# Yönetici Kokpiti: Proje Kurulum ve Uyarlama Rehberi

Bu dosya, `yonetici-kokpiti.html` sayfasını kendi projene birebir taşımak ya da kendi verinle uyarlamak için hazırlandı. Claude Code bu dosyayı proje kökünde `CLAUDE.md` olarak okuyarak çalışabilir.

## 1. Ne var

- **Tek dosya:** `yonetici-kokpiti.html`. HTML, CSS ve JavaScript aynı dosyada. Derleme, npm ya da sunucu gerekmiyor.
- **Dış bağımlılık:** Yalnızca Google Fonts (Barlow, Barlow Condensed). Font yüklenmezse sistem fontu kullanılır.
- **Veri:** Tüm veriler sayfa içindeki JavaScript dizilerinde duruyor. Gerçek veri bağlanana kadar örnek veri gösterir.

## 2. Birebir kopyalama (en hızlı yol)

1. `yonetici-kokpiti.html` dosyasını projenin `public/` ya da `static/` klasörüne koy.
2. Tarayıcıda `/yonetici-kokpiti.html` adresini aç.
3. Başka bir şey yapmana gerek yok. Tüm özellikler (düzenleme, sürükleme, boyutlandırma, sekmeler, mobil uzun basma) çalışır.

## 3. Claude Code ile uyarlama

VS Code'da Claude Code'u aç, proje köküne bu dosyayı koy ve şu tarzda iste:

- "CLAUDE.md'deki kokpiti benim projemin React bileşenlerine çevir. Stil değerlerini ve düzen davranışını koru."
- "Örnek verileri `/api/...` uç noktalarından çekecek şekilde değiştir. Veri şekli aşağıdaki tabloda."
- "Kamera görüntüsü yerine kendi RTSP/HLS yayın bileşenini kullan."
- "Yalnızca yönetici rolüne açık bölümleri göster, diğerlerini gizle."

Uyarlama yapmadan önce mevcut stack'i (React, Vue, Next.js, düz HTML vb.) Claude Code'a söyle. Tek dosyadaki JavaScript'i ayrı modüllere bölmesini istersen önce bunu da belirt.

## 4. Veri kaynakları (uyarlanacak yerler)

Hepsi `yonetici-kokpiti.html` içindeki `<script>` bloğunda, sabit dizi olarak tanımlı.

| Değişken | Ne gösterir | Önerilen kaynak |
|---|---|---|
| `sites` | Şantiye listesi: ad, konum, ilerleme, plan, bütçe, kişi sayısı | Proje yönetim API'si |
| `cams` | Kamera listesi: ad, şantiye, kanal, çevrimdışı durumu | Kamera/NVR API'si |
| `decs` | Karar bekleyen onaylar: başlık, talep eden, tutar | İş akışı / onay API'si |
| `alerts` | Dikkat gerektirenler: metin, alt metin, renk, kamera bağlantısı | Kural motoru |
| `inc`, `exp` | 8 haftalık gelir ve gider dizileri (milyon ₺) | Muhasebe API'si |
| `dues` | Önümüzdeki 7 gün: tarih, açıklama, tutar | Ödeme/tahsilat takvimi |
| `fleet` | Araçlar: plaka, tip, sürücü, durum, hız, konum, km, bakım, sigorta günü, HGS | Filo ve HGS entegrasyonu |
| `staff` | Personel: ad, görev, şantiye, durum, giriş saati | Yoklama / QR giriş |
| `bankTx` | Banka hareketleri: banka, tarih, açıklama, tutar | Açık bankacılık API'si |
| `stockItems` | Malzeme stokları: ad, miktar, minimum, birim | Stok yönetimi |
| `moves` | Son stok hareketleri | Stok hareket kaydı |
| `subs` | Taşeronlar: ad, kapsam, ilerleme, kalite, ödeme durumu | Taşeron / hakediş modülü |
| `docs` | Belgeler: ad, ilgili kayıt, kalan gün | Belge yönetimi |
| `fin` | Finansal hareketler: kasa, cari, çek/senet, gider sekmeleri | Muhasebe API'si |

### Veri şekilleri (örnek)

- `sites`: `{ id, n, l, p, plan, b, w, tag, c }`. `p` ilerleme yüzdesi, `plan` plan yüzdesi, `c` renk sınıfı (`good`, `warn`, `bad`).
- `fleet`: `{ p, t, d, s, sp, loc, km, nextSvc, insDays, hgs, hgsMin, fault }`. `s` durum: `move`, `idle`, `off`, `shop`.
- `staff`: `{ n, r, s, st, since }`. `st` durum: `saha`, `ofis`, `izin`, `giris`.
- `fin`: `{ kasa: { n, rows: [{ t, x, a, tag }] }, cari: ..., cek: ..., gider: ... }`. `a` pozitif giriş, negatif çıkış.

## 5. Düzen ve bölümler

Sayfanın ana alanı `.grid` sınıflı bir `<main>`. İçindeki her bölüm `section.card` ya da `.kpis` / `.banks` gibi bir kapsayıcı. Her birinin `a-*` sınıfı var: `a-kpi`, `a-alert`, `a-cam`, `a-site`, `a-stock`, `a-due`, `a-cash`, `a-dec`, `a-fleet`, `a-staff`, `a-report`, `a-bkg`, `a-bki`, `a-sub`, `a-docs`, `a-fin`. Bu sınıflar düzen kayıtlarında kimlik olarak kullanılır, silme ya da yeniden adlandırma yapma.

Varsayılan masaüstü sırası ve genişlikleri (12 sütunlu grid):

- Göstergeler (`a-kpi`): 12
- Banka kutuları (`banks` sarmalayıcı, içinde iki kart): 12
- Dikkat gerektirenler (`a-alert`): 12
- Kameralar (`a-cam`): 12
- Şantiyeler (`a-site`): 12
- Malzeme stok (`a-stock`): 8, yanında Önümüzdeki 7 gün (`a-due`): 4
- Nakit akışı (`a-cash`): 8, yanında Karar bekleyenler (`a-dec`): 4
- Araç filosu, personel, günlük rapor, taşeron, belge, finansal hareketler: 12 (taşeron ve belge yarım: 6 + 6)

Mobilde tek sütun. Sıra, `DEF` dizisi ile belirlenir.

## 6. Davranışlar

- **Bölüm aç/kapat:** Başlığa tıkla ya da Enter. Üstteki "Tümünü aç/kapat" hepsini değiştirir. Başlangıçta fleet, staff, bkg, bki, stock, sub, docs, fin kapalı gelir.
- **Düzenle modu:** Masaüstünde üst çubuktaki "Düzenle" düğmesi. Mobilde gizli; bir bölüme basılı tutunca (550 ms) beliren "Düzenle" düğmesiyle açılır.
- **Taşıma:** Düzenle modunda "⠿ Taşı" tutacağıyla. Hayalet kutu hedef yeri gösterir. Mıknatıs açıksa bırakınca yerine oturur (akıcı geçiş), kapalıysa bırakıldığı sütuna gider.
- **Boyutlandırma:** Sağ alt köşe tutacağı. Grid modunda genişlik 3–12 sütun arasında, yükseklik satır sayısıyla (en fazla 10 satır) ayarlanır. Bırakınca bir satırdan az farkı olan kardeş bölüm aynı yüksekliğe getirilir.
- **Serbest yerleşim:** Düzenle modunda "Serbest yerleşim" düğmesi. Bölümler piksel koordinatlarıyla serbest taşınır, genişlik ve yükseklik serbest değişir. Mıknatıs açıksa kenarları 10 px içinde komşu bölümlere yapışır.
- **Öncekine dön / Varsayılana sıfırla:** İki düğme; ayrıntısı §7'de.
- **Sekmeler:** Finansal hareketler (kasa, cari, çek/senet, gider). Sekme değişince bölüm yüksekliği sabit kalır.
- **Kameralar:** Karta tıklayınca büyük pencere açılır; önceki/sonraki kamera ve tam ekran. Görüntü şu an çizilmiş bir simülasyon. Gerçek yayın için `<video>` bileşeni kullanılmalı.
- **Mesaj gönderme:** Personel bölümünde alıcı seç, metin yaz, gönder. Şu an yalnızca "iletildi" bildirimi gösterir; gerçek gönderim için kod içindeki `TODO` yerine API çağrısı eklenmeli.

## 7. Kayıt ve geri alma

Düzen tarayıcının `localStorage` alanına yazılır. Anahtarlar:

- `yonetici-kokpit-duzen`: Güncel düzen (sıra, genişlik, satır sayısı, serbest konumlar, mod).
- `yonetici-kokpit-duzen-yedek`: "Öncekine dön" için yedek. Her düzenleme oturumu başında ve sıfırlamada güncellenir.
- `yonetici-kokpit-duzen-duzenleme`: Sayfa yenilemelerinde düzenleme modunu korumak için geçici bayrak.

"Öncekine dön" iki düzen arasında geçiş yapar (tekrar basınca geri gelir). "Varsayılana sıfırla" düzeni siler, öncesini yedekler.

Serbest yerleşim ve grid yerleşimi aynı kayıtta tutulur. Veri gerçek bir API'den gelecekse düzen kaydını sunucuya taşımak isteyebilirsin. Kullanıcıya özel düzen için anahtarı kullanıcı kimliğiyle birleştir.

## 8. Stil

Renkler ve fontlar `:root` içindeki değişkenlerde:

- `--sig` `#ffc20e` (vurgu sarısı), `--ink` `#141b24` (metin), `--bg` `#f9fafb` (zemin), `--card` `#ffffff` (kart), `--line` `#e3e6eb` (kenar)
- `--good` `#1b8a4b`, `--bad` `#c8372d`, `--warn` `#a86400` (durum renkleri)
- Font: `--head` Barlow Condensed (başlık), `--body` Barlow (metin)

Marka rengini değiştirmek için yalnızca bu değişkenleri düzenle. Koyu tema bilerek kapatıldı; zemin her zaman açık.

## 9. Bilinen sınırlar

- Kamera görüntüsü simülasyon. Gerçek yayın bağlanmalı.
- Mesaj gönderme, sigorta yenileme, HGS bakiye yükleme, belge yenileme düğmeleri yalnızca bildirim gösteriyor. Hepsi `TODO` ile işaretli.
- Serbest yerleşimde bölümler üst üste gelebilir. Çakışma kontrolü yok.
- Dokunmatik sürükleme, grip tutacağı üzerinde pointer olayları ile çalışır. Eski iOS Safari'de sorun çıkarsa `touch-action` ayarlarına bak.
- Düzen yalnızca bu tarayıcıda saklanır. Telefon ve bilgisayar ayrı düzen tutar.

## 10. Claude Code için hazır başlangıç komutu

```
CLAUDE.md dosyasını oku. yonetici-kokpiti.html dosyasını projemde <framework> ile çalışan bir sayfaya dönüştür.
- Stil değişkenlerini ve düzen davranışını birebir koru.
- Veri dizilerini (sites, fleet, staff, fin vb.) /api/ uç noktalarına bağlayacak servis katmanı yaz; şimdilik mock verisini koru.
- Kamera bileşenini <video> tabanlı yayın bileşenine çevir, simülasyonu test modu olarak tut.
- localStorage anahtarlarını koru, kullanıcı kimliğiyle ön ek ekle.
- Önce yapı planını göster, onaylamadan büyük değişiklik yapma.
```
