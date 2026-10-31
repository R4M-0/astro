'use client';

import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDepartments } from '@/components/hr/use-hr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useActiveMembership } from '@/stores/session';

const NONE = '__none__';

/** The current user's main department (default of every new record). */
export function useMyDepartmentId(): string | null {
  return useActiveMembership()?.departmentId ?? null;
}

/**
 * Pre-fills an empty department with the user's own on create forms.
 * Call it with the form's current value and setter; it only fires while `enabled` (e.g. dialog open, not editing).
 */
export function useDefaultDepartment(value: string | null | undefined, set: (id: string) => void, enabled = true) {
  const mine = useMyDepartmentId();
  useEffect(() => {
    if (enabled && !value && mine) set(mine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mine]);
}

/**
 * The organization's departments as picker options (sorted by name; the site is shown as a hint when
 * the organization has several sites).
 */
export function useDepartmentOptions() {
  const { departments, nameOf } = useDepartments();
  const multiSite = new Set(departments.map((d) => d.siteName)).size > 1;
  const options = departments
    .map((d) => ({ id: d.id, name: d.name, code: multiSite ? d.siteName : null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { options, departments, nameOf };
}

/**
 * Department picker. Records of the department-scoped registers belong to a department: members of
 * department-limited roles only see their department(s)' records.
 */
export function DepartmentSelect({
  value,
  onChange,
  allowNone,
  disabled,
  className,
  size,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  /** offer an empty choice (filters, optional fields) */
  allowNone?: boolean;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default';
}) {
  const t = useTranslations('departments');
  const { options } = useDepartmentOptions();
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger size={size} className={cn('w-full', className)}>
        <SelectValue placeholder={t('choose')} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value={NONE}>{t('none')}</SelectItem> : !value && <SelectItem value={NONE} disabled>{t('choose')}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
            {o.code && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{o.code}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Several departments (admin: extra departments a member may see). */
export function DepartmentMultiSelect({
  value,
  onChange,
  exclude,
  disabled,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** e.g. the member's main department */
  exclude?: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations('departments');
  const { options: all, nameOf } = useDepartmentOptions();
  const [open, setOpen] = useState(false);
  const options = all.filter((d) => d.id !== exclude);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((id) => (
        <Badge key={id} variant="secondary" className="gap-1 pr-1 text-[11px]">
          {nameOf(id)}
          {!disabled && (
            <button type="button" aria-label={t('remove')} onClick={() => toggle(id)} className="rounded hover:bg-foreground/10">
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted-foreground">
              {t('addExtra')} <ChevronsUpDown className="size-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder={t('search')} />
              <CommandList>
                <CommandEmpty>{t('empty')}</CommandEmpty>
                <CommandGroup>
                  {options.map((d) => (
                    <CommandItem key={d.id} value={`${d.name} ${d.code ?? ''}`} onSelect={() => toggle(d.id)}>
                      <Check className={cn('size-4', value.includes(d.id) ? 'opacity-100' : 'opacity-0')} />
                      {d.name}
                      {d.code && <span className="ml-auto font-mono text-[10px] text-muted-foreground">{d.code}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

const ALL_PROCESSES = '__all__';

/**
 * List-toolbar filter « Tous les services » / one department. `value` is a departmentId or '' for
 * all; send it as `departmentId` on the register's list endpoint.
 */
export function DepartmentFilter({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (departmentId: string) => void;
  className?: string;
}) {
  const t = useTranslations('departments');
  const { options } = useDepartmentOptions();
  return (
    <Select value={value || ALL_PROCESSES} onValueChange={(v) => onChange(v === ALL_PROCESSES ? '' : v)}>
      <SelectTrigger size="sm" className={cn('w-44', className)} aria-label={t('label')}>
        <SelectValue placeholder={t('allProcesses')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_PROCESSES}>{t('allProcesses')}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
