import { shouldCaptureBody } from './audit-log.interceptor';

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
