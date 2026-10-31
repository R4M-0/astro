import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Granted } from '../../common/decorators/granted.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolverService } from '../entities/entity-resolver.service';
import { FilesService } from './files.service';
import { StorageQuotaService } from './storage-quota';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Safe characters for the polymorphic host reference (also used verbatim in export entry names). */
const ENTITY_REF_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A bare `type/subtype` token — no parameters, spaces or control characters. */
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

/** Content types that a browser could execute or render as a document if ever served inline. */
const BLOCKED_MIME =
  /^(text\/html|application\/xhtml\+xml|text\/javascript|application\/javascript|application\/x-javascript|image\/svg\+xml|text\/xml|application\/xml|[\w.+-]+\/[\w.+-]*\+xml|multipart\/|message\/)/i;

class PresignUploadDto {
  @IsString()
  @Matches(ENTITY_REF_RE)
  entityType: string;

  @IsString()
  @Matches(ENTITY_REF_RE)
  entityId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(MIME_RE)
  mimeType: string;

  @IsInt()
  @Min(1)
  @Max(MAX_FILE_SIZE)
  size: number;
}

@ApiTags('files')
@ApiBearerAuth()
@Controller('attachments')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly prisma: PrismaService,
    private readonly quota: StorageQuotaService,
    private readonly entities: EntityResolverService,
  ) {}

  /**
   * Authorize `action` (read|update) on the attachment host entity for this caller: known type,
   * `<resource>:<action>`, and the host record must exist in the org and be visible to the caller
   * (department/members visibility, conversation membership for `message`). Attachments inherit the
   * authorization of the record they hang off.
   */
  private async authorize(
    orgId: string,
    user: AuthUser,
    granted: Set<string>,
    entityType: string,
    entityId: string,
    action: 'read' | 'update',
  ) {
    await this.entities.resolve({ orgId, userId: user.id, granted }, entityType, entityId, action);
  }

  @Post('presign')
  async presign(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Granted() granted: Set<string>,
    @Body() dto: PresignUploadDto,
  ) {
    await this.authorize(orgId, user, granted, dto.entityType, dto.entityId, 'update');
    if (BLOCKED_MIME.test(dto.mimeType)) throw new BadRequestException('This file type is not allowed');
    await this.quota.assertCanStore(orgId, dto.size);
    const key = this.files.buildKey(orgId, dto.entityType, dto.fileName);
    const uploadUrl = await this.files.presignUpload(key, dto.mimeType, dto.size);
    const attachment = await this.prisma.attachment.create({
      data: {
        organizationId: orgId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        size: dto.size,
        storageKey: key,
        uploadedById: user.id,
      },
    });
    return { attachment, uploadUrl };
  }

  @Get('by-entity/:entityType/:entityId')
  async list(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Granted() granted: Set<string>,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    await this.authorize(orgId, user, granted, entityType, entityId, 'read');
    return this.prisma.attachment.findMany({
      where: { organizationId: orgId, entityType, entityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id/download-url')
  async downloadUrl(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Granted() granted: Set<string>,
    @Param('id') id: string,
  ) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!attachment) throw new BadRequestException('Attachment not found');
    await this.authorize(orgId, user, granted, attachment.entityType, attachment.entityId, 'read');
    return { url: await this.files.presignDownload(attachment.storageKey, attachment.fileName) };
  }

  /** Soft delete — the object stays in MinIO, the link disappears from the entity. */
  @Delete(':id')
  async remove(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Granted() granted: Set<string>,
    @Param('id') id: string,
  ) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!attachment) throw new BadRequestException('Attachment not found');
    await this.authorize(orgId, user, granted, attachment.entityType, attachment.entityId, 'update');
    await this.prisma.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }
}
