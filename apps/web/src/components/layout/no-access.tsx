'use client';

import { SearchX, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/layout/empty-state';
import { Button } from '@/components/ui/button';

function BackHome() {
  const t = useTranslations('common');
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/dashboard">{t('backHome')}</Link>
    </Button>
  );
}

/** Shown in place of a page the member's role cannot open. */
export function NoAccess() {
  const t = useTranslations('common');
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <EmptyState icon={ShieldOff} title={t('noAccessTitle')} description={t('noAccessDesc')} action={<BackHome />} />
    </div>
  );
}

/** Shown by detail pages whose record could not be loaded (deleted, out of scope, forbidden). */
export function RecordNotFound() {
  const t = useTranslations('common');
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <EmptyState icon={SearchX} title={t('notFoundTitle')} description={t('notFoundDesc')} action={<BackHome />} />
    </div>
  );
}
