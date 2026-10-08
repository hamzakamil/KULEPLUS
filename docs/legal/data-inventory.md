# Veri Envanteri ve Saklama Matrisi

**Durum:** Faz 1 iskelet — hukukçu onayı ile Faz 2 öncesi dondurulur
**İlgili:** `docs/legal/kvkk-aydinlatma.md` §6 (Saklama Süresi) · `docs/TECHNICAL_SPEC.md` §27.2, §27.5
**Kaynak (tek doğruluk):** `data_retention_policies` tablosu seed değerleri (SPEC §27.5)

Bu dosya, KVKK aydınlatma metninin §6 "Saklama Süresi" bölümünün dayanağıdır. Saklama
süreleri kod tarafında `data_retention_policies` ile yönetilir; bu doküman insan-okur
katalogdur ve seed değerleriyle senkron tutulur.

---

## 1. Veri Kategorileri ve Saklama Süreleri

| data_category | Saklama | Aksiyon | Hukuki dayanak | Örnek tablolar |
|---------------|---------|---------|----------------|----------------|
| `financial` | 2555 gün (7 yıl) | `anonymize` | VUK / TTK | `invoices`, `invoice_lines`, `journal_entries`, `party_ledger_entries`, `stock_movements`, `cash_transactions`, `bank_transactions`, `expenses` |
| `personal` | 90 gün | `delete` | KVKK | `contact_phones`, `contact_emails`, `contact_addresses` (pasif kayıtlar), doğrulama/sıfırlama token kalıntıları |
| `audit` | 3650 gün (10 yıl) | `archive` | Yasal saklama | `audit_logs`, `legal_acceptances` |
| `logs` | 180 gün | `delete` | Operasyonel | Uygulama logları (pino), `email_outbox` gönderim kayıtları |
| `attachments` | 2555 gün (finansal referanslı) / 90 gün (kişisel) | `delete` | VUK/TTK + KVKK | S3 object storage üzerindeki dosyalar (`attachments` metadata) |

**Not:** `financial` kategorisi *anonimleştirilir, silinmez*; kişisel veriler *silinir*;
audit kayıtları *saklanır* (yasal). Yedeklerdeki kopyalar 30 gün içinde rotation ile düşer.

---

## 2. İşlenen Kişisel Veri Kategorileri

| Kategori | Veri örnekleri | Amaç | Hukuki dayanak (KVKK m.5) |
|----------|----------------|------|---------------------------|
| Kimlik | ad, soyad, ünvan | Hesap ve cari yönetimi | Sözleşmenin ifası (m.5/2-c) |
| İletişim | e-posta, telefon, adres | Bildirim, fatura, destek | Sözleşmenin ifası (m.5/2-c) |
| Müşteri işlem | fatura, tahsilat, stok hareketi | Hizmetin sunulması | Sözleşmenin ifası (m.5/2-c) |
| Finansal | ödeme kaydı, IBAN | Tahsilat/ödeme | Sözleşmenin ifası + yasal yükümlülük (m.5/2-a,ç) |
| Vergi kimlik | VKN / TCKN | e-Belge, yasal beyan | Yasal yükümlülük (m.5/2-ç) |
| Teknik | IP, user-agent, oturum | Güvenlik, denetim | Meşru menfaat (m.5/2-f) |

**Minimizasyon:** Gereksiz TCKN/hassas veri toplanmaz (SPEC §27.2). TCKN/VKN yalnızca
faturalama ve cari mutabakatı için, resmi doğrulama iddiası olmadan saklanır.

---

## 3. Alt İşleyenler (Özet)

| Alt işleyen | Kategori | Konum | Not |
|-------------|----------|-------|-----|
| TR VPS sağlayıcısı | Tüm tenant verisi | TR | Barındırma bölgesi karar: TR (K-12) |
| Object storage (S3 uyumlu) | `attachments` | TR | Sunucu tarafı şifreleme |
| E-posta (Postmark) | İletişim verisi | Yurt dışı | Ayrıca değerlendirilir (SPEC §27.2) |
| Analitik (Plausible) | Ziyaret verisi (site) | AB / self-host | KVKK dostu; çerezsiz |

Yurt dışı aktarım K-12 kararına (TR) göre DPA ile; aksi halde TR'de kalır.

---

## 4. KVKK İlgili Kişi Başvuruları

- **Erişim / düzeltme / silme** talepleri: destek kanalı → kimlik doğrulama → 30 gün içinde yanıt.
- **Tam veri dışa aktarma (ZIP):** Her planda açık (SPEC §23.2); "veri rehin alınmaz".
- **Tenant kapanış makinesi:** `active → suspended → closed → archived → purge` (SPEC §27.5).
  `closed` aşamasında salt okuma 30 gün, export hakkı 30 gün açık kalır.

---

*Bu dosya veri envanterinin tek insan-okur kaynağıdır. Seed (`data_retention_policies`) ile
farklılık görülürse kaynak seed'dir; doküman aynı PR'da güncellenir (GOVERNANCE §7).*
