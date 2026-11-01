'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EmployeeMultiSelect } from '@/components/hr/employee-multi-select';
import { ProficiencyLegend } from '@/components/hr/proficiency';
import { SkillRequirementEditor } from '@/components/hr/skill-requirement-editor';
import { useSkills } from '@/components/hr/use-hr';
import { DepartmentSelect, useDefaultDepartment, useMyDepartmentId } from '@/components/departments/department-select';
import {
  AWARENESS_KEYS,
  JD_STATUSES,
  type JobDescriptionRow,
  type SkillRequirementRow,
} from '@/components/hr/hr-meta';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiPatch, apiPost } from '@/lib/api';

interface ActivityDraft {
  description: string;
  frequency: string;
}
interface TrainingDraft {
  formation: string;
  level: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

export function JobDescriptionForm({ jd }: { jd?: JobDescriptionRow }) {
  const t = useTranslations('hr.jobDescriptions');
  const ta = useTranslations('hr.awareness');
  const tc = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const myDepartmentId = useMyDepartmentId();
  const { skills } = useSkills();
  const isEdit = !!jd;

  const initialReqs: SkillRequirementRow[] =
    jd?.skillRequirements?.map((r) => ({ skillId: r.skillId, requiredLevel: r.requiredLevel, skill: r.skill })) ?? [];
  const skillType = (id: string) => skills.find((s) => s.id === id)?.type ?? initialReqs.find((r) => r.skillId === id)?.skill?.type;

  const [reference, setReference] = useState(jd?.reference ?? '');
  const [version, setVersion] = useState(jd?.version ?? '1');
  const [jobTitle, setJobTitle] = useState(jd?.jobTitle ?? '');
  const [applicationDate, setApplicationDate] = useState(jd?.applicationDate ? jd.applicationDate.slice(0, 10) : '');
  const [departmentId, setDepartmentId] = useState(jd ? (jd.departmentId ?? '') : (myDepartmentId ?? ''));
  useDefaultDepartment(departmentId, setDepartmentId, !jd);
  const [managerId, setManagerId] = useState<string[]>(jd?.managerId ? [jd.managerId] : []);
  const [replacementId, setReplacementId] = useState<string[]>(jd?.replacementId ? [jd.replacementId] : []);
  const [mainMission, setMainMission] = useState(jd?.mainMission ?? '');
  const [hierarchicalLink, setHierarchicalLink] = useState(jd?.hierarchicalLink ?? '');
  const [functionalLink, setFunctionalLink] = useState(jd?.functionalLink ?? '');
  const [jobPurpose, setJobPurpose] = useState(jd?.jobPurpose ?? '');
  const [authority, setAuthority] = useState(jd?.authority ?? '');
  const [minExperienceMonths, setMinExperienceMonths] = useState(jd?.minExperienceMonths != null ? String(jd.minExperienceMonths) : '');
  const [experienceDomain, setExperienceDomain] = useState(jd?.experienceDomain ?? '');
  const [status, setStatus] = useState(jd?.status ?? 'DRAFT');
  const [activities, setActivities] = useState<ActivityDraft[]>(
    jd?.activities?.map((a) => ({ description: a.description, frequency: a.frequency ?? '' })) ?? [],
  );
  const [requiredTraining, setRequiredTraining] = useState<TrainingDraft[]>(
    (jd?.requiredTraining ?? []).map((r) => ({ formation: r.formation, level: r.level ?? '' })),
  );
  const [reqs, setReqs] = useState<SkillRequirementRow[]>(initialReqs);
  const [awareness, setAwareness] = useState<Record<string, boolean>>(jd?.qualityAwareness ?? {});

  const technical = reqs.filter((r) => skillType(r.skillId) === 'TECHNICAL');
  const behavioral = reqs.filter((r) => skillType(r.skillId) === 'BEHAVIORAL');
  const mergeReqs = (kept: SkillRequirementRow[], updated: SkillRequirementRow[]) => [...kept, ...updated];

  const valid = reference.trim() && version.trim() && jobTitle.trim() && departmentId;

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        reference: reference.trim(),
        version: version.trim(),
        jobTitle: jobTitle.trim(),
        applicationDate: applicationDate || undefined,
        departmentId: departmentId || undefined,
        managerId: managerId[0] || undefined,
        replacementId: replacementId[0] || undefined,
        mainMission: mainMission.trim() || undefined,
        hierarchicalLink: hierarchicalLink.trim() || undefined,
        functionalLink: functionalLink.trim() || undefined,
        jobPurpose: jobPurpose.trim() || undefined,
        // '' on edit clears the value server-side; omitted on create
        authority: isEdit ? authority.trim() : authority.trim() || undefined,
        minExperienceMonths: minExperienceMonths !== '' ? Number(minExperienceMonths) : undefined,
        experienceDomain: experienceDomain.trim() || undefined,
        status,
        requiredTraining: requiredTraining.filter((r) => r.formation.trim()).map((r) => ({ formation: r.formation.trim(), level: r.level.trim() || undefined })),
        qualityAwareness: awareness,
        activities: activities.filter((a) => a.description.trim()).map((a) => ({ description: a.description.trim(), frequency: a.frequency.trim() || undefined })),
        skillRequirements: reqs.map((r) => ({ skillId: r.skillId, requiredLevel: r.requiredLevel })),
      };
      return isEdit
        ? apiPatch<{ id: string }>(`/hr/job-descriptions/${jd!.id}`, payload)
        : apiPost<{ id: string }>('/hr/job-descriptions', payload);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'job-descriptions'] });
      toast.success(isEdit ? t('updatedToast') : t('createdToast'));
      router.push(`/hr/job-descriptions/${res.id}`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Identification de la fiche */}
      <Section title={t('sections.identification')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.reference')} *</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CC-QUAL-FDP-01" />
          </Field>
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.version')} *</Label>
            <Input value={version} onChange={(e) => setVersion(e.target.value)} />
          </Field>
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.applicationDate')}</Label>
            <Input type="date" value={applicationDate} onChange={(e) => setApplicationDate(e.target.value)} />
          </Field>
          <Field className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t('fields.jobTitle')} *</Label>
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </Field>
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.status')}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {JD_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`statuses.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.department')} *</Label>
            <DepartmentSelect size="sm" value={departmentId || null} onChange={(id) => setDepartmentId(id ?? '')} />
          </Field>
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.manager')}</Label>
            <EmployeeMultiSelect value={managerId} onChange={(ids) => setManagerId(ids.slice(-1))} placeholder="—" emptyLabel={tc('noResults')} />
          </Field>
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.replacement')}</Label>
            <EmployeeMultiSelect value={replacementId} onChange={(ids) => setReplacementId(ids.slice(-1))} placeholder="—" emptyLabel={tc('noResults')} />
          </Field>
        </div>
      </Section>

      {/* 2. Identification du poste */}
      <Section title={t('sections.jobIdentification')}>
        <Field className="flex flex-col gap-1.5">
          <Label>{t('fields.mainMission')}</Label>
          <Textarea rows={3} value={mainMission} onChange={(e) => setMainMission(e.target.value)} placeholder={t('hints.mainMission')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.hierarchicalLink')}</Label>
            <Input value={hierarchicalLink} onChange={(e) => setHierarchicalLink(e.target.value)} />
          </Field>
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.functionalLink')}</Label>
            <Input value={functionalLink} onChange={(e) => setFunctionalLink(e.target.value)} />
          </Field>
        </div>
        <Field className="flex flex-col gap-1.5">
          <Label>{t('fields.jobPurpose')}</Label>
          <Textarea rows={2} value={jobPurpose} onChange={(e) => setJobPurpose(e.target.value)} placeholder={t('hints.jobPurpose')} />
        </Field>
        <Field className="flex flex-col gap-1.5">
          <Label>{t('fields.authority')}</Label>
          <Textarea rows={3} maxLength={4000} value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder={t('hints.authority')} />
        </Field>
      </Section>

      {/* 3. Activités principales */}
      <Section title={t('sections.activities')}>
        {activities.map((a, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
            <div className="flex flex-col gap-1.5">
              {i === 0 && <Label className="text-xs text-muted-foreground">{t('fields.activity')}</Label>}
              <Textarea rows={1} value={a.description} onChange={(e) => setActivities((arr) => arr.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder={t('activityN', { n: i + 1 })} />
            </div>
            <div className="flex flex-col gap-1.5">
              {i === 0 && <Label className="text-xs text-muted-foreground">{t('fields.frequency')}</Label>}
              <Input value={a.frequency} onChange={(e) => setActivities((arr) => arr.map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)))} />
            </div>
            <div className="flex items-end">
              <Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground" onClick={() => setActivities((arr) => arr.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        {!activities.length && <p className="text-xs text-muted-foreground">{t('noActivities')}</p>}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setActivities((arr) => [...arr, { description: '', frequency: '' }])}>
          <Plus className="size-4" /> {t('addActivity')}
        </Button>
      </Section>

      {/* 4. Formation requise */}
      <Section title={t('sections.requiredTraining')}>
        {requiredTraining.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_220px_auto]">
            <div className="flex flex-col gap-1.5">
              {i === 0 && <Label className="text-xs text-muted-foreground">{t('fields.formation')}</Label>}
              <Input value={r.formation} onChange={(e) => setRequiredTraining((arr) => arr.map((x, j) => (j === i ? { ...x, formation: e.target.value } : x)))} />
            </div>
            <div className="flex flex-col gap-1.5">
              {i === 0 && <Label className="text-xs text-muted-foreground">{t('fields.level')}</Label>}
              <Input value={r.level} onChange={(e) => setRequiredTraining((arr) => arr.map((x, j) => (j === i ? { ...x, level: e.target.value } : x)))} />
            </div>
            <div className="flex items-end">
              <Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground" onClick={() => setRequiredTraining((arr) => arr.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        {!requiredTraining.length && <p className="text-xs text-muted-foreground">{t('noTraining')}</p>}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setRequiredTraining((arr) => [...arr, { formation: '', level: '' }])}>
          <Plus className="size-4" /> {t('addTraining')}
        </Button>
      </Section>

      {/* 5. Expérience professionnelle */}
      <Section title={t('sections.experience')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.minExperienceMonths')}</Label>
            <Input type="number" min={0} value={minExperienceMonths} onChange={(e) => setMinExperienceMonths(e.target.value)} />
          </Field>
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.experienceDomain')}</Label>
            <Input value={experienceDomain} onChange={(e) => setExperienceDomain(e.target.value)} />
          </Field>
        </div>
      </Section>

      {/* 6. Compétences techniques + comportementales (échelle 1–5) */}
      <Section title={t('sections.technicalSkills')}>
        <ProficiencyLegend />
        <SkillRequirementEditor type="TECHNICAL" value={technical} onChange={(rows) => setReqs(mergeReqs(behavioral, rows))} />
      </Section>
      <Section title={t('sections.behavioralSkills')}>
        <ProficiencyLegend />
        <SkillRequirementEditor type="BEHAVIORAL" value={behavioral} onChange={(rows) => setReqs(mergeReqs(technical, rows))} />
      </Section>

      {/* 7. Sensibilisation qualité */}
      <Section title={t('sections.qualityAwareness')}>
        <p className="text-xs text-muted-foreground">{t('hints.awareness')}</p>
        <div className="flex flex-col gap-2.5">
          {AWARENESS_KEYS.map((k) => (
            <label key={k} className="flex items-start gap-2.5 text-sm">
              <Checkbox checked={!!awareness[k]} onCheckedChange={(v) => setAwareness((a) => ({ ...a, [k]: !!v }))} className="mt-0.5" />
              <span>{ta(k)}</span>
            </label>
          ))}
        </div>
      </Section>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => router.push('/hr/job-descriptions')}>{tc('cancel')}</Button>
        <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {isEdit ? tc('save') : tc('create')}
        </Button>
      </div>
    </div>
  );
}
