import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LegalDocument } from '@/components/legal/legal-document';
import { LEGAL, LEGAL_DOCS, type LegalDocKey } from '@/lib/legal/company';
import { legalEn } from '@/lib/legal/en';
import { legalFr } from '@/lib/legal/fr';

type Props = { params: Promise<{ doc: string }> };

const isDoc = (d: string): d is LegalDocKey => (LEGAL_DOCS as readonly string[]).includes(d);
const docsFor = (locale: string) => (locale === 'fr' ? legalFr(LEGAL) : legalEn(LEGAL));

export function generateStaticParams() {
  return LEGAL_DOCS.map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { doc } = await params;
  if (!isDoc(doc)) return {};
  const d = docsFor(await getLocale())[doc];
  return { title: d.title, description: d.intro?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') };
}

export default async function LegalPage({ params }: Props) {
  const { doc } = await params;
  if (!isDoc(doc)) notFound();
  const locale = await getLocale();
  return <LegalDocument docKey={doc} doc={docsFor(locale)[doc]} locale={locale} />;
}
