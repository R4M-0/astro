import { BadRequestException } from '@nestjs/common';
import { mergeOrgSettings, publicOrgSettings } from './org-settings';

describe('organization settings allow-list', () => {
  it('merges allowed keys without touching the rest (visibility kept)', () => {
    expect(mergeOrgSettings({ visibility: { a: 1 } }, { allowSelfApproval: true })).toEqual({
      visibility: { a: 1 },
      allowSelfApproval: true,
    });
  });

  it('rejects unknown keys and wrong types', () => {
    expect(() => mergeOrgSettings({}, { visibility: {} })).toThrow(BadRequestException);
    expect(() => mergeOrgSettings({}, { constructor: 1 })).toThrow(BadRequestException);
    expect(() => mergeOrgSettings({}, { allowSelfApproval: 'yes' })).toThrow(BadRequestException);
  });

  it('exposes only public keys to members', () => {
    expect(publicOrgSettings({ visibility: 1, allowSelfApproval: false, internal: 'x' })).toEqual({ visibility: 1, allowSelfApproval: false });
    expect(publicOrgSettings(null)).toEqual({});
  });
});
