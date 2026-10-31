import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { REGISTER_BY_MODEL, REGISTERS, resolvePolicy } from './registers';

class VisibilityDto {
  /** { [model]: 'organization' | 'process' | 'members' } — only the registers to change */
  @IsObject() policy: Record<string, string>;
}

/** Admin → Visibilité: how each register's records are visible (stored in Organization.settings.visibility). */
@ApiTags('visibility')
@ApiBearerAuth()
@Controller('visibility')
export class VisibilityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('organization:read')
  async get(@OrgId() orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
    const policy = resolvePolicy(org.settings);
    return REGISTERS.map((r) => ({
      model: r.model,
      resource: r.resource,
      group: r.group,
      modes: r.modes,
      default: r.default,
      mode: policy[r.model],
      children: (r.children ?? []).map((c) => c.model),
    }));
  }

  @Put()
  @RequirePermissions('organization:update')
  async set(@OrgId() orgId: string, @Body() dto: VisibilityDto) {
    for (const [model, mode] of Object.entries(dto.policy)) {
      const register = REGISTER_BY_MODEL.get(model);
      if (!register) throw new BadRequestException(`Registre inconnu : ${model}`);
      if (!(register.modes as string[]).includes(mode)) throw new BadRequestException(`Mode « ${mode} » impossible pour ${model}`);
    }
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
    const settings = (org.settings ?? {}) as Record<string, unknown>;
    const visibility = { ...((settings.visibility as Record<string, string>) ?? {}), ...dto.policy };
    // an Organization write also invalidates every member's cached auth context → new policy applies at once
    await this.prisma.organization.update({ where: { id: orgId }, data: { settings: { ...settings, visibility } } });
    return this.get(orgId);
  }
}
