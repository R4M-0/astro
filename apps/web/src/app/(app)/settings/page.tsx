'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, KeyRound, Monitor, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useSession } from '@/stores/session';

interface SessionRow {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);
  const initialize = useSession((s) => s.initialize);

  const [profile, setProfile] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    locale: user?.locale ?? 'fr',
  });
  const [setup, setSetup] = useState<{ qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const { data: sessions } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => apiGet<SessionRow[]>('/auth/sessions'),
  });

  const onApiError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));

  const saveProfile = useMutation({
    mutationFn: () => apiPatch('/me', profile),
    onSuccess: async () => {
      document.cookie = `astro.locale=${profile.locale};path=/;max-age=31536000;samesite=lax`;
      await initialize();
      router.refresh();
      toast.success(t('profileSaved'));
    },
    onError: onApiError,
  });

  const start2fa = useMutation({
    mutationFn: () => apiPost<{ qrDataUrl: string }>('/auth/2fa/setup'),
    onSuccess: (res) => setSetup(res),
    onError: onApiError,
  });

  const confirm2fa = useMutation({
    mutationFn: () => apiPost<{ recoveryCodes: string[] }>('/auth/2fa/verify', { code }),
    onSuccess: async (res) => {
      setRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setCode('');
      await initialize();
    },
    onError: onApiError,
  });

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const changePassword = useMutation({
    mutationFn: () =>
      apiPost('/auth/password/change', { currentPassword: pwd.current, newPassword: pwd.next }),
    onSuccess: () => {
      setPwd({ current: '', next: '', confirm: '' });
      toast.success(t('passwordChanged'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('passwordError')),
  });
  const pwdValid = pwd.current.length > 0 && pwd.next.length >= 10 && pwd.next === pwd.confirm;

  const disable2fa = useMutation({
    mutationFn: () => apiPost('/auth/2fa/disable', { code }),
    onSuccess: async () => {
      setCode('');
      setRecoveryCodes(null);
      await initialize();
      toast.success(t('twoFactorOff'));
    },
    onError: onApiError,
  });

  const revokeSession = useMutation({
    mutationFn: (id: string) => apiDelete(`/auth/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
    onError: onApiError,
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <PageHeader title={t('title')} description={t('desc')} />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{t('tabs.profile')}</TabsTrigger>
          <TabsTrigger value="security">{t('tabs.security')}</TabsTrigger>
          <TabsTrigger value="sessions">{t('tabs.sessions')}</TabsTrigger>
        </TabsList>

        {/* profile */}
        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardContent className="grid gap-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>{t('firstName')}</Label>
                  <Input
                    value={profile.firstName}
                    onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{t('lastName')}</Label>
                  <Input
                    value={profile.lastName}
                    onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>{t('language')}</Label>
                <Select value={profile.locale} onValueChange={(locale) => setProfile({ ...profile, locale })}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Button
                  disabled={!profile.firstName.trim() || !profile.lastName.trim() || saveProfile.isPending}
                  onClick={() => saveProfile.mutate()}
                >
                  {t('saveProfile')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* security */}
        <TabsContent value="security" className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4" /> {t('password')}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label>{t('currentPassword')}</Label>
                <Input type="password" autoComplete="current-password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t('newPassword')}</Label>
                <Input type="password" autoComplete="new-password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t('confirmPassword')}</Label>
                <Input type="password" autoComplete="new-password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t('passwordHint')}</p>
              <Button className="w-fit justify-self-end" disabled={!pwdValid || changePassword.isPending} onClick={() => changePassword.mutate()}>
                {t('changePassword')}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                {user?.twoFactorEnabled ? (
                  <ShieldCheck className="size-4 text-success" />
                ) : (
                  <ShieldOff className="size-4 text-muted-foreground" />
                )}
                {t('twoFactor')}
              </CardTitle>
              <Badge variant={user?.twoFactorEnabled ? 'default' : 'secondary'}>
                {user?.twoFactorEnabled ? t('twoFactorOn') : t('twoFactorOff')}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* freshly generated recovery codes */}
              {recoveryCodes && (
                <div className="rounded-md border border-warning/50 bg-warning/10 p-4">
                  <p className="mb-2 text-sm font-medium">{t('recoveryCodes')}</p>
                  <div className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-4">
                    {recoveryCodes.map((rc) => (
                      <span key={rc}>{rc}</span>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      void navigator.clipboard.writeText(recoveryCodes.join('\n'));
                      toast.success('OK');
                    }}
                  >
                    <Copy className="size-3.5" /> {tc('actions')}
                  </Button>
                </div>
              )}

              {!user?.twoFactorEnabled && !setup && (
                <Button className="w-fit" disabled={start2fa.isPending} onClick={() => start2fa.mutate()}>
                  <ShieldCheck className="size-4" /> {t('enable2fa')}
                </Button>
              )}

              {/* setup flow: QR + confirmation code */}
              {setup && (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-muted-foreground">{t('scanQr')}</p>
                  <Image src={setup.qrDataUrl} alt="TOTP QR" width={180} height={180} className="rounded-md border" unoptimized />
                  <div className="flex gap-2">
                    <Input
                      className="w-40 text-center tracking-[0.4em]"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <Button disabled={code.length !== 6 || confirm2fa.isPending} onClick={() => confirm2fa.mutate()}>
                      <CheckCircle2 className="size-4" /> {t('confirm')}
                    </Button>
                  </div>
                </div>
              )}

              {user?.twoFactorEnabled && (
                <div className="flex gap-2">
                  <Input
                    className="w-40 text-center tracking-[0.4em]"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <Button
                    variant="destructive"
                    disabled={code.length !== 6 || disable2fa.isPending}
                    onClick={() => disable2fa.mutate()}
                  >
                    <ShieldOff className="size-4" /> {t('disable2fa')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* sessions */}
        <TabsContent value="sessions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('sessions')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {sessions?.map((session) => (
                <div key={session.id} className="flex items-center gap-3 rounded-md border p-3">
                  <Monitor className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{session.userAgent ?? t('currentDevice')}</p>
                    <p className="text-xs text-muted-foreground">
                      {session.ip ?? '—'} · {t('lastUsed')}{' '}
                      {formatDistanceToNow(new Date(session.lastUsedAt), { addSuffix: true })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('revoke')}
                    onClick={() => revokeSession.mutate(session.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {!sessions?.length && <p className="py-4 text-center text-sm text-muted-foreground">—</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
