import { BaseAdapter } from '../common/BaseAdapter';
import { StandartFatura, FaturaTipi } from '../common/InvoiceAdapter';
import { logger } from '../../utils/logger';

/**
 * Mikro Yazılım API Entegrasyon Adapter'ı
 * Mikro ERP ve Mikro ön muhasebe entegrasyonu
 */
export class MikroAdapter extends BaseAdapter {
  readonly adapterAdi = 'mikro';
  readonly gorunenAd = 'Mikro Yazılım';

  async testConnection(): Promise<boolean> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const res = await this.httpClient.get('/api/test');
      return res.status === 200;
    } catch (error) {
      logger.error('Mikro bağlantı testi başarısız:', error);
      return false;
    }
  }

  async getFaturalar(
    baslangic: Date,
    bitis: Date,
    tip?: FaturaTipi
  ): Promise<StandartFatura[]> {
    if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
    const faturalar: StandartFatura[] = [];

    try {
      const faturaTypes = [];
      if (!tip || tip === 'satis') faturaTypes.push('SF'); // Satış Faturası
      if (!tip || tip === 'alis') faturaTypes.push('AF'); // Alış Faturası

      for (const ft of faturaTypes) {
        const res = await this.httpClient.get('/api/faturalar', {
          params: {
            tip: ft,
            baslangicTarih: baslangic.toISOString().split('T')[0],
            bitisTarih: bitis.toISOString().split('T')[0],
          },
        });
        for (const inv of res.data.faturalar || []) {
          faturalar.push(this.mapMikroInvoice(inv, ft === 'SF' ? 'satis' : 'alis'));
        }
      }
    } catch (error) {
      logger.error('Mikro fatura çekme hatası:', error);
    }

    return faturalar;
  }

  async getFatura(faturaNo: string): Promise<StandartFatura | null> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const res = await this.httpClient.get(`/api/faturalar/${faturaNo}`);
      return this.mapMikroInvoice(res.data, res.data.faturaTip === 'SF' ? 'satis' : 'alis');
    } catch {
      return null;
    }
  }

  private mapMikroInvoice(data: any, tip: 'satis' | 'alis'): StandartFatura {
    return {
      faturaNo: data.faturaNo || data.evrakNo || '',
      faturaTipi: tip,
      tarih: new Date(data.tarih || data.faturaTarihi),
      vadeTarih: data.vadeTarihi ? new Date(data.vadeTarihi) : undefined,
      cariAd: data.cariUnvan || data.cariAdi || '',
      cariVkn: data.vergiNo,
      dovizKodu: data.dovizCinsi || 'TRY',
      dovizKur: data.dovizKuru ? parseFloat(data.dovizKuru) : undefined,
      durum: 'onaylandi',
      kalemler: (data.satirlar || data.kalemler || []).map((line: any, idx: number) => ({
        siraNo: idx + 1,
        urunKod: line.stokKodu || line.malzemeKodu,
        urunAd: line.stokAdi || line.aciklama || '',
        miktar: parseFloat(line.miktar) || 1,
        birim: line.birim || 'adet',
        birimFiyat: parseFloat(line.birimFiyat) || 0,
        tutar: parseFloat(line.tutar) || 0,
        iskontoOran: parseFloat(line.iskontoOran) || 0,
        iskontoTutar: parseFloat(line.iskontoTutar) || 0,
        kdvOran: parseFloat(line.kdvOran) || 0,
        kdvTutar: parseFloat(line.kdvTutar) || 0,
        toplamTutar: parseFloat(line.toplamTutar || line.netTutar) || 0,
      })),
      araToplam: parseFloat(data.araToplam) || 0,
      kdvToplam: parseFloat(data.kdvToplam) || 0,
      genelToplam: parseFloat(data.genelToplam) || 0,
      aciklama: data.aciklama,
      kaynakId: data.id || data.faturaNo,
    };
  }
}
