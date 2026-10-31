/**
 * Legal identity shown on the public legal pages (mentions légales, privacy,
 * terms, DPA). Every value comes from a NEXT_PUBLIC_LEGAL_* build variable so
 * the operator fills them in without touching the code; an unset value renders
 * as a visible « [à compléter] » placeholder rather than an invented fact.
 *
 * Bump LEGAL_VERSION whenever a document's substance changes: it is shown as
 * the « last updated » date and recorded with each account's terms acceptance.
 */
export const LEGAL_VERSION = '2026-10-21';

export const LEGAL_TODO = '[à compléter]';
const TODO = LEGAL_TODO;
const v = (value: string | undefined, fallback = TODO) => (value && value.trim()) || fallback;

export const LEGAL = {
  brand: 'Astro',
  site: v(process.env.NEXT_PUBLIC_LEGAL_SITE_URL, 'https://astro.app'),
  /** raison sociale */
  entity: v(process.env.NEXT_PUBLIC_LEGAL_ENTITY),
  legalForm: v(process.env.NEXT_PUBLIC_LEGAL_FORM),
  capital: v(process.env.NEXT_PUBLIC_LEGAL_CAPITAL),
  /** trade register + number (RCS, RNE…) */
  registration: v(process.env.NEXT_PUBLIC_LEGAL_REGISTRATION),
  vatId: v(process.env.NEXT_PUBLIC_LEGAL_VAT_ID),
  address: v(process.env.NEXT_PUBLIC_LEGAL_ADDRESS),
  phone: v(process.env.NEXT_PUBLIC_LEGAL_PHONE),
  /** directeur de la publication */
  director: v(process.env.NEXT_PUBLIC_LEGAL_DIRECTOR),
  email: v(process.env.NEXT_PUBLIC_LEGAL_EMAIL, 'contact@astro.app'),
  privacyEmail: v(process.env.NEXT_PUBLIC_LEGAL_PRIVACY_EMAIL, v(process.env.NEXT_PUBLIC_LEGAL_EMAIL, 'contact@astro.app')),
  host: v(process.env.NEXT_PUBLIC_LEGAL_HOST),
  hostAddress: v(process.env.NEXT_PUBLIC_LEGAL_HOST_ADDRESS),
  /** country / region where production data is stored */
  hostLocation: v(process.env.NEXT_PUBLIC_LEGAL_HOST_LOCATION),
  mailProvider: v(process.env.NEXT_PUBLIC_LEGAL_MAIL_PROVIDER),
  mailProviderLocation: v(process.env.NEXT_PUBLIC_LEGAL_MAIL_PROVIDER_LOCATION),
  /** courts with jurisdiction for business customers */
  jurisdiction: v(process.env.NEXT_PUBLIC_LEGAL_JURISDICTION),
  /** governing law, e.g. « droit français » */
  governingLaw: v(process.env.NEXT_PUBLIC_LEGAL_GOVERNING_LAW),
  /** supervisory authority for complaints, e.g. « CNIL (www.cnil.fr) » */
  authority: v(process.env.NEXT_PUBLIC_LEGAL_AUTHORITY),
} as const;

export type LegalIdentity = typeof LEGAL;

export const LEGAL_DOCS = ['notice', 'privacy', 'terms', 'cookies', 'dpa', 'subprocessors'] as const;
export type LegalDocKey = (typeof LEGAL_DOCS)[number];

export const LEGAL_ROUTES: Record<LegalDocKey, string> = {
  notice: '/legal/notice',
  privacy: '/legal/privacy',
  terms: '/legal/terms',
  cookies: '/legal/cookies',
  dpa: '/legal/dpa',
  subprocessors: '/legal/subprocessors',
};

/** Content model of a legal document: sections of paragraphs, lists and tables. Inline `[text](href)` and `**bold**` are supported. */
export type LegalBlock = string | { list: string[] } | { table: { head: string[]; rows: string[][] } };
export type LegalSection = { id: string; title: string; blocks: LegalBlock[] };
export type LegalDoc = { title: string; intro?: string; sections: LegalSection[] };
