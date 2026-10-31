'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useSession } from '@/stores/session';

/** Credentials sent with an e-signed request (`esign` body field). */
export interface ESignPayload {
  password?: string;
  totp?: string;
}

interface ESignRequest {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional summary of what is being signed (decision, role…). */
  summary?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  /** Runs the signed request; the dialog stays open (with the error) when re-authentication fails. */
  onSign: (esign: ESignPayload) => Promise<unknown>;
}

/** True for a failed re-authentication — the e-sign dialog reports it inline, so callers' toasts can skip it. */
export const isReauthError = (e: unknown) =>
  e instanceof ApiError && (e.details as { error?: string } | undefined)?.error === 'ESIGN_REAUTH_FAILED';
const reauthFailed = isReauthError;

/**
 * Electronic signature: every approve / sign / close / decide asks the signer to
 * re-enter their password (or their authenticator code when 2FA is on) and sends it
 * as `esign` with the request — the server re-authenticates, then seals the signature.
 *
 *   const esign = useESign();
 *   esign.request({ title, onSign: (payload) => apiPost(url, { ...body, esign: payload }) });
 *   return <>{…}{esign.dialog}</>;
 */
export function useESign() {
  const t = useTranslations('esign');
  const totpMode = useSession((s) => !!s.user?.twoFactorEnabled);
  const [req, setReq] = React.useState<ESignRequest | null>(null);
  const [secret, setSecret] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const request = React.useCallback((r: ESignRequest) => {
    setSecret('');
    setError(null);
    setReq(r);
  }, []);

  const close = () => {
    if (busy) return;
    setReq(null);
    setSecret('');
    setError(null);
  };

  const submit = async () => {
    if (!req || !secret.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await req.onSign(totpMode ? { totp: secret.replace(/\s/g, '') } : { password: secret });
      setReq(null);
      setSecret('');
    } catch (e) {
      if (reauthFailed(e)) {
        setError(totpMode ? t('invalidCode') : t('invalidPassword'));
        setSecret('');
      } else if (e instanceof ApiError && e.status === 429) {
        setError(e.message || t('locked'));
      } else {
        // business errors (guards, state) are surfaced by the caller's onError — close the dialog
        setReq(null);
        setSecret('');
      }
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <Dialog open={!!req} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> {req?.title ?? t('title')}
          </DialogTitle>
          <DialogDescription>{req?.description ?? t('description')}</DialogDescription>
        </DialogHeader>
        {req?.summary ? <div className="rounded-md border bg-muted/40 p-3 text-sm">{req.summary}</div> : null}
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="esign-secret">{totpMode ? t('totpLabel') : t('passwordLabel')}</Label>
          <Input
            id="esign-secret"
            autoFocus
            type={totpMode ? 'text' : 'password'}
            inputMode={totpMode ? 'numeric' : undefined}
            autoComplete={totpMode ? 'one-time-code' : 'current-password'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            aria-invalid={!!error}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <p className="text-xs text-muted-foreground">{t('legalHint')}</p>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!secret.trim() || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            {req?.confirmLabel ?? t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { request, dialog };
}
