import { BadRequestException } from '@nestjs/common';
import { verifySignature } from './esign.service';

/** EsignService test double: refuses a missing credential, otherwise returns a dummy record. */
export const esignMock = () => ({
  sign: jest.fn().mockImplementation(async (input: { credentials?: { password?: string; totp?: string }; scope: string; userId: string }) => {
    if (!input.credentials?.password && !input.credentials?.totp) throw new BadRequestException('ESIGN_REQUIRED');
    const record = { v: 1, scope: input.scope, signer: { userId: input.userId }, mac: 'test' };
    return { record, serialized: JSON.stringify(record) };
  }),
  verify: jest.fn().mockImplementation((stored: unknown, content?: unknown) => verifySignature(stored, content)),
  assertSeparation: jest.fn().mockResolvedValue(undefined),
  selfApprovalAllowed: jest.fn().mockResolvedValue(false),
  signer: jest.fn().mockResolvedValue({ userId: 'u1', name: 'Test User', email: 't@x', function: null }),
});
