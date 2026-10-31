'use client';

import { Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { useState } from 'react';
import { Panel } from '@/components/layout/stat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { graphApi } from '@/lib/api';
import type { AskResult } from './types';

const EXAMPLES = ['How many leave days do I have left?', 'Can I work remotely?', 'How is overtime paid?'];

/** Employee questions (« Mon espace »): answers from the handbook + the member's own file only. */
export function AskHr() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ q: string; a: AskResult } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ask = async (question = q) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      setRes({ q: question, a: await graphApi<AskResult>('/ask', { question }) });
      setQ('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Ask HR" icon={MessageCircleQuestion}>
      <div className="flex flex-col gap-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Leave, remote work, payroll, benefits…" maxLength={1000} />
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => <button key={x} onClick={() => ask(x)} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">{x}</button>)}
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {res && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <div className="mb-1 text-xs text-muted-foreground">{res.q}</div>
            <div className="whitespace-pre-wrap">{res.a.answer.replace(/\[m\d{5}\]/g, '')}</div>
            {res.a.policies.length > 0 && <div className="mt-2 text-xs text-muted-foreground">Sources: handbook — {res.a.policies.join(', ')}</div>}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Answers come from the company handbook and your own HR file. For anything about a decision, HR will answer you directly.</p>
      </div>
    </Panel>
  );
}
