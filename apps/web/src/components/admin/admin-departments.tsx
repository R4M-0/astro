'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, GitMerge, Pencil, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useHasPermission } from '@/stores/session';

type Kind = 'main' | 'extra';

interface DepartmentMember {
  membershipId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  roleName: string;
  kind: Kind;
}

interface DepartmentRow {
  id: string;
  name: string;
  siteName: string;
  members: DepartmentMember[];
  groups: { id: string; name: string }[];
  counts: Record<string, number>;
  usedBy: number;
}

interface Overview {
  departments: DepartmentRow[];
}

interface OrgMember {
  id: string;
  departmentId: string | null;
  extraDepartmentIds: string[];
  user: { firstName: string; lastName: string; email: string };
  role: { name: string };
}

interface Paged<T> {
  data: T[];
  meta?: { totalPages: number };
}

const QK = ['admin', 'departments'] as const;
const TOP_COUNTS = 6;

const initials = (first: string, last: string) => `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';

/** Every org member (the /users endpoint caps pageSize at 100). */
async function fetchAllMembers(): Promise<OrgMember[]> {
  const out: OrgMember[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await apiGet<Paged<OrgMember>>(`/users?page=${page}&pageSize=100`);
    out.push(...res.data);
    if (!res.meta || page >= res.meta.totalPages) break;
  }
  return out;
}

/** Admin → « Départements & membres »: members per department, records filed under each, rename / merge / delete. */
export function AdminDepartments() {
  const t = useTranslations('admin.departments');
  const tc = useTranslations('common');
  const hasPermission = useHasPermission();
  const canAdmin = hasPermission('users:admin');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<DepartmentRow | null>(null);
  const [newName, setNewName] = useState('');
  const [merging, setMerging] = useState<DepartmentRow | null>(null);
  const [target, setTarget] = useState('');
  const [deleting, setDeleting] = useState<DepartmentRow | null>(null);

  const overview = useQuery({ queryKey: QK, queryFn: () => apiGet<Overview>('/admin/departments') });
  const members = useQuery({ queryKey: [...QK, 'members'], queryFn: fetchAllMembers, enabled: canAdmin });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: QK });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['org', 'sites'] });
  };
  const onErr = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));

  const addMember = useMutation({
    mutationFn: (v: { departmentId: string; membershipId: string; kind: Kind }) =>
      apiPost(`/admin/departments/${v.departmentId}/members`, { membershipId: v.membershipId, kind: v.kind }),
    onSuccess: () => { invalidate(); toast.success(t('memberAdded')); },
    onError: onErr,
  });
  const removeMember = useMutation({
    mutationFn: (v: { departmentId: string; membershipId: string }) =>
      apiDelete(`/admin/departments/${v.departmentId}/members/${v.membershipId}`),
    onSuccess: () => { invalidate(); toast.success(t('memberRemoved')); },
    onError: onErr,
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => apiPatch(`/admin/departments/${v.id}`, { name: v.name }),
    onSuccess: () => { invalidate(); setRenaming(null); toast.success(t('renamed')); },
    onError: onErr,
  });
  const merge = useMutation({
    mutationFn: (v: { id: string; targetDepartmentId: string }) =>
      apiPost(`/admin/departments/${v.id}/merge`, { targetDepartmentId: v.targetDepartmentId }),
    onSuccess: () => { invalidate(); setMerging(null); toast.success(t('merged')); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/admin/departments/${id}`),
    onSuccess: () => { invalidate(); setDeleting(null); toast.success(t('deleted')); },
    onError: onErr,
  });

  const modelLabel = (model: string) => (t.has(`models.${model}`) ? t(`models.${model}` as never) : model);
  const departments = overview.data?.departments ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.siteName.toLowerCase().includes(q) ||
        d.members.some((m) => `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)),
    );
  }, [departments, search]);

  if (overview.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
      </div>
    );
  }

  const targets = departments.filter((d) => d.id !== merging?.id);
  const targetName = targets.find((d) => d.id === target)?.name ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')} className="pl-8" />
        </div>
      </div>

      {departments.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('noMatch')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((d) => (
            <Card key={d.id} className="gap-4">
              <CardHeader className="gap-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{d.name}</span>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{d.siteName}</p>
                  </div>
                  {canAdmin && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" className="size-8" aria-label={t('rename')} onClick={() => { setRenaming(d); setNewName(d.name); }}>
                        <Pencil className="size-3.5" />
                      </Button>
                      {departments.length > 1 && (
                        <Button variant="ghost" size="icon" className="size-8" aria-label={t('merge')} onClick={() => { setMerging(d); setTarget(''); }}>
                          <GitMerge className="size-3.5" />
                        </Button>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                              aria-label={t('delete')}
                              disabled={d.usedBy > 0}
                              onClick={() => setDeleting(d)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{d.usedBy > 0 ? t('deleteDisabled', { count: d.usedBy }) : t('delete')}</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <CountChips counts={d.counts} label={modelLabel} emptyLabel={t('noRecords')} />

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      <Users className="size-3.5" /> {t('members', { count: d.members.length })}
                    </span>
                    {canAdmin && (
                      <AddMemberPicker
                        departmentId={d.id}
                        current={d.members}
                        allMembers={members.data ?? []}
                        loading={members.isLoading}
                        pending={addMember.isPending}
                        onAdd={(membershipId, kind) => addMember.mutate({ departmentId: d.id, membershipId, kind })}
                      />
                    )}
                  </div>
                  <MemberList
                    members={d.members}
                    canEdit={canAdmin}
                    onRemove={(m) => removeMember.mutate({ departmentId: d.id, membershipId: m.membershipId })}
                  />
                </div>

                {d.groups.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{t('groups')} :</span>
                    {d.groups.map((g) => <Badge key={g.id} variant="secondary">{g.name}</Badge>)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('rename')}</DialogTitle>
            <DialogDescription>{renaming?.name}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="department-name">{t('newName')}</Label>
            <Input id="department-name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>{t('cancel')}</Button>
            <Button
              disabled={!newName.trim() || newName.trim() === renaming?.name || rename.isPending}
              onClick={() => renaming && rename.mutate({ id: renaming.id, name: newName.trim() })}
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!merging} onOpenChange={(o) => !o && setMerging(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('merge')}</DialogTitle>
            <DialogDescription>{merging && t('mergeDescription', { name: merging.name })}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label>{t('mergeTarget')}</Label>
            <Select value={target || undefined} onValueChange={setTarget}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t('mergeTargetPlaceholder')} /></SelectTrigger>
              <SelectContent>
                {targets.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {merging && target && (
              <p className="text-xs text-muted-foreground">
                {t('mergeConfirm', { source: merging.name, target: targetName, count: merging.usedBy })}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMerging(null)}>{t('cancel')}</Button>
            <Button
              disabled={!target || merge.isPending}
              onClick={() => merging && merge.mutate({ id: merging.id, targetDepartmentId: target })}
            >
              <GitMerge /> {t('mergeAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('delete')}</DialogTitle>
            <DialogDescription>{deleting && t('deleteConfirm', { name: deleting.name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>{t('cancel')}</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CountChips({ counts, label, emptyLabel }: { counts: Record<string, number>; label: (m: string) => string; emptyLabel: string }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  const top = entries.slice(0, TOP_COUNTS);
  const rest = entries.slice(TOP_COUNTS);
  return (
    <div className="flex flex-wrap gap-1.5">
      {top.map(([model, n]) => (
        <Badge key={model} variant="outline" className="gap-1 font-normal">
          <span className="font-semibold tabular-nums">{n}</span> {label(model)}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="ghost" className="cursor-default font-normal text-muted-foreground">+{rest.length}</Badge>
          </TooltipTrigger>
          <TooltipContent>
            {rest.map(([model, n]) => <div key={model}>{n} {label(model)}</div>)}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function MemberList({ members, canEdit, onRemove }: { members: DepartmentMember[]; canEdit: boolean; onRemove: (m: DepartmentMember) => void }) {
  const t = useTranslations('admin.departments');
  const [confirm, setConfirm] = useState<DepartmentMember | null>(null);
  if (!members.length) return <p className="text-sm text-muted-foreground">{t('noMembers')}</p>;
  return (
    <>
      <ul className="flex flex-col divide-y rounded-md border">
        {members.map((m) => (
          <li key={m.membershipId} className="flex items-center gap-3 px-3 py-2">
            <Avatar className="size-7">
              <AvatarFallback className="text-[11px]">{initials(m.firstName, m.lastName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.firstName} {m.lastName}</p>
              <p className="truncate text-xs text-muted-foreground">{m.roleName}</p>
            </div>
            <Badge variant={m.kind === 'main' ? 'default' : 'outline'} className="shrink-0">
              {m.kind === 'main' ? t('kindMain') : t('kindExtra')}
            </Badge>
            {canEdit && (
              <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={t('removeMember')} onClick={() => setConfirm(m)}>
                <X className="size-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('removeMember')}</DialogTitle>
            <DialogDescription>
              {confirm && t('removeMemberConfirm', { name: `${confirm.firstName} ${confirm.lastName}` })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            <Button variant="destructive" onClick={() => { if (confirm) onRemove(confirm); setConfirm(null); }}>{t('remove')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddMemberPicker({
  departmentId,
  current,
  allMembers,
  loading,
  pending,
  onAdd,
}: {
  departmentId: string;
  current: DepartmentMember[];
  allMembers: OrgMember[];
  loading: boolean;
  pending: boolean;
  onAdd: (membershipId: string, kind: Kind) => void;
}) {
  const t = useTranslations('admin.departments');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('main');
  const inDepartment = new Set(current.map((m) => m.membershipId));
  // a member whose extra access is here can still be promoted to main
  const candidates = allMembers.filter((m) =>
    kind === 'main' ? m.departmentId !== departmentId : !inDepartment.has(m.id),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="xs" disabled={pending}>
          <UserPlus /> {t('addMember')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex flex-col gap-1.5 border-b p-2">
          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
            {(['main', 'extra'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${kind === k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {k === 'main' ? t('kindMain') : t('kindExtra')}
              </button>
            ))}
          </div>
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">{kind === 'main' ? t('kindMainHint') : t('kindExtraHint')}</p>
        </div>
        <Command>
          <CommandInput placeholder={t('searchMember')} />
          <CommandList>
            <CommandEmpty>{loading ? t('loading') : t('noCandidates')}</CommandEmpty>
            <CommandGroup>
              {candidates.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.user.firstName} ${m.user.lastName} ${m.user.email}`}
                  onSelect={() => { onAdd(m.id, kind); setOpen(false); }}
                >
                  <Avatar className="size-6">
                    <AvatarFallback className="text-[10px]">{initials(m.user.firstName, m.user.lastName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{m.user.firstName} {m.user.lastName}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.role.name}</p>
                  </div>
                  {inDepartment.has(m.id) && <Check className="size-3.5 text-muted-foreground" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
