import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { EmployeeContractType, Prisma } from '@prisma/client';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { MAX_SHEET_ROWS, assertWorkbookUpload, parseWorkbookInWorker, uploadName } from '../../common/office-files';
import { ActivityService } from '../../core/activity/activity.service';
import { unscoped } from '../../core/department-scope/department-scope';
import { PrismaService } from '../../prisma/prisma.service';
import { norm, type EmployeeField, type HrImportKind, type ParsedHrWorkbook } from './hr-import.parser';

export interface UploadedWorkbook {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export interface ImportOptions {
  updateExisting?: boolean;
  createSkills?: boolean;
}

interface RowReport {
  row: number;
  action: 'create' | 'update' | 'skip' | 'error';
  label: string;
  issues: { severity: 'error' | 'warning'; message: string }[];
}

const CONTRACT_ALIASES: Record<string, EmployeeContractType> = {
  cdi: 'CDI', 'contrat a duree indeterminee': 'CDI', permanent: 'CDI',
  cdd: 'CDD', 'contrat a duree determinee': 'CDD', 'fixed term': 'CDD',
  interim: 'INTERIM', interimaire: 'INTERIM', temporary: 'INTERIM',
  apprentissage: 'APPRENTICESHIP', apprenti: 'APPRENTICESHIP', alternance: 'APPRENTICESHIP', apprenticeship: 'APPRENTICESHIP',
  stage: 'INTERNSHIP', stagiaire: 'INTERNSHIP', internship: 'INTERNSHIP', intern: 'INTERNSHIP',
  freelance: 'FREELANCE', independant: 'FREELANCE', consultant: 'FREELANCE', prestataire: 'FREELANCE',
  autre: 'OTHER', other: 'OTHER',
};
const TRUE = new Set(['oui', 'yes', 'y', 'o', '1', 'true', 'vrai', 'actif', 'active', 'x']);
const FALSE = new Set(['non', 'no', 'n', '0', 'false', 'faux', 'inactif', 'inactive', 'sorti']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface EmployeePlan {
  report: RowReport;
  existingId: string | null;
  data: Record<string, unknown>;
  managerKey: string | null;
  jobDescriptionId: string | null;
  keys: string[];
}

@Injectable()
export class HrImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  private async parse(kind: HrImportKind, file: UploadedWorkbook | undefined) {
    assertWorkbookUpload(file);
    const parsed = await parseWorkbookInWorker<ParsedHrWorkbook>('hr', [file.buffer, kind]);
    const count = kind === 'employees' ? parsed.employees.length : parsed.matrix.length;
    if (count > MAX_SHEET_ROWS) throw new BadRequestException({ code: 'import.tooLarge', message: `Trop de lignes (${count}) — ${MAX_SHEET_ROWS} au maximum` });
    return parsed;
  }

  private assertRights(kind: HrImportKind, opts: ImportOptions, granted: Set<string>) {
    if (kind === 'employees' && opts.updateExisting && !granted.has('employees:update')) {
      throw new ForbiddenException('Mettre à jour des collaborateurs existants nécessite employees:update');
    }
    if (kind === 'competencies' && opts.createSkills && !granted.has('skills:create')) {
      throw new ForbiddenException('Créer des compétences nécessite skills:create');
    }
  }

  // ── employees ───────────────────────────────────────────────────────────
  /** Name keys an employee can be referred to by (manager column, matrix rows). */
  private nameKeys(e: { reference?: string | null; firstName: string; lastName: string; email?: string | null }) {
    return [
      e.reference ? `ref:${norm(e.reference)}` : null,
      e.email ? `mail:${e.email.trim().toLowerCase()}` : null,
      `name:${norm(`${e.firstName} ${e.lastName}`)}`,
      `name:${norm(`${e.lastName} ${e.firstName}`)}`,
    ].filter((k): k is string => !!k);
  }

  private refKey(v: string) {
    if (EMAIL.test(v)) return `mail:${v.trim().toLowerCase()}`;
    if (/^emp[\s-]?\d+$/i.test(v.trim())) return `ref:${norm(v)}`;
    return `name:${norm(v)}`;
  }

  private async planEmployees(orgId: string, parsed: ParsedHrWorkbook, opts: ImportOptions) {
    const [employees, sites, jds] = await Promise.all([
      // matching respects the importer's visibility: they only update collaborators they can see
      this.prisma.employee.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: { id: true, reference: true, firstName: true, lastName: true, email: true, cin: true },
      }),
      this.prisma.site.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { departments: { where: { deletedAt: null }, select: { id: true, name: true } } } }),
      this.prisma.jobDescription.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { id: true, reference: true, jobTitle: true } }),
    ]);
    const departments = sites.flatMap((s) => s.departments);
    const deptByName = new Map(departments.map((d) => [norm(d.name), d.id]));
    const byRef = new Map(employees.map((e) => [norm(e.reference), e]));
    const byEmail = new Map(employees.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e]));
    const byCin = new Map(employees.filter((e) => e.cin).map((e) => [norm(e.cin), e]));
    const byName = new Map<string, typeof employees>();
    for (const e of employees) {
      const k = norm(`${e.firstName} ${e.lastName}`);
      byName.set(k, [...(byName.get(k) ?? []), e]);
    }

    const plans: EmployeePlan[] = [];
    const seen = new Set<string>();
    for (const { row, values: v } of parsed.employees) {
      const issues: RowReport['issues'] = [];
      const firstName = v.firstName?.trim() ?? '';
      const lastName = v.lastName?.trim() ?? '';
      const label = `${firstName} ${lastName}`.trim() || `Ligne ${row}`;
      if (!firstName || !lastName) issues.push({ severity: 'error', message: 'Prénom et nom obligatoires' });
      const email = v.email?.trim().toLowerCase() || null;
      if (email && !EMAIL.test(email)) issues.push({ severity: 'error', message: `Email invalide « ${v.email} »` });

      const data: Record<string, unknown> = {};
      const set = (f: EmployeeField, value: unknown) => {
        if (v[f] !== undefined) data[f] = value;
      };
      set('firstName', firstName);
      set('lastName', lastName);
      set('email', email);
      set('contact', v.contact?.slice(0, 200));
      set('cin', v.cin?.slice(0, 200));
      set('jobTitle', v.jobTitle?.slice(0, 200));
      for (const f of ['hireDate', 'trialEndDate'] as const) {
        if (v[f] === undefined) continue;
        if (!ISO_DATE.test(v[f]!) || Number.isNaN(Date.parse(v[f]!))) issues.push({ severity: 'error', message: `Date invalide « ${v[f]} » (attendu JJ/MM/AAAA)` });
        else data[f] = new Date(`${v[f]}T00:00:00.000Z`);
      }
      if (data.hireDate && data.trialEndDate && (data.trialEndDate as Date) < (data.hireDate as Date)) {
        issues.push({ severity: 'error', message: 'La fin de période d’essai précède la date d’embauche' });
      }
      if (v.contractType !== undefined) {
        const c = CONTRACT_ALIASES[norm(v.contractType)] ?? (Object.values(EmployeeContractType) as string[]).find((x) => x === v.contractType!.toUpperCase());
        if (c) data.contractType = c;
        else issues.push({ severity: 'warning', message: `Type de contrat « ${v.contractType} » non reconnu — ignoré` });
      }
      if (v.active !== undefined) {
        const a = norm(v.active);
        if (TRUE.has(a)) data.active = true;
        else if (FALSE.has(a)) data.active = false;
        else issues.push({ severity: 'warning', message: `Valeur « ${v.active} » de la colonne Actif non reconnue — ignorée` });
      }
      if (v.department !== undefined) {
        const d = deptByName.get(norm(v.department));
        if (d) data.departmentId = d;
        else issues.push({ severity: 'warning', message: `Processus « ${v.department} » inconnu — ignoré` });
      }
      let jobDescriptionId: string | null = null;
      if (v.jobDescription !== undefined) {
        const k = norm(v.jobDescription);
        const matches = jds.filter((j) => norm(j.reference) === k);
        const byTitle = matches.length ? matches : jds.filter((j) => norm(j.jobTitle) === k);
        if (byTitle.length === 1) jobDescriptionId = byTitle[0].id;
        else issues.push({ severity: 'warning', message: byTitle.length ? `Fiche de poste « ${v.jobDescription} » ambiguë — ignorée` : `Fiche de poste « ${v.jobDescription} » inconnue — ignorée` });
      }

      // existing collaborator: matricule → email → CIN → unique name
      let existing =
        (v.reference && byRef.get(norm(v.reference))) ||
        (email && byEmail.get(email)) ||
        (v.cin && byCin.get(norm(v.cin))) ||
        null;
      if (!existing && firstName && lastName) {
        const same = byName.get(norm(`${firstName} ${lastName}`)) ?? [];
        if (same.length === 1) existing = same[0];
        else if (same.length > 1) issues.push({ severity: 'warning', message: 'Plusieurs collaborateurs portent ce nom : ajoutez le matricule ou l’email pour les distinguer' });
      }
      const dupKey = existing ? `id:${existing.id}` : email ? `mail:${email}` : `name:${norm(label)}`;
      if (seen.has(dupKey)) issues.push({ severity: 'error', message: 'Collaborateur présent plusieurs fois dans le fichier' });
      seen.add(dupKey);

      const hasError = issues.some((i) => i.severity === 'error');
      const action: RowReport['action'] = hasError ? 'error' : existing ? (opts.updateExisting ? 'update' : 'skip') : 'create';
      if (action === 'skip') issues.push({ severity: 'warning', message: `Existe déjà (${existing!.reference}) — cochez « Mettre à jour » pour l’actualiser` });
      plans.push({
        report: { row, action, label: existing ? `${label} (${existing.reference})` : label, issues },
        existingId: existing?.id ?? null,
        data,
        managerKey: v.manager?.trim() || null,
        jobDescriptionId,
        keys: firstName && lastName ? this.nameKeys({ reference: existing?.reference, firstName, lastName, email }) : [],
      });
    }

    // managers: anyone already in Astro or anyone in the file
    const managerIndex = new Map<string, string>(); // key → existing id or `row:<n>`
    for (const e of employees) for (const k of this.nameKeys(e)) managerIndex.set(k, e.id);
    for (const p of plans) if (p.report.action !== 'error') for (const k of p.keys) managerIndex.set(k, p.existingId ?? `row:${p.report.row}`);
    const managerOf = new Map<EmployeePlan, string>();
    for (const p of plans) {
      if (!p.managerKey || p.report.action === 'error' || p.report.action === 'skip') continue;
      const target = managerIndex.get(this.refKey(p.managerKey));
      const self = p.existingId ?? `row:${p.report.row}`;
      if (!target) p.report.issues.push({ severity: 'warning', message: `Manager « ${p.managerKey} » introuvable — ignoré` });
      else if (target === self) p.report.issues.push({ severity: 'warning', message: 'Un collaborateur ne peut pas être son propre manager — ignoré' });
      else managerOf.set(p, target);
    }
    return { plans, managerOf };
  }

  private summary(reports: RowReport[]) {
    return {
      total: reports.length,
      create: reports.filter((r) => r.action === 'create').length,
      update: reports.filter((r) => r.action === 'update').length,
      skip: reports.filter((r) => r.action === 'skip').length,
      error: reports.filter((r) => r.action === 'error').length,
      warnings: reports.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'warning').length, 0),
    };
  }

  // ── competencies ────────────────────────────────────────────────────────
  private async planMatrix(orgId: string, parsed: ParsedHrWorkbook, opts: ImportOptions) {
    const [employees, skills, assignments] = await Promise.all([
      this.prisma.employee.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { id: true, reference: true, firstName: true, lastName: true, email: true } }),
      this.prisma.skill.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { id: true, name: true } }),
      this.prisma.jobAssignment.findMany({ where: { organizationId: orgId }, select: { employeeId: true, jobDescription: { select: { skillRequirements: { select: { skillId: true, requiredLevel: true } } } } } }),
    ]);
    const index = new Map<string, (typeof employees)[number][]>();
    for (const e of employees) for (const k of this.nameKeys(e)) index.set(k, [...(index.get(k) ?? []), e]);
    const skillByName = new Map(skills.map((s) => [norm(s.name), s.id]));
    const expected = new Map<string, number>();
    for (const a of assignments) for (const r of a.jobDescription.skillRequirements) expected.set(`${a.employeeId}:${r.skillId}`, r.requiredLevel);

    const global: RowReport['issues'] = [];
    // unknown skill columns: created on commit (option) — only those that end up with a valid level
    const candidates: string[] = [];
    for (const name of parsed.skills) {
      if (!name.trim() || skillByName.has(norm(name))) continue;
      if (opts.createSkills) candidates.push(name.trim());
      else global.push({ severity: 'warning', message: `Compétence « ${name} » inconnue — colonne ignorée (cochez « Créer les compétences manquantes »)` });
    }

    const reports: RowReport[] = [];
    const cells: { row: number; employeeId: string; skill: string; level: number }[] = [];
    const seen = new Set<string>();
    for (const r of parsed.matrix) {
      const issues: RowReport['issues'] = [];
      const keys = [
        r.employee.reference ? `ref:${norm(r.employee.reference)}` : null,
        r.employee.email ? `mail:${r.employee.email.trim().toLowerCase()}` : null,
        r.employee.name ? `name:${norm(r.employee.name)}` : null,
      ].filter((k): k is string => !!k);
      let match: (typeof employees)[number] | null = null;
      for (const k of keys) {
        const found = index.get(k) ?? [];
        if (found.length === 1) {
          match = found[0];
          break;
        }
        if (found.length > 1) issues.push({ severity: 'warning', message: 'Nom ambigu : plusieurs collaborateurs correspondent (ajoutez le matricule)' });
      }
      const label = match ? `${match.firstName} ${match.lastName} (${match.reference})` : r.employee.name ?? r.employee.reference ?? r.employee.email ?? `Ligne ${r.row}`;
      if (!match) issues.push({ severity: 'error', message: 'Collaborateur introuvable' });
      else if (seen.has(match.id)) issues.push({ severity: 'error', message: 'Collaborateur présent plusieurs fois dans le fichier' });
      if (match) seen.add(match.id);
      let n = 0;
      for (const l of r.levels) {
        if (!l.raw) continue;
        if (l.level == null) {
          issues.push({ severity: 'warning', message: `« ${l.skill} » : niveau « ${l.raw} » invalide (1 à 5) — ignoré` });
          continue;
        }
        if (!skillByName.has(norm(l.skill)) && !candidates.includes(l.skill.trim())) continue;
        if (match) cells.push({ row: r.row, employeeId: match.id, skill: l.skill.trim(), level: l.level });
        n++;
      }
      const error = issues.some((i) => i.severity === 'error');
      if (!error && !n) issues.push({ severity: 'warning', message: 'Aucun niveau renseigné' });
      reports.push({ row: r.row, action: error ? 'error' : n ? 'update' : 'skip', label, issues });
    }
    const valid = new Set(reports.filter((r) => r.action === 'update').map((r) => r.row));
    const kept = cells.filter((c) => valid.has(c.row));
    const newSkills = candidates.filter((name) => kept.some((c) => c.skill === name));
    for (const name of candidates.filter((n) => !newSkills.includes(n))) {
      global.push({ severity: 'warning', message: `Compétence « ${name} » : aucun niveau valide — non créée` });
    }
    return { reports, global, newSkills, cells: kept, skillByName, expected };
  }

  // ── entry points ────────────────────────────────────────────────────────
  async preview(orgId: string, kind: HrImportKind, file: UploadedWorkbook | undefined, opts: ImportOptions, granted: Set<string>) {
    this.assertRights(kind, opts, granted);
    const parsed = await this.parse(kind, file);
    if (kind === 'employees') {
      if (parsed.issues.some((i) => i.severity === 'error')) return { kind, sheet: parsed.sheet, issues: parsed.issues, rows: [], summary: this.summary([]) };
      const { plans } = await this.planEmployees(orgId, parsed, opts);
      const rows = plans.map((p) => p.report);
      return { kind, sheet: parsed.sheet, issues: parsed.issues, rows, summary: this.summary(rows) };
    }
    if (parsed.issues.some((i) => i.severity === 'error')) return { kind, sheet: parsed.sheet, issues: parsed.issues, rows: [], summary: { ...this.summary([]), cells: 0, newSkills: [] } };
    const plan = await this.planMatrix(orgId, parsed, opts);
    return {
      kind,
      sheet: parsed.sheet,
      issues: [...parsed.issues, ...plan.global],
      rows: plan.reports,
      summary: { ...this.summary(plan.reports), cells: plan.cells.length, newSkills: plan.newSkills },
    };
  }

  async commit(orgId: string, userId: string, kind: HrImportKind, file: UploadedWorkbook | undefined, opts: ImportOptions, granted: Set<string>) {
    this.assertRights(kind, opts, granted);
    const parsed = await this.parse(kind, file);
    const blocking = parsed.issues.filter((i) => i.severity === 'error');
    if (blocking.length) throw new BadRequestException(blocking.map((i) => i.message).join(' ; '));
    const result = kind === 'employees' ? await this.commitEmployees(orgId, userId, parsed, opts) : await this.commitMatrix(orgId, userId, parsed, opts);
    this.activity.record({
      organizationId: orgId,
      entityType: kind === 'employees' ? 'employee' : 'competency-evaluation',
      entityId: 'import',
      actorId: userId,
      verb: 'imported',
      data: { file: uploadName(file!.originalname), ...result },
    });
    return result;
  }

  private async commitEmployees(orgId: string, userId: string, parsed: ParsedHrWorkbook, opts: ImportOptions) {
    const { plans, managerOf } = await this.planEmployees(orgId, parsed, opts);
    const todo = plans.filter((p) => p.report.action === 'create' || p.report.action === 'update');
    if (!todo.length) throw new BadRequestException('Aucune ligne à importer');
    // references are numbered org-wide (a scoped importer must not reuse a hidden EMP- number)
    let next = (await unscoped(() => this.prisma.employee.count({ where: { organizationId: orgId } }))) + 1;
    const ids = new Map<EmployeePlan, string>();
    await this.prisma.$transaction(
      async (tx) => {
        for (const p of todo) {
          if (p.existingId) {
            await tx.employee.update({ where: { id: p.existingId }, data: { ...(p.data as Prisma.EmployeeUncheckedUpdateInput), updatedById: userId } });
            ids.set(p, p.existingId);
          } else {
            const created = await tx.employee.create({
              data: {
                ...(p.data as Omit<Prisma.EmployeeUncheckedCreateInput, 'organizationId' | 'reference' | 'firstName' | 'lastName'>),
                firstName: p.data.firstName as string,
                lastName: p.data.lastName as string,
                organizationId: orgId,
                reference: `EMP-${String(next++).padStart(4, '0')}`,
                createdById: userId,
              },
            });
            ids.set(p, created.id);
          }
          if (p.jobDescriptionId) {
            const employeeId = ids.get(p)!;
            await tx.jobAssignment.upsert({
              where: { employeeId },
              create: { organizationId: orgId, employeeId, jobDescriptionId: p.jobDescriptionId },
              update: { jobDescriptionId: p.jobDescriptionId, assignedAt: new Date() },
            });
          }
        }
        // managers once everyone exists; a line that would close a loop is skipped
        const rowIds = new Map<string, string>([...ids].map(([p, id]) => [`row:${p.report.row}`, id]));
        const current = new Map(
          (await tx.employee.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { id: true, managerId: true } })).map((e) => [e.id, e.managerId]),
        );
        for (const [p, target] of managerOf) {
          const id = ids.get(p);
          const managerId = rowIds.get(target) ?? target;
          if (!id) continue;
          let walk: string | null | undefined = managerId;
          let loop = false;
          for (let guard = 0; walk && guard < 10_000; guard++) {
            if (walk === id) {
              loop = true;
              break;
            }
            walk = current.get(walk);
          }
          if (loop) {
            p.report.issues.push({ severity: 'warning', message: 'Ligne hiérarchique circulaire — manager ignoré' });
            continue;
          }
          await tx.employee.update({ where: { id }, data: { managerId } });
          current.set(id, managerId);
        }
      },
      { timeout: 60_000 },
    );
    const rows = plans.map((p) => p.report);
    return { summary: this.summary(rows), rows };
  }

  private async commitMatrix(orgId: string, userId: string, parsed: ParsedHrWorkbook, opts: ImportOptions) {
    const plan = await this.planMatrix(orgId, parsed, opts);
    if (!plan.cells.length) throw new BadRequestException('Aucun niveau à importer');
    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        for (const name of plan.newSkills) {
          const s = await tx.skill.create({ data: { organizationId: orgId, name, type: 'TECHNICAL', createdById: userId } });
          plan.skillByName.set(norm(name), s.id);
        }
        for (const c of plan.cells) {
          const skillId = plan.skillByName.get(norm(c.skill))!;
          const expectedLevel = plan.expected.get(`${c.employeeId}:${skillId}`) ?? null;
          const gap = expectedLevel != null ? c.level - expectedLevel : 0;
          await tx.competencyEvaluation.upsert({
            where: { employeeId_skillId: { employeeId: c.employeeId, skillId } },
            create: {
              organizationId: orgId, employeeId: c.employeeId, skillId, expectedLevel, evaluatedLevel: c.level, gap,
              evaluationMethod: 'Import Excel', evaluatedById: userId, evaluatedAt: now,
            },
            update: { expectedLevel, evaluatedLevel: c.level, gap, evaluationMethod: 'Import Excel', evaluatedById: userId, evaluatedAt: now },
          });
        }
      },
      { timeout: 60_000 },
    );
    return { summary: { ...this.summary(plan.reports), cells: plan.cells.length, newSkills: plan.newSkills }, rows: plan.reports };
  }

  // ── templates ───────────────────────────────────────────────────────────
  /** Blank employees template / pre-filled matrix (current collaborators × skills) as .xlsx. */
  async template(orgId: string, kind: HrImportKind): Promise<Buffer> {
    const wb = XLSX.utils.book_new();
    if (kind === 'employees') {
      const headers = ['Matricule', 'Prénom', 'Nom', 'Email', 'Téléphone', 'CIN', 'Fonction', 'Processus', 'Manager', 'Fiche de poste', 'Date d’embauche', 'Type de contrat', 'Fin de période d’essai', 'Actif'];
      const example = ['', 'Camille', 'Martin', 'camille.martin@exemple.fr', '', '', 'Technicienne qualité', 'Production', 'EMP-0001', '', '01/09/2026', 'CDI', '28/02/2027', 'Oui'];
      const ws = XLSX.utils.aoa_to_sheet([headers, example]);
      ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
      XLSX.utils.book_append_sheet(wb, ws, 'Collaborateurs');
      const sites = await this.prisma.site.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { departments: { where: { deletedAt: null }, select: { name: true } } } });
      const processes = sites.flatMap((s) => s.departments.map((d) => d.name)).sort((a, b) => a.localeCompare(b, 'fr'));
      const contracts = ['CDI', 'CDD', 'Intérim', 'Apprentissage', 'Stage', 'Freelance', 'Autre'];
      const rows = Array.from({ length: Math.max(processes.length, contracts.length) }, (_, i) => [processes[i] ?? '', contracts[i] ?? '']);
      const lists = XLSX.utils.aoa_to_sheet([['Processus', 'Type de contrat'], ...rows]);
      lists['!cols'] = [{ wch: 32 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, lists, 'Listes');
    } else {
      const [employees, skills, evaluations] = await Promise.all([
        this.prisma.employee.findMany({ where: { organizationId: orgId, deletedAt: null, active: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], select: { id: true, reference: true, firstName: true, lastName: true } }),
        this.prisma.skill.findMany({ where: { organizationId: orgId, deletedAt: null }, orderBy: [{ type: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
        this.prisma.competencyEvaluation.findMany({ where: { organizationId: orgId }, select: { employeeId: true, skillId: true, evaluatedLevel: true } }),
      ]);
      const level = new Map(evaluations.map((e) => [`${e.employeeId}:${e.skillId}`, e.evaluatedLevel]));
      const aoa = [
        ['Matricule', 'Collaborateur', ...skills.map((s) => s.name)],
        ...employees.map((e) => [e.reference, `${e.firstName} ${e.lastName}`, ...skills.map((s) => level.get(`${e.id}:${s.id}`) ?? '')]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 12 }, { wch: 28 }, ...skills.map((s) => ({ wch: Math.max(10, Math.min(30, s.name.length + 2)) }))];
      XLSX.utils.book_append_sheet(wb, ws, 'Matrice');
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
