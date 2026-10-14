-- Faz 8 Sat A — Havale/EFT manuel aktivasyon (SPEC §8.5).
-- "Havale ve yetkili personel tahsilat doğrulaması desteklenir."
-- Sipariş hangi ödeme yöntemiyle tahsil edileceğini taşır: 'card' (sanal POS,
-- iyzico — K-08) veya 'bank_transfer' (havale/EFT — manuel personel onayı).
-- Tenant tablosudur; RLS + mevcut grant'ler tablo genelinde olduğu için kolon
-- ekleme ek izin gerektirmez. Yalnızca kolon ekler (tablo/izin/katalog değişmez).

ALTER TABLE commercial_orders
    ADD COLUMN payment_method text NOT NULL DEFAULT 'card'
        CHECK (payment_method IN ('card', 'bank_transfer'));
