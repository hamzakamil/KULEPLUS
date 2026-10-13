import { describe, expect, it } from 'vitest';
import { MockWhatsAppProvider } from '../src/integrations/whatsapp';

describe('MockWhatsAppProvider — SPEC §29.1 sözleşmesi (Faz 8)', () => {
  it('sendMessage yeni mesaj için referans üretir', async () => {
    const provider = new MockWhatsAppProvider();
    const result = await provider.sendMessage('msg-1', '+905551112233', 'Merhaba');
    expect(result.success).toBe(true);
    expect(result.providerMessageId).toMatch(/^MOCK-/);
  });

  it('sendMessage idempotenttir: aynı messageId ikinci kez önceki sonucu döner', async () => {
    const provider = new MockWhatsAppProvider();
    const first = await provider.sendMessage('msg-1', '+905551112233', 'Merhaba');
    const second = await provider.sendMessage('msg-1', '+905551112233', 'Merhaba');
    expect(second).toEqual(first);
  });

  it('belirsiz referansta queryStatus pending döner, exception fırlatmaz (§29.1 Liskov)', async () => {
    const provider = new MockWhatsAppProvider();
    await expect(provider.sendMessage('msg-1', '+905551112233', 'Merhaba')).resolves.toBeDefined();
    const unknown = await provider.queryStatus('YOK-000');
    expect(unknown.status).toBe('pending');
  });

  it('listInbox gönderilen mesajı döndürür', async () => {
    const provider = new MockWhatsAppProvider();
    await provider.sendMessage('msg-1', '+905551112233', 'Merhaba');
    const inbox = await provider.listInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].direction).toBe('outgoing');
  });

  it('sendTemplate şablonu iletir', async () => {
    const provider = new MockWhatsAppProvider();
    const result = await provider.sendTemplate('msg-1', '+905551112233', 'dogrulama', {
      kod: '123456',
    });
    expect(result.success).toBe(true);
  });
});
