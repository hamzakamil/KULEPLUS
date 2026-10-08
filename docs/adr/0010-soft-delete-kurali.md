# ADR-0010: Soft Delete Yalnızca Kart Tablolarında; Finansal Belgelerde Yasak

**Tarih:** 5 Ekim 2026
**Durum:** Kabul
**İlgili:** GOVERNANCE §3 (ID/ortak kolonlar) · SPEC §0.4 · README §2 (finansal bütünlük)

## Bağlam
Silinen kayıtları geri getirme ihtiyacı ile finansal değişmezlik çatışıyordu.

## Karar
- **Soft delete yalnızca kart niteliğindeki tablolarda** izinlidir (`contacts`, `products`,
  `users` vb. — `deleted_at` + pasif filtre).
- **Finansal belgelerde soft delete yasaktır.** Kesinleşmiş hareket silinmez;
  düzeltme **ters kayıt** ile yapılır (README §2.3).
- `audit_logs` ve finansal ledger tablolarında silme (soft/hard) hiçbir rolle yapılamaz.

## Alternatifler
| Alternatif | Neden reddedildi |
|------------|------------------|
| Her yerde soft delete | Finansal bütünlük ilkesi çöker; düzeltme izi kirlenir |
| Hiç soft delete yok | Kart yönetiminde kullanıcı deneyimi kaybı |

## Sonuçlar
- ➕ Denetim izi temiz, düzeltme kuralları tek tip
- ➖ Kart geri yükleme akışı için ayrı ekran gerekir (Faz 2)

## Kapanış Kriteri
"Finansal belge tablosunda `deleted_at` kolonu yoktur" — schema review + governance-check (Faz 1+).
