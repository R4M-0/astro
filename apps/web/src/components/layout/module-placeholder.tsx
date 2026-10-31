'use client';

import { Construction } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Temporary stub rendered for module routes whose phase has not shipped yet. */
export function ModulePlaceholder({ navKey, clause }: { navKey: string; clause?: string }) {
  const t = useTranslations('nav');
  return (
    <div className="flex h-full min-h-[60svh] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="rounded-xl bg-muted p-4">
        <Construction className="size-8 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">
        {t(navKey)}
        {clause && <span className="ml-2 text-sm font-normal text-muted-foreground">ISO {clause}</span>}
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Ce module arrive dans une prochaine phase de développement.
      </p>
    </div>
  );
}
