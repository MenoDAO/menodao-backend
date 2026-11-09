import type { PrismaService } from '../../prisma/prisma.service';
import { BotIdentityService } from './bot-identity.service';

describe('BotIdentityService (phone → Member link)', () => {
  const svc = new BotIdentityService({} as unknown as PrismaService);

  it('normalizes Kenyan formats to E.164', () => {
    expect(svc.normalizeToE164('254712345678@s.whatsapp.net')).toBe(
      '+254712345678',
    );
    expect(svc.normalizeToE164('+254712345678')).toBe('+254712345678');
    expect(svc.normalizeToE164('0712345678')).toBe('+254712345678');
  });

  it('passes through @lid identities', () => {
    expect(svc.normalizeWhatsappIdentity('123456@lid')).toBe('123456@lid');
    expect(svc.isLid('123456@lid')).toBe(true);
    expect(svc.isLid('+254712345678')).toBe(false);
  });
});
