'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  KeyRound,
  MailCheck,
  MailQuestion,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { DepartmentMultiSelect, DepartmentSelect } from '@/components/departments/department-select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useHasPermission, useSession } from '@/stores/session';

export interface AdminRole {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  /** members only see their department(s)' records */
  departmentScoped: boolean;
  permissions: { permission: { resource: string; action: string } }[];
  _count: { memberships: number };
}

interface Member {
  id: string;
  jobTitle: string | null;
  siteId: string | null;
  departmentId: string | null;
  extraDepartmentIds: string[];
  isActive: boolean;
  deactivatedAt: string | null;
  /** null = invitation not accepted yet (no access) */
  acceptedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    lastLoginAt: string | null;
    emailVerifiedAt: string | null;
    twoFactorEnabled?: boolean;
  };
  role: { id: string; key: string; name: string; departmentScoped?: boolean };
}

interface GroupOption {
  id: string;
  name: string;
}

type BulkKind = 'role' | 'main' | 'addExtra' | 'removeExtra' | 'addGroup' | 'removeGroup';

interface Site {
  id: string;
  name: string;
}

const PAGE_SIZE = 20;
const NONE = '__none__';

export function AdminMembers({ roles, sites }: { roles: AdminRole[]; sites: Site[] }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const tdep = useTranslations('departments.admin');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canAdmin = hasPermission('users:admin');
  const myUserId = useSession((s) => s.user?.id);
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', firstName: '', lastName: '', roleId: '', siteId: '', jobTitle: '', departmentId: '' });

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) params.set('search', search);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'members', params.toString()],
    queryFn: () => apiGet<{ data: Member[]; meta: { total: number; totalPages: number } }>(`/users?${params.toString()}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  };
  const onErr = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));

  const doInvite = useMutation({
    mutationFn: () =>
      apiPost('/users', {
        email: invite.email,
        firstName: invite.firstName,
        lastName: invite.lastName,
        roleId: invite.roleId,
        siteId: invite.siteId || undefined,
        jobTitle: invite.jobTitle || undefined,
        departmentId: invite.departmentId || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setInviteOpen(false);
      setInvite({ email: '', firstName: '', lastName: '', roleId: '', siteId: '', jobTitle: '', departmentId: '' });
      toast.success(t('members.invited'));
    },
    onError: onErr,
  });
  const updateMembership = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => apiPatch(`/users/${v.id}`, v.body),
    onSuccess: invalidate,
    onError: onErr,
  });
  const removeMembership = useMutation({
    mutationFn: (id: string) => apiDelete(`/users/${id}`),
    onSuccess: () => { invalidate(); toast.success(t('members.removed')); },
    onError: onErr,
  });

  const members = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;
  const fullName = (m: Member) => `${m.user.firstName} ${m.user.lastName}`;

  // ── row actions ───────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<Member | null>(null);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', jobTitle: '' });
  const openEdit = (m: Member) => {
    setEditing(m);
    setEditForm({ firstName: m.user.firstName, lastName: m.user.lastName, jobTitle: m.jobTitle ?? '' });
  };
  const saveEdit = useMutation({
    mutationFn: () =>
      apiPatch(`/users/${editing!.id}`, {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        jobTitle: editForm.jobTitle.trim(),
      }),
    onSuccess: () => { invalidate(); setEditing(null); toast.success(t('members.saved')); },
    onError: onErr,
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => apiPatch(`/users/${v.id}/status`, { isActive: v.isActive }),
    onSuccess: (_r, v) => { invalidate(); toast.success(v.isActive ? t('members.reactivated') : t('members.deactivated')); },
    onError: onErr,
  });
  const reset2fa = useMutation({
    mutationFn: (id: string) => apiPost(`/users/${id}/reset-2fa`),
    onSuccess: () => { invalidate(); toast.success(t('members.reset2faDone')); },
    onError: onErr,
  });
  const resendInvite = useMutation({
    mutationFn: (id: string) => apiPost(`/users/${id}/resend-invite`),
    onSuccess: () => toast.success(t('members.resendInviteDone')),
    onError: onErr,
  });

  // ── selection + bulk ──────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageIds = members.map((m) => m.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPage) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const [bulkKind, setBulkKind] = useState<BulkKind | null>(null);
  const [bulkValue, setBulkValue] = useState<string | null>(null);
  const openBulk = (kind: BulkKind) => { setBulkKind(kind); setBulkValue(null); };

  const { data: groupsData, isError: groupsError } = useQuery({
    queryKey: ['admin', 'groups', 'options'],
    queryFn: () => apiGet<GroupOption[] | { data: GroupOption[] }>('/groups'),
    enabled: canAdmin,
    retry: false,
    staleTime: 60_000,
  });
  const groups: GroupOption[] = groupsError ? [] : Array.isArray(groupsData) ? groupsData : (groupsData?.data ?? []);

  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiPost<{ updated: number }>('/users/bulk', { membershipIds: [...selected], ...body }),
    onSuccess: (r) => {
      invalidate();
      setBulkKind(null);
      setSelected(new Set());
      toast.success(t('members.bulk.done', { count: r?.updated ?? 0 }));
    },
    onError: onErr,
  });
  const applyBulk = () => {
    if (!bulkKind) return;
    const v = bulkValue;
    const body: Record<string, unknown> =
      bulkKind === 'role' ? { roleId: v }
      : bulkKind === 'main' ? { departmentId: v === NONE ? null : v }
      : bulkKind === 'addExtra' ? { addExtraDepartmentIds: [v] }
      : bulkKind === 'removeExtra' ? { removeExtraDepartmentIds: [v] }
      : bulkKind === 'addGroup' ? { addGroupIds: [v] }
      : { removeGroupIds: [v] };
    bulk.mutate(body);
  };
  const bulkActive = (isActive: boolean) => {
    const msg = isActive ? t('members.bulk.activateConfirm', { count: selected.size }) : t('members.bulk.deactivateConfirm', { count: selected.size });
    if (confirm(msg)) bulk.mutate({ isActive });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-64 pl-8"
            placeholder={t('members.search')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <span className="text-xs text-muted-foreground">{data?.meta.total ?? '…'} {t('members.count')}</span>
        {canAdmin && (
          <Button size="sm" className="ml-auto" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" /> {t('members.invite')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {canAdmin && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label={t('members.selectAll')}
                      checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
                      onCheckedChange={togglePage}
                    />
                  </TableHead>
                )}
                <TableHead>{t('members.columns.member')}</TableHead>
                <TableHead className="w-28">{t('members.status.column')}</TableHead>
                <TableHead className="w-44">{t('members.columns.role')}</TableHead>
                <TableHead className="w-40">{t('members.columns.site')}</TableHead>
                <TableHead className="w-52">{tdep('department')}</TableHead>
                <TableHead className="w-40">{t('members.columns.jobTitle')}</TableHead>
                <TableHead className="w-32">{t('members.columns.lastLogin')}</TableHead>
                <TableHead className="w-28">{t('members.columns.joined')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id} data-state={selected.has(m.id) ? 'selected' : undefined} className={m.isActive === false ? 'opacity-70' : undefined}>
                  {canAdmin && (
                    <TableCell>
                      <Checkbox
                        aria-label={t('members.selectRow')}
                        checked={selected.has(m.id)}
                        onCheckedChange={() => toggleOne(m.id)}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-primary/10 text-xs text-primary">
                          {`${m.user.firstName[0] ?? ''}${m.user.lastName[0] ?? ''}`.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {m.user.firstName} {m.user.lastName}
                          {m.user.id === myUserId && <Badge variant="secondary" className="text-[10px]">{t('members.you')}</Badge>}
                          {m.user.twoFactorEnabled && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <ShieldCheck className="size-3.5 text-success" aria-label={t('members.twoFactorOn')} />
                              </TooltipTrigger>
                              <TooltipContent>{t('members.twoFactorOn')}</TooltipContent>
                            </Tooltip>
                          )}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          {m.user.email}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {m.user.emailVerifiedAt ? (
                                <MailCheck className="size-3 text-success" />
                              ) : (
                                <MailQuestion className="size-3 text-warning-foreground dark:text-warning" />
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              {m.user.emailVerifiedAt ? t('members.emailVerified') : t('members.emailNotVerified')}
                            </TooltipContent>
                          </Tooltip>
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {!m.acceptedAt ? (
                      <Badge variant="outline" className="border-warning/40 text-warning">{t('members.status.pending')}</Badge>
                    ) : m.isActive === false ? (
                      <Badge variant="outline" className="border-destructive/40 text-destructive">{t('members.status.inactive')}</Badge>
                    ) : (
                      <Badge variant="outline" className="border-success/40 text-success">{t('members.status.active')}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {canAdmin ? (
                      <Select value={m.role.id} onValueChange={(roleId) => updateMembership.mutate({ id: m.id, body: { roleId } })}>
                        <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{m.role.name}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {canAdmin ? (
                      <Select
                        value={m.siteId ?? NONE}
                        onValueChange={(siteId) => updateMembership.mutate({ id: m.id, body: { siteId: siteId === NONE ? null : siteId } })}
                      >
                        <SelectTrigger size="sm" className="w-36"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground">{sites.find((s) => s.id === m.siteId)?.name ?? '—'}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <DepartmentSelect
                        size="sm"
                        allowNone
                        className="w-44"
                        disabled={!canAdmin}
                        value={m.departmentId}
                        onChange={(departmentId) => updateMembership.mutate({ id: m.id, body: { departmentId } })}
                      />
                      {(canAdmin || m.extraDepartmentIds?.length > 0) && (
                        <DepartmentMultiSelect
                          value={m.extraDepartmentIds ?? []}
                          exclude={m.departmentId}
                          disabled={!canAdmin}
                          onChange={(extraDepartmentIds) => updateMembership.mutate({ id: m.id, body: { extraDepartmentIds } })}
                        />
                      )}
                      {m.role.departmentScoped && !m.departmentId && (
                        <span className="text-[11px] text-warning-foreground dark:text-warning">{tdep('noneScoped')}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.jobTitle ?? '—'}</TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {m.user.lastLoginAt ? format(new Date(m.user.lastLoginAt), 'd MMM yyyy', { locale: dateLocale }) : t('members.never')}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-muted-foreground">
                    {format(new Date(m.createdAt), 'd MMM yyyy', { locale: dateLocale })}
                  </TableCell>
                  <TableCell>
                    {canAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7" aria-label={t('members.rowActions')}>
                            <MoreHorizontal className="size-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onSelect={() => openEdit(m)}>
                            <Pencil className="size-4" /> {t('members.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => router.push(`/admin/members/${m.id}`)}>
                            <Eye className="size-4" /> {t('members.viewAs')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => { if (confirm(t('members.resendInviteConfirm', { email: m.user.email }))) resendInvite.mutate(m.id); }}
                          >
                            <Send className="size-4" /> {t('members.resendInvite')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!m.user.twoFactorEnabled}
                            onSelect={() => { if (confirm(t('members.reset2faConfirm', { name: fullName(m) }))) reset2fa.mutate(m.id); }}
                          >
                            <KeyRound className="size-4" /> {t('members.reset2fa')}
                          </DropdownMenuItem>
                          {m.user.id !== myUserId && (
                            <>
                              <DropdownMenuSeparator />
                              {m.isActive === false ? (
                                <DropdownMenuItem
                                  onSelect={() => { if (confirm(t('members.reactivateConfirm', { name: fullName(m) }))) setStatus.mutate({ id: m.id, isActive: true }); }}
                                >
                                  <Power className="size-4" /> {t('members.reactivate')}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() => { if (confirm(t('members.deactivateConfirm', { name: fullName(m) }))) setStatus.mutate({ id: m.id, isActive: false }); }}
                                >
                                  <PowerOff className="size-4" /> {t('members.deactivate')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => { if (confirm(t('members.removeConfirm', { name: fullName(m) }))) removeMembership.mutate(m.id); }}
                              >
                                <Trash2 className="size-4" /> {t('members.remove')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Button variant="outline" size="icon" className="size-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular-nums">{page} / {totalPages}</span>
          <Button variant="outline" size="icon" className="size-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}

      {/* sticky bulk bar */}
      {canAdmin && selected.size > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <span className="px-1 text-sm font-medium tabular-nums">{t('members.bulk.selected', { count: selected.size })}</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            <X className="size-4" /> {t('members.bulk.clear')}
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => openBulk('role')}>{t('members.bulk.role')}</Button>
            <Button variant="outline" size="sm" onClick={() => openBulk('main')}>{t('members.bulk.mainProcess')}</Button>
            <Button variant="outline" size="sm" onClick={() => openBulk('addExtra')}>{t('members.bulk.addExtra')}</Button>
            <Button variant="outline" size="sm" onClick={() => openBulk('removeExtra')}>{t('members.bulk.removeExtra')}</Button>
            <Button variant="outline" size="sm" onClick={() => openBulk('addGroup')}>{t('members.bulk.addGroup')}</Button>
            <Button variant="outline" size="sm" onClick={() => openBulk('removeGroup')}>{t('members.bulk.removeGroup')}</Button>
            <Button variant="outline" size="sm" disabled={bulk.isPending} onClick={() => bulkActive(true)}>
              <Power className="size-4" /> {t('members.bulk.activate')}
            </Button>
            <Button variant="outline" size="sm" className="text-destructive" disabled={bulk.isPending} onClick={() => bulkActive(false)}>
              <PowerOff className="size-4" /> {t('members.bulk.deactivate')}
            </Button>
          </div>
        </div>
      )}

      {/* bulk value dialog */}
      <Dialog open={bulkKind !== null} onOpenChange={(o) => { if (!o) setBulkKind(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bulkKind === 'role' ? t('members.bulk.role')
                : bulkKind === 'main' ? t('members.bulk.mainProcess')
                : bulkKind === 'addExtra' ? t('members.bulk.addExtra')
                : bulkKind === 'removeExtra' ? t('members.bulk.removeExtra')
                : bulkKind === 'addGroup' ? t('members.bulk.addGroup')
                : t('members.bulk.removeGroup')}
            </DialogTitle>
            <DialogDescription>{t('members.bulk.applyTo', { count: selected.size })}</DialogDescription>
          </DialogHeader>
          {bulkKind === 'role' && (
            <Select value={bulkValue ?? undefined} onValueChange={setBulkValue}>
              <SelectTrigger><SelectValue placeholder={t('members.bulk.chooseRole')} /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {bulkKind === 'main' && (
            <div className="flex flex-col gap-2">
              <DepartmentSelect value={bulkValue === NONE ? null : bulkValue} onChange={(id) => setBulkValue(id)} />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={bulkValue === NONE} onCheckedChange={(c) => setBulkValue(c ? NONE : null)} />
                {t('members.bulk.clearMain')}
              </label>
            </div>
          )}
          {(bulkKind === 'addExtra' || bulkKind === 'removeExtra') && (
            <DepartmentSelect value={bulkValue} onChange={(id) => setBulkValue(id)} />
          )}
          {(bulkKind === 'addGroup' || bulkKind === 'removeGroup') &&
            (groups.length ? (
              <Select value={bulkValue ?? undefined} onValueChange={setBulkValue}>
                <SelectTrigger><SelectValue placeholder={t('members.bulk.chooseGroup')} /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">{t('members.bulk.noGroups')}</p>
            ))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkKind(null)}>{tc('cancel')}</Button>
            <Button disabled={!bulkValue || bulk.isPending} onClick={applyBulk}>{t('members.bulk.apply')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* edit member dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('members.editTitle')}</DialogTitle>
            <DialogDescription>{editing ? t('members.editDesc', { name: fullName(editing) }) : null}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => { e.preventDefault(); if (editForm.firstName.trim() && editForm.lastName.trim()) saveEdit.mutate(); }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field className="grid gap-2">
                <Label>{t('members.firstName')} *</Label>
                <Input value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} autoFocus />
              </Field>
              <Field className="grid gap-2">
                <Label>{t('members.lastName')} *</Label>
                <Input value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
              </Field>
            </div>
            <Field className="grid gap-2">
              <Label>{t('members.columns.jobTitle')}</Label>
              <Input value={editForm.jobTitle} onChange={(e) => setEditForm({ ...editForm, jobTitle: e.target.value })} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>{tc('cancel')}</Button>
              <Button type="submit" disabled={!editForm.firstName.trim() || !editForm.lastName.trim() || saveEdit.isPending}>
                {tc('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('members.invite')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field className="grid gap-2">
              <Label>{t('members.email')}</Label>
              <Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field className="grid gap-2">
                <Label>{t('members.firstName')}</Label>
                <Input value={invite.firstName} onChange={(e) => setInvite({ ...invite, firstName: e.target.value })} />
              </Field>
              <Field className="grid gap-2">
                <Label>{t('members.lastName')}</Label>
                <Input value={invite.lastName} onChange={(e) => setInvite({ ...invite, lastName: e.target.value })} />
              </Field>
              <Field className="grid gap-2">
                <Label>{t('members.columns.role')}</Label>
                <Select value={invite.roleId || undefined} onValueChange={(roleId) => setInvite({ ...invite, roleId })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="grid gap-2">
                <Label>{t('members.columns.site')}</Label>
                <Select value={invite.siteId || undefined} onValueChange={(siteId) => setInvite({ ...invite, siteId })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field className="grid gap-2">
                <Label>{t('members.columns.jobTitle')}</Label>
                <Input value={invite.jobTitle} onChange={(e) => setInvite({ ...invite, jobTitle: e.target.value })} />
              </Field>
              <Field className="grid gap-2">
                <Label>{tdep('department')}</Label>
                <DepartmentSelect allowNone value={invite.departmentId || null} onChange={(id) => setInvite({ ...invite, departmentId: id ?? '' })} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{t('members.inviteHint')}</p>
          </div>
          <DialogFooter>
            <Button
              disabled={!invite.email.trim() || !invite.firstName.trim() || !invite.lastName.trim() || !invite.roleId || doInvite.isPending}
              onClick={() => doInvite.mutate()}
            >
              <UserPlus className="size-4" /> {t('members.invite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
