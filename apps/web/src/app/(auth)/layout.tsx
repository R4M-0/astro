import { Check, Lock, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/layout/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('auth');
  const points = t.raw('brandPoints') as string[];

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ── Form column ───────────────────────────────── */}
      <div className="flex min-h-svh flex-col px-4 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <Logo />
        </header>

        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[25rem]">{children}</div>
        </main>

        <footer className="flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row lg:flex-col xl:flex-row">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3" />
            {t('secureNote')}
          </span>
        </footer>
      </div>

      {/* ── Brand panel ───────────────────────────────── */}
      <aside className="relative hidden overflow-hidden bg-[oklch(0.2_0.03_274)] text-white lg:flex lg:flex-col lg:justify-center lg:p-12 xl:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(80%_70%_at_70%_30%,black,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-40 size-[38rem] rounded-full bg-[radial-gradient(closest-side,oklch(0.6_0.22_274/0.55),transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 -left-24 size-[30rem] rounded-full bg-[radial-gradient(closest-side,oklch(0.7_0.14_200/0.25),transparent)]"
        />

        <div className="relative max-w-lg">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/75">
            <Sparkles className="size-3.5 text-[oklch(0.8_0.14_274)]" />
            {t('brandBadge')}
          </span>
          <h2 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.025em]">{t('brandTitle')}</h2>
          <p className="mt-4 text-pretty leading-relaxed text-white/70">{t('brandSubtitle')}</p>
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-white/85">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/10">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
