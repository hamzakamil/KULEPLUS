/**
 * Yevmiye maddesinin dayandığı belge (GİB e-Defter belge bilgisi). Başlıkta girilir, satırda
 * ezilebilir; boş belge tipi "belgesiz" (açılış, amortisman, yansıtma vb.) demektir.
 */
export type JournalDocumentType =
  | 'invoice'
  | 'check'
  | 'voucher'
  | 'receipt'
  | 'shipment'
  | 'order-customer'
  | 'order-vendor'
  | 'other';

export interface JournalDocumentFields {
  document_type: JournalDocumentType | '';
  document_type_description: string;
  document_number: string;
  document_date: string;
  payment_method: string;
}

export const JOURNAL_DOCUMENT_TYPES: { value: JournalDocumentType; label: string }[] = [
  { value: 'invoice', label: 'Fatura' },
  { value: 'check', label: 'Çek' },
  { value: 'voucher', label: 'Senet' },
  { value: 'receipt', label: 'Makbuz' },
  { value: 'shipment', label: 'Navlun' },
  { value: 'order-customer', label: 'Müşteri Sipariş Belgesi' },
  { value: 'order-vendor', label: 'Satıcı Sipariş Belgesi' },
  { value: 'other', label: 'Diğer' },
];

export const JOURNAL_PAYMENT_METHODS = ['Nakit', 'Banka', 'Çek', 'Senet', 'Kredi Kartı', 'Diğer'];

export const emptyJournalDocument = (): JournalDocumentFields => ({
  document_type: '',
  document_type_description: '',
  document_number: '',
  document_date: '',
  payment_method: '',
});

export const hasJournalDocument = (d: JournalDocumentFields): boolean =>
  !!(
    d.document_type ||
    d.document_number.trim() ||
    d.document_date ||
    d.payment_method ||
    d.document_type_description.trim()
  );

/** Fatura, çek ve "diğer" belgede no + tarih (diğerde ayrıca ad) zorunlu. Hata yoksa null. */
export function validateJournalDocument(d: JournalDocumentFields, where: string): string | null {
  if (!d.document_type) return null;
  const name = JOURNAL_DOCUMENT_TYPES.find((t) => t.value === d.document_type)?.label ?? 'Belge';
  if (d.document_type === 'other' && !d.document_type_description.trim())
    return `${where}: belge türü "Diğer" ise belgenin adını yazın (ör. Ücret Bordrosu, Dekont).`;
  if (['invoice', 'check', 'other'].includes(d.document_type)) {
    if (!d.document_number.trim()) return `${where}: ${name} için belge no gerekli.`;
    if (!d.document_date) return `${where}: ${name} için belge tarihi gerekli.`;
  }
  return null;
}

/** İstek gövdesine eklenecek belge alanları; boş olanlar hiç gönderilmez. */
export function journalDocumentPayload(d: JournalDocumentFields): Partial<JournalDocumentFields> {
  const out: Partial<JournalDocumentFields> = {};
  if (d.document_type) {
    out.document_type = d.document_type;
    if (d.document_type === 'other' && d.document_type_description.trim())
      out.document_type_description = d.document_type_description.trim();
  }
  if (d.document_number.trim()) out.document_number = d.document_number.trim();
  if (d.document_date) out.document_date = d.document_date;
  if (d.payment_method) out.payment_method = d.payment_method;
  return out;
}
