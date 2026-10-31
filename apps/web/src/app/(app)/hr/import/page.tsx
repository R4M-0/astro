'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, ShieldCheck, TriangleAlert, Upload, Users, Grid3x3 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/layout/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError, apiDownload, apiUpload } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

type Kind = 'employees' | 'competencies';
interface Issue { severity: 'error' | 'warning'; message: string }
interface RowReport { row: number; action: 'create' | 'update' | 'skip' | 'error'; label: string; issues: Issue[] }
interface Summary { total: number; create: number; update: number; skip: number; error: number; warnings: number; cells?: number; newSkills?: string[] }
interface Preview { sheet: string | null; issues: Issue[]; rows: RowReport[]; summary: Summary }

const ACTION_TONE: Record<RowReport['action'], string> = {
  create: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  update: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  skip: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  error: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

function Issues({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {issues.map((i, k) => {
        const Icon = i.severity === 'error' ? AlertCircle : TriangleAlert;
        return (
          <li key={k} className={cn('flex items-start gap-1.5 text-xs', i.severity === 'error' ? 'text-destructive' : 'text-warning-foreground dark:text-warning')}>
            <Icon className="mt-0.5 size-3 shrink-0" /> {i.message}
          </li>
        );
      })}
    </ul>
  );
}

function ImportCard({ kind }: { kind: Kind }) {
  const t = useTranslations('hr.import');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const has = useHasPermission();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [option, setOption] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(true);
  // employees: update existing collaborators · competencies: create missing skills
  const optionAllowed = kind === 'employees' ? has('employees:update') : has('skills:create');

  const form = () => {
    const fd = new FormData();
    fd.append('file', file!);
    fd.append(kind === 'employees' ? 'updateExisting' : 'createSkills', option ? 'true' : 'false');
    return fd;
  };
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : tc('error'));
  const analyse = useMutation({
    mutationFn: () => apiUpload<Preview>(`/hr/import/${kind}/preview`, form()),
    onSuccess: (p) => {
      setPreview(p);
      setResult(null);
    },
    onError: onErr,
  });
  const commit = useMutation({
    mutationFn: () => apiUpload<{ summary: Summary }>(`/hr/import/${kind}/commit`, form()),
    onSuccess: (r) => {
      setResult(r.summary);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['hr'] });
      toast.success(t('doneToast'));
    },
    onError: onErr,
  });
  const template = () =>
    apiDownload(`/hr/import/${kind}/template`, kind === 'employees' ? 'modele-collaborateurs.xlsx' : 'matrice-competences.xlsx').catch(onErr);

  const rows = (preview?.rows ?? []).filter((r) => !onlyIssues || r.issues.length || r.action === 'error' || r.action === 'skip');
  const importable = preview ? (kind === 'employees' ? preview.summary.create + preview.summary.update : preview.summary.cells ?? 0) : 0;
  const blocked = preview?.issues.some((i) => i.severity === 'error');

  return (
    <Panel title={t(`${kind}.title`)} icon={kind === 'employees' ? Users : Grid3x3}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t(`${kind}.desc`)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={template}>
            <Download className="size-4" /> {t(`${kind}.template`)}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xls,.xlsx"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
            }}
          />
          <Button variant="outline" size="sm" className="max-w-xs justify-start" onClick={() => fileRef.current?.click()}>
            <FileSpreadsheet className="size-4" /> <span className="truncate">{file ? file.name : t('chooseFile')}</span>
          </Button>
          <Button size="sm" disabled={!file || analyse.isPending} onClick={() => analyse.mutate()}>
            <Upload className="size-4" /> {analyse.isPending ? t('analysing') : t('analyse')}
          </Button>
        </div>
        {optionAllowed && (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={option}
              onCheckedChange={(v) => {
                setOption(v === true);
                setPreview(null);
              }}
            />
            {t(`${kind}.option`)}
          </label>
        )}

        {result && (
          <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            <CheckCircle2 className="size-4 text-emerald-500" />
            {kind === 'employees'
              ? t('employees.result', { create: result.create, update: result.update, skip: result.skip + result.error })
              : t('competencies.result', { cells: result.cells ?? 0, employees: result.update, skills: result.newSkills?.length ?? 0 })}
          </p>
        )}

        {preview && (
          <div className="flex flex-col gap-3">
            <Issues issues={preview.issues} />
            <div className="flex flex-wrap gap-2 text-xs">
              {(kind === 'employees' ? (['create', 'update', 'skip', 'error'] as const) : (['update', 'skip', 'error'] as const)).map((a) => (
                <Badge key={a} variant="secondary" className={cn('text-[11px]', ACTION_TONE[a])}>
                  {t(`actions.${kind === 'competencies' && a === 'update' ? 'evaluate' : a}`)} · {preview.summary[a]}
                </Badge>
              ))}
              {kind === 'competencies' && <Badge variant="outline" className="text-[11px]">{t('competencies.cells', { count: preview.summary.cells ?? 0 })}</Badge>}
              {!!preview.summary.newSkills?.length && <Badge variant="outline" className="text-[11px]">{t('competencies.newSkills', { count: preview.summary.newSkills.length })}</Badge>}
              {preview.summary.warnings > 0 && <Badge variant="outline" className="text-[11px]">{t('warnings', { count: preview.summary.warnings })}</Badge>}
            </div>
            {preview.rows.length > 0 && (
              <>
                <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={onlyIssues} onCheckedChange={(v) => setOnlyIssues(v === true)} /> {t('onlyIssues')}
                </label>
                <div className="max-h-[420px] overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">{t('row')}</TableHead>
                        <TableHead>{t('item')}</TableHead>
                        <TableHead className="w-32">{t('action')}</TableHead>
                        <TableHead>{t('remarks')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.row}>
                          <TableCell className="tabular-nums text-muted-foreground">{r.row}</TableCell>
                          <TableCell className="text-sm font-medium">{r.label}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={cn('text-[11px]', ACTION_TONE[r.action])}>
                              {t(`actions.${kind === 'competencies' && r.action === 'update' ? 'evaluate' : r.action}`)}
                            </Badge>
                          </TableCell>
                          <TableCell><Issues issues={r.issues} /></TableCell>
                        </TableRow>
                      ))}
                      {!rows.length && (
                        <TableRow>
                          <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">{t('noIssues')}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            <div>
              <Button disabled={!importable || blocked || commit.isPending} onClick={() => commit.mutate()}>
                <CheckCircle2 className="size-4" /> {commit.isPending ? t('importing') : t('commit', { count: importable })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function HrImportPage() {
  const t = useTranslations('hr.import');
  const has = useHasPermission();
  const canEmployees = has('employees:create');
  const canMatrix = has('competency-evaluations:update');

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={t('title')} description={t('desc')} />
      {!canEmployees && !canMatrix ? (
        <EmptyState icon={FileSpreadsheet} title={t('forbidden')} description={t('forbiddenDesc')} />
      ) : (
        <>
          {canEmployees && <ImportCard kind="employees" />}
          {canMatrix && <ImportCard kind="competencies" />}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> {t('safety')}</p>
        </>
      )}
    </div>
  );
}
