# ROADMAP - TDHP Muhasebe Sistemi Yol Haritası

## Vizyon

Türkiye'deki tüm fatura düzenleyen programlara (e-Fatura, Paraşüt, Logo, Mikro, Luca, BizimHesap vb.) API üzerinden entegre olabilen, TDHP uyumlu, modüler muhasebe çekirdeği.

---

## Faz 0: Proje Altyapısı ve Mimari Tasarım
**Durum:** Aktif
**Öncelik:** Kritik

- [x] Gereksinim analizi ve readme dokümanı
- [x] CLAUDE.md proje bağlam dosyası
- [x] ROADMAP.md yol haritası
- [x] PROGRESS.md ilerleme takip dosyası
- [ ] Git repository kurulumu
- [ ] Backend proje iskeleti (Node.js + Express + TypeScript)
- [ ] Frontend proje iskeleti (Vue 3 + Vite)
- [ ] Docker Compose yapılandırması
- [ ] ESLint + Prettier konfigürasyonu
- [ ] CI/CD temel pipeline

---

## Faz 1: Veritabanı Modelleri ve Repository Katmanı
**Durum:** Beklemede
**Öncelik:** Kritik

### 1.1 Veri Modelleri
- [ ] Account (Hesap) modeli - TDHP uyumlu tüm alanlar
- [ ] JournalEntry (Yevmiye Fişi) modeli
- [ ] EntryLine (Fiş Hareketi) modeli
- [ ] ExchangeRate (Döviz Kuru) modeli
- [ ] AuditLog (Denetim Kaydı) modeli
- [ ] User (Kullanıcı) modeli
- [ ] IntegrationConfig (Entegrasyon Ayarları) modeli

### 1.2 Repository Pattern
- [ ] Repository interface tanımları (TypeScript)
- [ ] MongoDB (Mongoose) implementasyonu
- [ ] PostgreSQL (Sequelize) implementasyonu
- [ ] Repository Factory - runtime DB seçimi
- [ ] İndeksleme ve performans optimizasyonu

### 1.3 Seed Data
- [ ] TDHP tam hesap planı (1xx - 9xx)
- [ ] Örnek döviz kurları
- [ ] Test kullanıcıları

---

## Faz 2: Backend Core İş Mantığı
**Durum:** Beklemede
**Öncelik:** Yüksek

### 2.1 Hesap Servisi (AccountService)
- [ ] Hesap CRUD işlemleri
- [ ] Hesap kodu benzersizlik kontrolü
- [ ] Ana hesap - alt hesap hiyerarşisi
- [ ] Düzenleyici hesap yönetimi
- [ ] Hesap arama ve filtreleme

### 2.2 Fiş Servisi (JournalService)
- [ ] Yevmiye fişi oluşturma
- [ ] Borç = Alacak denklik kontrolü
- [ ] Döviz işlemleri ve kur hesaplaması
- [ ] Fiş numarası otomatik atama
- [ ] Fiş düzenleme ve iptal

### 2.3 Bakiye Servisi (BalanceService)
- [ ] Anlık bakiye hesaplama
- [ ] Tarih aralığı bazlı bakiye
- [ ] Döviz bazlı bakiye
- [ ] Ters bakiye uyarı sistemi

### 2.4 Denetim Servisi (AuditLogService)
- [ ] Otomatik log middleware
- [ ] Log sorgulama ve filtreleme
- [ ] Değişiklik geçmişi görüntüleme

---

## Faz 3: API Entegrasyon Katmanı (Fatura Programları)
**Durum:** Beklemede
**Öncelik:** Yüksek

### 3.1 Entegrasyon Altyapısı
- [ ] InvoiceAdapter interface tasarımı
- [ ] Adapter registry ve factory pattern
- [ ] Webhook altyapısı (fatura programlarından bildirim)
- [ ] Retry mekanizması ve hata yönetimi
- [ ] Rate limiting ve kuyruk sistemi

### 3.2 Fatura Programı Adapterleri
- [ ] **GİB e-Fatura** entegrasyonu (UBL-TR format)
- [ ] **Paraşüt** API adapter
- [ ] **Logo** API adapter
- [ ] **Mikro** API adapter
- [ ] **Luca** API adapter
- [ ] **BizimHesap** API adapter
- [ ] **Kolaybi** API adapter
- [ ] **Genel/Custom** adapter (kullanıcı tanımlı)

### 3.3 Otomatik Muhasebeleştirme
- [ ] Fatura → Yevmiye fişi dönüşüm kuralları
- [ ] Satış faturası muhasebeleştirme şablonu
- [ ] Alış faturası muhasebeleştirme şablonu
- [ ] KDV hesaplama ve muhasebeleştirme
- [ ] Tevkifat hesaplama
- [ ] İade faturası işleme
- [ ] Toplu fatura muhasebeleştirme

### 3.4 Mutabakat
- [ ] Fatura-fiş eşleştirme
- [ ] Uyumsuzluk raporlama
- [ ] Otomatik düzeltme önerileri

---

## Faz 4: Raporlama Sistemi
**Durum:** Beklemede
**Öncelik:** Orta

- [ ] Mizan raporu (aylık, yıllık, karşılaştırmalı)
- [ ] Bilanço (TDHP formatında, düzenleyici hesaplarla netleştirme)
- [ ] Gelir tablosu
- [ ] Hesap ekstresi
- [ ] Döviz pozisyon raporu
- [ ] KDV beyanname desteği
- [ ] Denetim log raporu
- [ ] PDF ve Excel export

---

## Faz 5: Frontend (Vue.js)
**Durum:** Beklemede
**Öncelik:** Orta

- [ ] Dashboard (özet bakiye, son işlemler, grafikler)
- [ ] Hesap planı yönetimi (tree view)
- [ ] Yevmiye fişi giriş ekranı
- [ ] Raporlama sayfaları
- [ ] Entegrasyon ayarları paneli
- [ ] Kullanıcı yönetimi
- [ ] Responsive tasarım

---

## Faz 6: Veritabanı Geçişi (MongoDB → PostgreSQL)
**Durum:** Beklemede
**Öncelik:** Düşük

- [ ] Migration script
- [ ] Veri bütünlüğü doğrulama
- [ ] Performans karşılaştırma testi
- [ ] Geçiş dokümantasyonu

---

## Faz 7: Güvenlik, Test ve Dağıtım
**Durum:** Beklemede
**Öncelik:** Orta

- [ ] JWT kimlik doğrulama
- [ ] Rol bazlı yetkilendirme (RBAC)
- [ ] Birim testleri (%80+ kapsam)
- [ ] Entegrasyon testleri
- [ ] E2E testleri
- [ ] Docker production imajları
- [ ] CI/CD pipeline
- [ ] API rate limiting
- [ ] Güvenlik taraması

---

## Gelecek Planlar (v2.0+)

- [ ] Çoklu şirket desteği
- [ ] Banka entegrasyonu (Open Banking API)
- [ ] OCR ile fatura okuma
- [ ] Mobil uygulama (Flutter/React Native)
- [ ] Yapay zeka destekli otomatik hesap eşleştirme
- [ ] Gerçek zamanlı kur güncelleme
- [ ] Elektronik defter (e-Defter) uyumluluğu
- [ ] XBRL raporlama desteği
