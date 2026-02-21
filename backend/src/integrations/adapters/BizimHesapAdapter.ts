import { BaseAdapter } from '../common/BaseAdapter';
import { StandartFatura, FaturaTipi } from '../common/InvoiceAdapter';
import { logger } from '../../utils/logger';

/**
 * BizimHesap API Entegrasyon Adapter'ı
 * https://www.bizimhesap.com/ (Bulut tabanlı ön muhasebe)
 */
export class BizimHesapAdapter extends BaseAdapter {
  readonly adapterAdi = 'bizimhesap';
  readonly gorunenAd = 'BizimHesap';

  async testConnection(): Promise<boolean> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const res = await this.httpClient.get('/api/v1/company');
      return res.status === 200;
    } catch (error) {
      logger.error('BizimHesap bağlantı testi başarısız:', error);
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
      const endpoint = tip === 'satis' ? '/api/v1/sales-invoices' :
                       tip === 'alis' ? '/api/v1/purchase-invoices' :
                       '/api/v1/invoices';

      const res = await this.httpClient.get(endpoint, {
        params: {
          date_from: baslangic.toISOString().split('T')[0],
          date_to: bitis.toISOString().split('T')[0],
        },
      });

      for (const inv of res.data.data || res.data || []) {
        faturalar.push(this.mapBizimHesapInvoice(inv));
      }
    } catch (error) {
      logger.error('BizimHesap fatura çekme hatası:', error);
    }

    return faturalar;
  }

  async getFatura(faturaNo: string): Promise<StandartFatura | null> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const res = await this.httpClient.get(`/api/v1/invoices/${faturaNo}`);
      return this.mapBizimHesapInvoice(res.data.data || res.data);
    } catch {
      return null;
    }
  }

  private mapBizimHesapInvoice(data: any): StandartFatura {
    const tip = data.type === 'sale' || data.direction === 'out' ? 'satis' : 'alis';
    return {
      faturaNo: data.invoice_no || data.number || '',
      faturaTipi: tip as FaturaTipi,
      tarih: new Date(data.date || data.invoice_date),
      vadeTarih: data.due_date ? new Date(data.due_date) : undefined,
      cariAd: data.contact?.name || data.customer_name || '',
      cariVkn: data.contact?.tax_number || data.tax_id,
      dovizKodu: data.currency || 'TRY',
      dovizKur: data.exchange_rate ? parseFloat(data.exchange_rate) : undefined,
      durum: 'onaylandi',
      kalemler: (data.items || data.lines || []).map((item: any, idx: number) => ({
        siraNo: idx + 1,
        urunKod: item.code || item.product_code,
        urunAd: item.name || item.description || '',
        miktar: parseFloat(item.quantity) || 1,
        birim: item.unit || 'adet',
        birimFiyat: parseFloat(item.unit_price) || 0,
        tutar: parseFloat(item.amount) || 0,
        iskontoOran: parseFloat(item.discount_rate) || 0,
        iskontoTutar: parseFloat(item.discount_amount) || 0,
        kdvOran: parseFloat(item.vat_rate || item.tax_rate) || 0,
        kdvTutar: parseFloat(item.vat_amount || item.tax_amount) || 0,
        toplamTutar: parseFloat(item.total) || 0,
      })),
      araToplam: parseFloat(data.subtotal || data.net_total) || 0,
      kdvToplam: parseFloat(data.tax_total || data.vat_total) || 0,
      genelToplam: parseFloat(data.total || data.grand_total) || 0,
      aciklama: data.notes || data.description,
      kaynakId: data.id,
    };
  }
}
