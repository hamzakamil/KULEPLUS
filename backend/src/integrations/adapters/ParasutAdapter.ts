import { BaseAdapter } from '../common/BaseAdapter';
import { StandartFatura, FaturaTipi } from '../common/InvoiceAdapter';
import { logger } from '../../utils/logger';

/**
 * Paraşüt API Entegrasyon Adapter'ı
 * https://apidocs.parasut.com/
 *
 * Paraşüt, OAuth2 tabanlı kimlik doğrulama kullanır.
 * Fatura, müşteri, ürün ve tahsilat verilerine erişim sağlar.
 */
export class ParasutAdapter extends BaseAdapter {
  readonly adapterAdi = 'parasut';
  readonly gorunenAd = 'Paraşüt';

  private companyId: string = '';

  async connect(config: any): Promise<void> {
    await super.connect(config);
    this.companyId = config.ekAyarlar?.companyId as string || '';

    if (!this.companyId) {
      throw new Error('Paraşüt entegrasyonu için companyId gereklidir');
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const response = await this.httpClient.get(
        `/v4/${this.companyId}/company`
      );
      return response.status === 200;
    } catch (error) {
      logger.error('Paraşüt bağlantı testi başarısız:', error);
      return false;
    }
  }

  async refreshAccessToken(): Promise<string> {
    if (!this.httpClient || !this.config) {
      throw new Error('Bağlantı kurulmamış');
    }

    const response = await this.httpClient.post('/oauth/token', {
      grant_type: 'refresh_token',
      client_id: this.config.apiKey,
      client_secret: this.config.apiSecret,
      refresh_token: this.config.refreshToken,
    });

    const newToken = response.data.access_token;
    this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    return newToken;
  }

  async getFaturalar(
    baslangic: Date,
    bitis: Date,
    tip?: FaturaTipi
  ): Promise<StandartFatura[]> {
    if (!this.httpClient) throw new Error('Bağlantı kurulmamış');

    const faturalar: StandartFatura[] = [];

    // Satış faturaları
    if (!tip || tip === 'satis') {
      const satisFaturalari = await this.fetchSalesInvoices(baslangic, bitis);
      faturalar.push(...satisFaturalari);
    }

    // Alış faturaları
    if (!tip || tip === 'alis') {
      const alisFaturalari = await this.fetchPurchaseInvoices(baslangic, bitis);
      faturalar.push(...alisFaturalari);
    }

    return faturalar;
  }

  async getFatura(faturaNo: string): Promise<StandartFatura | null> {
    // Paraşüt'te fatura ID ile arama
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const response = await this.httpClient.get(
        `/v4/${this.companyId}/sales_invoices/${faturaNo}`
      );
      return this.mapParasutSalesInvoice(response.data.data);
    } catch {
      return null;
    }
  }

  /** Paraşüt satış faturalarını çek */
  private async fetchSalesInvoices(
    baslangic: Date,
    bitis: Date
  ): Promise<StandartFatura[]> {
    const response = await this.httpClient!.get(
      `/v4/${this.companyId}/sales_invoices`,
      {
        params: {
          'filter[issue_date]': `${baslangic.toISOString().split('T')[0]}...${bitis.toISOString().split('T')[0]}`,
          'page[size]': 25,
        },
      }
    );

    return (response.data.data || []).map((inv: any) =>
      this.mapParasutSalesInvoice(inv)
    );
  }

  /** Paraşüt alış faturalarını çek */
  private async fetchPurchaseInvoices(
    baslangic: Date,
    bitis: Date
  ): Promise<StandartFatura[]> {
    const response = await this.httpClient!.get(
      `/v4/${this.companyId}/purchase_bills`,
      {
        params: {
          'filter[issue_date]': `${baslangic.toISOString().split('T')[0]}...${bitis.toISOString().split('T')[0]}`,
          'page[size]': 25,
        },
      }
    );

    return (response.data.data || []).map((inv: any) =>
      this.mapParasutPurchaseInvoice(inv)
    );
  }

  /** Paraşüt satış faturasını standart formata dönüştür */
  private mapParasutSalesInvoice(data: any): StandartFatura {
    const attrs = data.attributes;
    return {
      faturaNo: attrs.invoice_no || data.id,
      faturaTipi: 'satis',
      tarih: new Date(attrs.issue_date),
      vadeTarih: attrs.due_date ? new Date(attrs.due_date) : undefined,
      cariAd: attrs.contact?.name || 'Bilinmeyen',
      cariVkn: attrs.contact?.tax_number,
      dovizKodu: attrs.currency || 'TRY',
      dovizKur: attrs.exchange_rate ? parseFloat(attrs.exchange_rate) : undefined,
      durum: this.mapParasutStatus(attrs.status),
      kalemler: (attrs.details || []).map((d: any, i: number) => ({
        siraNo: i + 1,
        urunKod: d.product?.code,
        urunAd: d.product?.name || d.description || '',
        miktar: parseFloat(d.quantity) || 1,
        birim: d.unit || 'adet',
        birimFiyat: parseFloat(d.unit_price) || 0,
        tutar: parseFloat(d.net_total) || 0,
        iskontoOran: parseFloat(d.discount_percentage) || 0,
        iskontoTutar: parseFloat(d.discount) || 0,
        kdvOran: parseFloat(d.vat_rate) || 0,
        kdvTutar: parseFloat(d.vat_amount) || 0,
        toplamTutar: parseFloat(d.total) || 0,
      })),
      araToplam: parseFloat(attrs.net_total) || 0,
      kdvToplam: parseFloat(attrs.total_vat) || 0,
      genelToplam: parseFloat(attrs.gross_total) || 0,
      aciklama: attrs.description,
      kaynakId: data.id,
    };
  }

  /** Paraşüt alış faturasını standart formata dönüştür */
  private mapParasutPurchaseInvoice(data: any): StandartFatura {
    const attrs = data.attributes;
    return {
      faturaNo: attrs.invoice_no || data.id,
      faturaTipi: 'alis',
      tarih: new Date(attrs.issue_date),
      vadeTarih: attrs.due_date ? new Date(attrs.due_date) : undefined,
      cariAd: attrs.supplier?.name || 'Bilinmeyen',
      cariVkn: attrs.supplier?.tax_number,
      dovizKodu: attrs.currency || 'TRY',
      dovizKur: attrs.exchange_rate ? parseFloat(attrs.exchange_rate) : undefined,
      durum: this.mapParasutStatus(attrs.status),
      kalemler: (attrs.details || []).map((d: any, i: number) => ({
        siraNo: i + 1,
        urunKod: d.product?.code,
        urunAd: d.product?.name || d.description || '',
        miktar: parseFloat(d.quantity) || 1,
        birim: d.unit || 'adet',
        birimFiyat: parseFloat(d.unit_price) || 0,
        tutar: parseFloat(d.net_total) || 0,
        kdvOran: parseFloat(d.vat_rate) || 0,
        kdvTutar: parseFloat(d.vat_amount) || 0,
        toplamTutar: parseFloat(d.total) || 0,
      })),
      araToplam: parseFloat(attrs.net_total) || 0,
      kdvToplam: parseFloat(attrs.total_vat) || 0,
      genelToplam: parseFloat(attrs.gross_total) || 0,
      aciklama: attrs.description,
      kaynakId: data.id,
    };
  }

  private mapParasutStatus(status: string): StandartFatura['durum'] {
    switch (status) {
      case 'draft': return 'taslak';
      case 'paid': case 'approved': return 'onaylandi';
      case 'cancelled': return 'iptal';
      default: return 'onaylandi';
    }
  }
}
