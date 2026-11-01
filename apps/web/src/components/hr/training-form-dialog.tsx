'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { DepartmentSelect, useDefaultDepartment, useMyDepartmentId } from '@/components/departments/department-select';
import { EmployeeMultiSelect } from '@/components/hr/employee-multi-select';
import {
  HR_TRAINING_TYPES,
  TRAINING_STATUSES,
  type HrTrainingType,
  type TrainingRow,
  type TrainingStatus,
} from '@/components/hr/hr-meta';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiPatch, apiPost } from '@/lib/api';

interface TrainingDetail extends TrainingRow {
  participants?: { employee: { id: string } }[];
}

const EMPTY = {
  code: '',
  theme: '',
  type: 'INTERNE' as HrTrainingType,
  startDate: '',
  endDate: '',
  status: 'PLANNED' as TrainingStatus,
  observation: '',
  departmentId: '',
  participantIds: [] as string[],
};

export function TrainingFormDialog({
  open,
  onOpenChange,
  training,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  training?: TrainingDetail | null;
  onSaved?: (id: string) => void;
}) {
  const t = useTranslations('hr.trainings');
  const tc = useTranslations('common');
  const td = useTranslations('departments');
  const myDepartmentId = useMyDepartmentId();
  const queryClient = useQueryClient();
  const isEdit = !!training;
  const [form, setForm] = useState({ ...EMPTY });

  const [prevReset, setPrevReset] = useState<{ open: boolean; training: typeof training } | null>(null);
  if (!prevReset || prevReset.open !== open || prevReset.training !== training) {
    setPrevReset({ open, training });
    if (open) {
      setForm(
        training
          ? {
              code: training.code,
              theme: training.theme,
              type: training.type,
              startDate: training.startDate ? training.startDate.slice(0, 10) : '',
              endDate: training.endDate ? training.endDate.slice(0, 10) : '',
              status: training.status,
              observation: training.observation ?? '',
              departmentId: training.departmentId ?? '',
              participantIds: training.participants?.map((p) => p.employee.id) ?? [],
            }
          : { ...EMPTY, departmentId: myDepartmentId ?? '' },
      );
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  useDefaultDepartment(form.departmentId, (id) => set('departmentId', id), open && !isEdit);

  const dateOrderInvalid = !!form.startDate && !!form.endDate && new Date(form.endDate) < new Date(form.startDate);
  const valid = form.code.trim() && form.theme.trim() && form.departmentId && !dateOrderInvalid;

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        code: form.code.trim(),
        theme: form.theme.trim(),
        type: form.type,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        status: form.status,
        observation: form.observation.trim() || undefined,
        departmentId: form.departmentId,
        participantIds: form.participantIds,
      };
      return isEdit
        ? apiPatch<{ id: string }>(`/hr/trainings/${training!.id}`, payload)
        : apiPost<{ id: string }>('/hr/trainings', payload);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'trainings'] });
      toast.success(isEdit ? t('updatedToast') : t('createdToast'));
      onOpenChange(false);
      onSaved?.(res.id);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('edit') : t('new')}</DialogTitle>
          <DialogDescription>{t('formDesc')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="flex flex-col gap-1.5">
              <Label>{t('fields.code')} *</Label>
              <Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="FORM-2026-01" />
            </Field>
            <Field className="flex flex-col gap-1.5">
              <Label>{t('fields.type')} *</Label>
              <Select value={form.type} onValueChange={(v) => set('type', v as HrTrainingType)}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HR_TRAINING_TYPES.map((s) => <SelectItem key={s} value={s}>{t(`types.${s}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="flex flex-col gap-1.5">
              <Label>{t('fields.theme')} *</Label>
              <Input value={form.theme} onChange={(e) => set('theme', e.target.value)} />
            </Field>
            <Field className="flex flex-col gap-1.5">
              <Label>{td('label')} *</Label>
              <DepartmentSelect size="sm" value={form.departmentId || null} onChange={(id) => set('departmentId', id ?? '')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field className="flex flex-col gap-1.5">
              <Label>{t('fields.startDate')}</Label>
              <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field className="flex flex-col gap-1.5">
              <Label>{t('fields.endDate')}</Label>
              <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
            <Field className="flex flex-col gap-1.5">
              <Label>{t('fields.status')}</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v as TrainingStatus)}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAINING_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`statuses.${s}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {dateOrderInvalid && <p className="-mt-2 text-xs text-destructive">{t('dateOrderError')}</p>}
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.participants')}</Label>
            <EmployeeMultiSelect
              value={form.participantIds}
              onChange={(ids) => set('participantIds', ids)}
              placeholder={t('fields.participants')}
              emptyLabel={tc('noResults')}
            />
          </Field>
          <Field className="flex flex-col gap-1.5">
            <Label>{t('fields.observation')}</Label>
            <Textarea rows={3} value={form.observation} onChange={(e) => set('observation', e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {isEdit ? tc('save') : tc('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
