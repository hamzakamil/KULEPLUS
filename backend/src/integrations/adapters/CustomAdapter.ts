import { BaseAdapter } from '../common/BaseAdapter';
import { StandartFatura, FaturaTipi, AdapterConfig } from '../common/InvoiceAdapter';
import { logger } from '../../utils/logger';

/**
 * Genel/Özel API Adapter'ı
 *
 * Herhangi bir fatura programına bağlanmak için kullanılır.
 * Kullanıcı, API endpoint yapısını ve alan eşleştirmelerini (field mapping)
 * kendisi tanımlar.
 *
 * Bu adapter, webhook veya REST API üzerinden veri alabilir.
 */
export class CustomAdapter extends BaseAdapter {
  readonly adapterAdi = 'custom';
  readonly gorunenAd = 'Özel Entegrasyon';

  private fieldMapping: FieldMapping = defaultFieldMapping;
  private endpoints: CustomEndpoints = {
    listInvoices: '/invoices',
    getInvoice: '/invoices/{id}',
    sendInvoice: '/invoices',
  };

  async connect(config: AdapterConfig): Promise<void> {
    await super.connect(config);

    // Özel alan eşleştirmeleri
    if (config.ekAyarlar?.fieldMapping) {
      this.fieldMapping = {
        ...defaultFieldMapping,
        ...(config.ekAyarlar.fieldMapping as Partial<FieldMapping>),
      };
    }

    // Özel endpoint'ler
    if (config.ekAyarlar?.endpoints) {
      this.endpoints = {
        ...this.endpoints,
        ...(config.ekAyarlar.endpoints as Partial<CustomEndpoints>),
      };
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const response = await this.httpClient.get(this.endpoints.listInvoices, {
        params: { limit: 1 },
      });
      return response.status === 200;
    } catch (error) {
      logger.error('Custom adapter bağlantı testi başarısız:', error);
      return false;
    }
  }

  async getFaturalar(
    baslangic: Date,
    bitis: Date,
    tip?: FaturaTipi
  ): Promise<StandartFatura[]> {
    if (!this.httpClient) throw new Error('Bağlantı kurulmamış');

    try {
      const response = await this.httpClient.get(this.endpoints.listInvoices, {
        params: {
          start_date: baslangic.toISOString().split('T')[0],
          end_date: bitis.toISOString().split('T')[0],
          type: tip || undefined,
        },
      });

      const data = this.extractData(response.data);
      return data.map((item: any) => this.mapToStandart(item));
    } catch (error) {
      logger.error('Custom adapter fatura çekme hatası:', error);
      return [];
    }
  }

  async getFatura(faturaNo: string): Promise<StandartFatura | null> {
    try {
      if (!this.httpClient) throw new Error('Bağlantı kurulmamış');
      const url = this.endpoints.getInvoice.replace('{id}', faturaNo);
      const response = await this.httpClient.get(url);
      return this.mapToStandart(response.data);
    } catch {
      return null;
    }
  }

  /**
   * Yanıt verisinden fatura listesini çıkart
   * Farklı API yanıt formatlarını destekler
   */
  private extractData(responseData: any): any[] {
    if (Array.isArray(responseData)) return responseData;
    if (responseData.data && Array.isArray(responseData.data)) return responseData.data;
    if (responseData.invoices && Array.isArray(responseData.invoices))
      return responseData.invoices;
    if (responseData.items && Array.isArray(responseData.items)) return responseData.items;
    if (responseData.results && Array.isArray(responseData.results))
      return responseData.results;
    return [];
  }

  /**
   * Alan eşleştirmesine göre standart fatura formatına dönüştür
   */
  private mapToStandart(data: any): StandartFatura {
    const m = this.fieldMapping;

    const getNestedValue = (obj: any, path: string): any => {
      return path.split('.').reduce((o, key) => (o && o[key] !== undefined ? o[key] : null), obj);
    };

    const kalemler = (getNestedValue(data, m.kalemler) || []).map(
      (item: any, idx: number) => ({
        siraNo: idx + 1,
        urunKod: getNestedValue(item, m.kalemUrunKod) || '',
        urunAd: getNestedValue(item, m.kalemUrunAd) || '',
        miktar: parseFloat(getNestedValue(item, m.kalemMiktar)) || 1,
        birim: getNestedValue(item, m.kalemBirim) || 'adet',
        birimFiyat: parseFloat(getNestedValue(item, m.kalemBirimFiyat)) || 0,
        tutar: parseFloat(getNestedValue(item, m.kalemTutar)) || 0,
        kdvOran: parseFloat(getNestedValue(item, m.kalemKdvOran)) || 0,
        kdvTutar: parseFloat(getNestedValue(item, m.kalemKdvTutar)) || 0,
        toplamTutar: parseFloat(getNestedValue(item, m.kalemToplamTutar)) || 0,
      })
    );

    return {
      faturaNo: getNestedValue(data, m.faturaNo) || '',
      faturaTipi: this.mapFaturaTipi(getNestedValue(data, m.faturaTipi)),
      tarih: new Date(getNestedValue(data, m.tarih)),
      vadeTarih: getNestedValue(data, m.vadeTarih)
        ? new Date(getNestedValue(data, m.vadeTarih))
        : undefined,
      cariAd: getNestedValue(data, m.cariAd) || '',
      cariVkn: getNestedValue(data, m.cariVkn),
      dovizKodu: getNestedValue(data, m.dovizKodu) || 'TRY',
      dovizKur: parseFloat(getNestedValue(data, m.dovizKur)) || undefined,
      durum: 'onaylandi',
      kalemler,
      araToplam: parseFloat(getNestedValue(data, m.araToplam)) || 0,
      kdvToplam: parseFloat(getNestedValue(data, m.kdvToplam)) || 0,
      genelToplam: parseFloat(getNestedValue(data, m.genelToplam)) || 0,
      aciklama: getNestedValue(data, m.aciklama),
      kaynakId: getNestedValue(data, m.kaynakId) || getNestedValue(data, m.faturaNo),
    };
  }

  private mapFaturaTipi(tip: string | null): FaturaTipi {
    if (!tip) return 'satis';
    const lower = tip.toLowerCase();
    if (lower.includes('satis') || lower === 'sales') return 'satis';
    if (lower.includes('alis') || lower === 'purchase') return 'alis';
    if (lower.includes('iade_satis') || lower === 'sales_return') return 'iade_satis';
    if (lower.includes('iade_alis') || lower === 'purchase_return') return 'iade_alis';
    return 'satis';
  }
}

/** Alan eşleştirme yapısı */
interface FieldMapping {
  faturaNo: string;
  faturaTipi: string;
  tarih: string;
  vadeTarih: string;
  cariAd: string;
  cariVkn: string;
  dovizKodu: string;
  dovizKur: string;
  kalemler: string;
  kalemUrunKod: string;
  kalemUrunAd: string;
  kalemMiktar: string;
  kalemBirim: string;
  kalemBirimFiyat: string;
  kalemTutar: string;
  kalemKdvOran: string;
  kalemKdvTutar: string;
  kalemToplamTutar: string;
  araToplam: string;
  kdvToplam: string;
  genelToplam: string;
  aciklama: string;
  kaynakId: string;
}

interface CustomEndpoints {
  listInvoices: string;
  getInvoice: string;
  sendInvoice?: string;
}

/** Varsayılan alan eşleştirmeleri */
const defaultFieldMapping: FieldMapping = {
  faturaNo: 'invoiceNumber',
  faturaTipi: 'type',
  tarih: 'date',
  vadeTarih: 'dueDate',
  cariAd: 'customerName',
  cariVkn: 'taxNumber',
  dovizKodu: 'currency',
  dovizKur: 'exchangeRate',
  kalemler: 'items',
  kalemUrunKod: 'code',
  kalemUrunAd: 'name',
  kalemMiktar: 'quantity',
  kalemBirim: 'unit',
  kalemBirimFiyat: 'unitPrice',
  kalemTutar: 'amount',
  kalemKdvOran: 'vatRate',
  kalemKdvTutar: 'vatAmount',
  kalemToplamTutar: 'totalAmount',
  araToplam: 'subTotal',
  kdvToplam: 'vatTotal',
  genelToplam: 'grandTotal',
  aciklama: 'description',
  kaynakId: 'id',
};
