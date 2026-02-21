# Mimari Dokümantasyon - TDHP Muhasebe Sistemi

## 1. Genel Bakış

TDHP-Muhasebe-Core, Türkiye Tek Düzen Hesap Planı'na uyumlu, fatura programlarına API üzerinden entegre olabilen modüler bir muhasebe sistemidir.

```
┌─────────────────────────────────────────────────────────────┐
│                     VUE.JS FRONTEND                         │
│              (Vue 3 + Pinia + TailwindCSS)                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API (HTTP/JSON)
┌──────────────────────────▼──────────────────────────────────┐
│                    EXPRESS.JS BACKEND                        │
│                                                             │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Routes  │→ │Controllers│→ │ Services │→ │Repositories │ │
│  └─────────┘  └──────────┘  └──────────┘  └──────┬──────┘ │
│                                                    │        │
│  ┌─────────────────────────────────────┐          │        │
│  │     Integration Layer               │          │        │
│  │  ┌──────────┐ ┌──────────┐         │          │        │
│  │  │ Paraşüt  │ │ e-Fatura │ ...     │          │        │
│  │  │ Adapter  │ │ Adapter  │         │          │        │
│  │  └──────────┘ └──────────┘         │          │        │
│  └─────────────────────────────────────┘          │        │
└───────────────────────────────────────────────────┼────────┘
                                                    │
                          ┌─────────────────────────▼──────┐
                          │        DATABASE                 │
                          │   MongoDB ──→ PostgreSQL        │
                          └────────────────────────────────┘
```

## 2. Katmanlı Mimari

### 2.1 Route Katmanı (`/routes`)
- HTTP endpoint tanımları
- Swagger/OpenAPI anotasyonları
- Middleware zinciri (auth, validation)

### 2.2 Controller Katmanı (`/controllers`)
- HTTP request/response yönetimi
- Giriş doğrulama (Joi şemaları)
- Standart API yanıt formatı (`{ success, data, message, error }`)
- İş mantığı İÇERMEZ

### 2.3 Servis Katmanı (`/services`)
- **Tüm iş mantığı burada yaşar**
- Muhasebe kuralları (borç=alacak denkliği, düzenleyici hesap kuralları)
- Döviz hesaplamaları
- Otomatik audit log oluşturma
- Veritabanı bağımsız - Repository arayüzleri üzerinden çalışır

### 2.4 Repository Katmanı (`/repositories`)
- Veritabanı soyutlama katmanı
- Interface → MongoDB/PostgreSQL implementasyonu
- Factory Pattern ile runtime DB seçimi
- MongoDB → PostgreSQL geçişi sadece bu katmanı etkiler

### 2.5 Entegrasyon Katmanı (`/integrations`)
- Fatura programı adapterleri
- Adapter Pattern (Strategy Pattern)
- Standardize edilmiş fatura veri modeli
- Otomatik muhasebeleştirme motoru

## 3. Veri Modeli

```
┌─────────────┐     ┌──────────────────┐     ┌────────────┐
│   Account   │     │  JournalEntry    │     │  EntryLine │
│─────────────│     │──────────────────│     │────────────│
│ hesapKodu   │◄────│ fisNo            │────►│ hareketId  │
│ hesapAdi    │     │ tarih            │     │ hesapKodu  │
│ hesapSinifi │     │ aciklama         │     │ tutar      │
│ normalBakiye│     │ fisTipi          │     │ yon (B/A)  │
│ dovizKodu   │     │ hareketler[]     │     │ dovizKodu  │
│ ozelKod     │     │ toplamBorc       │     │ dovizTutar │
│ onMuhKod    │     │ toplamAlacak     │     │ dovizKur   │
│ duzenleyici │     │ kaynakEntegr.    │     │ aciklama   │
└─────────────┘     │ durum            │     └────────────┘
                    └──────────────────┘
                             │
                    ┌────────▼─────────┐     ┌──────────────┐
                    │    AuditLog      │     │ ExchangeRate │
                    │──────────────────│     │──────────────│
                    │ logId            │     │ dovizKodu    │
                    │ islemTipi        │     │ tarih        │
                    │ ilgiliTablo      │     │ alisCur      │
                    │ eskiDeger (JSON) │     │ satisCur     │
                    │ yeniDeger (JSON) │     │ kaynak       │
                    └──────────────────┘     └──────────────┘

┌───────────────────┐
│ IntegrationConfig │
│───────────────────│
│ programAdi        │
│ apiUrl            │
│ apiKey/Secret     │
│ accessToken       │
│ hesapEslestirmeler│
│ aktif             │
└───────────────────┘
```

## 4. Entegrasyon Mimarisi

### 4.1 Adapter Pattern

```
                    ┌──────────────────────┐
                    │   IInvoiceAdapter    │  ← Interface
                    │──────────────────────│
                    │ connect()            │
                    │ testConnection()     │
                    │ getFaturalar()       │
                    │ getFatura()          │
                    │ faturaToFis()        │
                    │ senkronize()         │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │     BaseAdapter      │  ← Abstract Class
                    │──────────────────────│
                    │ HTTP client          │
                    │ Muhasebeleştirme:    │
                    │  - satisFaturasiToFis│
                    │  - alisFaturasiToFis │
                    │  - iadeFaturasiToFis │
                    │ KDV hesaplama        │
                    │ Tevkifat hesaplama   │
                    └──────────┬───────────┘
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ParasutAdapter│ │EFaturaAdapter│ │CustomAdapter │
    │──────────────│ │──────────────│ │──────────────│
    │OAuth2 auth   │ │UBL-TR format │ │Field mapping │
    │JSON:API resp.│ │Entegratör API│ │Configurable  │
    │Company-based │ │Gelen/Giden   │ │endpoints     │
    └──────────────┘ └──────────────┘ └──────────────┘
```

### 4.2 Fatura → Fiş Dönüşüm Akışı

```
Fatura Programı API
        │
        ▼
  ┌─────────────┐     ┌──────────────┐     ┌────────────────┐
  │  Adapter     │────►│ StandartFatura│────►│ faturaToFis()  │
  │ (API çağrısı)│     │ (normalize)  │     │ (muhasebeleştir)│
  └─────────────┘     └──────────────┘     └───────┬────────┘
                                                    │
                                           ┌────────▼────────┐
                                           │ JournalService  │
                                           │ .createFrom     │
                                           │  Integration()  │
                                           └────────┬────────┘
                                                    │
                                           ┌────────▼────────┐
                                           │ JournalEntry    │
                                           │ (Yevmiye Fişi)  │
                                           │ + AuditLog      │
                                           └─────────────────┘
```

### 4.3 Muhasebeleştirme Kuralları

**Satış Faturası:**
```
BORÇ : 120 Alıcılar ................ Genel Toplam
ALACAK: 600 Yurtiçi Satışlar ....... Ara Toplam
ALACAK: 391 Hesaplanan KDV ......... KDV Toplam
```

**Alış Faturası:**
```
BORÇ : 153 Ticari Mallar ........... Ara Toplam
BORÇ : 191 İndirilecek KDV ........ KDV Toplam
ALACAK: 320 Satıcılar .............. Genel Toplam
```

**Satış İade Faturası:**
```
BORÇ : 610 Satıştan İadeler ........ Ara Toplam
BORÇ : 391 Hesaplanan KDV ......... KDV Toplam (ters kayıt)
ALACAK: 120 Alıcılar ............... Genel Toplam
```

## 5. Güvenlik Mimarisi

```
Client Request
    │
    ▼
┌──────────┐   ┌────────┐   ┌───────────┐   ┌──────────┐
│  Helmet  │──►│  CORS  │──►│Rate Limit │──►│ JWT Auth │
└──────────┘   └────────┘   └───────────┘   └────┬─────┘
                                                  │
                                         ┌────────▼────────┐
                                         │  Role-Based     │
                                         │  Authorization  │
                                         │  (admin,        │
                                         │   muhasebeci,   │
                                         │   izleyici)     │
                                         └────────┬────────┘
                                                  │
                                         ┌────────▼────────┐
                                         │  Joi Validation │
                                         └────────┬────────┘
                                                  │
                                         ┌────────▼────────┐
                                         │   Controller    │
                                         └─────────────────┘
```

## 6. Veritabanı Geçiş Stratejisi

```
Faz 1-5: MongoDB (Mongoose)
         │
         │  Repository Pattern sayesinde
         │  sadece repository implementasyonu değişir
         │
Faz 6:   ▼  PostgreSQL (Sequelize)

Config: DB_TYPE=mongodb  →  DB_TYPE=postgresql
```

**RepositoryFactory** sınıfı, çalışma zamanında `config.dbType` değerine göre doğru implementasyonu döner. Servis katmanı hiçbir zaman doğrudan veritabanı modeline erişmez.

## 7. API Standartları

### Yanıt Formatı
```json
{
  "success": true,
  "data": { ... },
  "message": "İşlem başarılı",
  "meta": {
    "page": 1,
    "limit": 25,
    "total": 150
  }
}
```

### Hata Formatı
```json
{
  "success": false,
  "error": "Hesap bulunamadı: 999",
  "message": "Detaylı hata açıklaması"
}
```

### HTTP Durum Kodları
| Kod | Kullanım |
|-----|----------|
| 200 | Başarılı GET/PUT/PATCH |
| 201 | Başarılı POST (oluşturma) |
| 400 | Doğrulama hatası / İş kuralı ihlali |
| 401 | Kimlik doğrulama hatası |
| 403 | Yetkilendirme hatası |
| 404 | Kayıt bulunamadı |
| 409 | Çakışma (duplicate key) |
| 500 | Sunucu hatası |
