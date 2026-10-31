import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import {
  LEGAL,
  LEGAL_DOCS,
  LEGAL_ROUTES,
  LEGAL_TODO,
  LEGAL_VERSION,
  type LegalBlock,
  type LegalDoc,
  type LegalDocKey,
} from '@/lib/legal/company';
import { cn } from '@/lib/utils';
import { Container, Eyebrow } from './section';
import { PrintButton } from './print-button';

/** Inline markup: `[text](href)`, `**bold**`, and the unfilled-identity placeholder (highlighted). */
function inline(text: string, todoLabel: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|(\[à compléter\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] && m[2]) {
      const href = m[2];
      out.push(
        href.startsWith('/') ? (
          <Link key={k++} href={href} className="font-medium text-primary underline-offset-4 hover:underline">
            {m[1]}
          </Link>
        ) : (
          <a key={k++} href={href} className="font-medium text-primary underline-offset-4 hover:underline">
            {m[1]}
          </a>
        ),
      );
    } else if (m[3]) {
      out.push(
        <strong key={k++} className="font-semibold text-foreground">
          {m[3]}
        </strong>,
      );
    } else if (m[4] === LEGAL_TODO) {
      out.push(
        <mark key={k++} className="rounded bg-warning/20 px-1 text-foreground">
          {todoLabel}
        </mark>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Block({ block, todo }: { block: LegalBlock; todo: string }) {
  if (typeof block === 'string') return <p>{inline(block, todo)}</p>;
  if ('list' in block) {
    return (
      <ul className="list-disc space-y-1.5 pl-5 marker:text-primary/60">
        {block.list.map((item, i) => (
          <li key={i}>{inline(item, todo)}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[36rem] border-separate border-spacing-0 overflow-hidden rounded-xl border text-left text-sm">
        <thead className="bg-muted/60">
          <tr>
            {block.table.head.map((h) => (
              <th key={h} className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn('px-4 py-3', i < block.table.rows.length - 1 && 'border-b', j === 0 && 'font-medium text-foreground')}
                >
                  {inline(cell, todo)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A legal page: header, sticky contents + sibling documents, sections. */
export function LegalDocument({ docKey, doc, locale }: { docKey: LegalDocKey; doc: LegalDoc; locale: string }) {
  const t = useTranslations('legal');
  const todo = locale === 'fr' ? 'à compléter' : 'to be completed';
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(`${LEGAL_VERSION}T12:00:00`));

  return (
    <Container className="py-14 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16 xl:grid-cols-[16rem_minmax(0,48rem)]">
        <aside className="lg:sticky lg:top-24 lg:self-start print:hidden">
          <nav aria-label={t('title')}>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('title')}</p>
            <ul className="mt-3 space-y-0.5">
              {LEGAL_DOCS.map((k) => (
                <li key={k}>
                  <Link
                    href={LEGAL_ROUTES[k]}
                    aria-current={k === docKey ? 'page' : undefined}
                    className={cn(
                      'block rounded-md px-3 py-1.5 text-sm transition-colors',
                      k === docKey ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(`docs.${k}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav className="mt-8 hidden lg:block" aria-label={t('toc')}>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('toc')}</p>
            <ul className="mt-3 space-y-1 border-l">
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="-ml-px block border-l border-transparent py-1 pl-3 text-[13px] leading-snug text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article>
          <Eyebrow>{t('title')}</Eyebrow>
          <h1 className="mt-5 text-balance text-3xl font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-4xl">
            {doc.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span>{t('updated', { date: updated })}</span>
            <PrintButton label={t('print')} />
          </div>
          {doc.intro && (
            <p className="mt-8 text-pretty text-lg leading-relaxed text-muted-foreground">{inline(doc.intro, todo)}</p>
          )}
          <div className="mt-10 space-y-12">
            {doc.sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">{s.title}</h2>
                <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
                  {s.blocks.map((b, i) => (
                    <Fragment key={i}>
                      <Block block={b} todo={todo} />
                    </Fragment>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <p className="mt-16 rounded-xl border bg-muted/40 p-5 text-sm text-muted-foreground">
            {t('contact', { email: LEGAL.privacyEmail })}
          </p>
        </article>
      </div>
    </Container>
  );
}
