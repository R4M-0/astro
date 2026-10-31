import { NotFoundException } from '@nestjs/common';
import { EntityResolverService } from '../entities/entity-resolver.service';
import { FilesController } from './files.controller';

describe('FilesController.presign', () => {
  it('refuses to presign an upload for a host record that does not exist (404, no row, no URL)', async () => {
    const prisma = new Proxy({} as Record<string, unknown>, {
      get: (_t, key: string) =>
        key === 'attachment'
          ? { create: jest.fn() }
          : { findFirst: jest.fn(async () => null) },
    });
    const files = { buildKey: jest.fn(), presignUpload: jest.fn() };
    const quota = { assertAvailable: jest.fn(), check: jest.fn() };
    const ctrl = new FilesController(files as never, prisma as never, quota as never, new EntityResolverService(prisma as never));
    await expect(
      ctrl.presign('org-a', { id: 'u1' } as never, new Set(['employees:update']), {
        entityType: 'employee', entityId: 'cnotreal', fileName: 'a.pdf', mimeType: 'application/pdf', size: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(files.presignUpload).not.toHaveBeenCalled();
    expect((prisma.attachment as { create: jest.Mock }).create).not.toHaveBeenCalled();
  });
});
