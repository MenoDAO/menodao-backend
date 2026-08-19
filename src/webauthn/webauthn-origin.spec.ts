import { allowedWebAuthnOrigins, resolveWebAuthnRp } from './webauthn-origin';

describe('webauthn-origin', () => {
  const allowed = allowedWebAuthnOrigins();

  it('includes the production app host by default', () => {
    expect(allowed).toContain('https://app.menodao.org');
    expect(allowed).toContain('http://localhost:3001');
  });

  it('derives rpID from a trusted origin', () => {
    expect(resolveWebAuthnRp('https://app.menodao.org', allowed)).toEqual({
      origin: 'https://app.menodao.org',
      rpID: 'app.menodao.org',
    });
    expect(resolveWebAuthnRp('http://localhost:3001/staff/login', allowed)).toEqual({
      origin: 'http://localhost:3001',
      rpID: 'localhost',
    });
  });

  it('rejects unknown origins', () => {
    expect(() => resolveWebAuthnRp('https://evil.example', allowed)).toThrow(
      /not allowed/,
    );
  });
});
