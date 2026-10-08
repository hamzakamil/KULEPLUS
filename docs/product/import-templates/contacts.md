# Cari İçe Aktarma Şablonu

**Durum:** İskelet — Faz 2'de doldurulacak

## Kolonlar
| Kolon | Tip | Zorunlu | Örnek |
|-------|-----|---------|-------|
| contact_type | person / company | ✅ | company |
| company_name | metin | (company için ✅) | ABC Ltd. |
| first_name | metin | (person için ✅) | Ali |
| last_name | metin | (person için ✅) | Yılmaz |
| tax_number (VKN) | 10 hane | — | 1234567890 |
| identity_number (TCKN) | 11 hane | — | 12345678901 |
| phone | E.164 | — | +905551234567 |
| email | e-posta | — | info@abc.com |
| address_line1 | metin | — | ... |
| city | metin | — | İstanbul |
| district | metin | — | Kadıköy |

## Kurallar
- Aynı VKN veya (isim + telefon) mükerrer olarak işaretlenir.
- UTF-8 BOM zorunlu.
- `dry-run` sonucu kullanıcıya onaylatılır.