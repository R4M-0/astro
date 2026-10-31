'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useAvailableNavGroups } from './nav-config';

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('nav');
  const navGroups = useAvailableNavGroups();
  const tc = useTranslations('common');
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setSearch('');
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={tc('search')} value={search} onValueChange={setSearch} />
      <CommandList>
        <CommandEmpty>{tc('noResults')}</CommandEmpty>
        {navGroups.map((group, gi) => (
          <CommandGroup key={gi} heading={group.key ? t(group.key) : undefined}>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.href}
                  // unique per entry (two modules share the "Dashboard" label); group name stays searchable
                  value={`${t(item.key)} ${group.key ? t(group.key) : ''} ${item.href}`}
                  onSelect={() => go(item.href)}
                >
                  <Icon className="size-4" aria-hidden />
                  {t(item.key)}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
