import { AuditLogInterceptor, maskIdentifier, shouldCaptureBody } from './audit-log.interceptor';

describe('audit-log body capture', () => {
  const user = { id: 'u1' };

  it('keeps bodies of authenticated, non-private requests', () => {
    expect(shouldCaptureBody({ url: '/api/v1/risks/r1', user })).toBe(true);
  });

  it('never stores inbox message bodies', () => {
    expect(shouldCaptureBody({ url: '/api/v1/inbox/conversations/c1/messages', user })).toBe(false);
  });

  it('never stores public/anonymous submissions', () => {
    for (const url of [
      '/api/v1/hr/surveys/public/tok/responses',
      '/api/v1/hr/trainings/public/tok/responses',
      '/api/v1/satisfaction/public/tok',
      '/api/v1/public/contact',
    ]) {
      expect(shouldCaptureBody({ url, user })).toBe(false);
    }
  });

  it('never stores bodies of unauthenticated requests', () => {
    expect(shouldCaptureBody({ url: '/api/v1/risks/r1' })).toBe(false);
  });
});

describe('audit-log personal identifiers', () => {
  const interceptor = new AuditLogInterceptor({} as never, {} as never);

  it('masks national identifiers at any depth, keeps the last two characters', () => {
    const out = interceptor.sanitize({ firstName: 'Awa', cin: '12345678', nested: { iban: 'FR7612345' } }) as Record<string, any>;
    expect(out.firstName).toBe('Awa');
    expect(out.cin).toBe('••••••78');
    expect(out.nested.iban).toBe('•••••••45');
  });

  it('still redacts secrets', () => {
    expect((interceptor.sanitize({ password: 'x', token: 'y' }) as Record<string, unknown>)).toEqual({ password: '[redacted]', token: '[redacted]' });
  });

  it('leaves empty and short identifiers unreadable', () => {
    expect(maskIdentifier('')).toBe('');
    expect(maskIdentifier('12')).toBe('••');
    expect(maskIdentifier(null)).toBe(null);
  });
});
