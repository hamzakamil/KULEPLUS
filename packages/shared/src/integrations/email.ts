/** E-posta gönderim portu — SPEC §29.1 adapter kalıbı. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerRef: string; status: 'sent' | 'failed' }>;
}
