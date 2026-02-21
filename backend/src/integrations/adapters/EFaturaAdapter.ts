import { BaseAdapter } from '../common/BaseAdapter';
import { StandartFatura, FaturaTipi } from '../common/InvoiceAdapter';
import { logger } from '../../utils/logger';

/**
 * GİB e-Fatura / e-Arşiv Entegrasyon Adapter'ı
 *
 * GİB (Gelir İdaresi Başkanlığı) e-Fatura sistemi UBL-TR formatı kullanır.
 * Entegrasyon, özel entegratör firmalar (Foriba, FinentEDI, Logo, vb.)
 * üzerinden yapılır.
 *
 * Bu adapter, entegratör API'si üzerinden çalışır.
 */
export class EFaturaAdapter extends BaseAdapter {
  readonly adapterAdi = 'efatura';
  readonly gorunenAd = 'GİB e-Fatura / e-Arşiv';

  private entegratorType: string = 'generic'; // foriba, finentedi, logo vb.

  async connect(config: any): Promise<void> {
    await super.connect(config);
    this.entegratorType = (config.ekAyarlar?.entegratorType as string) || 'generic';
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const response = await this.httpClient.get('/api/status');
      return response.status === 200;
    } catch (error) {
      logger.error('e-Fatura bağlantı testi başarısız:', error);
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

    // Gelen faturalar (alış)
    if (!tip || tip === 'alis') {
      try {
        const response = await this.httpClient.get('/api/invoices/incoming', {
          params: {
            startDate: baslangic.toISOString().split('T')[0],
            endDate: bitis.toISOString().split('T')[0],
          },
        });
        const gelenFaturalar = (response.data.invoices || []).map((inv: any) =>
          this.mapUblToStandart(inv, 'alis')
        );
        faturalar.push(...gelenFaturalar);
      } catch (error) {
        logger.error('e-Fatura gelen fatura çekme hatası:', error);
      }
    }

    // Giden faturalar (satış)
    if (!tip || tip === 'satis') {
      try {
        const response = await this.httpClient.get('/api/invoices/outgoing', {
          params: {
            startDate: baslangic.toISOString().split('T')[0],
            endDate: bitis.toISOString().split('T')[0],
          },
        });
        const gidenFaturalar = (response.data.invoices || []).map((inv: any) =>
          this.mapUblToStandart(inv, 'satis')
        );
        faturalar.push(...gidenFaturalar);
      } catch (error) {
        logger.error('e-Fatura giden fatura çekme hatası:', error);
      }
    }

    return faturalar;
  }

  async getFatura(faturaNo: string): Promise<StandartFatura | null> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const response = await this.httpClient.get(`/api/invoices/${faturaNo}`);
      const tip = response.data.invoice?.direction === 'incoming' ? 'alis' : 'satis';
      return this.mapUblToStandart(response.data.invoice, tip);
    } catch {
      return null;
    }
  }

  /**
   * UBL-TR fatura formatını standart formata dönüştür
   */
  private mapUblToStandart(
    data: any,
    tip: 'satis' | 'alis'
  ): StandartFatura {
    return {
      faturaNo: data.invoiceNumber || data.id,
      faturaTipi: tip,
      tarih: new Date(data.issueDate),
      vadeTarih: data.dueDate ? new Date(data.dueDate) : undefined,
      cariAd: tip === 'satis'
        ? data.receiverName || data.accountingCustomerParty?.name || ''
        : data.senderName || data.accountingSupplierParty?.name || '',
      cariVkn: tip === 'satis'
        ? data.receiverTaxNumber
        : data.senderTaxNumber,
      dovizKodu: data.currency || 'TRY',
      dovizKur: data.exchangeRate ? parseFloat(data.exchangeRate) : undefined,
      durum: this.mapEFaturaDurum(data.status),
      kalemler: (data.lines || data.invoiceLines || []).map(
        (line: any, idx: number) => ({
          siraNo: idx + 1,
          urunKod: line.itemCode || line.sellersItemIdentification,
          urunAd: line.itemName || line.name || '',
          miktar: parseFloat(line.quantity) || 1,
          birim: line.unitCode || 'C62', // UN/CEFACT birim kodu
          birimFiyat: parseFloat(line.price || line.unitPrice) || 0,
          tutar: parseFloat(line.lineExtensionAmount) || 0,
          iskontoOran: parseFloat(line.allowancePercent) || 0,
          iskontoTutar: parseFloat(line.allowanceAmount) || 0,
          kdvOran: parseFloat(line.taxPercent || line.vatRate) || 0,
          kdvTutar: parseFloat(line.taxAmount || line.vatAmount) || 0,
          tevkifatOran: parseFloat(line.withholdingTaxPercent) || 0,
          tevkifatTutar: parseFloat(line.withholdingTaxAmount) || 0,
          toplamTutar:
            parseFloat(line.lineExtensionAmount || 0) +
            parseFloat(line.taxAmount || line.vatAmount || 0),
        })
      ),
      araToplam: parseFloat(data.lineExtensionAmount || data.subTotal) || 0,
      kdvToplam: parseFloat(data.taxAmount || data.vatTotal) || 0,
      tevkifatToplam: parseFloat(data.withholdingTaxTotal) || 0,
      genelToplam: parseFloat(data.payableAmount || data.grandTotal) || 0,
      aciklama: data.note || data.notes,
      kaynakId: data.uuid || data.id,
    };
  }

  private mapEFaturaDurum(status: string): StandartFatura['durum'] {
    switch (status?.toLowerCase()) {
      case 'draft': return 'taslak';
      case 'approved': case 'accepted': return 'onaylandi';
      case 'sent': return 'gonderildi';
      case 'cancelled': case 'rejected': return 'iptal';
      default: return 'onaylandi';
    }
  }
}
