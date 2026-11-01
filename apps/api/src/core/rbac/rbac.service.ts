import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, DEPARTMENT_SCOPED_ROLE_KEYS, SYSTEM_ROLES } from '@astro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { stampRoleSynced, syncPermissionCatalog } from './sync-role-permissions';

/** Grants the org_admin role can never lose — otherwise the organization locks itself out. */
export const ORG_ADMIN_LOCKED_PERMISSIONS = [
  'users:admin',
  'roles:admin',
  'roles:read',
  'users:read',
  'organization:read',
  'organization:update',
] as const;

const customKey = (name: string) => `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotently sync the global permission catalog (supported resource × action keys only). */
  async syncPermissionCatalog() {
    await syncPermissionCatalog(this.prisma);
    return this.prisma.permission.findMany();
  }

  /** Create the 7 system roles with default grants for a new organization. */
  async provisionSystemRoles(organizationId: string) {
    const permissions = await this.syncPermissionCatalog();
    const byKey = new Map(permissions.map((p) => [`${p.resource}:${p.action}`, p.id]));

    const roles = [];
    for (const def of SYSTEM_ROLES) {
      const role = await this.prisma.role.upsert({
        where: { organizationId_key: { organizationId, key: def.key } },
        create: { organizationId, key: def.key, name: def.name, isSystem: true, departmentScoped: DEPARTMENT_SCOPED_ROLE_KEYS.includes(def.key) },
        update: {},
      });
      const grants = (DEFAULT_ROLE_PERMISSIONS[def.key] ?? [])
        .map((key) => byKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId }));
      await this.prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });
      await stampRoleSynced(this.prisma, role.id, def.key);
      roles.push(role);
    }
    return roles;
  }

  async listRoles(organizationId: string) {
    return this.prisma.role.findMany({
      where: { organizationId, deletedAt: null },
      include: { permissions: { include: { permission: true } }, _count: { select: { memberships: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async findRole(organizationId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId, deletedAt: null } });
    if (!role) throw new NotFoundException('Rôle introuvable');
    return role;
  }

  /** Creates a custom role; a duplicate name (same derived key) is rejected with 400. */
  async createCustomRole(
    organizationId: string,
    name: string,
    permissionKeys: string[],
    opts: { departmentScoped?: boolean; description?: string | null } = {},
  ) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Le nom du rôle est obligatoire');
    const key = customKey(trimmed);
    const existing = await this.prisma.role.findFirst({ where: { organizationId, key } });
    if (existing) throw new BadRequestException(`Un rôle nommé « ${trimmed} » existe déjà`);
    let role;
    try {
      role = await this.prisma.role.create({
        data: {
          organizationId,
          key,
          name: trimmed,
          isSystem: false,
          departmentScoped: opts.departmentScoped ?? false,
          description: opts.description ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`Un rôle nommé « ${trimmed} » existe déjà`);
      }
      throw e;
    }
    await this.setRolePermissions(organizationId, role.id, permissionKeys);
    return role;
  }

  /** Updates name (custom roles only), description and/or department scoping. */
  async updateRole(
    organizationId: string,
    roleId: string,
    dto: { name?: string; description?: string | null; departmentScoped?: boolean },
  ) {
    const role = await this.findRole(organizationId, roleId);
    const data: Prisma.RoleUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (role.isSystem) throw new BadRequestException('Un rôle système ne peut pas être renommé');
      if (!name) throw new BadRequestException('Le nom du rôle est obligatoire');
      if (name !== role.name) {
        const key = customKey(name);
        const clash = await this.prisma.role.findFirst({ where: { organizationId, key, id: { not: role.id } } });
        if (clash) throw new BadRequestException(`Un rôle nommé « ${name} » existe déjà`);
        data.name = name;
        data.key = key;
      }
    }
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.departmentScoped !== undefined) data.departmentScoped = dto.departmentScoped;
    if (Object.keys(data).length === 0) return role;
    return this.prisma.role.update({ where: { id: role.id }, data });
  }

  /** Turns department-scoped visibility on/off for every member holding this role. */
  async setDepartmentScoped(organizationId: string, roleId: string, departmentScoped: boolean) {
    return this.updateRole(organizationId, roleId, { departmentScoped });
  }

  /** Replaces a role's grants — system roles included (org_admin keeps its lock-out guard). */
  async setRolePermissions(organizationId: string, roleId: string, permissionKeys: string[]) {
    const role = await this.findRole(organizationId, roleId);
    const wanted = new Set(permissionKeys);
    if (role.isSystem && role.key === 'org_admin') {
      const missing = ORG_ADMIN_LOCKED_PERMISSIONS.filter((k) => !wanted.has(k));
      if (missing.length) {
        throw new BadRequestException(
          `Le rôle Administrateur doit conserver les permissions ${missing.join(', ')} pour éviter de verrouiller l'organisation`,
        );
      }
    }
    const permissions = await this.prisma.permission.findMany();
    const byKey = new Map(permissions.map((p) => [`${p.resource}:${p.action}`, p.id]));
    const unknown = [...wanted].filter((k) => !byKey.has(k));
    if (unknown.length) throw new BadRequestException(`Permissions inconnues : ${unknown.join(', ')}`);
    const ids = [...wanted]
      .map((k) => byKey.get(k))
      .filter((id): id is string => Boolean(id));
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      this.prisma.rolePermission.createMany({
        data: ids.map((permissionId) => ({ roleId: role.id, permissionId })),
      }),
    ]);
    return { updated: true };
  }

  /** Restores a system role's shipped grants + default department scoping. */
  async resetRole(organizationId: string, roleId: string) {
    const role = await this.findRole(organizationId, roleId);
    if (!role.isSystem) throw new BadRequestException('Seuls les rôles système peuvent être rétablis par défaut');
    await this.syncPermissionCatalog();
    await this.setRolePermissions(organizationId, role.id, DEFAULT_ROLE_PERMISSIONS[role.key] ?? []);
    await this.prisma.role.update({
      where: { id: role.id },
      data: { departmentScoped: DEPARTMENT_SCOPED_ROLE_KEYS.includes(role.key) },
    });
    await stampRoleSynced(this.prisma, role.id, role.key);
    return { reset: true };
  }

  /** New custom role carrying the same grants + scoping as the source role. */
  async duplicateRole(organizationId: string, roleId: string, name: string) {
    const source = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId, deletedAt: null },
      include: { permissions: { include: { permission: true } } },
    });
    if (!source) throw new NotFoundException('Rôle introuvable');
    const keys = source.permissions.map((p) => `${p.permission.resource}:${p.permission.action}`);
    return this.createCustomRole(organizationId, name, keys, {
      departmentScoped: source.departmentScoped,
      description: source.description,
    });
  }

  /**
   * Soft-deletes a custom role. Members holding it must be moved to `reassignToRoleId`
   * (another live role of the same org) first, otherwise 400.
   */
  async deleteRole(organizationId: string, roleId: string, reassignToRoleId?: string) {
    const role = await this.findRole(organizationId, roleId);
    if (role.isSystem) throw new BadRequestException('Un rôle système ne peut pas être supprimé');
    const holders = await this.prisma.membership.count({ where: { roleId: role.id, deletedAt: null } });
    if (holders > 0 && !reassignToRoleId) {
      throw new BadRequestException(
        `Ce rôle est attribué à ${holders} membre(s) — choisissez un rôle de remplacement`,
      );
    }
    if (reassignToRoleId) {
      if (reassignToRoleId === role.id) throw new BadRequestException('Le rôle de remplacement doit être différent');
      await this.findRole(organizationId, reassignToRoleId).catch(() => {
        throw new BadRequestException('Rôle de remplacement inconnu pour cette organisation');
      });
    }
    await this.prisma.$transaction([
      ...(reassignToRoleId
        ? [
            this.prisma.membership.updateMany({
              where: { roleId: role.id, organizationId },
              data: { roleId: reassignToRoleId },
            }),
          ]
        : []),
      // free the (organizationId, key) slot so the name can be reused later
      this.prisma.role.update({
        where: { id: role.id },
        data: { deletedAt: new Date(), key: `${role.key}__deleted_${Date.now()}` },
      }),
    ]);
    return { deleted: true, reassigned: holders };
  }
}
