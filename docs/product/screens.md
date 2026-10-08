# Ekran Listesi

**Durum:** İskelet — Faz 2 öncesi doldurulacak
**3 görünüm:** Patron (sade), Uzman (derin), Müşteri Portalı (harici)

## Format
| Route | Ekran | Görünüm | Rol/Permission | Faz | İlgili API |
|-------|-------|---------|----------------|-----|------------|

## Örnek satırlar
| `/login` | Giriş | Tümü | — | 1 | POST /auth/login |
| `/dashboard` | Patron Paneli | Patron | (tenant üyesi) | 2 | GET /dashboard/summary |
| `/contacts` | Cari Listesi | Uzman | contacts.contact.read | 2 | GET /contacts |
| ... | ... | ... | ... | ... | ... |