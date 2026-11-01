import { Injectable, NotFoundException } from '@nestjs/common';
import { mergeOrgSettings } from './org-settings';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  getOrganization(orgId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      include: {
        sites: { where: { deletedAt: null }, include: { departments: { where: { deletedAt: null } } } },
      },
    });
  }

  /** Self-serve org creation — feature flag + per-user cap enforced by AuthService. */
  async createOrganization(userId: string, name: string) {
    await this.auth.assertCanCreateOrganization(userId);
    return this.auth.createOrganizationForUser(userId, name);
  }

  async updateOrganization(orgId: string, data: { name?: string; settings?: Record<string, unknown> }) {
    let settings: object | undefined;
    if (data.settings) {
      const current = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
      settings = mergeOrgSettings(current?.settings, data.settings);
    }
    return this.prisma.organization.update({
      where: { id: orgId },
      data: { name: data.name, ...(settings ? { settings } : {}) },
    });
  }

  listSites(orgId: string) {
    return this.prisma.site.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: { departments: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  createSite(orgId: string, data: { name: string; address?: string }) {
    return this.prisma.site.create({ data: { organizationId: orgId, ...data } });
  }

  async updateSite(orgId: string, siteId: string, data: { name: string; address?: string }) {
    await this.assertSite(orgId, siteId);
    return this.prisma.site.update({ where: { id: siteId }, data });
  }

  async deleteSite(orgId: string, siteId: string) {
    await this.assertSite(orgId, siteId);
    await this.prisma.site.update({ where: { id: siteId }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  async createDepartment(orgId: string, siteId: string, name: string) {
    await this.assertSite(orgId, siteId);
    return this.prisma.department.create({ data: { siteId, name } });
  }

  async deleteDepartment(orgId: string, departmentId: string) {
    const dep = await this.prisma.department.findFirst({
      where: { id: departmentId, site: { organizationId: orgId } },
    });
    if (!dep) throw new NotFoundException('Department not found');
    await this.prisma.department.update({
      where: { id: departmentId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  private async assertSite(orgId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId: orgId, deletedAt: null },
    });
    if (!site) throw new NotFoundException('Site not found');
  }
}
