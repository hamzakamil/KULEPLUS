/**
 * Türkiye Tek Düzen Hesap Planı (TDHP) Seed Verileri
 * Ana hesaplar (3 haneli) ve en çok kullanılan alt hesaplar
 */
export const tdhpHesapPlani = [
  // ═══════════════════════════════════════════════════
  // 1. SINIF - DÖNEN VARLIKLAR (Borç bakiyesi)
  // ═══════════════════════════════════════════════════

  // 10 - Hazır Değerler
  { hesapKodu: '100', hesapAdi: 'Kasa', normalBakiye: 1 },
  { hesapKodu: '101', hesapAdi: 'Alınan Çekler', normalBakiye: 1 },
  { hesapKodu: '102', hesapAdi: 'Bankalar', normalBakiye: 1 },
  { hesapKodu: '103', hesapAdi: 'Verilen Çekler ve Ödeme Emirleri (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },
  { hesapKodu: '108', hesapAdi: 'Diğer Hazır Değerler', normalBakiye: 1 },
  { hesapKodu: '109', hesapAdi: 'Banka Kredileri (-)', normalBakiye: -1 },

  // 11 - Menkul Kıymetler
  { hesapKodu: '110', hesapAdi: 'Hisse Senetleri', normalBakiye: 1 },
  { hesapKodu: '111', hesapAdi: 'Özel Kesim Tahvil, Senet ve Bonoları', normalBakiye: 1 },
  { hesapKodu: '112', hesapAdi: 'Kamu Kesimi Tahvil, Senet ve Bonoları', normalBakiye: 1 },
  { hesapKodu: '118', hesapAdi: 'Diğer Menkul Kıymetler', normalBakiye: 1 },
  { hesapKodu: '119', hesapAdi: 'Menkul Kıymetler Değer Düşüklüğü Karşılığı (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },

  // 12 - Ticari Alacaklar
  { hesapKodu: '120', hesapAdi: 'Alıcılar', normalBakiye: 1 },
  { hesapKodu: '121', hesapAdi: 'Alacak Senetleri', normalBakiye: 1 },
  { hesapKodu: '122', hesapAdi: 'Alacak Senetleri Reeskontu (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },
  { hesapKodu: '126', hesapAdi: 'Verilen Depozito ve Teminatlar', normalBakiye: 1 },
  { hesapKodu: '127', hesapAdi: 'Diğer Ticari Alacaklar', normalBakiye: 1 },
  { hesapKodu: '128', hesapAdi: 'Şüpheli Ticari Alacaklar', normalBakiye: 1 },
  { hesapKodu: '129', hesapAdi: 'Şüpheli Ticari Alacaklar Karşılığı (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },

  // 13 - Diğer Alacaklar
  { hesapKodu: '131', hesapAdi: 'Ortaklardan Alacaklar', normalBakiye: 1 },
  { hesapKodu: '132', hesapAdi: 'İştiraklerden Alacaklar', normalBakiye: 1 },
  { hesapKodu: '133', hesapAdi: 'Bağlı Ortaklıklardan Alacaklar', normalBakiye: 1 },
  { hesapKodu: '135', hesapAdi: 'Personelden Alacaklar', normalBakiye: 1 },
  { hesapKodu: '136', hesapAdi: 'Diğer Çeşitli Alacaklar', normalBakiye: 1 },
  { hesapKodu: '137', hesapAdi: 'Diğer Alacak Senetleri Reeskontu (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },
  { hesapKodu: '138', hesapAdi: 'Şüpheli Diğer Alacaklar', normalBakiye: 1 },
  { hesapKodu: '139', hesapAdi: 'Şüpheli Diğer Alacaklar Karşılığı (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },

  // 15 - Stoklar
  { hesapKodu: '150', hesapAdi: 'İlk Madde ve Malzeme', normalBakiye: 1 },
  { hesapKodu: '151', hesapAdi: 'Yarı Mamuller - Üretim', normalBakiye: 1 },
  { hesapKodu: '152', hesapAdi: 'Mamuller', normalBakiye: 1 },
  { hesapKodu: '153', hesapAdi: 'Ticari Mallar', normalBakiye: 1 },
  { hesapKodu: '157', hesapAdi: 'Diğer Stoklar', normalBakiye: 1 },
  { hesapKodu: '158', hesapAdi: 'Stok Değer Düşüklüğü Karşılığı (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },
  { hesapKodu: '159', hesapAdi: 'Verilen Sipariş Avansları', normalBakiye: 1 },

  // 17 - Yıllara Yaygın İnşaat ve Onarım Maliyetleri
  { hesapKodu: '170', hesapAdi: 'Yıllara Yaygın İnşaat ve Onarım Maliyetleri', normalBakiye: 1 },
  { hesapKodu: '179', hesapAdi: 'Taşeronlara Verilen Avanslar', normalBakiye: 1 },

  // 18 - Gelecek Aylara Ait Giderler ve Gelir Tahakkukları
  { hesapKodu: '180', hesapAdi: 'Gelecek Aylara Ait Giderler', normalBakiye: 1 },
  { hesapKodu: '181', hesapAdi: 'Gelir Tahakkukları', normalBakiye: 1 },

  // 19 - Diğer Dönen Varlıklar
  { hesapKodu: '190', hesapAdi: 'Devreden KDV', normalBakiye: 1 },
  { hesapKodu: '191', hesapAdi: 'İndirilecek KDV', normalBakiye: 1 },
  { hesapKodu: '192', hesapAdi: 'Diğer KDV', normalBakiye: 1 },
  { hesapKodu: '193', hesapAdi: 'Peşin Ödenen Vergiler ve Fonlar', normalBakiye: 1 },
  { hesapKodu: '195', hesapAdi: 'İş Avansları', normalBakiye: 1 },
  { hesapKodu: '196', hesapAdi: 'Personel Avansları', normalBakiye: 1 },
  { hesapKodu: '197', hesapAdi: 'Sayım ve Tesellüm Noksanları', normalBakiye: 1 },
  { hesapKodu: '199', hesapAdi: 'Diğer Çeşitli Dönen Varlıklar', normalBakiye: 1 },

  // ═══════════════════════════════════════════════════
  // 2. SINIF - DURAN VARLIKLAR (Borç bakiyesi)
  // ═══════════════════════════════════════════════════

  // 22 - Ticari Alacaklar (Uzun Vadeli)
  { hesapKodu: '220', hesapAdi: 'Alıcılar (Uzun Vadeli)', normalBakiye: 1 },
  { hesapKodu: '221', hesapAdi: 'Alacak Senetleri (Uzun Vadeli)', normalBakiye: 1 },
  { hesapKodu: '226', hesapAdi: 'Verilen Depozito ve Teminatlar (Uzun Vadeli)', normalBakiye: 1 },

  // 24 - Mali Duran Varlıklar
  { hesapKodu: '240', hesapAdi: 'Bağlı Menkul Kıymetler', normalBakiye: 1 },
  { hesapKodu: '242', hesapAdi: 'İştirakler', normalBakiye: 1 },
  { hesapKodu: '245', hesapAdi: 'Bağlı Ortaklıklar', normalBakiye: 1 },
  { hesapKodu: '249', hesapAdi: 'Ertelen. Vergi Varlıkları', normalBakiye: 1 },

  // 25 - Maddi Duran Varlıklar
  { hesapKodu: '250', hesapAdi: 'Arazi ve Arsalar', normalBakiye: 1 },
  { hesapKodu: '251', hesapAdi: 'Yeraltı ve Yerüstü Düzenleri', normalBakiye: 1 },
  { hesapKodu: '252', hesapAdi: 'Binalar', normalBakiye: 1 },
  { hesapKodu: '253', hesapAdi: 'Tesis, Makine ve Cihazlar', normalBakiye: 1 },
  { hesapKodu: '254', hesapAdi: 'Taşıtlar', normalBakiye: 1 },
  { hesapKodu: '255', hesapAdi: 'Demirbaşlar', normalBakiye: 1 },
  { hesapKodu: '256', hesapAdi: 'Diğer Maddi Duran Varlıklar', normalBakiye: 1 },
  { hesapKodu: '257', hesapAdi: 'Birikmiş Amortismanlar (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },
  { hesapKodu: '258', hesapAdi: 'Yapılmakta Olan Yatırımlar', normalBakiye: 1 },
  { hesapKodu: '259', hesapAdi: 'Verilen Avanslar', normalBakiye: 1 },

  // 26 - Maddi Olmayan Duran Varlıklar
  { hesapKodu: '260', hesapAdi: 'Haklar', normalBakiye: 1 },
  { hesapKodu: '261', hesapAdi: 'Şerefiye', normalBakiye: 1 },
  { hesapKodu: '262', hesapAdi: 'Kuruluş ve Örgütlenme Giderleri', normalBakiye: 1 },
  { hesapKodu: '263', hesapAdi: 'Araştırma ve Geliştirme Giderleri', normalBakiye: 1 },
  { hesapKodu: '264', hesapAdi: 'Özel Maliyetler', normalBakiye: 1 },
  { hesapKodu: '268', hesapAdi: 'Birikmiş Amortismanlar (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },
  { hesapKodu: '269', hesapAdi: 'Verilen Avanslar', normalBakiye: 1 },

  // 28 - Gelecek Yıllara Ait Giderler
  { hesapKodu: '280', hesapAdi: 'Gelecek Yıllara Ait Giderler', normalBakiye: 1 },
  { hesapKodu: '281', hesapAdi: 'Gelir Tahakkukları', normalBakiye: 1 },

  // 29 - Diğer Duran Varlıklar
  { hesapKodu: '291', hesapAdi: 'Gelecek Yıllarda İndirilecek KDV', normalBakiye: 1 },
  { hesapKodu: '292', hesapAdi: 'Diğer KDV', normalBakiye: 1 },
  { hesapKodu: '293', hesapAdi: 'Gelecek Yıllar İhtiyacı Stoklar', normalBakiye: 1 },
  { hesapKodu: '294', hesapAdi: 'Elden Çıkarılacak Stoklar ve Maddi Duran Varlıklar', normalBakiye: 1 },
  { hesapKodu: '295', hesapAdi: 'Peşin Ödenen Vergiler ve Fonlar', normalBakiye: 1 },
  { hesapKodu: '299', hesapAdi: 'Birikmiş Amortismanlar (-)', normalBakiye: -1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'aktif_duzenleyici' },

  // ═══════════════════════════════════════════════════
  // 3. SINIF - KISA VADELİ YABANCI KAYNAKLAR (Alacak bakiyesi)
  // ═══════════════════════════════════════════════════

  { hesapKodu: '300', hesapAdi: 'Banka Kredileri', normalBakiye: -1 },
  { hesapKodu: '303', hesapAdi: 'Uzun Vadeli Kredilerin Anapara Taksitleri ve Faizleri', normalBakiye: -1 },
  { hesapKodu: '320', hesapAdi: 'Satıcılar', normalBakiye: -1 },
  { hesapKodu: '321', hesapAdi: 'Borç Senetleri', normalBakiye: -1 },
  { hesapKodu: '322', hesapAdi: 'Borç Senetleri Reeskontu (-)', normalBakiye: 1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'pasif_duzenleyici' },
  { hesapKodu: '326', hesapAdi: 'Alınan Depozito ve Teminatlar', normalBakiye: -1 },
  { hesapKodu: '329', hesapAdi: 'Diğer Ticari Borçlar', normalBakiye: -1 },
  { hesapKodu: '331', hesapAdi: 'Ortaklara Borçlar', normalBakiye: -1 },
  { hesapKodu: '332', hesapAdi: 'İştiraklere Borçlar', normalBakiye: -1 },
  { hesapKodu: '333', hesapAdi: 'Bağlı Ortaklıklara Borçlar', normalBakiye: -1 },
  { hesapKodu: '335', hesapAdi: 'Personele Borçlar', normalBakiye: -1 },
  { hesapKodu: '336', hesapAdi: 'Diğer Çeşitli Borçlar', normalBakiye: -1 },
  { hesapKodu: '340', hesapAdi: 'Alınan Sipariş Avansları', normalBakiye: -1 },
  { hesapKodu: '350', hesapAdi: 'Yıllara Yaygın İnşaat ve Onarım Hakedişleri', normalBakiye: -1 },
  { hesapKodu: '360', hesapAdi: 'Ödenecek Vergi ve Fonlar', normalBakiye: -1 },
  { hesapKodu: '361', hesapAdi: 'Ödenecek Sosyal Güvenlik Kesintileri', normalBakiye: -1 },
  { hesapKodu: '368', hesapAdi: 'Vadesi Geçmiş Ertelenmiş veya Taksitlendirilmiş Vergi ve Diğer Yükümlülükler', normalBakiye: -1 },
  { hesapKodu: '370', hesapAdi: 'Dönem Karı Vergi ve Diğer Yasal Yükümlülük Karşılıkları', normalBakiye: -1 },
  { hesapKodu: '371', hesapAdi: 'Dönem Karının Peşin Ödenen Vergi ve Diğer Yükümlülükleri (-)', normalBakiye: 1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'pasif_duzenleyici' },
  { hesapKodu: '372', hesapAdi: 'Kıdem Tazminatı Karşılığı', normalBakiye: -1 },
  { hesapKodu: '373', hesapAdi: 'Maliyet Giderleri Karşılığı', normalBakiye: -1 },
  { hesapKodu: '379', hesapAdi: 'Diğer Borç ve Gider Karşılıkları', normalBakiye: -1 },
  { hesapKodu: '380', hesapAdi: 'Gelecek Aylara Ait Gelirler', normalBakiye: -1 },
  { hesapKodu: '381', hesapAdi: 'Gider Tahakkukları', normalBakiye: -1 },
  { hesapKodu: '391', hesapAdi: 'Hesaplanan KDV', normalBakiye: -1 },
  { hesapKodu: '392', hesapAdi: 'Diğer KDV', normalBakiye: -1 },
  { hesapKodu: '397', hesapAdi: 'Sayım ve Tesellüm Fazlaları', normalBakiye: -1 },
  { hesapKodu: '399', hesapAdi: 'Diğer Çeşitli Yabancı Kaynaklar', normalBakiye: -1 },

  // ═══════════════════════════════════════════════════
  // 4. SINIF - UZUN VADELİ YABANCI KAYNAKLAR (Alacak bakiyesi)
  // ═══════════════════════════════════════════════════

  { hesapKodu: '400', hesapAdi: 'Banka Kredileri (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '405', hesapAdi: 'Çıkarılmış Tahviller', normalBakiye: -1 },
  { hesapKodu: '420', hesapAdi: 'Satıcılar (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '421', hesapAdi: 'Borç Senetleri (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '426', hesapAdi: 'Alınan Depozito ve Teminatlar (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '431', hesapAdi: 'Ortaklara Borçlar (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '432', hesapAdi: 'İştiraklere Borçlar (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '436', hesapAdi: 'Diğer Çeşitli Borçlar (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '437', hesapAdi: 'Diğer Borç Senetleri Reeskontu (-)', normalBakiye: 1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'pasif_duzenleyici' },
  { hesapKodu: '440', hesapAdi: 'Alınan Sipariş Avansları (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '472', hesapAdi: 'Kıdem Tazminatı Karşılığı (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '480', hesapAdi: 'Gelecek Yıllara Ait Gelirler', normalBakiye: -1 },
  { hesapKodu: '481', hesapAdi: 'Gider Tahakkukları (Uzun Vadeli)', normalBakiye: -1 },
  { hesapKodu: '492', hesapAdi: 'Gelecek Yıllara Ertelenen veya Terkin Edilecek KDV', normalBakiye: -1 },
  { hesapKodu: '499', hesapAdi: 'Diğer Çeşitli Uzun Vadeli Yabancı Kaynaklar', normalBakiye: -1 },

  // ═══════════════════════════════════════════════════
  // 5. SINIF - ÖZ KAYNAKLAR (Alacak bakiyesi)
  // ═══════════════════════════════════════════════════

  { hesapKodu: '500', hesapAdi: 'Sermaye', normalBakiye: -1 },
  { hesapKodu: '501', hesapAdi: 'Ödenmemiş Sermaye (-)', normalBakiye: 1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'pasif_duzenleyici' },
  { hesapKodu: '520', hesapAdi: 'Hisse Senedi İhraç Primleri', normalBakiye: -1 },
  { hesapKodu: '521', hesapAdi: 'Hisse Senedi İptal Karları', normalBakiye: -1 },
  { hesapKodu: '522', hesapAdi: 'Maddi Duran Varlık Yeniden Değerleme Artışları', normalBakiye: -1 },
  { hesapKodu: '523', hesapAdi: 'İştirakler Yeniden Değerleme Artışları', normalBakiye: -1 },
  { hesapKodu: '540', hesapAdi: 'Yasal Yedekler', normalBakiye: -1 },
  { hesapKodu: '541', hesapAdi: 'Statü Yedekleri', normalBakiye: -1 },
  { hesapKodu: '542', hesapAdi: 'Olağanüstü Yedekler', normalBakiye: -1 },
  { hesapKodu: '549', hesapAdi: 'Özel Fonlar', normalBakiye: -1 },
  { hesapKodu: '570', hesapAdi: 'Geçmiş Yıllar Karları', normalBakiye: -1 },
  { hesapKodu: '580', hesapAdi: 'Geçmiş Yıllar Zararları (-)', normalBakiye: 1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'pasif_duzenleyici' },
  { hesapKodu: '590', hesapAdi: 'Dönem Net Karı', normalBakiye: -1 },
  { hesapKodu: '591', hesapAdi: 'Dönem Net Zararı (-)', normalBakiye: 1, duzenleyiciHesapMi: true, duzenleyiciHesapTuru: 'pasif_duzenleyici' },

  // ═══════════════════════════════════════════════════
  // 6. SINIF - GELİR TABLOSU HESAPLARI (Borç bakiyesi, gelirler alacak)
  // ═══════════════════════════════════════════════════

  { hesapKodu: '600', hesapAdi: 'Yurtiçi Satışlar', normalBakiye: -1 },
  { hesapKodu: '601', hesapAdi: 'Yurtdışı Satışlar', normalBakiye: -1 },
  { hesapKodu: '602', hesapAdi: 'Diğer Gelirler', normalBakiye: -1 },
  { hesapKodu: '610', hesapAdi: 'Satıştan İadeler (-)', normalBakiye: 1 },
  { hesapKodu: '611', hesapAdi: 'Satış İskontoları (-)', normalBakiye: 1 },
  { hesapKodu: '612', hesapAdi: 'Diğer İndirimler (-)', normalBakiye: 1 },
  { hesapKodu: '620', hesapAdi: 'Satılan Mamuller Maliyeti', normalBakiye: 1 },
  { hesapKodu: '621', hesapAdi: 'Satılan Ticari Mallar Maliyeti', normalBakiye: 1 },
  { hesapKodu: '622', hesapAdi: 'Satılan Hizmet Maliyeti', normalBakiye: 1 },
  { hesapKodu: '623', hesapAdi: 'Diğer Satışların Maliyeti', normalBakiye: 1 },
  { hesapKodu: '630', hesapAdi: 'Araştırma ve Geliştirme Giderleri', normalBakiye: 1 },
  { hesapKodu: '631', hesapAdi: 'Pazarlama Satış ve Dağıtım Giderleri', normalBakiye: 1 },
  { hesapKodu: '632', hesapAdi: 'Genel Yönetim Giderleri', normalBakiye: 1 },
  { hesapKodu: '640', hesapAdi: 'İştiraklerden Temettü Gelirleri', normalBakiye: -1 },
  { hesapKodu: '642', hesapAdi: 'Faiz Gelirleri', normalBakiye: -1 },
  { hesapKodu: '643', hesapAdi: 'Komisyon Gelirleri', normalBakiye: -1 },
  { hesapKodu: '644', hesapAdi: 'Konusu Kalmayan Karşılıklar', normalBakiye: -1 },
  { hesapKodu: '646', hesapAdi: 'Kambiyo Karları', normalBakiye: -1 },
  { hesapKodu: '647', hesapAdi: 'Reeskont Faiz Gelirleri', normalBakiye: -1 },
  { hesapKodu: '648', hesapAdi: 'Enflasyon Düzeltmesi Karları', normalBakiye: -1 },
  { hesapKodu: '649', hesapAdi: 'Diğer Olağan Gelir ve Karlar', normalBakiye: -1 },
  { hesapKodu: '654', hesapAdi: 'Karşılık Giderleri', normalBakiye: 1 },
  { hesapKodu: '655', hesapAdi: 'Menkul Kıymet Satış Zararları', normalBakiye: 1 },
  { hesapKodu: '656', hesapAdi: 'Kambiyo Zararları', normalBakiye: 1 },
  { hesapKodu: '657', hesapAdi: 'Reeskont Faiz Giderleri', normalBakiye: 1 },
  { hesapKodu: '658', hesapAdi: 'Enflasyon Düzeltmesi Zararları', normalBakiye: 1 },
  { hesapKodu: '659', hesapAdi: 'Diğer Olağan Gider ve Zararlar', normalBakiye: 1 },
  { hesapKodu: '660', hesapAdi: 'Kısa Vadeli Borçlanma Giderleri', normalBakiye: 1 },
  { hesapKodu: '661', hesapAdi: 'Uzun Vadeli Borçlanma Giderleri', normalBakiye: 1 },
  { hesapKodu: '671', hesapAdi: 'Önceki Dönem Gelir ve Karları', normalBakiye: -1 },
  { hesapKodu: '679', hesapAdi: 'Diğer Olağandışı Gelir ve Karlar', normalBakiye: -1 },
  { hesapKodu: '680', hesapAdi: 'Çalışmayan Kısım Gider ve Zararları', normalBakiye: 1 },
  { hesapKodu: '681', hesapAdi: 'Önceki Dönem Gider ve Zararları', normalBakiye: 1 },
  { hesapKodu: '689', hesapAdi: 'Diğer Olağandışı Gider ve Zararlar', normalBakiye: 1 },
  { hesapKodu: '690', hesapAdi: 'Dönem Karı veya Zararı', normalBakiye: 1 },
  { hesapKodu: '691', hesapAdi: 'Dönem Karı Vergi ve Diğer Yasal Yükümlülük Karşılıkları (-)', normalBakiye: 1 },
  { hesapKodu: '692', hesapAdi: 'Dönem Net Karı veya Zararı', normalBakiye: 1 },

  // ═══════════════════════════════════════════════════
  // 7. SINIF - MALİYET HESAPLARI (Borç bakiyesi)
  // ═══════════════════════════════════════════════════

  { hesapKodu: '700', hesapAdi: 'Maliyet Muhasebesi Bağlantı Hesabı', normalBakiye: 1 },
  { hesapKodu: '710', hesapAdi: 'Direkt İlk Madde ve Malzeme Giderleri', normalBakiye: 1 },
  { hesapKodu: '720', hesapAdi: 'Direkt İşçilik Giderleri', normalBakiye: 1 },
  { hesapKodu: '730', hesapAdi: 'Genel Üretim Giderleri', normalBakiye: 1 },
  { hesapKodu: '740', hesapAdi: 'Hizmet Üretim Maliyeti', normalBakiye: 1 },
  { hesapKodu: '750', hesapAdi: 'Araştırma ve Geliştirme Giderleri', normalBakiye: 1 },
  { hesapKodu: '760', hesapAdi: 'Pazarlama Satış ve Dağıtım Giderleri', normalBakiye: 1 },
  { hesapKodu: '770', hesapAdi: 'Genel Yönetim Giderleri', normalBakiye: 1 },
  { hesapKodu: '780', hesapAdi: 'Finansman Giderleri', normalBakiye: 1 },
  { hesapKodu: '799', hesapAdi: 'Üretim Maliyet Hesabı', normalBakiye: 1 },
];
