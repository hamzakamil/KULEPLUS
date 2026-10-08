# Golden Test Envanteri ve SMMM İmza Takibi

**Durum:** Aktif — SMMM danışman mevcut (karar: 8 Ekim 2026, `pending-decisions.md` D1)
**Kaynak:** `docs/ROADMAP.md` Ek B · Faz 5 çıkış kapısı
**Amaç:** Muhasebe doğruluğunun (Faz 5) SMMM imzasına bağlanması — her senaryo
"bekliyor → hazırlandı → imzalandı" zincirinden geçer.

**Kural:** Golden testler **test edilebilir** olmalıdır: her senaryo için beklenen
sonuç (mizan satırı, bakiye, vergi) net sayı olarak yazılır ve otomatik testle eşlenir.
İmzalanmamış senaryo Faz 5 kapısını geçemez.

---

## İlerleme Özeti

| Alan | Senaryo | Hazır | İmzalı |
|------|---------|-------|--------|
| Cari & Tahsilat | 4 | 0 | 0 |
| Fatura & Vergi | 7 | 0 | 0 |
| Muhasebe | 4 | 0 | 0 |
| Stok & Maliyet | 3 | 0 | 0 |
| **Toplam** | **18** | **0** | **0** |

---

## 1. Cari & Tahsilat

| # | Senaryo | Beklenen sonuç | Durum | İmza tarihi |
|---|---------|----------------|-------|-------------|
| G-1.1 | Açılış bakiyeli cari + kısmi tahsilat | Kalan bakiye = açılış − tahsilat | ⏳ bekliyor | — |
| G-1.2 | Çoktan-çoğa mahsup (1 tahsilat → 3 fatura) | `settlement_allocations` 3 satır; dağıtılmamış = 0 | ⏳ bekliyor | — |
| G-1.3 | Fazla ödeme → avans → sonraki faturaya mahsup | Avans bakiyesi doğru taşınır | ⏳ bekliyor | — |
| G-1.4 | İade + ters kayıt | Orijinal hareket değişmez; ters kayıt izlenir | ⏳ bekliyor | — |

## 2. Fatura & Vergi

| # | Senaryo | Beklenen sonuç | Durum | İmza tarihi |
|---|---------|----------------|-------|-------------|
| G-2.1 | Tek ürünlü fatura, %20 KDV | Matrah/KDV/genel toplam | ⏳ bekliyor | — |
| G-2.2 | Çok satırlı, farklı KDV oranları | Satır bazlı KDV doğru | ⏳ bekliyor | — |
| G-2.3 | İskonto (satır + belge düzeyi) | Matrah iskontodan sonra | ⏳ bekliyor | — |
| G-2.4 | Tevkifat (ör. 2/10) | Tevkifat tutarı + ödenecek KDV | ⏳ bekliyor | — |
| G-2.5 | İstisna | KDV = 0, istisna kodu taşınır | ⏳ bekliyor | — |
| G-2.6 | Yuvarlama (0.005 → 0.01) | Belge toplamı NUMERIC(20,4) | ⏳ bekliyor | — |
| G-2.7 | Dövizli fatura (kur + TL karşılık) | Faz 6 — kur tarihi doğru | ⏳ bekliyor | — |

## 3. Muhasebe

| # | Senaryo | Beklenen sonuç | Durum | İmza tarihi |
|---|---------|----------------|-------|-------------|
| G-3.1 | Otomatik fiş: fatura → 120/600/391 | Borç = Alacak | ⏳ bekliyor | — |
| G-3.2 | Otomatik fiş: tahsilat → 100/120 | Borç = Alacak | ⏳ bekliyor | — |
| G-3.3 | Dönem sonu mizan eşitliği | Toplam borç = toplam alacak | ⏳ bekliyor | — |
| G-3.4 | Kapanış fişi (690 → 692 → 580) | Kâr/zarar doğru aktarılır | ⏳ bekliyor | — |

## 4. Stok & Maliyet

| # | Senaryo | Beklenen sonuç | Durum | İmza tarihi |
|---|---------|----------------|-------|-------------|
| G-4.1 | Hareketli ortalama: 2 giriş + 1 çıkış | Birim maliyet doğru | ⏳ bekliyor | — |
| G-4.2 | Sayım farkı → maliyet etkisi | Fark hareketi + maliyet güncellenir | ⏳ bekliyor | — |
| G-4.3 | Negatif stok blokaj testi | `negative_stock_policy=block` → reddedilir | ⏳ bekliyor | — |

---

## SMMM Çalışma Düzeni

| Konu | Karar | Not |
|------|-------|-----|
| Danışman | ✅ Mevcut | Kim: TBD |
| Toplantı sıklığı | TBD | Faz 5 öncesi haftalık önerilir |
| Senaryo onayı | SMMM imzası | Her satır ayrı imzalanır |
| Değişiklik | Yeni senaryo = yeni satır | Mevcut imzalı senaryo sessizce değişmez |

**Sonraki adım:** Bu envanteri SMMM ile gözden geçir; her senaryo için beklenen
sayısal sonucu (mizan satırı / bakiye / KDV tutarı) doldur. Faz 3'te fatura ve tahsilat
modülleri gelince G-1.*/G-2.* otomatik testlere bağlanır.

---

*Bu belge `docs/ROADMAP.md` Ek B'nin yaşayan (living) kopyasıdır. ROADMAP toplu
senaryo listesini tutar; bu belge ilerleme + imza takibini tutar. GOVERNANCE §7:
ikisi çelişirse ROADMAP kaynaktır, bu belge durumu yansıtır.*
