import { createTransport } from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import type { Pool } from 'pg';
import { getPool } from '@kuleplus/db';
import type { EmailMessage, EmailProvider } from '@kuleplus/shared';
import { AppError } from '@kuleplus/shared';

/**
 * SMTP e-posta sağlayıcısı — Gmail OAuth2 ile.
 * SPEC §29.1 (Liskov): EmailProvider sözleşmesini uygular.
 * Faz 1'de kredi puanı kontrolü yapılır; Faz 0 ile mock.
 */
export class SmtpEmailProvider implements EmailProvider {
  private transporter: ReturnType<typeof createTransport>;
  private pool: Pool | null = null;

  constructor() {
    const auth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      accessToken: process.env.SMTP_ACCESS_TOKEN,
    };

    // OAuth2 ile Gmail için transporter
    const oAuth2 = new OAuth2Client(
      auth.clientId,
      auth.clientSecret,
      'https://developers.google.com/oauthplayground',
    );

    oAuth2.setCredentials({
      refresh_token: auth.refreshToken,
      access_token: auth.accessToken,
    });

    this.transporter = createTransport(
      {
        service: 'gmail',
        auth: {
          user: auth.user,
          clientId: auth.clientId,
          clientSecret: auth.clientSecret,
          refreshToken: auth.refreshToken,
          accessToken: auth.accessToken,
          expires: Number(process.env.SMTP_ACCESS_TOKEN_EXPIRY) || undefined,
        },
      },
      {
        from: process.env.SMTP_FROM,
      },
    );

    this.transporter.verify().catch((err: Error) => {
      console.error('SMTP bağlantısı doğrulama başarısız:', err);
    });
  }

  async send(message: EmailMessage): Promise<{ providerRef: string; status: 'sent' | 'failed' }> {
    try {
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text ?? message.html,
        html: message.html,
      });

      // Audit log (outbox'a later için)
      await this.logOutbox(info.messageId, message, info.response);

      return {
        providerRef: info.messageId ?? `smtp-${Date.now()}`,
        status: 'sent',
      };
    } catch (error) {
      console.error('SMTP gönderim başarısız:', error);
      throw new AppError('INTERNAL_ERROR', 'E-posta gönderilemedi');
    }
  }

  /** E-posta gönderme denemesi kaydı (outbox tablosuna daha sonra için). */
  private async logOutbox(
    messageId: string | undefined,
    message: EmailMessage,
    response: string,
  ): Promise<void> {
    const pool = this.getPoolInstance();
    await pool.query(
      `INSERT INTO email_outbox (id, to, subject, html, text, provider_ref, response, attempts, max_attempts, next_attempt_at, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [
        messageId,
        message.to,
        message.subject,
        message.html,
        message.text ?? null,
        `smtp-${Date.now()}`,
        response,
        1,
        3,
        new Date(Date.now() + 60_000),
        'pending',
      ],
    );
  }

  private getPoolInstance(): Pool {
    if (!this.pool) {
      this.pool = getPool('app');
    }
    return this.pool;
  }

  async cleanup(): Promise<void> {
    if (this.transporter) {
      await this.transporter.close();
    }
  }
}
