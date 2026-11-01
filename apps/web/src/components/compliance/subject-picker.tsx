'use client';

import { useQuery } from '@tanstack/react-query';
import { Briefcase, Search, User, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api';
import type { Subject } from './types';

/** Finds the person a request or a hold is about: employees and candidates by name, e-mail or reference. */
export function SubjectPicker({ value, onChange }: { value: Subject | null; onChange: (s: Subject | null) => void }) {
  const t = useTranslations('compliance.subjects');
  const [search, setSearch] = useState('');
  const q = search.trim();
  const { data, isFetching } = useQuery({
    queryKey: ['compliance', 'subjects', q],
    queryFn: () => apiGet<Subject[]>(`/compliance/subjects?search=${encodeURIComponent(q)}`),
    enabled: q.length >= 2 && !value,
  });

  if (value) {
    const Icon = value.type === 'EMPLOYEE' ? User : Briefcase;
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <Icon className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{value.label}</span>
        <Badge variant="outline">{t(`status.${value.status}` as never)}</Badge>
        <Button variant="ghost" size="icon" className="size-6" onClick={() => onChange(null)} aria-label={t('clear')}>
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder={t('placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      </div>
      {q.length >= 2 && (
        <div className="max-h-56 overflow-y-auto rounded-md border">
          {isFetching && !data ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">…</p>
          ) : !data?.length ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t('none')}</p>
          ) : (
            data.map((s) => {
              const Icon = s.type === 'EMPLOYEE' ? User : Briefcase;
              return (
                <button
                  key={`${s.type}-${s.id}`}
                  type="button"
                  onClick={() => onChange(s)}
                  className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.label}</span>
                    {s.email && <span className="block truncate text-xs text-muted-foreground">{s.email}</span>}
                  </span>
                  <Badge variant="outline">{t(`status.${s.status}` as never)}</Badge>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
