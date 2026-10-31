import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Granted } from '../../common/decorators/granted.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { SharesService } from './shares.service';

class ShareDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) userIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) groupIds?: string[];
}

/** Per-record invitations of department-scoped records (`entityType` = Prisma model name). */
@ApiTags('shares')
@ApiBearerAuth()
@Controller('shares')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Get(':entityType/:entityId')
  list(
    @OrgId() orgId: string,
    @Granted() granted: Set<string>,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.shares.list(orgId, granted, entityType, entityId);
  }

  @Post(':entityType/:entityId')
  add(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Granted() granted: Set<string>,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body() dto: ShareDto,
  ) {
    return this.shares.add(orgId, user.id, granted, entityType, entityId, dto.userIds, dto.groupIds);
  }

  @Delete(':entityType/:entityId/group/:groupId')
  removeGroup(
    @OrgId() orgId: string,
    @Granted() granted: Set<string>,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.shares.removeGroup(orgId, granted, entityType, entityId, groupId);
  }

  @Delete(':entityType/:entityId/:userId')
  remove(
    @OrgId() orgId: string,
    @Granted() granted: Set<string>,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('userId') userId: string,
  ) {
    return this.shares.remove(orgId, granted, entityType, entityId, userId);
  }
}
