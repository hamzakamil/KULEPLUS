# CLAUDE.md - Proje Bağlam Dosyası

## Proje: TDHP-Muhasebe-Core

TDHP (Türkiye Tek Düzen Hesap Planı) uyumlu, API-first muhasebe sistemi.
Tüm fatura düzenleyen programlara (e-Fatura, e-Arşiv, Paraşüt, Logo, Mikro, Luca, BizimHesap vb.) API entegrasyonu sağlayan modüler muhasebe çekirdeği.

## Teknoloji Yığını

- **Backend:** Node.js + Express.js (TypeScript)
- **Frontend:** Vue 3 + Vite + Pinia + TailwindCSS
- **Veritabanı:** MongoDB (başlangıç) → PostgreSQL (hedef)
- **ORM/ODM:** Mongoose (MongoDB), Sequelize (PostgreSQL)
- **Test:** Jest + Supertest
- **API Docs:** Swagger/OpenAPI 3.0
- **Auth:** JWT + bcrypt
- **Validation:** Joi

## Mimari Kurallar

1. **Repository Pattern:** Tüm veritabanı işlemleri repository arayüzleri üzerinden yapılır. Doğrudan model erişimi yasaktır.
2. **Servis Katmanı:** İş mantığı sadece servis katmanında bulunur. Controller'lar sadece HTTP request/response yönetir.
3. **Çift Taraflı Kayıt:** Her yevmiye fişinde `∑(tutar * yön) = 0` kuralı zorunludur.
4. **Audit Log:** Tüm CREATE/UPDATE/DELETE işlemleri otomatik loglanır.
5. **Döviz Desteği:** Her işlemde döviz kodu, kur ve döviz tutarı saklanır.

## Klasör Yapısı

```
/backend
  /src
    /config          # Uygulama ve DB konfigürasyonu
    /models          # Mongoose şemaları ve Sequelize modelleri
    /repositories    # Repository arayüzleri ve implementasyonları
    /services        # İş mantığı katmanı
    /controllers     # HTTP controller'lar
    /routes          # Express route tanımları
    /middlewares      # Auth, validation, error handler, audit log
    /integrations    # Fatura programı API entegrasyonları
      /adapters      # Her program için adapter (Paraşüt, Logo, vb.)
      /common        # Ortak entegrasyon interface'leri
    /utils           # Yardımcı fonksiyonlar
    /validators      # Joi şemaları
    /seeds           # TDHP hesap planı seed verileri
  /tests             # Jest test dosyaları
/frontend
  /src
    /views           # Sayfa bileşenleri
    /components      # Yeniden kullanılabilir bileşenler
    /stores          # Pinia store'ları
    /services        # API çağrıları
    /router          # Vue Router
    /assets          # Statik dosyalar
```

## Entegrasyon Mimarisi

Sistem, **Adapter Pattern** kullanarak farklı fatura programlarına bağlanır:

```
InvoiceAdapter (Interface)
├── ParasutAdapter
├── LogoAdapter
├── MikroAdapter
├── LucaAdapter
├── BizimHesapAdapter
├── EFaturaGIBAdapter (GİB doğrudan entegrasyon)
└── CustomAdapter (Özel entegrasyonlar)
```

Her adapter şu işlemleri destekler:
- Fatura verisi çekme (pull)
- Fatura verisi gönderme (push)
- Otomatik muhasebe fişi oluşturma
- Mutabakat kontrolü

## Önemli Komutlar

```bash
# Backend
cd backend && npm run dev          # Geliştirme sunucusu
cd backend && npm test             # Testleri çalıştır
cd backend && npm run seed         # TDHP hesap planını yükle
cd backend && npm run migrate      # Veritabanı migration

# Frontend
cd frontend && npm run dev         # Geliştirme sunucusu
cd frontend && npm run build       # Üretim build
```

## Kodlama Standartları

- Tüm dosyalar TypeScript ile yazılır
- Değişken ve fonksiyon adları İngilizce, açıklamalar Türkçe
- Her servis metodu için JSDoc yorum satırı
- Hata mesajları Türkçe (kullanıcıya dönük) ve İngilizce (log)
- HTTP response'lar standart format: `{ success, data, message, error }`

## TDHP Hesap Sınıfları

| Sınıf | Açıklama | Normal Bakiye |
|-------|----------|---------------|
| 1     | Dönen Varlıklar | Borç |
| 2     | Duran Varlıklar | Borç |
| 3     | Kısa Vadeli Yabancı Kaynaklar | Alacak |
| 4     | Uzun Vadeli Yabancı Kaynaklar | Alacak |
| 5     | Öz Kaynaklar | Alacak |
| 6     | Gelir Tablosu Hesapları | Borç |
| 7     | Maliyet Hesapları | Borç |
| 8     | Serbest | - |
| 9     | Nazım Hesaplar | - |
