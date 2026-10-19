-- Muhasebe çekirdeği Faz 6 — TDHP şablonu düzeltmesi (A10).
--
-- Düzeltmeler (resmî Tek Düzen Hesap Planı; SMMM teyidi gerekir):
--  * Kambiyo kârı 646 / kambiyo zararı 656 (eski şablonda 645 / 655 idi; 645/655 menkul
--    kıymet satış kâr/zararıdır). Reeskont faiz gelir/giderleri 647 / 657'ye kayar.
--  * 36x: 362/363 resmî planda yok (pasife alınır); 368 "vadesi geçmiş..." ve 369 "ödenecek diğer".
--  * 37x, 13x, 30x, 405, 602, 680, 57/58 ad düzeltmeleri; eksik yaygın hesaplar eklenir.
-- Hesap kimliği (id) korunur: bu hesaplara bağlı fiş satırları ve hesap eşlemeleri bozulmaz.
-- Yalnızca ŞABLONDAN gelen (is_tdphp) ve adı eski şablonla birebir aynı hesaplar dönüştürülür;
-- kullanıcının değiştirdiği veya hedef kodu dolu olan hesaplara dokunulmaz.
-- 1) Kod kaydırma (sıra önemli: tekil kod kısıtı)
UPDATE accounting_accounts a SET code = '647', name = 'REESKONT FAİZ GELİRLERİ', updated_at = now()
 WHERE a.is_tdphp AND a.code = '646' AND a.name = 'REESKONT FAİZ GELİRLERİ'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '647');
UPDATE accounting_accounts a SET code = '646', name = 'KAMBİYO KÂRLARI', updated_at = now()
 WHERE a.is_tdphp AND a.code = '645' AND a.name = 'KAMBİYO KÂRLARI'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '646');
UPDATE accounting_accounts a SET code = '657', name = 'REESKONT FAİZ GİDERLERİ (-)', updated_at = now()
 WHERE a.is_tdphp AND a.code = '656' AND a.name = 'REESKONT FAİZ GİDERLERİ (-)'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '657');
UPDATE accounting_accounts a SET code = '656', name = 'KAMBİYO ZARARLARI (-)', updated_at = now()
 WHERE a.is_tdphp AND a.code = '655' AND a.name = 'KAMBİYO ZARARLARI (-)'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '656');
UPDATE accounting_accounts a SET code = '369', name = 'ÖDENECEK DİĞER YÜKÜMLÜLÜKLER', updated_at = now()
 WHERE a.is_tdphp AND a.code = '368' AND a.name = 'ÖDENECEK DİĞER YÜKÜMLÜLÜKLER'
   AND NOT EXISTS (SELECT 1 FROM accounting_accounts x WHERE x.tenant_id = a.tenant_id AND x.code = '369');

-- 2) Ad düzeltmeleri
UPDATE accounting_accounts SET name = 'DİĞER ALACAK SENETLERİ REESKONTU (-)', updated_at = now()
 WHERE is_tdphp AND code = '137' AND name = 'DİĞER ALACAK SENETLERİ';
UPDATE accounting_accounts SET name = 'ŞÜPHELİ DİĞER ALACAKLAR', updated_at = now()
 WHERE is_tdphp AND code = '138' AND name = 'DİĞER ALACAK SENETLERİ REESKONTU (-)';
UPDATE accounting_accounts SET name = 'ŞÜPHELİ DİĞER ALACAKLAR KARŞILIĞI (-)', updated_at = now()
 WHERE is_tdphp AND code = '139' AND name = 'ŞÜPHELİ DİĞER ALACAKLAR';
UPDATE accounting_accounts SET name = 'TAHVİL ANAPARA BORÇ, TAKSİT VE FAİZLERİ', updated_at = now()
 WHERE is_tdphp AND code = '304' AND name = 'TAHVİLLİ BORÇLAR';
UPDATE accounting_accounts SET name = 'ÇIKARILMIŞ BONOLAR VE SENETLER', updated_at = now()
 WHERE is_tdphp AND code = '305' AND name = 'ÇIKARILMIŞ BONOLAR';
UPDATE accounting_accounts SET name = 'MENKUL KIYMETLER İHRAÇ FARKI (-)', updated_at = now()
 WHERE is_tdphp AND code = '308' AND name = 'BANKA KREDİLERİ';
UPDATE accounting_accounts SET name = 'DÖNEM KÂRI VERGİ VE DİĞER YASAL YÜKÜMLÜLÜK KARŞILIKLARI', updated_at = now()
 WHERE is_tdphp AND code = '370' AND name = 'İZLEYEN DÖNEMLERDE KARŞILANACAK GİDERLER';
UPDATE accounting_accounts SET name = 'DÖNEM KÂRININ PEŞİN ÖDENEN VERGİ VE DİĞER YÜKÜMLÜLÜKLERİ (-)', updated_at = now()
 WHERE is_tdphp AND code = '371' AND name = 'PERSONEL KIDEM TAZMİNATI KARŞILIĞI';
UPDATE accounting_accounts SET name = 'ÇIKARILMIŞ TAHVİLLER', updated_at = now()
 WHERE is_tdphp AND code = '405' AND name = 'ÇIKARILMIŞ BONOLAR';
UPDATE accounting_accounts SET name = 'DİĞER GELİRLER', updated_at = now()
 WHERE is_tdphp AND code = '602' AND name = 'DİĞER SATIŞLAR';
UPDATE accounting_accounts SET name = 'ÇALIŞMAYAN KISIM GİDER VE ZARARLARI (-)', updated_at = now()
 WHERE is_tdphp AND code = '680' AND name = 'ÇEŞİTLİ GİDER VE ZARARLAR (-)';
UPDATE accounting_accounts SET name = 'GEÇMİŞ YILLAR KÂRLARI', updated_at = now()
 WHERE is_tdphp AND code = '57' AND name = 'GEÇMİŞ YILLAR KÂRLARI VEYA ZARARLARI';

-- 3) Resmî planda olmayan kodlar pasife alınır
UPDATE accounting_accounts SET is_active = false, updated_at = now()
 WHERE is_tdphp AND code = '362' AND name = 'ÖDENECEK SOSYAL GÜVENLİK İŞVEREN PRİMLERİ';
UPDATE accounting_accounts SET is_active = false, updated_at = now()
 WHERE is_tdphp AND code = '363' AND name = 'ÖDENECEK ZORUNLU TASARRUF KESİNTİLERİ';

-- 4) Eksik hesaplar (hesap planı olan her tenant'a; id deterministik — ADR-0002)
INSERT INTO accounting_accounts (id, tenant_id, code, name, type, is_tdphp)
SELECT (substr(m.h,1,8)||'-'||substr(m.h,9,4)||'-'||substr(m.h,13,4)||'-'||substr(m.h,17,4)||'-'||substr(m.h,21,12))::uuid,
       t.tenant_id, v.code, v.name, v.type, true
FROM (SELECT DISTINCT tenant_id FROM accounting_accounts) t
CROSS JOIN (VALUES
  ('302', 'ERTELENMİŞ FİNANSAL KİRALAMA BORÇLANMA MALİYETLERİ (-)', 'detail'),
  ('306', 'ÇIKARILMIŞ DİĞER MENKUL KIYMETLER', 'detail'),
  ('309', 'DİĞER MALİ BORÇLAR', 'detail'),
  ('368', 'VADESİ GEÇMİŞ, ERTELENMİŞ VEYA TAKSİTLENDİRİLMİŞ VERGİ VE DİĞER YÜKÜMLÜLÜKLER', 'detail'),
  ('372', 'KIDEM TAZMİNATI KARŞILIĞI', 'detail'),
  ('402', 'ERTELENMİŞ FİNANSAL KİRALAMA BORÇLANMA MALİYETLERİ (-)', 'detail'),
  ('408', 'MENKUL KIYMETLER İHRAÇ FARKI (-)', 'detail'),
  ('409', 'DİĞER MALİ BORÇLAR', 'detail'),
  ('521', 'HİSSE SENEDİ İPTAL KÂRLARI', 'detail'),
  ('549', 'ÖZEL FONLAR', 'detail'),
  ('58', 'GEÇMİŞ YILLAR ZARARLARI', 'group'),
  ('641', 'BAĞLI ORTAKLIKLARDAN TEMETTÜ GELİRLERİ', 'detail'),
  ('643', 'KOMİSYON GELİRLERİ', 'detail'),
  ('644', 'KONUSU KALMAYAN KARŞILIKLAR', 'detail'),
  ('645', 'MENKUL KIYMET SATIŞ KÂRLARI', 'detail'),
  ('646', 'KAMBİYO KÂRLARI', 'detail'),
  ('647', 'REESKONT FAİZ GELİRLERİ', 'detail'),
  ('648', 'ENFLASYON DÜZELTMESİ KÂRLARI', 'detail'),
  ('654', 'KARŞILIK GİDERLERİ (-)', 'detail'),
  ('655', 'MENKUL KIYMET SATIŞ ZARARLARI (-)', 'detail'),
  ('656', 'KAMBİYO ZARARLARI (-)', 'detail'),
  ('657', 'REESKONT FAİZ GİDERLERİ (-)', 'detail'),
  ('658', 'ENFLASYON DÜZELTMESİ ZARARLARI (-)', 'detail'),
  ('670', 'KONUSU KALMAYAN KARŞILIKLAR', 'detail')
) AS v(code, name, type)
CROSS JOIN LATERAL (SELECT md5('account:' || t.tenant_id::text || ':' || v.code) AS h) m
ON CONFLICT (tenant_id, code) DO NOTHING;
