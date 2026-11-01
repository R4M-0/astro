'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarCheck, Lock, SearchX } from 'lucide-react';
import { formatSlot } from '@/components/recruiting/recruiting-meta';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface Booking {
  organization: string;
  opening: string;
  firstName: string | null;
  status: 'INVITED' | 'BOOKED' | 'CLOSED';
  booking: { startsAt: string; durationMinutes: number; location: string | null } | null;
  slots: { id: string; startsAt: string; durationMinutes: number }[];
}

type Phase = 'loading' | 'notFound' | 'error' | 'ready';

async function fetchBooking(base: string): Promise<{ phase: Phase; data?: Booking }> {
  try {
    const r = await fetch(base);
    if (r.status === 404) return { phase: 'notFound' };
    if (!r.ok) return { phase: 'error' };
    return { phase: 'ready', data: (await r.json()) as Booking };
  } catch {
    return { phase: 'error' };
  }
}

/** Pipeline 2, candidate side: pick or change an interview slot, withdraw, or write to the recruiting team. */
export default function BookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations('booking');
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<Booking | null>(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const base = `${API_URL}/recruiting/public/${encodeURIComponent(token)}`;

  const load = useCallback(
    () =>
      fetchBooking(base).then(({ phase, data }) => {
        setPhase(phase);
        if (data) setData(data);
      }),
    [base],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch(`${base}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // 409 = slot taken meanwhile, 410 = invitation closed: reload to show the current state
      if (r.status === 409 || r.status === 410) {
        if (r.status === 409) setNotice(t('slotTaken'));
        await load();
        return null;
      }
      if (!r.ok) {
        setNotice(t(r.status === 429 ? 'tooMany' : 'error'));
        return null;
      }
      return r;
    } catch {
      setNotice(t('error'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const book = async (slotId: string) => {
    const r = await post('book', { slotId });
    if (r) {
      setData((await r.json()) as Booking);
      setChanging(false);
    }
  };

  const decline = async () => {
    if (!confirm(t('declineConfirm'))) return;
    const r = await post('decline');
    if (r) setData((await r.json()) as Booking);
  };

  const send = async () => {
    if (await post('messages', { text })) {
      setText('');
      setSent(true);
    }
  };

  // slots grouped by local day
  const days = new Map<string, Booking['slots']>();
  for (const s of data?.slots ?? []) {
    const day = new Date(s.startsAt).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    days.set(day, [...(days.get(day) ?? []), s]);
  }

  return (
    <div className="min-h-svh bg-muted/30">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:py-12">
        {phase === 'loading' && (
          <div className="flex flex-col gap-4" aria-busy="true">
            <Skeleton className="h-28" />
            <Skeleton className="h-48" />
          </div>
        )}
        {phase === 'notFound' && <StateCard icon={<SearchX className="size-10 text-muted-foreground" />} title={t('notFoundTitle')} body={t('notFoundBody')} />}
        {phase === 'error' && (
          <StateCard icon={<SearchX className="size-10 text-muted-foreground" />} title={t('errorTitle')} body={t('error')}>
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t('retry')}
            </Button>
          </StateCard>
        )}

        {phase === 'ready' && data && (
          <>
            <header className="rounded-xl border bg-card px-6 py-5">
              <p className="text-sm text-muted-foreground">{data.organization}</p>
              <h1 className="text-xl font-semibold text-balance">{data.opening}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{data.firstName ? t('hello', { name: data.firstName }) : t('helloAnon')}</p>
            </header>

            {data.status === 'CLOSED' && <StateCard icon={<Lock className="size-10 text-muted-foreground" />} title={t('closedTitle')} body={t('closedBody')} />}

            {data.booking && data.status === 'BOOKED' && (
              <section className="flex flex-col items-center gap-2 rounded-xl border bg-card px-6 py-8 text-center" role="status">
                <CalendarCheck className="size-10 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-lg font-semibold">{t('bookedTitle')}</h2>
                <p className="font-medium">{formatSlot(data.booking.startsAt, locale)}</p>
                <p className="text-sm text-muted-foreground">
                  {t('duration', { minutes: data.booking.durationMinutes })}
                  {data.booking.location && ` · ${data.booking.location}`}
                </p>
                {!changing && (
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => setChanging(true)}>
                    {t('change')}
                  </Button>
                )}
              </section>
            )}

            {notice && <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400" role="alert">{notice}</p>}

            {(data.status === 'INVITED' || changing) && (
              <section className="flex flex-col gap-4 rounded-xl border bg-card px-6 py-5">
                <div>
                  <h2 className="font-semibold">{t('pickTitle')}</h2>
                  <p className="text-sm text-muted-foreground">{t('pickBody')}</p>
                </div>
                {!data.slots.length ? (
                  <p className="text-sm text-muted-foreground">{t('noSlots')}</p>
                ) : (
                  [...days].map(([day, slots]) => (
                    <div key={day} className="flex flex-col gap-2">
                      <h3 className="text-sm font-medium capitalize">{day}</h3>
                      <div className="flex flex-wrap gap-2">
                        {slots.map((s) => (
                          <Button key={s.id} variant="outline" size="sm" disabled={busy} onClick={() => book(s.id)}>
                            {new Date(s.startsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
                            <span className="text-xs text-muted-foreground">· {s.durationMinutes} min</span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
                {changing && (
                  <Button variant="ghost" size="sm" className="self-start" onClick={() => setChanging(false)}>
                    {t('keep')}
                  </Button>
                )}
              </section>
            )}

            {data.status !== 'CLOSED' && (
              <section className="flex flex-col gap-3 rounded-xl border bg-card px-6 py-5">
                <div>
                  <h2 className="font-semibold">{t('writeTitle')}</h2>
                  <p className="text-sm text-muted-foreground">{t('writeBody')}</p>
                </div>
                {sent ? (
                  <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{t('sent')}</p>
                ) : (
                  <>
                    <Textarea rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('writeTitle')} />
                    <Button size="sm" className="self-end" disabled={busy || !text.trim()} onClick={send}>
                      {t('send')}
                    </Button>
                  </>
                )}
                <button type="button" className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline" disabled={busy} onClick={decline}>
                  {t('decline')}
                </button>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function StateCard({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center">
      {icon}
      <h1 className="text-lg font-semibold text-balance">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
