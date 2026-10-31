'use client';

import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ProficiencyPicker } from '@/components/hr/proficiency';
import { useSkills } from '@/components/hr/use-hr';
import type { SkillRequirementRow, SkillType } from '@/components/hr/hr-meta';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Reusable competency + required-level editor. Filters the skill repository by
 * `type` and prevents duplicate skills within the same job description.
 */
export function SkillRequirementEditor({
  type,
  value,
  onChange,
}: {
  type: SkillType;
  value: SkillRequirementRow[];
  onChange: (rows: SkillRequirementRow[]) => void;
}) {
  const t = useTranslations('hr.jobDescriptions');
  const { skills } = useSkills();
  const [open, setOpen] = useState(false);

  const pool = skills.filter((s) => s.type === type);
  const selectedIds = new Set(value.map((v) => v.skillId));

  const add = (skillId: string) => {
    if (selectedIds.has(skillId)) return;
    const skill = skills.find((s) => s.id === skillId);
    onChange([...value, { skillId, requiredLevel: 3, skill }]);
    setOpen(false);
  };
  const setLevel = (skillId: string, requiredLevel: number) =>
    onChange(value.map((v) => (v.skillId === skillId ? { ...v, requiredLevel } : v)));
  const remove = (skillId: string) => onChange(value.filter((v) => v.skillId !== skillId));

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-col divide-y rounded-md border">
          {value.map((row) => {
            const skill = row.skill ?? skills.find((s) => s.id === row.skillId);
            return (
              <div key={row.skillId} className="flex items-center gap-3 p-2.5">
                <span className="flex-1 text-sm font-medium">{skill?.name ?? row.skillId}</span>
                <ProficiencyPicker
                  size="sm"
                  value={row.requiredLevel}
                  onChange={(v) => setLevel(row.skillId, v || 1)}
                />
                <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={() => remove(row.skillId)}>
                  <X className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-fit">
            <ChevronsUpDown className="size-4" /> {t('addSkill')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder={t('selectSkill')} />
            <CommandList>
              <CommandEmpty>{t('noSkills')}</CommandEmpty>
              <CommandGroup>
                {pool.map((s) => {
                  const on = selectedIds.has(s.id);
                  return (
                    <CommandItem key={s.id} value={s.name} onSelect={() => add(s.id)} disabled={on}>
                      <span className="flex size-4 items-center justify-center">
                        {on && <Check className="size-3 text-primary" />}
                      </span>
                      {s.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {!value.length && <p className="text-xs text-muted-foreground">{t('noSkills')}</p>}
    </div>
  );
}
