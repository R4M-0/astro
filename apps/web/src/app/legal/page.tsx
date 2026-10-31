import { ArrowRight, Building2, Cookie, FileSignature, FileText, Server, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Eyebrow, Section, SectionHeading } from '@/components/legal/section';
import { LEGAL_DOCS, LEGAL_ROUTES } from '@/lib/legal/company';

export const metadata: Metadata = { title: 'Informations légales' };

const ICONS = { notice: Building2, privacy: ShieldCheck, terms: FileText, cookies: Cookie, dpa: FileSignature, subprocessors: Server };

export default function LegalHub() {
  const t = useTranslations('legal');
  return (
    <Section rule={false}>
      <SectionHeading eyebrow={<Eyebrow>{t('title')}</Eyebrow>} title={t('title')} subtitle={t('hubSubtitle')} />
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LEGAL_DOCS.map((k) => {
          const Icon = ICONS[k];
          return (
            <li key={k}>
              <Link
                href={LEGAL_ROUTES[k]}
                className="group flex h-full flex-col rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <h2 className="mt-5 text-base font-semibold tracking-tight text-foreground">{t(`docs.${k}`)}</h2>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{t(`hubDesc.${k}`)}</p>
                <ArrowRight className="mt-4 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
