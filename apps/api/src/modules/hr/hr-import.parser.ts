import * as XLSX from 'xlsx';
import { readWorkbookBounded } from '../../common/office-files';

/**
 * Pure parsers for the HR workbook imports (run in a worker thread — see parseWorkbookInWorker):
 *  - `employees`: one row per collaborator, columns recognised by header (FR/EN aliases);
 *  - `competencies`: the matrix as displayed in Astro — identifier column(s) then one column
 *    per skill, cells = level 1–5 (blank = not evaluated).
 * Values are returned as trimmed strings (dates as YYYY-MM-DD); matching against the database
 * happens in HrImportService.
 */

export type HrImportKind = 'employees' | 'competencies';

export interface ParsedIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface ParsedEmployeeRow {
  row: number;
  values: Partial<Record<EmployeeField, string>>;
}

export interface ParsedMatrixRow {
  row: number;
  employee: { reference?: string; name?: string; email?: string };
  levels: { skill: string; level: number | null; raw: string }[];
}

export interface ParsedHrWorkbook {
  kind: HrImportKind;
  sheet: string | null;
  issues: ParsedIssue[];
  employees: ParsedEmployeeRow[];
  matrix: ParsedMatrixRow[];
  skills: string[];
}

export const EMPLOYEE_FIELDS = [
  'reference', 'firstName', 'lastName', 'email', 'contact', 'cin', 'jobTitle', 'department',
  'manager', 'jobDescription', 'hireDate', 'contractType', 'trialEndDate', 'active',
] as const;
export type EmployeeField = (typeof EMPLOYEE_FIELDS)[number];

/** lowercase, accents and punctuation removed, single spaces */
export const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const EMPLOYEE_ALIASES: Record<EmployeeField, string[]> = {
  reference: ['matricule', 'reference', 'ref', 'code collaborateur', 'id'],
  firstName: ['prenom', 'first name', 'firstname', 'given name'],
  lastName: ['nom', 'nom de famille', 'last name', 'lastname', 'surname', 'family name'],
  email: ['email', 'e mail', 'mail', 'adresse email', 'adresse e mail'],
  contact: ['contact', 'telephone', 'tel', 'phone', 'mobile', 'gsm'],
  cin: ['cin', 'cni', 'piece d identite', 'numero d identite', 'national id'],
  jobTitle: ['fonction', 'poste', 'intitule du poste', 'job title', 'title', 'position'],
  department: ['processus', 'departement', 'service', 'department', 'process'],
  manager: ['manager', 'responsable', 'responsable hierarchique', 'superieur hierarchique', 'n 1', 'supervisor'],
  jobDescription: ['fiche de poste', 'job description', 'reference fiche de poste'],
  hireDate: ['date d embauche', 'date embauche', 'embauche', 'hire date', 'date d entree', 'start date'],
  contractType: ['contrat', 'type de contrat', 'contract', 'contract type'],
  trialEndDate: ['fin de periode d essai', 'fin periode d essai', 'fin periode essai', 'trial end', 'trial end date', 'fin d essai'],
  active: ['actif', 'active', 'statut', 'status'],
};
const ALIAS_TO_FIELD = new Map<string, EmployeeField>(
  (Object.entries(EMPLOYEE_ALIASES) as [EmployeeField, string[]][]).flatMap(([f, list]) => list.map((a) => [a, f] as const)),
);

/** identifier columns of the matrix sheet */
const MATRIX_ID: Record<'reference' | 'name' | 'first' | 'email', string[]> = {
  reference: ['matricule', 'reference', 'ref'],
  first: ['prenom', 'first name', 'firstname'],
  name: ['collaborateur', 'employe', 'salarie', 'nom', 'nom et prenom', 'nom prenom', 'employee', 'name'],
  email: ['email', 'e mail', 'mail'],
};
/** informative columns of our template, never read as skills */
const MATRIX_IGNORED = new Set(['fonction', 'poste', 'processus', 'departement', 'fiche de poste', 'job title', 'department']);

const pad = (n: number) => String(n).padStart(2, '0');

/** Cell → string; dates as YYYY-MM-DD (Excel serial, JS Date or dd/mm/yyyy text). */
function cellText(cell: XLSX.CellObject | undefined, asDate = false): string {
  if (!cell || cell.v == null) return '';
  if (cell.v instanceof Date) {
    const d = cell.v;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (asDate && typeof cell.v === 'number') {
    const p = XLSX.SSF.parse_date_code(cell.v);
    if (p) return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
  const text = String(cell.w ?? cell.v).trim();
  if (asDate) {
    const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (fr) return `${fr[3]}-${pad(+fr[2])}-${pad(+fr[1])}`;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  return text;
}

function pickSheet(wb: XLSX.WorkBook, kind: HrImportKind) {
  const wanted = kind === 'employees' ? ['collaborateurs', 'employes', 'employees'] : ['matrice', 'competences', 'matrice des competences', 'competencies'];
  const name = wb.SheetNames.find((n) => wanted.includes(norm(n))) ?? wb.SheetNames.find((n) => wb.Sheets[n]?.['!ref']);
  return name ? { name, ws: wb.Sheets[name]! } : null;
}

export function parseHrWorkbook(buffer: Buffer, kind: HrImportKind): ParsedHrWorkbook {
  const wb = readWorkbookBounded(buffer, { cellDates: true, cellFormula: false, cellHTML: false, sheetStubs: false });
  const out: ParsedHrWorkbook = { kind, sheet: null, issues: [], employees: [], matrix: [], skills: [] };
  const sheet = pickSheet(wb, kind);
  if (!sheet || !sheet.ws['!ref']) {
    out.issues.push({ severity: 'error', message: 'Classeur vide' });
    return out;
  }
  out.sheet = sheet.name;
  const range = XLSX.utils.decode_range(sheet.ws['!ref']);
  const at = (r: number, c: number) => sheet.ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;

  // header row = first of the first 10 rows that names enough known columns
  let header = -1;
  const columns = new Map<number, string>();
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 9) && header < 0; r++) {
    const names = new Map<number, string>();
    for (let c = range.s.c; c <= range.e.c; c++) {
      const h = norm(cellText(at(r, c)));
      if (h) names.set(c, h);
    }
    const known = [...names.values()].filter((h) =>
      kind === 'employees' ? ALIAS_TO_FIELD.has(h) : Object.values(MATRIX_ID).some((l) => l.includes(h)),
    ).length;
    if ((kind === 'employees' && known >= 2) || (kind === 'competencies' && known >= 1 && names.size >= 2)) {
      header = r;
      for (const [c, h] of names) columns.set(c, h);
    }
  }
  if (header < 0) {
    out.issues.push({
      severity: 'error',
      message:
        kind === 'employees'
          ? 'Ligne d’en-tête introuvable : le fichier doit contenir au moins les colonnes « Prénom » et « Nom » (utilisez le modèle)'
          : 'Ligne d’en-tête introuvable : la première colonne doit identifier le collaborateur (« Matricule », « Collaborateur » ou « Email »)',
    });
    return out;
  }

  if (kind === 'employees') {
    const fieldCol = new Map<EmployeeField, number>();
    for (const [c, h] of columns) {
      const f = ALIAS_TO_FIELD.get(h);
      if (f && !fieldCol.has(f)) fieldCol.set(f, c);
    }
    if (!fieldCol.has('firstName') || !fieldCol.has('lastName')) {
      out.issues.push({ severity: 'error', message: 'Colonnes « Prénom » et « Nom » obligatoires' });
      return out;
    }
    for (let r = header + 1; r <= range.e.r; r++) {
      const values: Partial<Record<EmployeeField, string>> = {};
      for (const [f, c] of fieldCol) {
        const v = cellText(at(r, c), f === 'hireDate' || f === 'trialEndDate');
        if (v) values[f] = v.slice(0, 500);
      }
      if (Object.keys(values).length) out.employees.push({ row: r + 1, values });
    }
    return out;
  }

  // competencies
  const id: { reference?: number; name?: number; first?: number; email?: number } = {};
  const skillCols: { c: number; skill: string }[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = columns.get(c);
    if (!h) continue;
    const idKey = (Object.keys(MATRIX_ID) as (keyof typeof MATRIX_ID)[]).find((k) => MATRIX_ID[k].includes(h));
    if (idKey && id[idKey] === undefined) {
      id[idKey] = c;
      continue;
    }
    if (MATRIX_IGNORED.has(h)) continue;
    skillCols.push({ c, skill: cellText(at(header, c)).slice(0, 200) });
  }
  out.skills = skillCols.map((s) => s.skill);
  if (!skillCols.length) {
    out.issues.push({ severity: 'error', message: 'Aucune colonne de compétence après les colonnes d’identification' });
    return out;
  }
  for (let r = header + 1; r <= range.e.r; r++) {
    const employee = {
      reference: id.reference !== undefined ? cellText(at(r, id.reference)) || undefined : undefined,
      name:
        [id.first, id.name]
          .filter((c): c is number => c !== undefined)
          .map((c) => cellText(at(r, c)))
          .filter(Boolean)
          .join(' ') || undefined,
      email: id.email !== undefined ? cellText(at(r, id.email)) || undefined : undefined,
    };
    const levels = skillCols.map(({ c, skill }) => {
      const raw = cellText(at(r, c));
      const n = Number(raw.replace(',', '.'));
      return { skill, raw, level: raw && Number.isInteger(n) && n >= 1 && n <= 5 ? n : null };
    });
    if (!employee.reference && !employee.name && !employee.email && levels.every((l) => !l.raw)) continue;
    out.matrix.push({ row: r + 1, employee, levels });
  }
  return out;
}
