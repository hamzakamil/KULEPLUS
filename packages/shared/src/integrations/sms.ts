/**
 * SMS gönderim portu — SPEC §29.1 adapter kalıbı, GOVERNANCE §2 `sms` modülü.
 *
 * Gerçek sağlayıcı (Netgsm/iys/Fizyeli — K-07 benzeri sağlayıcı kararı bekleniyor)
 * bu arayüzü uygular; dev ve test ortamında `MockSmsProvider` kullanılır.
 * Kredi düşümü `sms_credits`, mesaj kaydı `sms_messages` tablosunda tutulur —
 * port yalnızca taşıma sözleşmesidir, muhasebe kaydı API tarafında yapılır.
 */
export interface SmsMessage {
  /** E.164 biçiminde alıcı numarası (`toE164TR` çıktısı). */
  to: string;
  /** Gövde — tek mesaj sınırını aşsa da gönderilir; parçalama sağlayıcıya aittir. */
  body: string;
  /** Raporlama etiketi (`otp`, `tahsilat-hatirlatma`, ...). */
  tag?: string;
}

export interface SmsSendResult {
  /** Sağlayıcı referansı — `sms_messages.provider_ref` alanına yazılır. */
  providerRef: string;
  status: 'sent' | 'failed';
  /** Başarısızlıkta sağlayıcı hata mesajı (kullanıcıya gösterilmez, loglanır). */
  detail?: string;
}

export interface SmsProvider {
  /**
   * Tek SMS gönderir. Idempotency çağıranda: aynı mesaj iki kez gönderilmeyecekse
   * çağıran taraf `sms_messages` üzerinde tekrar kontrolü yapmalıdır.
   */
  send(message: SmsMessage): Promise<SmsSendResult>;

  /** Sağlayıcı tarafındaki kalan kredi (kredi adedi). Bilinemiyorsa `null`. */
  balance(): Promise<number | null>;
}
