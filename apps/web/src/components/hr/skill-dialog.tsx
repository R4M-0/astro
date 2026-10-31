'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { SKILL_TYPES, type SkillRow, type SkillType } from '@/components/hr/hr-meta';
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
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiPatch, apiPost } from '@/lib/api';

/** Create a skill, or edit one when `skill` is given. */
export function SkillDialog({
  open,
  onOpenChange,
  skill,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  skill?: SkillRow | null;
}) {
  const t = useTranslations('hr.skills');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const isEdit = !!skill;
  const [form, setForm] = useState({ name: '', description: '', type: 'TECHNICAL' as SkillType });

  const [prevReset, setPrevReset] = useState<{ open: boolean; skill: typeof skill } | null>(null);
  if (!prevReset || prevReset.open !== open || prevReset.skill !== skill) {
    setPrevReset({ open, skill });
    if (open) setForm(skill ? { name: skill.name, description: skill.description ?? '', type: skill.type } : { name: '', description: '', type: 'TECHNICAL' });
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: form.name.trim(), description: form.description.trim() || undefined, type: form.type };
      return isEdit ? apiPatch(`/hr/skills/${skill!.id}`, payload) : apiPost('/hr/skills', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'skills'] });
      toast.success(isEdit ? t('updatedToast') : t('createdToast'));
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('edit') : t('new')}</DialogTitle>
          <DialogDescription>{t('formDesc')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t('fields.name')} *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('fields.type')} *</Label>
            <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as SkillType }))}>
              <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SKILL_TYPES.map((s) => <SelectItem key={s} value={s}>{t(`types.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('fields.description')}</Label>
            <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
            {isEdit ? tc('save') : tc('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
