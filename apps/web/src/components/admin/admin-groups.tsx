'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Pencil, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { DepartmentMultiSelect, useDepartmentOptions } from '@/components/departments/department-select';
import { EmptyState } from '@/components/layout/empty-state';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Field, FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

export interface UserGroupRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  departmentIds: string[];
  members: { userId: string; firstName: string; lastName: string; email: string }[];
  memberCount: number;
}

interface OrgMember {
  id: string;
  user: { id: string; firstName: string; lastName: string; email: string };
}

/** Preset swatches (hex so they render identically wherever the group colour is shown). */
export const GROUP_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#84cc16', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];
const DEFAULT_COLOR = GROUP_COLORS[0];

const initials = (u: { firstName: string; lastName: string }) => `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();

export function AdminGroups() {
  const t = useTranslations('admin.groups');
  const tc = useTranslations('common');
  const hasPermission = useHasPermission();
  const canEdit = hasPermission('users:admin');
  const qc = useQueryClient();
  const { nameOf } = useDepartmentOptions();
  const [editing, setEditing] = useState<UserGroupRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: groups, isLoading } = useQuery({
    queryKey: ['groups'],
    queryFn: () => apiGet<UserGroupRow[]>('/groups'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/groups/${id}`),
    onSuccess: () => {
      toast.success(t('deleted'));
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['groups-directory'] });
      qc.invalidateQueries({ queryKey: ['shares'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc('error')),
  });

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (g: UserGroupRow) => { setEditing(g); setDialogOpen(true); };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
        {canEdit && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> {t('new')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      ) : !groups?.length ? (
        <EmptyState
          icon={UsersRound}
          title={t('empty')}
          description={t('emptyDesc')}
          action={canEdit ? <Button size="sm" onClick={openCreate}><Plus className="size-4" /> {t('new')}</Button> : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <div key={g.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <div className="flex items-start gap-2.5">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color ?? DEFAULT_COLOR }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.name}</p>
                  {g.description && <p className="line-clamp-2 text-xs text-muted-foreground">{g.description}</p>}
                </div>
                {canEdit && (
                  <div className="-mr-1 -mt-1 flex shrink-0">
                    <Button size="icon" variant="ghost" className="size-7" aria-label={tc('edit')} title={tc('edit')} onClick={() => openEdit(g)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={tc('delete')}
                      title={tc('delete')}
                      disabled={remove.isPending}
                      onClick={() => { if (window.confirm(t('deleteConfirm', { name: g.name }))) remove.mutate(g.id); }}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  {g.members.slice(0, 5).map((m) => (
                    <Avatar key={m.userId} className="size-6 ring-2 ring-card" title={`${m.firstName} ${m.lastName}`}>
                      <AvatarFallback className="text-[9px]">{initials(m)}</AvatarFallback>
                    </Avatar>
                  ))}
                  {g.memberCount > 5 && (
                    <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[9px] font-medium ring-2 ring-card">
                      +{g.memberCount - 5}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{t('memberCount', { count: g.memberCount })}</span>
              </div>

              <div className="flex flex-wrap gap-1">
                {g.departmentIds.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">{t('noProcesses')}</span>
                ) : (
                  g.departmentIds.map((id) => (
                    <Badge key={id} variant="secondary" className="text-[11px]">{nameOf(id)}</Badge>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && <GroupDialog open={dialogOpen} onOpenChange={setDialogOpen} group={editing} />}
    </div>
  );
}

function GroupDialog({
  open,
  onOpenChange,
  group,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: UserGroupRow | null;
}) {
  const t = useTranslations('admin.groups');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);

  // Prefill whenever the dialog opens or the edited group changes.
  const [prevOpen, setPrevOpen] = useState(false);
  const [prevGroup, setPrevGroup] = useState(group);
  if (open !== prevOpen || group !== prevGroup) {
    setPrevOpen(open);
    setPrevGroup(group);
    if (open) {
      setName(group?.name ?? '');
      setDescription(group?.description ?? '');
      setColor(group?.color ?? DEFAULT_COLOR);
      setMemberIds(group?.members.map((m) => m.userId) ?? []);
      setDepartmentIds(group?.departmentIds ?? []);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), description: description.trim() || null, color, departmentIds };
      const saved = group
        ? await apiPatch<UserGroupRow>(`/groups/${group.id}`, body)
        : await apiPost<UserGroupRow>('/groups', body);
      return apiPut<UserGroupRow>(`/groups/${saved.id}/members`, { userIds: memberIds });
    },
    onSuccess: () => {
      toast.success(group ? t('saved') : t('created'));
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['groups-directory'] });
      qc.invalidateQueries({ queryKey: ['shares'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc('error')),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={group ? t('edit') : t('new')}
      description={t('formDesc')}
      submitLabel={group ? tc('save') : t('create')}
      onSubmit={() => save.mutate()}
      submitting={save.isPending}
      disabled={!name.trim()}
      cancelLabel={tc('cancel')}
      size="md"
    >
      <Field label={t('name')} required htmlFor="group-name">
        <Input id="group-name" value={name} maxLength={120} placeholder={t('namePlaceholder')} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label={t('descriptionLabel')} htmlFor="group-desc">
        <Textarea id="group-desc" rows={2} value={description} maxLength={1000} placeholder={t('descriptionPlaceholder')} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={t('color')}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('color')}>
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                'flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition',
                color === c ? 'ring-2 ring-foreground/60' : 'hover:scale-110',
              )}
              style={{ backgroundColor: c }}
            >
              {color === c && <Check className="size-3.5 text-white" />}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('members')}>
        <MemberMultiSelect value={memberIds} onChange={setMemberIds} enabled={open} />
      </Field>
      <Field label={t('processes')} hint={t('processesHint')}>
        <DepartmentMultiSelect value={departmentIds} onChange={setDepartmentIds} />
      </Field>
    </FormDialog>
  );
}

function MemberMultiSelect({ value, onChange, enabled }: { value: string[]; onChange: (ids: string[]) => void; enabled: boolean }) {
  const t = useTranslations('admin.groups');
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['users', 'all-members-paged'],
    // the API caps pageSize at 100 → walk every page
    queryFn: async () => {
      const all: OrgMember[] = [];
      for (let page = 1; page <= 50; page++) {
        const res = await apiGet<{ data: OrgMember[]; meta?: { totalPages: number } }>(`/users?pageSize=100&page=${page}`);
        all.push(...res.data);
        if (!res.meta || page >= res.meta.totalPages) break;
      }
      return { data: all };
    },
    enabled,
    staleTime: 60_000,
  });
  const users = (data?.data ?? [])
    .map((m) => m.user)
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'fr'));
  const byId = new Map(users.map((u) => [u.id, u]));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((id) => {
        const u = byId.get(id);
        return (
          <Badge key={id} variant="secondary" className="gap-1 pr-1 text-[11px]">
            {u ? `${u.firstName} ${u.lastName}` : '…'}
            <button type="button" aria-label={u ? `${u.firstName} ${u.lastName}` : id} onClick={() => toggle(id)} className="rounded hover:bg-foreground/10">
              <X className="size-3" />
            </button>
          </Badge>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted-foreground">
            {t('addMembers')} <ChevronsUpDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder={t('searchMembers')} />
            <CommandList>
              <CommandEmpty>{t('noMembersFound')}</CommandEmpty>
              <CommandGroup>
                {users.map((u) => (
                  <CommandItem key={u.id} value={`${u.firstName} ${u.lastName} ${u.email}`} onSelect={() => toggle(u.id)}>
                    <Check className={cn('size-4', value.includes(u.id) ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{u.firstName} {u.lastName}</span>
                    <span className="ml-auto truncate text-[11px] text-muted-foreground">{u.email}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
