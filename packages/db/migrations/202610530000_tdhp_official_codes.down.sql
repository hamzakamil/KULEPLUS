-- Down migration for 202610530000_tdhp_official_codes.sql (SPEC §30.7: down zorunlu)
-- Not: yeni eklenen hesaplar hareketsizse silinir; kod kaydırmaları ve adlar geri alınır.

UPDATE accounting_accounts SET is_active = true, updated_at = now()
 WHERE is_tdphp AND code = '363' AND name = 'ÖDENECEK ZORUNLU TASARRUF KESİNTİLERİ';
UPDATE accounting_accounts SET is_active = true, updated_at = now()
 WHERE is_tdphp AND code = '362' AND name = 'ÖDENECEK SOSYAL GÜVENLİK İŞVEREN PRİMLERİ';
UPDATE accounting_accounts SET name = 'GEÇMİŞ YILLAR KÂRLARI VEYA ZARARLARI', updated_at = now()
 WHERE is_tdphp AND code = '57' AND name = 'GEÇMİŞ YILLAR KÂRLARI';
UPDATE accounting_accounts SET name = 'ÇEŞİTLİ GİDER VE ZARARLAR (-)', updated_at = now()
 WHERE is_tdphp AND code = '680' AND name = 'ÇALIŞMAYAN KISIM GİDER VE ZARARLARI (-)';
UPDATE accounting_accounts SET name = 'DİĞER SATIŞLAR', updated_at = now()
 WHERE is_tdphp AND code = '602' AND name = 'DİĞER GELİRLER';
UPDATE accounting_accounts SET name = 'ÇIKARILMIŞ BONOLAR', updated_at = now()
 WHERE is_tdphp AND code = '405' AND name = 'ÇIKARILMIŞ TAHVİLLER';
UPDATE accounting_accounts SET name = 'PERSONEL KIDEM TAZMİNATI KARŞILIĞI', updated_at = now()
 WHERE is_tdphp AND code = '371' AND name = 'DÖNEM KÂRININ PEŞİN ÖDENEN VERGİ VE DİĞER YÜKÜMLÜLÜKLERİ (-)';
UPDATE accounting_accounts SET name = 'İZLEYEN DÖNEMLERDE KARŞILANACAK GİDERLER', updated_at = now()
 WHERE is_tdphp AND code = '370' AND name = 'DÖNEM KÂRI VERGİ VE DİĞER YASAL YÜKÜMLÜLÜK KARŞILIKLARI';
UPDATE accounting_accounts SET name = 'BANKA KREDİLERİ', updated_at = now()
 WHERE is_tdphp AND code = '308' AND name = 'MENKUL KIYMETLER İHRAÇ FARKI (-)';
UPDATE accounting_accounts SET name = 'ÇIKARILMIŞ BONOLAR', updated_at = now()
 WHERE is_tdphp AND code = '305' AND name = 'ÇIKARILMIŞ BONOLAR VE SENETLER';
UPDATE accounting_accounts SET name = 'TAHVİLLİ BORÇLAR', updated_at = now()
 WHERE is_tdphp AND code = '304' AND name = 'TAHVİL ANAPARA BORÇ, TAKSİT VE FAİZLERİ';
UPDATE accounting_accounts SET name = 'ŞÜPHELİ DİĞER ALACAKLAR', updated_at = now()
 WHERE is_tdphp AND code = '139' AND name = 'ŞÜPHELİ DİĞER ALACAKLAR KARŞILIĞI (-)';
UPDATE accounting_accounts SET name = 'DİĞER ALACAK SENETLERİ REESKONTU (-)', updated_at = now()
 WHERE is_tdphp AND code = '138' AND name = 'ŞÜPHELİ DİĞER ALACAKLAR';
UPDATE accounting_accounts SET name = 'DİĞER ALACAK SENETLERİ', updated_at = now()
 WHERE is_tdphp AND code = '137' AND name = 'DİĞER ALACAK SENETLERİ REESKONTU (-)';

DELETE FROM accounting_accounts a
 WHERE a.is_tdphp AND a.code IN ('302', '306', '309', '368', '372', '402', '408', '409', '521', '549', '58', '641', '643', '644', '645', '646', '647', '648', '654', '655', '656', '657', '658', '670')
   AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.account_id = a.id)
   AND NOT EXISTS (SELECT 1 FROM account_mappings am WHERE am.account_id = a.id)
   AND a.name IN ('BAĞLI ORTAKLIKLARDAN TEMETTÜ GELİRLERİ', 'DİĞER MALİ BORÇLAR', 'ENFLASYON DÜZELTMESİ KÂRLARI', 'ENFLASYON DÜZELTMESİ ZARARLARI (-)', 'ERTELENMİŞ FİNANSAL KİRALAMA BORÇLANMA MALİYETLERİ (-)', 'GEÇMİŞ YILLAR ZARARLARI', 'HİSSE SENEDİ İPTAL KÂRLARI', 'KAMBİYO KÂRLARI', 'KAMBİYO ZARARLARI (-)', 'KARŞILIK GİDERLERİ (-)', 'KIDEM TAZMİNATI KARŞILIĞI', 'KOMİSYON GELİRLERİ', 'KONUSU KALMAYAN KARŞILIKLAR', 'MENKUL KIYMET SATIŞ KÂRLARI', 'MENKUL KIYMET SATIŞ ZARARLARI (-)', 'MENKUL KIYMETLER İHRAÇ FARKI (-)', 'REESKONT FAİZ GELİRLERİ', 'REESKONT FAİZ GİDERLERİ (-)', 'VADESİ GEÇMİŞ, ERTELENMİŞ VEYA TAKSİTLENDİRİLMİŞ VERGİ VE DİĞER YÜKÜMLÜLÜKLER', 'ÇIKARILMIŞ DİĞER MENKUL KIYMETLER', 'ÖZEL FONLAR');

UPDATE accounting_accounts a SET code = '368', name = 'ÖDENECEK DİĞER YÜKÜMLÜLÜKLER', updated_at = now()
 WHERE a.is_tdphp AND a.code = '369' AND a.name = 'ÖDENECEK DİĞER YÜKÜMLÜLÜKLER'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '368');
UPDATE accounting_accounts a SET code = '655', name = 'KAMBİYO ZARARLARI (-)', updated_at = now()
 WHERE a.is_tdphp AND a.code = '656' AND a.name = 'KAMBİYO ZARARLARI (-)'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '655');
UPDATE accounting_accounts a SET code = '656', name = 'REESKONT FAİZ GİDERLERİ (-)', updated_at = now()
 WHERE a.is_tdphp AND a.code = '657' AND a.name = 'REESKONT FAİZ GİDERLERİ (-)'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '656');
UPDATE accounting_accounts a SET code = '645', name = 'KAMBİYO KÂRLARI', updated_at = now()
 WHERE a.is_tdphp AND a.code = '646' AND a.name = 'KAMBİYO KÂRLARI'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '645');
UPDATE accounting_accounts a SET code = '646', name = 'REESKONT FAİZ GELİRLERİ', updated_at = now()
 WHERE a.is_tdphp AND a.code = '647' AND a.name = 'REESKONT FAİZ GELİRLERİ'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '646');
