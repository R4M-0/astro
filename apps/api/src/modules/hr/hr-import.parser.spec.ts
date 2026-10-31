import * as XLSX from 'xlsx';
import { parseHrWorkbook } from './hr-import.parser';

const book = (sheet: string, rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

describe('parseHrWorkbook — employees', () => {
  it('maps FR headers (accents, apostrophes) and normalises dates', () => {
    const p = parseHrWorkbook(
      book('Collaborateurs', [
        ['Prénom', 'Nom', 'E-mail', 'Date d’embauche', 'Fin de période d’essai', 'Processus'],
        ['Zoé', 'Martin', 'zoe@example.com', '01/09/2026', new Date(Date.UTC(2027, 1, 28)), 'Production'],
      ]),
      'employees',
    );
    expect(p.issues).toEqual([]);
    expect(p.employees).toHaveLength(1);
    expect(p.employees[0].row).toBe(2);
    expect(p.employees[0].values).toMatchObject({
      firstName: 'Zoé',
      lastName: 'Martin',
      email: 'zoe@example.com',
      hireDate: '2026-09-01',
      department: 'Production',
    });
    expect(p.employees[0].values.trialEndDate).toMatch(/^2027-02-2[78]$/);
  });

  it('finds the header row below a title and skips blank rows', () => {
    const p = parseHrWorkbook(
      book('Feuil1', [['Liste du personnel'], [], ['First name', 'Last name'], ['Ann', 'Lee'], [], ['Bob', 'Ray']]),
      'employees',
    );
    expect(p.employees.map((e) => e.values.firstName)).toEqual(['Ann', 'Bob']);
    expect(p.employees.map((e) => e.row)).toEqual([4, 6]);
  });

  it('rejects a sheet without first/last name columns', () => {
    const p = parseHrWorkbook(book('Collaborateurs', [['Email', 'Fonction'], ['a@b.c', 'X']]), 'employees');
    expect(p.issues[0].severity).toBe('error');
    expect(p.employees).toEqual([]);
  });
});

describe('parseHrWorkbook — competency matrix', () => {
  it('reads identifier columns then one column per skill, levels 1–5 only', () => {
    const p = parseHrWorkbook(
      book('Matrice', [
        ['Matricule', 'Collaborateur', 'Fonction', 'Soudure', 'Lecture de plans'],
        ['EMP-0001', 'Ann Lee', 'Soudeuse', 4, ''],
        ['', 'Bob Ray', '', '7', 'abc'],
      ]),
      'competencies',
    );
    expect(p.issues).toEqual([]);
    expect(p.skills).toEqual(['Soudure', 'Lecture de plans']); // « Fonction » is informative, not a skill
    expect(p.matrix[0].employee).toEqual({ reference: 'EMP-0001', name: 'Ann Lee', email: undefined });
    expect(p.matrix[0].levels).toEqual([
      { skill: 'Soudure', raw: '4', level: 4 },
      { skill: 'Lecture de plans', raw: '', level: null },
    ]);
    // out-of-scale and text values are kept raw (reported) but carry no level
    expect(p.matrix[1].levels.map((l) => l.level)).toEqual([null, null]);
    expect(p.matrix[1].levels.map((l) => l.raw)).toEqual(['7', 'abc']);
  });

  it('joins separate first-name / name columns', () => {
    const p = parseHrWorkbook(book('Matrice', [['Prénom', 'Nom', 'Soudure'], ['Ann', 'Lee', 3]]), 'competencies');
    expect(p.skills).toEqual(['Soudure']);
    expect(p.matrix[0].employee.name).toBe('Ann Lee');
  });
});
