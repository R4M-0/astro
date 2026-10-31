'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Share2, Trash2, UserPlus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission, useSession } from '@/stores/session';

interface ShareUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}
interface SharesResponse {
  department: { id: string; name: string } | null;
  shares: { userId: string; user: ShareUser | null; grantedBy: ShareUser | null; createdAt: string }[];
  groupShares?: {
    groupId: string;
    group: { id: string; name: string; color: string | null; memberCount: number };
    grantedBy: ShareUser | null;
    createdAt: string;
  }[];
}
interface DirectoryGroup {
  id: string;
  name: string;
  color: string | null;
  memberCount: number;
}

const initials = (u: { firstName: string; lastName: string }) => `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();

interface DirectoryUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * « Partager » — invite people from other departments to one record of a department-scoped register.
 * `entityType` is the Prisma model name (Action, Nonconformity, Risk…); `resource` its RBAC resource
 * (sharing needs `<resource>:update`; the list is visible with `<resource>:read`).
 */
export function ShareButton({
  entityType,
  entityId,
  resource,
  size = 'sm',
  membersOnly,
}: {
  entityType: string;
  entityId: string;
  resource: string;
  size?: 'sm' | 'default';
  /** members-only record (projects): no department — only the people on it + invited users see it */
  membersOnly?: boolean;
}) {
  const t = useTranslations('departments.share');
  const tc = useTranslations('common');
  const hasPermission = useHasPermission();
  const canShare = hasPermission(`${resource}:update`);
  const myId = useSession((s) => s.user?.id);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const key = ['shares', entityType, entityId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => apiGet<SharesResponse>(`/shares/${entityType}/${entityId}`),
    enabled: !!entityId && canShare,
  });
  const directory = useQuery({
    queryKey: ['users', 'directory', 'share'],
    queryFn: () => apiGet<{ data: { user: DirectoryUser }[] }>('/users/directory').then((r) => r.data.map((m) => m.user)),
    enabled: open && canShare,
    staleTime: 60_000,
  });
  const groupDirectory = useQuery({
    queryKey: ['groups-directory'],
    queryFn: () => apiGet<DirectoryGroup[]>('/groups/directory'),
    enabled: open && canShare,
    staleTime: 60_000,
  });

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : tc('error'));
  const add = useMutation({
    mutationFn: (target: { userId?: string; groupId?: string }) =>
      apiPost<SharesResponse>(
        `/shares/${entityType}/${entityId}`,
        target.groupId ? { groupIds: [target.groupId] } : { userIds: [target.userId] },
      ),
    onSuccess: (res) => { qc.setQueryData(key, res); toast.success(t('added')); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => apiDelete<SharesResponse>(`/shares/${entityType}/${entityId}/${userId}`),
    onSuccess: (res) => qc.setQueryData(key, res),
    onError: onErr,
  });
  const removeGroup = useMutation({
    mutationFn: (groupId: string) => apiDelete<SharesResponse>(`/shares/${entityType}/${entityId}/group/${groupId}`),
    onSuccess: (res) => qc.setQueryData(key, res),
    onError: onErr,
  });

  const shares = data?.shares ?? [];
  const sharedIds = new Set(shares.map((s) => s.userId));
  const candidates = (directory.data ?? []).filter((u) => u.id !== myId && !sharedIds.has(u.id));
  const groupShares = data?.groupShares ?? [];
  const sharedGroupIds = new Set(groupShares.map((g) => g.groupId));
  const groupCandidates = (groupDirectory.data ?? []).filter((g) => !sharedGroupIds.has(g.id));
  const shareCount = shares.length + groupShares.length;

  // Sharing needs `<resource>:update` — readers don't get the button at all.
  if (!canShare) return null;

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <Share2 className="size-4" /> {t('button')}
        {shareCount > 0 && <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px] tabular-nums">{shareCount}</Badge>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{membersOnly ? t('membersOnlyDescription') : t('description')}</DialogDescription>
          </DialogHeader>

          {!membersOnly && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <Building2 className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('department')}</span>
              <span className="font-medium">{data?.department?.name ?? t('noDepartment')}</span>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">{t('sharedWith')}</p>
              {canShare && (
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7">
                      <UserPlus className="size-3.5" /> {t('add')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="end">
                    <Command>
                      <CommandInput placeholder={t('searchAll')} />
                      <CommandList>
                        <CommandEmpty>{directory.isLoading || groupDirectory.isLoading ? '…' : t('noCandidate')}</CommandEmpty>
                        {groupCandidates.length > 0 && (
                          <CommandGroup heading={t('groups')}>
                            {groupCandidates.map((g) => (
                              <CommandItem
                                key={g.id}
                                value={`group ${g.name} ${g.id}`}
                                onSelect={() => { add.mutate({ groupId: g.id }); setPickerOpen(false); }}
                              >
                                <GroupDot color={g.color} />
                                <span className="truncate">{g.name}</span>
                                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                                  {t('groupMembers', { count: g.memberCount })}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                        <CommandGroup heading={groupCandidates.length > 0 ? t('people') : undefined}>
                          {candidates.map((u) => (
                            <CommandItem
                              key={u.id}
                              value={`${u.firstName} ${u.lastName} ${u.email}`}
                              onSelect={() => { add.mutate({ userId: u.id }); setPickerOpen(false); }}
                            >
                              <Avatar className="size-6"><AvatarFallback className="text-[10px]">{initials(u)}</AvatarFallback></Avatar>
                              <span className="truncate">{u.firstName} {u.lastName}</span>
                              <span className="ml-auto truncate text-[11px] text-muted-foreground">{u.email}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            {isLoading ? (
              <p className="py-3 text-center text-sm text-muted-foreground">…</p>
            ) : shareCount === 0 ? (
              <p className="rounded-md border border-dashed py-4 text-center text-sm text-muted-foreground">{t('none')}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {groupShares.map((s) => (
                  <li key={`g-${s.groupId}`} className="flex items-center gap-2.5 px-3 py-2">
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: s.group.color ?? DEFAULT_GROUP_COLOR }}
                    >
                      <UsersRound className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm">
                        <span className="truncate">{s.group.name}</span>
                        <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">{t('groupBadge')}</Badge>
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {t('groupMembers', { count: s.group.memberCount })}
                        {s.grantedBy && ` · ${t('grantedBy', { name: `${s.grantedBy.firstName} ${s.grantedBy.lastName}` })}`}
                      </p>
                    </div>
                    {canShare && (
                      <Button size="icon" variant="ghost" className="size-7" aria-label={t('revoke')} title={t('revoke')}
                        disabled={removeGroup.isPending} onClick={() => removeGroup.mutate(s.groupId)}>
                        <Trash2 className="size-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </li>
                ))}
                {shares.map((s) => (
                  <li key={s.userId} className="flex items-center gap-2.5 px-3 py-2">
                    <Avatar className="size-7"><AvatarFallback className="text-[10px]">{s.user ? initials(s.user) : '?'}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{s.user ? `${s.user.firstName} ${s.user.lastName}` : '—'}</p>
                      {s.grantedBy && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {t('grantedBy', { name: `${s.grantedBy.firstName} ${s.grantedBy.lastName}` })}
                        </p>
                      )}
                    </div>
                    {canShare && (
                      <Button size="icon" variant="ghost" className="size-7" aria-label={t('revoke')} title={t('revoke')}
                        disabled={remove.isPending} onClick={() => remove.mutate(s.userId)}>
                        <Trash2 className="size-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className={cn('flex items-start gap-1.5 text-xs text-muted-foreground')}>
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
            {membersOnly ? t('membersOnlyHint') : t('involvedHint')}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

const DEFAULT_GROUP_COLOR = '#6366f1';

function GroupDot({ color }: { color: string | null }) {
  return <span className="ml-1 mr-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? DEFAULT_GROUP_COLOR }} />;
}
