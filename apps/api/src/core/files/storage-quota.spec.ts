import { HttpException } from '@nestjs/common';
import { assertWithinQuota, effectiveStorageLimit } from './storage-quota';

describe('storage quota', () => {
  it('uses the subscription override before the plan, null = unlimited', () => {
    expect(effectiveStorageLimit({ storageLimitMb: 10, plan: { storageLimitMb: 5 } })).toBe(10 * 1024 * 1024);
    expect(effectiveStorageLimit({ storageLimitMb: null, plan: { storageLimitMb: 5 } })).toBe(5 * 1024 * 1024);
    expect(effectiveStorageLimit({ storageLimitMb: null, plan: { storageLimitMb: null } })).toBeNull();
    expect(effectiveStorageLimit(null)).toBeNull();
  });

  it('refuses an upload that would exceed the limit with STORAGE_QUOTA', () => {
    expect(() => assertWithinQuota(90, 10, 100)).not.toThrow();
    expect(() => assertWithinQuota(0, 1e12, null)).not.toThrow();
    try {
      assertWithinQuota(95, 10, 100);
      fail('expected quota error');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(413);
      expect((err as HttpException).getResponse()).toMatchObject({ error: 'STORAGE_QUOTA' });
    }
  });
});
