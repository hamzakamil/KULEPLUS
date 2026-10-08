# ADR-0011: legal_texts ve legal_acceptances `core` modülüne taşındı; ikisi de global

**Tarih:** 5 Ekim 2026
**Durum:** Kabul

## Bağlam
SPEC §8.2 bu tabloları Faz 4'te `subscription` modülüne koyuyordu. Ancak kayıt/kimlik akışında KVKK aydınlatma kabulü Faz 1'de gerekli; abonelikle ilişkisi yok.

## Karar
- İki tablo `core` modülüne taşındı (GOVERNANCE §2 güncellendi).
- Faz 1'e çekildi (SPEC §8.2 güncellendi).
- İkisi de **global**; `tenant_id` taşımaz.
- `legal_acceptances` yalnızca `user_id` bazlıdır.

## Alternatifler
- Tenant bazlı aydınlatma: anlamsız (SaaS'ta aynı metin).
- Tenant'a özgü DPA: ayrı tablo (ileride gerekirse).

## Sonuç
Kayıt akışı Faz 1'de tamamlanır; yasal metin sürümlemesi tek yerden yönetilir.

## Kapanış Kriteri
Faz 1 e2e testinde kullanıcı kaydı KVKK kabulü ile tamamlanır; `legal_acceptances`'te kayıt oluşur.