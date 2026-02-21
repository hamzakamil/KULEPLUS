# API Dokümantasyonu - TDHP Muhasebe Sistemi

**Base URL:** `http://localhost:3000/api`
**Swagger UI:** `http://localhost:3000/api-docs`

---

## Sağlık Kontrolü

### `GET /api/health`
Sunucu durumunu kontrol eder.

**Yanıt:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-02-21T10:00:00.000Z",
    "version": "0.1.0",
    "dbType": "mongodb"
  }
}
```

---

## Hesaplar (Accounts)

### `GET /api/accounts`
Tüm hesapları listeler.

**Query Parametreleri:**
| Parametre | Tip | Açıklama |
|-----------|-----|----------|
| sinif | number | Hesap sınıfı (1-9) |
| aktif | boolean | Aktif/pasif filtreleme |
| dovizKodu | string | Döviz kodu filtresi |

**Örnek:** `GET /api/accounts?sinif=1&aktif=true`

---

### `GET /api/accounts/tree`
Hesap planını hiyerarşik ağaç yapısında getirir.

**Yanıt:**
```json
{
  "success": true,
  "data": [
    {
      "hesapKodu": "100",
      "hesapAdi": "Kasa",
      "children": [
        { "hesapKodu": "1001", "hesapAdi": "TL Kasa", "children": [] }
      ]
    }
  ]
}
```

---

### `GET /api/accounts/search?q={query}`
Hesap kodu, hesap adı veya özel koda göre arama yapar.

---

### `GET /api/accounts/:kod`
Belirtilen hesap koduna sahip hesabı getirir.

**Örnek:** `GET /api/accounts/100`

---

### `POST /api/accounts`
Yeni hesap oluşturur.

**Body:**
```json
{
  "hesapKodu": "1001",
  "hesapAdi": "TL Kasa",
  "normalBakiye": 1,
  "dovizKodu": "TRY",
  "onMuhasebeBaglantiKodu": "KASA_TL",
  "ozelKod": "K001"
}
```

**Zorunlu Alanlar:** `hesapKodu`, `hesapAdi`
**Otomatik Alanlar:** `hesapSinifi` (hesap kodundan), `normalBakiye` (sınıftan), `ustHesapKodu`

---

### `PUT /api/accounts/:kod`
Hesap bilgilerini günceller.

---

### `DELETE /api/accounts/:kod`
Hesabı pasifleştirir (soft delete). Alt hesabı varsa hata döner.

---

## Yevmiye Fişleri (Journal Entries)

### `GET /api/journal-entries`
Yevmiye fişlerini listeler.

**Query Parametreleri:**
| Parametre | Tip | Açıklama |
|-----------|-----|----------|
| tarihBaslangic | date | Başlangıç tarihi (YYYY-MM-DD) |
| tarihBitis | date | Bitiş tarihi |
| fisTipi | string | mahsup, tahsil, tediye, acilis, kapanis, diger |
| durum | string | taslak, onaylandi, iptal |
| hesapKodu | string | Belirli hesabı içeren fişler |
| kaynakEntegrasyon | string | Entegrasyon kaynağı (parasut, efatura vb.) |
| page | number | Sayfa numarası |
| limit | number | Sayfa başına kayıt |

---

### `GET /api/journal-entries/:fisNo`
Belirtilen fiş numarasına sahip fişi getirir.

---

### `POST /api/journal-entries`
Yeni yevmiye fişi oluşturur.

**Body:**
```json
{
  "tarih": "2026-02-21",
  "aciklama": "Satış faturası - ABC Ltd. Şti.",
  "fisTipi": "mahsup",
  "hareketler": [
    {
      "hesapKodu": "120",
      "tutar": 11800,
      "yon": 1,
      "aciklama": "ABC Ltd. Şti. - Fatura No: F001"
    },
    {
      "hesapKodu": "600",
      "tutar": 10000,
      "yon": -1,
      "aciklama": "Satış geliri"
    },
    {
      "hesapKodu": "391",
      "tutar": 1800,
      "yon": -1,
      "aciklama": "Hesaplanan KDV %18"
    }
  ]
}
```

**Kurallar:**
- En az 2 hareket satırı olmalı
- `∑(tutar × yön) = 0` (Borç = Alacak)
- Tüm hesap kodları geçerli ve aktif olmalı
- Düzenleyici hesap kuralları kontrol edilir
- `yon: 1` = Borç, `yon: -1` = Alacak
- `tutar` her zaman pozitif olmalı

**Dövizli İşlem Örneği:**
```json
{
  "tarih": "2026-02-21",
  "aciklama": "USD satış faturası",
  "hareketler": [
    {
      "hesapKodu": "120",
      "tutar": 360000,
      "yon": 1,
      "dovizKodu": "USD",
      "dovizTutar": 10000,
      "dovizKur": 36.00
    },
    {
      "hesapKodu": "601",
      "tutar": 360000,
      "yon": -1
    }
  ]
}
```

---

### `PATCH /api/journal-entries/:fisNo/approve`
Taslak durumdaki fişi onaylar.

---

### `PATCH /api/journal-entries/:fisNo/cancel`
Fişi iptal eder.

---

### `GET /api/journal-entries/account/:hesapKodu/movements`
Belirli bir hesabın hareket detaylarını getirir.

**Query:** `?tarihBaslangic=2026-01-01&tarihBitis=2026-12-31`

---

## Raporlar (Reports)

### `GET /api/reports/balance/:hesapKodu`
Hesap bakiyesini hesaplar.

**Yanıt:**
```json
{
  "success": true,
  "data": {
    "hesapKodu": "100",
    "hesapAdi": "Kasa",
    "borcToplam": 50000,
    "alacakToplam": 35000,
    "bakiye": 15000,
    "bakiyeYonu": "borc",
    "tersBakiye": false,
    "tersBakiyeUyari": null
  }
}
```

---

### `GET /api/reports/trial-balance`
Mizan raporu.

**Query:** `?tarihBaslangic=2026-01-01&tarihBitis=2026-02-28&sinif=1`

**Yanıt:**
```json
{
  "success": true,
  "data": {
    "tarihBaslangic": "2026-01-01",
    "tarihBitis": "2026-02-28",
    "satirlar": [
      {
        "hesapKodu": "100",
        "hesapAdi": "Kasa",
        "borcToplam": 50000,
        "alacakToplam": 35000,
        "borcBakiye": 15000,
        "alacakBakiye": 0
      }
    ],
    "genelBorcToplam": 500000,
    "genelAlacakToplam": 500000,
    "denklikDurumu": true
  }
}
```

---

### `GET /api/reports/balance-sheet`
TDHP formatında bilanço raporu. Düzenleyici hesaplar netleştirilmiş olarak gösterilir.

**Query:** `?tarih=2026-02-28`

---

### `GET /api/reports/income-statement`
Gelir tablosu (6. ve 7. sınıf hesaplar).

**Query:** `?tarihBaslangic=2026-01-01&tarihBitis=2026-02-28`

---

### `GET /api/reports/account-statement/:hesapKodu`
Hesap ekstresi - başlangıç bakiyesi, hareketler ve bitiş bakiyesi.

**Query:** `?tarihBaslangic=2026-01-01&tarihBitis=2026-02-28`

---

## Entegrasyonlar (Integrations)

### `GET /api/integrations/supported`
Desteklenen fatura programlarını listeler.

**Yanıt:**
```json
{
  "success": true,
  "data": [
    { "id": "parasut", "ad": "Paraşüt" },
    { "id": "efatura", "ad": "GİB e-Fatura / e-Arşiv" },
    { "id": "logo", "ad": "Logo Yazılım" },
    { "id": "mikro", "ad": "Mikro Yazılım" },
    { "id": "luca", "ad": "Luca" },
    { "id": "bizimhesap", "ad": "BizimHesap" },
    { "id": "kolaybi", "ad": "Kolaybi" },
    { "id": "custom", "ad": "Özel Entegrasyon" }
  ]
}
```

---

### `GET /api/integrations`
Konfigüre edilmiş entegrasyonları listeler (API anahtarları gizlenir).

---

### `PUT /api/integrations/:programAdi/config`
Entegrasyon konfigürasyonu oluşturur veya günceller.

**Body (Paraşüt Örneği):**
```json
{
  "programGorunenAd": "Paraşüt",
  "apiUrl": "https://api.parasut.com",
  "apiKey": "your-client-id",
  "apiSecret": "your-client-secret",
  "accessToken": "your-access-token",
  "refreshToken": "your-refresh-token",
  "ekAyarlar": {
    "companyId": "123456"
  },
  "aktif": true
}
```

**Body (Özel Entegrasyon Örneği):**
```json
{
  "programGorunenAd": "Şirket X Fatura Sistemi",
  "apiUrl": "https://api.sirketx.com",
  "apiKey": "your-api-key",
  "ekAyarlar": {
    "endpoints": {
      "listInvoices": "/v1/faturalar",
      "getInvoice": "/v1/faturalar/{id}"
    },
    "fieldMapping": {
      "faturaNo": "fatura_numarasi",
      "tarih": "fatura_tarihi",
      "cariAd": "musteri.unvan",
      "genelToplam": "toplam_tutar",
      "kalemler": "satirlar"
    }
  },
  "aktif": true
}
```

---

### `POST /api/integrations/:programAdi/test`
Entegrasyon bağlantı testi yapar.

---

### `POST /api/integrations/:programAdi/sync`
Belirli bir program için fatura senkronizasyonu başlatır.

**Body:**
```json
{
  "baslangic": "2026-01-01",
  "bitis": "2026-02-28"
}
```

**Yanıt:**
```json
{
  "success": true,
  "data": {
    "basarili": 45,
    "basarisiz": 2,
    "hatalar": [
      {
        "faturaNo": "F-2026-0015",
        "hata": "Geçersiz hesap kodu: 999"
      }
    ],
    "sonSenkronizasyon": "2026-02-21T10:30:00.000Z"
  },
  "message": "Senkronizasyon tamamlandı: 45 başarılı"
}
```

---

### `POST /api/integrations/sync-all`
Tüm aktif entegrasyonları aynı anda senkronize eder.

---

### `PUT /api/integrations/:programAdi/account-mapping`
Fatura programı kodları ile TDHP hesap kodları arasındaki eşleştirmeleri günceller.

**Body:**
```json
{
  "eslestirmeler": [
    {
      "kaynakKod": "SATIS_GELİR",
      "hedefHesapKodu": "600",
      "aciklama": "Yurtiçi satış geliri"
    },
    {
      "kaynakKod": "KDV_18",
      "hedefHesapKodu": "391",
      "aciklama": "Hesaplanan KDV %18"
    }
  ]
}
```

---

## Hata Kodları

| HTTP Kodu | Açıklama | Örnek |
|-----------|----------|-------|
| 400 | Doğrulama hatası | "Borç-Alacak dengesi tutmuyor!" |
| 400 | İş kuralı ihlali | "Pasif hesaba kayıt yapılamaz" |
| 401 | Kimlik doğrulama | "Geçersiz token" |
| 403 | Yetkilendirme | "Bu işlem için yetkiniz yok" |
| 404 | Kayıt bulunamadı | "Hesap bulunamadı: 999" |
| 409 | Çakışma | "Bu hesap kodu zaten mevcut" |
| 429 | Rate limit | "Çok fazla istek gönderildi" |
| 500 | Sunucu hatası | "Sunucu hatası" |
| 503 | Servis kullanılamıyor | "Bağlantı başarısız" |
