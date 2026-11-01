import { ArrowLeft, LayoutDashboard, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BackButton } from '@/components/layout/back-button';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notFound');
  return { title: t('metaTitle') };
}

export default async function NotFound() {
  const t = await getTranslations('notFound');

  return (
    <main className="relative flex min-h-svh flex-col bg-background px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_60%)]"
      />
      <header className="relative mx-auto flex h-16 w-full max-w-5xl items-center">
        <Link href="/" aria-label="Constella">
          <Logo />
        </Link>
      </header>

      <section className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center pb-24 text-center">
        <div className="mb-6 grid size-14 place-items-center rounded-2xl border bg-card text-muted-foreground shadow-sm">
          <SearchX className="size-6" />
        </div>
        <p className="font-mono text-sm font-medium text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">{t('description')}</p>

        <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <BackButton label={t('back')} icon={<ArrowLeft className="size-4" />} />
          <Button asChild>
            <Link href="/dashboard">
              <LayoutDashboard className="size-4" />
              {t('dashboard')}
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
