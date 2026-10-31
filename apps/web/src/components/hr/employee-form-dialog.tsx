'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useMembers } from '@/components/hr/use-members';
import { DepartmentSelect, useDefaultDepartment, useMyDepartmentId } from '@/components/departments/department-select';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useEmployees } from './use-hr';
import { CONTRACT_TYPES, toDateInput, type EmployeeRow, type JobDescriptionRow } from './hr-meta';

const NONE = '__none__';
const EMPTY = {
  firstName: '',
  lastName: '',
  contact: '',
  email: '',
  cin: '',
  jobTitle: '',
  departmentId: '',
  managerId: '',
  userId: '',
  jobDescriptionId: '',
  active: true,
  hireDate: '',
  contractType: '',
  trialEndDate: '',
};

export function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employee?: (EmployeeRow & { jobDescription?: { id: string } | null }) | null;
  onSaved?: (id: string) => void;
}) {
  const t = useTranslations('hr.employees');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const { members } = useMembers();
  const { employees } = useEmployees();
  const isEdit = !!employee;
  const myDepartmentId = useMyDepartmentId();
  const [form, setForm] = useState({ ...EMPTY });

  const { data: jobDescriptions } = useQuery({
    queryKey: ['hr', 'job-descriptions', 'select'],
    queryFn: () => apiGet<{ data: JobDescriptionRow[] }>('/hr/job-descriptions?pageSize=200'),
    enabled: open,
  });

  const [prevReset, setPrevReset] = useState<{ open: boolean; employee: typeof employee } | null>(null);
  if (!prevReset || prevReset.open !== open || prevReset.employee !== employee) {
    setPrevReset({ open, employee });
    if (open) setForm(
      employee
        ? {
            firstName: employee.firstName,
            lastName: employee.lastName,
            contact: employee.contact ?? '',
            email: employee.email ?? '',
            cin: employee.cin ?? '',
            jobTitle: employee.jobTitle ?? '',
            departmentId: employee.departmentId ?? '',
            managerId: employee.managerId ?? '',
            userId: employee.userId ?? '',
            jobDescriptionId: employee.jobDescription?.id ?? '',
            active: employee.active,
            hireDate: toDateInput(employee.hireDate),
            contractType: employee.contractType ?? '',
            trialEndDate: toDateInput(employee.trialEndDate),
          }
        : { ...EMPTY, departmentId: myDepartmentId ?? '' },
    );
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  useDefaultDepartment(form.departmentId, (id) => set('departmentId', id), open && !isEdit);

  const emailInvalid = !!form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const trialInvalid = !!form.hireDate && !!form.trialEndDate && form.trialEndDate < form.hireDate;
  const valid = form.firstName.trim() && form.lastName.trim() && form.departmentId && !emailInvalid && !trialInvalid;

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        contact: form.contact.trim() || undefined,
        email: form.email.trim() || undefined,
        cin: form.cin.trim() || undefined,
        jobTitle: form.jobTitle.trim() || undefined,
        departmentId: form.departmentId || undefined,
        managerId: isEdit ? form.managerId || '' : form.managerId || undefined,
        userId: form.userId || undefined,
        active: form.active,
        // '' clears on edit; omitted on create
        hireDate: form.hireDate || (isEdit ? null : undefined),
        contractType: form.contractType || (isEdit ? null : undefined),
        trialEndDate: form.trialEndDate || (isEdit ? null : undefined),
        ...(isEdit ? { jobDescriptionId: form.jobDescriptionId || '' } : {}),
      };
      return isEdit
        ? apiPatch<EmployeeRow>(`/hr/employees/${employee!.id}`, payload)
        : apiPost<EmployeeRow>('/hr/employees', payload);
    },
    onSuccess: async (res) => {
      // assign job description on create (create dto ignores it) via a follow-up patch
      if (!isEdit && form.jobDescriptionId) {
        await apiPatch(`/hr/employees/${res.id}`, { jobDescriptionId: form.jobDescriptionId });
      }
      queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] });
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
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.firstName')} *</Label>
              <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.lastName')} *</Label>
              <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.contact')}</Label>
              <Input value={form.contact} onChange={(e) => set('contact', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.email')}</Label>
              <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              {emailInvalid && <p className="text-xs text-destructive">{tc('error')}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.cin')}</Label>
              <Input value={form.cin} onChange={(e) => set('cin', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.jobTitle')}</Label>
              <Input value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.department')} *</Label>
              <DepartmentSelect size="sm" value={form.departmentId || null} onChange={(id) => set('departmentId', id ?? '')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.manager')}</Label>
              <Select value={form.managerId || NONE} onValueChange={(v) => set('managerId', v === NONE ? '' : v)}>
                <SelectTrigger size="sm"><SelectValue placeholder={t('noManager')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('noManager')}</SelectItem>
                  {employees
                    .filter((e) => e.id !== employee?.id)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.firstName} {e.lastName}
                        {e.jobTitle ? ` · ${e.jobTitle}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.jobDescription')}</Label>
              <Select value={form.jobDescriptionId || NONE} onValueChange={(v) => set('jobDescriptionId', v === NONE ? '' : v)}>
                <SelectTrigger size="sm"><SelectValue placeholder={t('unassigned')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('unassigned')}</SelectItem>
                  {(jobDescriptions?.data ?? []).map((j) => (
                    <SelectItem key={j.id} value={j.id}>{j.jobTitle} · {j.reference}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.user')}</Label>
              <Select value={form.userId || NONE} onValueChange={(v) => set('userId', v === NONE ? '' : v)}>
                <SelectTrigger size="sm"><SelectValue placeholder={t('unassigned')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('unassigned')}</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user.id} value={m.user.id}>{m.user.firstName} {m.user.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.hireDate')}</Label>
              <Input type="date" value={form.hireDate} onChange={(e) => set('hireDate', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.contractType')}</Label>
              <Select value={form.contractType || NONE} onValueChange={(v) => set('contractType', v === NONE ? '' : v)}>
                <SelectTrigger size="sm"><SelectValue placeholder={t('unassigned')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('unassigned')}</SelectItem>
                  {CONTRACT_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>{t(`contracts.${c}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('fields.trialEndDate')}</Label>
              <Input type="date" value={form.trialEndDate} min={form.hireDate || undefined} onChange={(e) => set('trialEndDate', e.target.value)} />
              {trialInvalid && <p className="text-xs text-destructive">{t('trialBeforeHire')}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} id="emp-active" />
            <Label htmlFor="emp-active">{t('fields.active')}</Label>
          </div>
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
