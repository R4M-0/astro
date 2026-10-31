import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeContractType, Prisma } from '@prisma/client';
import { ActivityService } from '../../core/activity/activity.service';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { assertMembers } from '../../common/assert-members';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeQuery } from './dto/hr.dto';
import { unscoped } from '../../core/department-scope/department-scope';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async nextReference(orgId: string): Promise<string> {
    const count = await unscoped(() => this.prisma.employee.count({ where: { organizationId: orgId } }));
    return `EMP-${String(count + 1).padStart(4, '0')}`;
  }

  async list(orgId: string, q: EmployeeQuery) {
    const where: Prisma.EmployeeWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.contractType ? { contractType: q.contractType as Prisma.EmployeeWhereInput['contractType'] } : {}),
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { cin: { contains: q.search, mode: 'insensitive' } },
              { reference: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const sortable = ['createdAt', 'firstName', 'lastName', 'reference', 'jobTitle', 'hireDate'];
    const orderBy: Prisma.EmployeeOrderByWithRelationInput = {
      [sortable.includes(q.sortBy ?? '') ? (q.sortBy as string) : 'lastName']:
        q.sortOrder ?? 'asc',
    };
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy,
        skip: q.skip,
        take: q.pageSize,
        include: {
          assignments: { include: { jobDescription: { select: { id: true, jobTitle: true, reference: true } } } },
          _count: { select: { evaluations: true, participants: true } },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);
    const decorated = rows.map((r) => {
      const { assignments, _count, ...rest } = r;
      return {
        ...rest,
        jobDescription: assignments[0]?.jobDescription ?? null,
        evaluationCount: _count.evaluations,
        trainingCount: _count.participants,
      };
    });
    return paginate(decorated, total, q as unknown as PaginationQuery);
  }

  /** Flat list of every employee for the org chart, with reports counts. */
  async orgChart(orgId: string) {
    const rows = await this.prisma.employee.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        reference: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        departmentId: true,
        managerId: true,
        email: true,
        contact: true,
        active: true,
      },
    });
    return rows;
  }

  /**
   * Would setting `managerId` as the manager of `employeeId` create a cycle?
   * Walks up the proposed manager's chain; a hit on employeeId means a loop.
   */
  private async wouldCreateCycle(orgId: string, employeeId: string, managerId: string) {
    let current: string | null = managerId;
    const seen = new Set<string>();
    while (current) {
      if (current === employeeId) return true;
      if (seen.has(current)) break; // pre-existing loop guard
      seen.add(current);
      // whole-org walk: a manager outside the caller's processes still belongs to the chain
      const id: string = current;
      const parent: { managerId: string | null } | null = await unscoped(() =>
        this.prisma.employee.findFirst({ where: { id, organizationId: orgId }, select: { managerId: true } }),
      );
      current = parent?.managerId ?? null;
    }
    return false;
  }

  private async resolveManagerId(
    orgId: string,
    employeeId: string | null,
    managerId: string,
  ): Promise<string | null> {
    if (!managerId) return null;
    if (managerId === employeeId) throw new BadRequestException('An employee cannot manage themselves');
    const manager = await unscoped(() =>
      this.prisma.employee.findFirst({
        where: { id: managerId, organizationId: orgId, deletedAt: null },
        select: { id: true },
      }),
    );
    if (!manager) throw new NotFoundException('Manager not found');
    if (employeeId && (await this.wouldCreateCycle(orgId, employeeId, managerId))) {
      throw new BadRequestException('This would create a circular reporting line');
    }
    return managerId;
  }

  async assert(orgId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async get(orgId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        assignments: {
          include: {
            jobDescription: {
              include: { skillRequirements: { include: { skill: true } } },
            },
          },
        },
        evaluations: { include: { skill: true }, orderBy: { evaluatedAt: 'desc' } },
        participants: {
          include: { training: { select: { id: true, code: true, theme: true, status: true, startDate: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const { assignments, ...rest } = employee;
    return { ...rest, jobDescription: assignments[0]?.jobDescription ?? null };
  }


  /** The department must belong to the org (ids come from the client). */
  private async assertDepartment(orgId: string, departmentId: unknown) {
    if (!departmentId) return;
    const found = await this.prisma.department.count({
      where: { id: departmentId as string, deletedAt: null, site: { organizationId: orgId } },
    });
    if (!found) throw new BadRequestException('Département inconnu');
  }

  /** Hire / contract / trial / exit fields: only the keys present are written, '' or null clears. */
  private lifecycleFields(dto: Record<string, unknown>) {
    const date = (v: unknown) => (v ? new Date(v as string) : null);
    const out: {
      hireDate?: Date | null;
      trialEndDate?: Date | null;
      exitDate?: Date | null;
      contractType?: EmployeeContractType | null;
      exitReason?: string | null;
    } = {};
    if (dto.hireDate !== undefined) out.hireDate = date(dto.hireDate);
    if (dto.trialEndDate !== undefined) out.trialEndDate = date(dto.trialEndDate);
    if (dto.exitDate !== undefined) out.exitDate = date(dto.exitDate);
    if (dto.contractType !== undefined) out.contractType = (dto.contractType as EmployeeContractType) || null;
    if (dto.exitReason !== undefined) out.exitReason = (dto.exitReason as string) || null;
    const hire = out.hireDate;
    const trial = out.trialEndDate;
    if (hire && trial && trial < hire) throw new BadRequestException('La fin de période d’essai doit suivre la date d’embauche');
    return out;
  }

  async create(orgId: string, userId: string, dto: Record<string, unknown>) {
    await assertMembers(this.prisma, orgId, [dto.userId as string | undefined]);
    await this.assertDepartment(orgId, dto.departmentId);
    const reference = await this.nextReference(orgId);
    const managerId = dto.managerId
      ? await this.resolveManagerId(orgId, null, dto.managerId as string)
      : null;
    const employee = await this.prisma.employee.create({
      data: {
        organizationId: orgId,
        reference,
        firstName: dto.firstName as string,
        lastName: dto.lastName as string,
        contact: (dto.contact as string) || null,
        email: (dto.email as string) || null,
        cin: (dto.cin as string) || null,
        jobTitle: (dto.jobTitle as string) || null,
        departmentId: (dto.departmentId as string) || null,
        managerId,
        userId: (dto.userId as string) || null,
        active: dto.active === undefined ? true : (dto.active as boolean),
        ...this.lifecycleFields(dto),
        createdById: userId,
      },
    });
    this.activity.record({
      organizationId: orgId,
      entityType: 'employee',
      entityId: employee.id,
      actorId: userId,
      verb: 'created',
      data: { reference: employee.reference, name: `${employee.firstName} ${employee.lastName}` },
    });
    return this.get(orgId, employee.id);
  }

  async update(orgId: string, userId: string, id: string, dto: Record<string, unknown>, granted?: Set<string>) {
    await assertMembers(this.prisma, orgId, [dto.userId as string | undefined]);
    await this.assertDepartment(orgId, dto.departmentId);
    const current = await this.assert(orgId, id);
    // the employee ↔ login link drives identity-based gates (HACCP team, signatures, surveys):
    // only a users admin may re-point it once set
    if (
      dto.userId !== undefined &&
      current.userId &&
      (dto.userId || null) !== current.userId &&
      !granted?.has('users:admin')
    ) {
      throw new ForbiddenException('Seul un administrateur des utilisateurs peut modifier le compte lié');
    }
    const { jobDescriptionId, ...fields } = dto;
    const managerId =
      fields.managerId !== undefined
        ? await this.resolveManagerId(orgId, id, (fields.managerId as string) || '')
        : undefined;
    await this.prisma.employee.update({
      where: { id },
      data: {
        ...(fields.firstName !== undefined ? { firstName: fields.firstName as string } : {}),
        ...(fields.lastName !== undefined ? { lastName: fields.lastName as string } : {}),
        ...(fields.contact !== undefined ? { contact: (fields.contact as string) || null } : {}),
        ...(fields.email !== undefined ? { email: (fields.email as string) || null } : {}),
        ...(fields.cin !== undefined ? { cin: (fields.cin as string) || null } : {}),
        ...(fields.jobTitle !== undefined ? { jobTitle: (fields.jobTitle as string) || null } : {}),
        ...(fields.departmentId !== undefined
          ? { departmentId: (fields.departmentId as string) || null }
          : {}),
        ...(managerId !== undefined ? { managerId } : {}),
        ...(fields.userId !== undefined ? { userId: (fields.userId as string) || null } : {}),
        ...(fields.active !== undefined ? { active: fields.active as boolean } : {}),
        ...this.lifecycleFields(fields),
        updatedById: userId,
      },
    });
    if (jobDescriptionId !== undefined) {
      await this.assignJobDescription(orgId, id, (jobDescriptionId as string) || null);
    }
    this.activity.record({
      organizationId: orgId,
      entityType: 'employee',
      entityId: id,
      actorId: userId,
      verb: 'updated',
    });
    return this.get(orgId, id);
  }

  /** Assign (or clear) the employee's job description; drives expected competency levels. */
  async assignJobDescription(orgId: string, employeeId: string, jobDescriptionId: string | null) {
    await this.assert(orgId, employeeId);
    if (!jobDescriptionId) {
      await this.prisma.jobAssignment.deleteMany({ where: { employeeId } });
      return { assigned: null };
    }
    const jd = await this.prisma.jobDescription.findFirst({
      where: { id: jobDescriptionId, organizationId: orgId, deletedAt: null },
    });
    if (!jd) throw new NotFoundException('Job description not found');
    await this.prisma.jobAssignment.upsert({
      where: { employeeId },
      create: { organizationId: orgId, employeeId, jobDescriptionId },
      update: { jobDescriptionId, assignedAt: new Date() },
    });
    return { assigned: jobDescriptionId };
  }

  async remove(orgId: string, userId: string, id: string) {
    const employee = await this.assert(orgId, id);
    // re-parent this manager's direct reports to their grand-manager
    // whole org: reports in other processes must not keep pointing at a deleted manager
    await unscoped(() =>
      this.prisma.employee.updateMany({
        where: { organizationId: orgId, managerId: id },
        data: { managerId: employee.managerId ?? null },
      }),
    );
    await this.prisma.employee.update({ where: { id }, data: { deletedAt: new Date(), managerId: null } });
    this.activity.record({
      organizationId: orgId,
      entityType: 'employee',
      entityId: id,
      actorId: userId,
      verb: 'deleted',
    });
    return { deleted: true };
  }
}
