import { BaseAdapter } from '../common/BaseAdapter';
import { StandartFatura, FaturaTipi } from '../common/InvoiceAdapter';
import { logger } from '../../utils/logger';

/**
 * Luca Muhasebe API Entegrasyon Adapter'ı
 * https://www.lfrfrcloud.com/ (Luca ön muhasebe sistemi)
 */
export class LucaAdapter extends BaseAdapter {
  readonly adapterAdi = 'luca';
  readonly gorunenAd = 'Luca';

  async testConnection(): Promise<boolean> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const res = await this.httpClient.get('/api/company/info');
      return res.status === 200;
    } catch (error) {
      logger.error('Luca bağlantı testi başarısız:', error);
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
      const res = await this.httpClient.get('/api/invoices', {
        params: {
          start_date: baslangic.toISOString().split('T')[0],
          end_date: bitis.toISOString().split('T')[0],
          type: tip === 'satis' ? 'sales' : tip === 'alis' ? 'purchase' : undefined,
        },
      });

      for (const inv of res.data.data || []) {
        faturalar.push(this.mapLucaInvoice(inv));
      }
    } catch (error) {
      logger.error('Luca fatura çekme hatası:', error);
    }

    return faturalar;
  }

  async getFatura(faturaNo: string): Promise<StandartFatura | null> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const res = await this.httpClient.get(`/api/invoices/${faturaNo}`);
      return this.mapLucaInvoice(res.data.data);
    } catch {
      return null;
    }
  }

  private mapLucaInvoice(data: any): StandartFatura {
    const tip = data.invoice_type === 'sales' ? 'satis' : 'alis';
    return {
      faturaNo: data.invoice_number || data.id,
      faturaTipi: tip as FaturaTipi,
      tarih: new Date(data.invoice_date),
      vadeTarih: data.due_date ? new Date(data.due_date) : undefined,
      cariAd: data.contact_name || '',
      cariVkn: data.tax_number,
      dovizKodu: data.currency || 'TRY',
      durum: 'onaylandi',
      kalemler: (data.lines || []).map((line: any, idx: number) => ({
        siraNo: idx + 1,
        urunKod: line.product_code,
        urunAd: line.description || '',
        miktar: parseFloat(line.quantity) || 1,
        birim: line.unit || 'adet',
        birimFiyat: parseFloat(line.unit_price) || 0,
        tutar: parseFloat(line.amount) || 0,
        kdvOran: parseFloat(line.vat_rate) || 0,
        kdvTutar: parseFloat(line.vat_amount) || 0,
        toplamTutar: parseFloat(line.total) || 0,
      })),
      araToplam: parseFloat(data.sub_total) || 0,
      kdvToplam: parseFloat(data.vat_total) || 0,
      genelToplam: parseFloat(data.grand_total) || 0,
      aciklama: data.notes,
      kaynakId: data.id,
    };
  }
}
