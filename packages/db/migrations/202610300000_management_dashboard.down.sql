-- Faz 7: Patron Görünümü v3 izin senkronunun geri alınması (SPEC §30.7).
DELETE FROM permissions WHERE code = 'management.dashboard.read';
