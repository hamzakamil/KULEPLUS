import { BaseAdapter } from '../common/BaseAdapter';
import { StandartFatura, FaturaTipi } from '../common/InvoiceAdapter';
import { logger } from '../../utils/logger';

/**
 * Logo Yazılım API Entegrasyon Adapter'ı
 * Logo Tiger, Go3, j-Platform entegrasyonları
 * Logo REST API veya Logo Connect üzerinden çalışır.
 */
export class LogoAdapter extends BaseAdapter {
  readonly adapterAdi = 'logo';
  readonly gorunenAd = 'Logo Yazılım';

  private firmNo: string = '1';
  private donemNo: string = '1';

  async connect(config: any): Promise<void> {
    await super.connect(config);
    this.firmNo = (config.ekAyarlar?.firmNo as string) || '1';
    this.donemNo = (config.ekAyarlar?.donemNo as string) || '1';
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const response = await this.httpClient.get('/api/v1/status');
      return response.status === 200;
    } catch (error) {
      logger.error('Logo bağlantı testi başarısız:', error);
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
      // Logo satış faturaları endpoint
      if (!tip || tip === 'satis') {
        const res = await this.httpClient.get('/api/v1/salesInvoices', {
          params: {
            firmNo: this.firmNo,
            donemNo: this.donemNo,
            startDate: baslangic.toISOString().split('T')[0],
            endDate: bitis.toISOString().split('T')[0],
          },
        });
        faturalar.push(
          ...(res.data.items || []).map((inv: any) => this.mapLogoInvoice(inv, 'satis'))
        );
      }

      // Logo alış faturaları
      if (!tip || tip === 'alis') {
        const res = await this.httpClient.get('/api/v1/purchaseInvoices', {
          params: {
            firmNo: this.firmNo,
            donemNo: this.donemNo,
            startDate: baslangic.toISOString().split('T')[0],
            endDate: bitis.toISOString().split('T')[0],
          },
        });
        faturalar.push(
          ...(res.data.items || []).map((inv: any) => this.mapLogoInvoice(inv, 'alis'))
        );
      }
    } catch (error) {
      logger.error('Logo fatura çekme hatası:', error);
    }

    return faturalar;
  }

  async getFatura(faturaNo: string): Promise<StandartFatura | null> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const res = await this.httpClient.get(`/api/v1/invoices/${faturaNo}`, {
        params: { firmNo: this.firmNo },
      });
      return this.mapLogoInvoice(res.data, 'satis');
    } catch {
      return null;
    }
  }

  private mapLogoInvoice(data: any, tip: 'satis' | 'alis'): StandartFatura {
    return {
      faturaNo: data.FICHENO || data.NUMBER_ || String(data.LOGICALREF),
      faturaTipi: tip,
      tarih: new Date(data.DATE_ || data.CAPIBLOCK_CREADEDDATE),
      vadeTarih: data.EINVOICE_DUEDATE ? new Date(data.EINVOICE_DUEDATE) : undefined,
      cariAd: data.CLIENTREF_NAME || data.ARP_NAME || '',
      cariVkn: data.TAXNR || data.ARP_TAXNR,
      dovizKodu: this.mapLogoCurrency(data.TRCURR),
      dovizKur: data.REPORTRATE || undefined,
      durum: 'onaylandi',
      kalemler: (data.TRANSACTIONS?.items || data.LINES || []).map((line: any, idx: number) => ({
        siraNo: idx + 1,
        urunKod: line.STOCKREF_CODE || line.ITEMCODE,
        urunAd: line.STOCKREF_NAME || line.ITEMNAME || '',
        miktar: parseFloat(line.AMOUNT) || 1,
        birim: line.UOMREF_NAME || 'adet',
        birimFiyat: parseFloat(line.PRICE) || 0,
        tutar: parseFloat(line.TOTAL) || 0,
        iskontoOran: parseFloat(line.DISCPER) || 0,
        iskontoTutar: parseFloat(line.DISCOUNT) || 0,
        kdvOran: parseFloat(line.VAT) || 0,
        kdvTutar: parseFloat(line.VATAMOUNT || line.VATSUM) || 0,
        toplamTutar: parseFloat(line.LINENET) || 0,
      })),
      araToplam: parseFloat(data.NETTOTAL) || 0,
      kdvToplam: parseFloat(data.TOTALVAT) || 0,
      genelToplam: parseFloat(data.GROSSTOTAL) || 0,
      aciklama: data.GENEXP1 || data.NOTES1,
      kaynakId: String(data.LOGICALREF || data.FICHENO),
    };
  }

  private mapLogoCurrency(code: number | string): string {
    const map: Record<string, string> = {
      '0': 'TRY', '1': 'USD', '20': 'EUR', '30': 'GBP',
    };
    return map[String(code)] || 'TRY';
  }
}
