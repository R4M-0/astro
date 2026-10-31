'use client';

import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';
import { useEmployees } from './use-hr';

/** Multi-select of employees (e.g. training attendance list). Value = employee ids. */
export function EmployeeMultiSelect({
  value,
  onChange,
  placeholder,
  emptyLabel,
  disabled,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  emptyLabel: string;
  disabled?: boolean;
}) {
  const { employees, nameOf } = useEmployees();
  const [open, setOpen] = useState(false);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="flex flex-col gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn(!value.length && 'text-muted-foreground')}>
              {value.length ? `${value.length} sélectionné(s)` : placeholder}
            </span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={placeholder} />
            <CommandList>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                {employees.map((e) => {
                  const on = value.includes(e.id);
                  return (
                    <CommandItem
                      key={e.id}
                      value={`${e.firstName} ${e.lastName} ${e.reference}`}
                      onSelect={() => toggle(e.id)}
                    >
                      <span
                        className={cn(
                          'flex size-4 items-center justify-center rounded border',
                          on && 'border-primary bg-primary text-primary-foreground',
                        )}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      {e.firstName} {e.lastName}
                      {e.jobTitle && (
                        <span className="ml-auto text-xs text-muted-foreground">{e.jobTitle}</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 pr-1 text-[11px]">
              {nameOf(id)}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="rounded-sm hover:bg-muted-foreground/20"
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
