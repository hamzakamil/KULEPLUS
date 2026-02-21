# 🧾 TDHP Uyumlu, MongoDB'den PostgreSQL'e Geçişli Muhasebe Sistemi – Proje Yol Haritası (Roadmap)

Bu doküman, **Node.js (backend)** ve **Vue.js (frontend)** kullanılarak geliştirilecek, **Türkiye Tek Düzen Hesap Planı (TDHP)**'na tam uyumlu, **döviz**, **log kaydı**, **ön muhasebe bağlantı kodu**, **özel kod** gibi ek gereksinimleri içeren bir muhasebe sisteminin **aşamalı (fazlı) yol haritasını** sunar. Sistem, **MongoDB ile başlayıp daha sonra PostgreSQL'e geçiş** yapabilecek esneklikte tasarlanacaktır.

Bu roadmap, bir yapay zeka asistanına (örneğin Claude, ChatGPT) verilecek bir **görev tanımı (prompt)** olarak da kullanılabilir. Her fazın çıktıları net bir şekilde belirtilmiştir.

---

## 📋 Proje Genel Bilgileri

| Öğe | Açıklama |
|------|----------|
| **Proje Adı** | TDHP-Muhasebe-Core |
| **Amaç** | TDHP kurallarına göre çalışan, çift taraflı kayıt esaslı, döviz destekli, loglu, ön muhasebe entegrasyonuna hazır bir muhasebe sistemi geliştirmek. |
| **Teknolojiler** | Node.js (Express/NestJS tercihe bağlı), Vue.js (Vue 3 + Pinia + Vite), MongoDB (ilk aşama), PostgreSQL (hedef), Docker (opsiyonel) |
| **Veri Tabanı Geçişi** | MongoDB'den PostgreSQL'e sorunsuz geçiş için repository pattern ile soyutlama yapılacak. |
| **Ek Gereksinimler** | Döviz kodu ve miktar, log kaydı, ön muhasebe bağlantı kodu, özel kod (her hesap için) |

---

## 🧱 Faz 0: Proje Hazırlığı ve Mimari Tasarım

**Süre:** 1 hafta  
**Hedef:** Proje gereksinimlerinin netleştirilmesi, katmanlı mimarinin tasarlanması, teknolojik altyapının kurulması.

### Yapılacaklar:
- [ ] Detaylı gereksinim analizi yapılır (TDHP tüm hesaplar listelenir, düzenleyici hesaplar işaretlenir).
- [ ] Veritabanı bağımsız çalışacak şekilde **repository pattern** ve **servis katmanı** tasarlanır.
- [ ] Backend için Node.js + Express (veya NestJS) projesi oluşturulur.
- [ ] Frontend için Vue.js + Vite projesi oluşturulur.
- [ ] Geliştirme ortamı için Docker Compose dosyası hazırlanır (MongoDB, PostgreSQL, pgAdmin, Mongo Express).
- [ ] Versiyon kontrolü (Git) ve branching stratejisi belirlenir.
- [ ] Proje yapısı (klasör hiyerarşisi) oluşturulur.

### Çıktılar:
- Proje deposu (GitHub/GitLab)
- Mimari tasarım dokümanı (veri akış şemaları)
- Geliştirme ortamı kurulum kılavuzu

---

## 🗄️ Faz 1: Veritabanı Modelleri ve Soyutlama Katmanı

**Süre:** 2 hafta  
**Hedef:** Hem MongoDB hem PostgreSQL'de çalışacak şekilde veri modellerinin oluşturulması, repository katmanının yazılması.

### Yapılacaklar:

#### 1.1. Ortak Veri Modelleri (Entity’ler)
- **Hesap (Account)**
  - `hesapKodu` (string, unique)
  - `hesapAdi` (string)
  - `anaHesapMi` (boolean)
  - `hesapSinifi` (int: 1-9)
  - `normalBakiye` (int: 1 = borç, -1 = alacak)
  - `duzenleyiciHesapMi` (boolean)
  - `duzenleyiciHesapTuru` (string: 'aktif_duzenleyici' / 'pasif_duzenleyici' / null)
  - `ilgiliHesapKodu` (string, opsiyonel, foreign key)
  - **`dovizKodu`** (string, varsayılan 'TRY')
  - **`miktarBirimi`** (string, opsiyonel – örn. 'kg', 'adet')
  - **`onMuhasebeBaglantiKodu`** (string, opsiyonel – entegrasyon için)
  - **`ozelKod`** (string, opsiyonel – kullanıcı tanımlı)
  - `aktif` (boolean)
  - `createdAt`, `updatedAt`

- **Fiş (JournalEntry)**
  - `fisNo` (string, unique)
  - `tarih` (Date)
  - `aciklama` (string)
  - `eklenmeTarihi` (Date)
  - `kullaniciId` (string, opsiyonel)

- **Fiş Hareketi (EntryLine)**
  - `hareketId` (UUID)
  - `fisNo` (string, ref: JournalEntry)
  - `hesapKodu` (string, ref: Account)
  - `tutar` (decimal) – her zaman pozitif
  - `yon` (int: 1 = borç, -1 = alacak)
  - **`dovizKodu`** (string, varsayılan 'TRY')
  - **`dovizTutar`** (decimal, opsiyonel – döviz cinsinden tutar)
  - **`dovizKur`** (decimal, opsiyonel – işlem anı kur)
  - `aciklama` (string, opsiyonel)

- **Döviz Kuru (ExchangeRate)** (opsiyonel, günlük kur takibi için)
  - `dovizKodu` (string)
  - `tarih` (Date)
  - `kur` (decimal)

- **Log (AuditLog)** – tüm kritik işlemler kaydedilir
  - `logId` (UUID)
  - `kullaniciId` (string)
  - `islemTipi` (string: 'CREATE', 'UPDATE', 'DELETE', 'LOGIN' vb.)
  - `ilgiliTablo` (string)
  - `ilgiliKayitId` (string)
  - `eskiDeger` (JSON, opsiyonel)
  - `yeniDeger` (JSON, opsiyonel)
  - `ipAdresi` (string)
  - `tarih` (Date)

#### 1.2. Repository Katmanı (Soyutlama)
- **Interface/Abstract** tanımlanır: `IAccountRepository`, `IJournalRepository`, `ILogRepository` vb.
- **MongoDB için implementasyon** (mongoose şemaları ve modelleri)
- **PostgreSQL için implementasyon** (Sequelize veya TypeORM modelleri)
- Her iki repository de aynı metod imzalarına sahip olur (find, create, update, delete, findByHesapKodu vb.)
- **Factory pattern** ile hangi veritabanının kullanılacağı çalışma zamanında belirlenebilir (config ile).

#### 1.3. İndekslemeler ve Performans
- MongoDB: `hesapKodu`, `fisNo`, `tarih` alanlarına indeks.
- PostgreSQL: Aynı alanlara indeks, foreign key constraint'ler.

### Çıktılar:
- Mongoose şemaları (MongoDB)
- Sequelize/TypeORM modelleri (PostgreSQL)
- Repository arayüzleri ve implementasyonları
- Test verileriyle doldurulmuş iki veritabanı (geçici)

---

## ⚙️ Faz 2: Backend Core İş Mantığı (Servis Katmanı)

**Süre:** 3 hafta  
**Hedef:** Muhasebe kurallarını içeren iş mantığının geliştirilmesi, borç/alacak kontrolü, bakiye hesaplama, düzenleyici hesap yönetimi.

### Yapılacaklar:

#### 2.1. Hesap Servisi (AccountService)
- Hesap CRUD işlemleri (repository üzerinden)
- Hesap kodu benzersizlik kontrolü
- Düzenleyici hesap eklenirken ilgili hesabın varlığının kontrolü
- Hesap listesi getirirken **ana hesap – alt hesap** hiyerarşisini oluşturma

#### 2.2. Fiş Servisi (JournalService)
- Yeni fiş ekleme:
  - Aynı fişe ait hareketlerin borç toplamı = alacak toplamı kontrolü (`∑ (tutar*yon) = 0`)
  - Her hareketin `hesapKodu` geçerliliği
  - **Kural:** Düzenleyici hesaplara yapılan kayıtların yönü, hesabın `normalBakiye` alanına uygun olmalı (örnek: aktif düzenleyici hesaplara sadece alacak kaydı yapılabilir).
  - Döviz işlemleri: `dovizTutar` ve `dovizKur` girilmişse, `tutar` = `dovizTutar * dovizKur` şeklinde otomatik hesaplanabilir veya kullanıcı girişine bırakılır.
  - İşlem başarılıysa log kaydı (AuditLogService'e bildirilir).

#### 2.3. Bakiye Hesaplama ve Raporlama Servisi (BalanceService)
- Bir hesabın güncel bakiyesini hesaplama: `SUM(tutar * yon)`
- Belirli bir tarihe kadar olan bakiyeyi hesaplama
- **Ters bakiye kontrolü:** Hesabın karakterine göre beklenen bakiye yönünü kontrol eder (örnek: 100 Kasa hesabı borç bakiyesi vermeli, alacak bakiyesi varsa uyarı verir).
- Döviz bazında bakiye hesaplama (opsiyonel)

#### 2.4. Log Servisi (AuditLogService)
- Tüm create/update/delete işlemlerini otomatik kaydeden bir mekanizma (middleware veya decorator)
- Logları listeleme ve filtreleme

### Çıktılar:
- REST API endpoint'leri (Swagger dokümantasyonu ile):
  - `POST /api/accounts`
  - `GET /api/accounts`
  - `GET /api/accounts/:code/balance`
  - `POST /api/journal-entries` (fiş ekleme)
  - `GET /api/journal-entries`
  - `GET /api/reports/trial-balance` (mizan)
- Birim testleri (Jest/Mocha)

---

## 📊 Faz 3: Raporlama ve İleri İşlevler

**Süre:** 2 hafta  
**Hedef:** Mizan, bilanço, gelir tablosu, hesap ekstresi gibi raporların oluşturulması, döviz raporları, log sorgulama.

### Yapılacaklar:

#### 3.1. Mizan (Trial Balance)
- Tüm hesaplar için:
  - Borç toplamı
  - Alacak toplamı
  - Bakiye (borç-alacak farkı)
  - Bakiye yönü ve beklenen uyum bilgisi

#### 3.2. Bilanço ve Gelir Tablosu
- TDHP formatına uygun bilanço (aktif – pasif)
- Düzenleyici hesapların ilgili kalemlerden düşülmesi (netleştirme)
- Gelir tablosu (6 ve 7. sınıf hesaplar)

#### 3.3. Hesap Ekstresi
- Belirli bir hesabın tarih aralığındaki tüm hareketleri
- Başlangıç bakiyesi, hareketler, bitiş bakiyesi

#### 3.4. Döviz Raporları
- Döviz bazında net pozisyon
- Kur farkı hesaplama (opsiyonel)

#### 3.5. Log Raporlama
- Kullanıcı bazında log listesi
- Belirli bir kayda ait değişim geçmişi

### Çıktılar:
- Raporlama API endpoint'leri
- PDF/Excel çıktı desteği (opsiyonel, ek süre gerektirir)

---

## 🎨 Faz 4: Frontend Geliştirme (Vue.js)

**Süre:** 4 hafta  
**Hedef:** Kullanıcı dostu bir arayüz ile tüm işlevlerin kullanılabilir hale getirilmesi.

### Yapılacaklar:

#### 4.1. Proje Kurulumu ve Temel Bileşenler
- Vue 3 + Vite + Pinia (state yönetimi)
- Vue Router (sayfa yönlendirme)
- UI Kütüphanesi (örneğin Quasar, Vuetify veya TailwindCSS + HeadlessUI)
- Axios ile backend API bağlantısı

#### 4.2. Hesap Yönetimi Sayfası
- Hesap listesi (tree view ile ana-alt hesap gösterimi)
- Hesap ekleme/düzenleme formu (döviz kodu, özel kod vb. alanlar dahil)
- Hesap detay sayfası (bakiye, hareketler)

#### 4.3. Fiş Giriş Ekranı
- Yevmiye fişi ekleme formu
- Dinamik satır ekleme (borç/alacak satırları)
- Hesap seçimi (autocomplete)
- Borç-alacak toplamını anlık gösteren denetim
- Döviz bilgisi girişi

#### 4.4. Raporlama Sayfaları
- Mizan tablosu (filtreleme: tarih aralığı, hesap grubu)
- Bilanço ve gelir tablosu görüntüleme
- Hesap ekstresi (tarih aralığı, döviz tipi)
- Log görüntüleyici

#### 4.5. Kullanıcı Yönetimi (opsiyonel)
- Giriş/kayıt
- Rol bazlı yetkilendirme (admin, muhasebeci, izleyici)

### Çıktılar:
- Çalışan Vue.js uygulaması
- Backend ile entegre tüm sayfalar
- Responsive tasarım

---

## 🔄 Faz 5: MongoDB'den PostgreSQL'e Geçiş Stratejisi ve Test

**Süre:** 2 hafta  
**Hedef:** Mevcut MongoDB verilerinin PostgreSQL'e aktarılması ve sistemin her iki veritabanıyla da sorunsuz çalıştığının doğrulanması.

### Yapılacaklar:

#### 5.1. Geçiş Scripti (Migration Script)
- Node.js ile yazılmış bir script:
  - MongoDB'deki tüm koleksiyonları okur.
  - Veriyi dönüştürür (ObjectId'leri integer/UUID'ye çevirir, tarih formatlarını düzenler, duzenleyiciHesapTuru alanlarını kontrol eder).
  - PostgreSQL'e bulk insert yapar.
  - Veri bütünlüğü kontrolü yapar (borç-alacak toplamları, foreign key tutarlılığı).

#### 5.2. Test Ortamı
- Geçiş öncesi ve sonrası aynı test verileriyle sistemin çalıştığını doğrulama.
- Repository implementasyonunu değiştirerek (config'den) uygulamanın PostgreSQL'e yönlendirilmesi ve tüm testlerin geçmesi.

#### 5.3. Performans Testi
- Her iki veritabanında da aynı sorguların performans karşılaştırması.
- İndekslerin optimizasyonu.

### Çıktılar:
- Geçiş scripti
- Test raporu
- Geçiş sonrası PostgreSQL veritabanı

---

## 🧪 Faz 6: Test, Güvenlik ve Dağıtım

**Süre:** 2 hafta  
**Hedef:** Sistemin canlıya alınmaya hazır hale getirilmesi.

### Yapılacaklar:

#### 6.1. Kapsamlı Testler
- Birim testleri (servis katmanı)
- Entegrasyon testleri (API)
- Uçtan uca (E2E) testler (Cypress ile)
- Yük testi (opsiyonel)

#### 6.2. Güvenlik
- JWT tabanlı kimlik doğrulama
- Helmet.js ile güvenlik başlıkları
- Rate limiting
- SQL/NoSQL injection korumaları (ORM/ODM zaten korur)
- Veri doğrulama (Joi veya class-validator)

#### 6.3. Dağıtım
- Docker imajlarının hazırlanması
- CI/CD pipeline (GitHub Actions veya GitLab CI)
- Canlı ortamda MongoDB veya PostgreSQL seçeneğiyle kurulum

### Çıktılar:
- Test raporları
- Docker imajları
- Canlıya alınmış sistem

---

## 📌 Notlar ve Öneriler

- **Döviz İşlemleri:** Dövizli işlemlerde, her hareketin döviz cinsi ve kur bilgisi ayrıca saklanmalıdır. Raporlama sırasında istenirse kur farkı hesaplaması yapılabilir.
- **Ön Muhasebe Bağlantı Kodu:** Bu alan, sistemin başka bir yazılıma (örneğin fatura programı) entegre olması durumunda eşleştirme için kullanılacaktır.
- **Log Yönetimi:** Log kayıtları ayrı bir koleksiyonda/tabloda tutulmalı ve gerektiğinde otomatik temizleme (archiving) stratejisi uygulanmalıdır.
- **Düzenleyici Hesaplar:** Raporlarda düzenleyici hesapların ilgili ana hesap kalemi altında eksi (-) olarak gösterilmesi unutulmamalıdır.

---

Bu yol haritası, projenin başından sonuna kadar izlenecek adımları net bir şekilde tanımlamaktadır. Her fazın sonunda somut çıktılar elde edilecek ve bir sonraki faza geçiş için gerekli kontroller yapılmış olacaktır.

**İyi çalışmalar!**