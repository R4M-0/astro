'use client';

import { ACTIONS, resourceSupports } from '@astro/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Lock, MoreHorizontal, Pencil, Plus, RotateCcw, Save, Search, ShieldCheck, Trash2, Undo2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiDelete, apiPatch, apiPost, apiPut } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';
import type { AdminRole } from './admin-members';
import { ORG_ADMIN_LOCKED_PERMISSIONS, resolvedSections } from './role-resource-groups';

const NONE = '__none__';

const key = (resource: string, action: string) => `${resource}:${action}`;
/** Only actions the code enforces for a resource get a checkbox (see RESOURCE_ACTIONS). */
const supportedKeys = (resource: string) => ACTIONS.filter((a) => resourceSupports(resource, a)).map((a) => key(resource, a));

/** `GET /roles` also returns the role description. */
type Role = AdminRole & { description?: string | null };

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function AdminRoles({ roles: rawRoles }: { roles: AdminRole[] }) {
  const roles = rawRoles as Role[];
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const tdep = useTranslations('departments.admin');
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canAdmin = hasPermission('roles:admin');

  const [selectedId, setSelectedId] = useState<string | null>(roles[0]?.id ?? null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', copyFrom: NONE });
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reassignTo, setReassignTo] = useState<string>(NONE);
  const [resetOpen, setResetOpen] = useState(false);

  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;
  const editable = canAdmin && !!selected;
  const isOrgAdmin = !!selected?.isSystem && selected.key === 'org_admin';
  const isLocked = (k: string) => isOrgAdmin && ORG_ADMIN_LOCKED_PERMISSIONS.has(k);

  const rolePerms = useMemo(
    () => new Set(selected?.permissions.map((p) => key(p.permission.resource, p.permission.action)) ?? []),
    [selected],
  );

  // reset the draft whenever the selected role (or its saved permissions) change
  const [prevRolePerms, setPrevRolePerms] = useState<Set<string> | null>(null);
  if (rolePerms !== prevRolePerms) {
    setPrevRolePerms(rolePerms);
    setDraft(new Set(rolePerms));
  }

  /** number of cells that differ from the saved grants */
  const diffCount = useMemo(() => {
    let n = 0;
    for (const k of draft) if (!rolePerms.has(k)) n++;
    for (const k of rolePerms) if (!draft.has(k)) n++;
    return n;
  }, [draft, rolePerms]);
  const dirty = diffCount > 0;

  const resourceLabel = (r: string) => (t.has(`resources.${r}`) ? t(`resources.${r}`) : r);
  const sectionLabel = (id: string) => (t.has(`roles.sections.${id}`) ? t(`roles.sections.${id}`) : id);

  const allSections = useMemo(() => resolvedSections(), []);
  const sections = useMemo(() => {
    const q = normalize(search.trim());
    if (!q) return allSections;
    return allSections
      .map((s) => ({
        ...s,
        resources: s.resources.filter(
          (r) => normalize(r).includes(q) || normalize(resourceLabel(r)).includes(q) || normalize(sectionLabel(s.id)).includes(q),
        ),
      }))
      .filter((s) => s.resources.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSections, search]);
  const visibleResources = useMemo(() => sections.flatMap((s) => s.resources), [sections]);
  const totalCells = allSections.reduce((n, s) => n + s.resources.reduce((m, r) => m + supportedKeys(r).length, 0), 0);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });
  const onErr = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));

  const confirmDiscard = () => !dirty || window.confirm(t('roles.discardConfirm'));
  const selectRole = (id: string) => {
    if (id === selected?.id || !confirmDiscard()) return;
    setSelectedId(id);
  };

  const save = useMutation({
    mutationFn: () => apiPut(`/roles/${selected!.id}/permissions`, { permissions: [...draft] }),
    onSuccess: () => { invalidate(); toast.success(t('roles.saved')); },
    onError: onErr,
  });
  const createRole = useMutation({
    mutationFn: () => {
      const source = roles.find((r) => r.id === createForm.copyFrom);
      const permissions = source
        ? source.permissions.map((p) => key(p.permission.resource, p.permission.action))
        : ['dashboard:read', 'notifications:read'];
      return apiPost<{ id: string }>('/roles', { name: createForm.name.trim(), permissions });
    },
    onSuccess: (role) => {
      invalidate();
      setCreateOpen(false);
      setCreateForm({ name: '', copyFrom: NONE });
      setSelectedId(role.id);
      toast.success(t('roles.created'));
    },
    onError: onErr,
  });

  const setScoped = useMutation({
    mutationFn: (departmentScoped: boolean) => apiPatch(`/roles/${selected!.id}`, { departmentScoped }),
    onSuccess: () => { invalidate(); toast.success(tdep('saved')); },
    onError: onErr,
  });

  const updateRole = useMutation({
    mutationFn: () => {
      const body: { name?: string; description?: string | null } = {};
      const name = editForm.name.trim();
      if (!selected!.isSystem && name && name !== selected!.name) body.name = name;
      const description = editForm.description.trim();
      if (description !== (selected!.description ?? '')) body.description = description || null;
      return apiPatch(`/roles/${selected!.id}`, body);
    },
    onSuccess: () => { invalidate(); setEditOpen(false); toast.success(t('roles.updated')); },
    onError: onErr,
  });

  const resetRole = useMutation({
    mutationFn: () => apiPost(`/roles/${selected!.id}/reset`),
    onSuccess: () => { invalidate(); setResetOpen(false); toast.success(t('roles.resetDone')); },
    onError: onErr,
  });

  const duplicateRole = useMutation({
    mutationFn: () => apiPost<{ id: string }>(`/roles/${selected!.id}/duplicate`, { name: dupName.trim() }),
    onSuccess: (role) => {
      invalidate();
      setDupOpen(false);
      setSelectedId(role.id);
      toast.success(t('roles.duplicated'));
    },
    onError: onErr,
  });

  const deleteRole = useMutation({
    mutationFn: () => {
      const qs = reassignTo !== NONE ? `?reassignToRoleId=${encodeURIComponent(reassignTo)}` : '';
      return apiDelete(`/roles/${selected!.id}${qs}`);
    },
    onSuccess: () => {
      invalidate();
      setDeleteOpen(false);
      setSelectedId(roles.find((r) => r.id !== selected?.id)?.id ?? null);
      toast.success(t('roles.deleted'));
    },
    onError: onErr,
  });

  const toggle = (k: string) => {
    if (!editable || isLocked(k)) return;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  /** Sets a batch of cells all-on, or all-off when they are already all on (locked cells stay on). */
  const toggleMany = (keys: string[]) => {
    if (!editable || keys.length === 0) return;
    const allOn = keys.every((k) => draft.has(k));
    setDraft((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allOn) { if (!isLocked(k)) next.delete(k); } else next.add(k);
      }
      return next;
    });
  };

  /** Row toggle: full CRUD+extras on / off for one resource. */
  const toggleRow = (resource: string) => toggleMany(supportedKeys(resource));
  /** Column toggle: one action across every visible resource. */
  const toggleColumn = (action: string) =>
    toggleMany(visibleResources.filter((r) => resourceSupports(r, action)).map((r) => key(r, action)));
  /** Section toggle: every cell of a module group. */
  const sectionKeys = (resources: string[]) => resources.flatMap(supportedKeys);

  const otherRoles = roles.filter((r) => r.id !== selected?.id);
  const memberCount = selected?._count.memberships ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* role list */}
      <div className="flex flex-col gap-2">
        {roles.map((r) => (
          <button
            key={r.id}
            onClick={() => selectRole(r.id)}
            className={cn(
              'flex flex-col gap-1 rounded-md border p-3 text-left transition-colors',
              selected?.id === r.id ? 'border-primary bg-primary/5' : 'hover:bg-accent',
            )}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className={cn('size-4', selected?.id === r.id ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
              {r.isSystem && (
                <Badge variant="secondary" className="gap-1 text-[10px]"><Lock className="size-2.5" /> {t('roles.system')}</Badge>
              )}
            </div>
            {r.description && <p className="line-clamp-2 text-[11px] text-muted-foreground">{r.description}</p>}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="truncate font-mono">{r.key}</span>
              {r.departmentScoped && <span title={tdep('scopedOn')} className="rounded bg-primary/10 px-1 text-primary">{tdep('department')}</span>}
              <span className="ml-auto flex items-center gap-1"><Users className="size-3" /> {r._count.memberships}</span>
              <span className="whitespace-nowrap">{r.permissions.length} perm.</span>
            </div>
          </button>
        ))}
        {canAdmin && (
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> {t('roles.new')}
          </Button>
        )}
      </div>

      {/* permission matrix */}
      {selected && (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{selected.name}</h3>
            {selected.isSystem ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3" /> {canAdmin ? t('roles.systemEditable') : t('roles.systemReadonly')}
              </span>
            ) : (
              canAdmin && <span className="text-xs text-muted-foreground">{t('roles.matrixHint')}</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {dirty ? (
                <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning-foreground dark:text-warning">
                  {t('roles.unsaved', { count: diffCount })}
                </span>
              ) : (
                <span className="text-xs tabular-nums text-muted-foreground">{draft.size} / {totalCells}</span>
              )}
              {editable && dirty && (
                <Button size="sm" variant="ghost" onClick={() => setDraft(new Set(rolePerms))}>
                  <Undo2 className="size-3.5" /> {t('roles.discard')}
                </Button>
              )}
              {editable && (
                <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                  <Save className="size-3.5" /> {tc('save')}
                </Button>
              )}
              {canAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="outline" className="size-8" aria-label={t('roles.more')}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditForm({ name: selected.name, description: selected.description ?? '' });
                        setEditOpen(true);
                      }}
                    >
                      <Pencil className="size-4" /> {t('roles.editRole')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setDupName(t('roles.copySuffix', { name: selected.name }));
                        setDupOpen(true);
                      }}
                    >
                      <Copy className="size-4" /> {t('roles.duplicate')}
                    </DropdownMenuItem>
                    {selected.isSystem && (
                      <DropdownMenuItem onSelect={() => setResetOpen(true)}>
                        <RotateCcw className="size-4" /> {t('roles.reset')}
                      </DropdownMenuItem>
                    )}
                    {!selected.isSystem && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            setReassignTo(NONE);
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="size-4" /> {t('roles.deleteRole')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* visibility: whole organization vs. own department(s) — editable on system roles too */}
          <label className="flex items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3">
            <Switch
              className="mt-0.5"
              checked={selected.departmentScoped}
              disabled={!canAdmin || setScoped.isPending}
              onCheckedChange={(v) => setScoped.mutate(v)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{tdep('scoped')}</span>
              <span className="text-xs text-muted-foreground">{tdep('scopedHint')}</span>
            </span>
          </label>

          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('roles.searchResources')}
              className="h-8 pl-8 text-sm"
              aria-label={t('roles.searchResources')}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left text-xs font-medium text-muted-foreground backdrop-blur">
                    {t('roles.resource')}
                  </th>
                  {ACTIONS.map((a) => (
                    <th key={a} className="px-2 py-2 text-center">
                      <button
                        className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground', editable && 'hover:bg-accent hover:text-foreground')}
                        onClick={() => toggleColumn(a)}
                        disabled={!editable}
                        title={editable ? t('roles.toggleColumn') : undefined}
                      >
                        {t(`roles.actions.${a}`)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.length === 0 && (
                  <tr>
                    <td colSpan={ACTIONS.length + 1} className="px-3 py-6 text-center text-xs text-muted-foreground">
                      {t('roles.noResources')}
                    </td>
                  </tr>
                )}
                {sections.map((section) => {
                  const keys = sectionKeys(section.resources);
                  const granted = keys.filter((k) => draft.has(k)).length;
                  const allOn = granted === keys.length;
                  return [
                    <tr key={`section-${section.id}`} className="border-b bg-muted/50">
                      <td colSpan={ACTIONS.length + 1} className="px-3 py-1.5">
                        <div className="sticky left-3 flex w-fit items-center gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                            {sectionLabel(section.id)}
                          </span>
                          <span className="text-[11px] tabular-nums text-muted-foreground">{granted} / {keys.length}</span>
                          {editable && (
                            <button
                              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                              onClick={() => toggleMany(keys)}
                            >
                              {allOn ? t('roles.uncheckSection') : t('roles.checkSection')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>,
                    ...section.resources.map((resource) => (
                      <tr key={resource} className="border-b last:border-0">
                        <td className="sticky left-0 z-10 bg-background px-3 py-1.5">
                          <button
                            className={cn('flex flex-col rounded px-1 py-0.5 text-left', editable && 'hover:bg-accent')}
                            onClick={() => toggleRow(resource)}
                            disabled={!editable}
                            title={editable ? t('roles.toggleRow') : undefined}
                          >
                            <span className="text-xs font-medium">{resourceLabel(resource)}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{resource}</span>
                          </button>
                        </td>
                        {ACTIONS.map((action) => {
                          const k = key(resource, action);
                          if (!resourceSupports(resource, action)) {
                            return (
                              <td key={action} className="px-2 py-1.5 text-center" title={t('roles.notApplicable')}>
                                <span className="text-muted-foreground/30">—</span>
                              </td>
                            );
                          }
                          const on = draft.has(k);
                          const locked = isLocked(k);
                          const changed = on !== rolePerms.has(k);
                          return (
                            <td
                              key={action}
                              className={cn('px-2 py-1.5 text-center', changed && 'bg-warning/10')}
                              title={locked ? t('roles.lockedPermission') : undefined}
                            >
                              {editable ? (
                                locked ? (
                                  <Lock className="mx-auto size-3.5 text-muted-foreground" aria-label={k} />
                                ) : (
                                  <Checkbox checked={on} onCheckedChange={() => toggle(k)} aria-label={k} />
                                )
                              ) : on ? (
                                <Check className="mx-auto size-3.5 text-success" />
                              ) : (
                                <span className="text-muted-foreground/30">·</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* create role dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('roles.new')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>{t('roles.name')}</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} autoFocus />
            </div>
            <div className="grid gap-2">
              <Label>{t('roles.copyFrom')}</Label>
              <Select value={createForm.copyFrom} onValueChange={(copyFrom) => setCreateForm({ ...createForm, copyFrom })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('roles.copyNone')}</SelectItem>
                  {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!createForm.name.trim() || createRole.isPending} onClick={() => createRole.mutate()}>
              {tc('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selected && (
        <>
          {/* edit (rename custom / describe any) */}
          <FormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            size="sm"
            title={t('roles.editRole')}
            description={selected.isSystem ? t('roles.editRoleDesc') : undefined}
            submitLabel={tc('save')}
            submitting={updateRole.isPending}
            disabled={!selected.isSystem && !editForm.name.trim()}
            onSubmit={() => updateRole.mutate()}
          >
            <Field label={t('roles.name')} required={!selected.isSystem}>
              <Input
                value={editForm.name}
                disabled={selected.isSystem}
                maxLength={80}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                autoFocus={!selected.isSystem}
              />
            </Field>
            <Field label={t('roles.descriptionLabel')}>
              <Textarea
                value={editForm.description}
                maxLength={500}
                rows={3}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </Field>
          </FormDialog>

          {/* duplicate */}
          <FormDialog
            open={dupOpen}
            onOpenChange={setDupOpen}
            size="sm"
            title={t('roles.duplicateTitle', { name: selected.name })}
            description={t('roles.duplicateDesc')}
            submitLabel={t('roles.duplicate')}
            submitting={duplicateRole.isPending}
            disabled={!dupName.trim()}
            onSubmit={() => duplicateRole.mutate()}
          >
            <Field label={t('roles.name')} required>
              <Input value={dupName} maxLength={80} onChange={(e) => setDupName(e.target.value)} autoFocus />
            </Field>
          </FormDialog>

          {/* reset system role */}
          <FormDialog
            open={resetOpen}
            onOpenChange={setResetOpen}
            size="sm"
            title={t('roles.reset')}
            description={t('roles.resetConfirm', { name: selected.name })}
            submitLabel={t('roles.reset')}
            submitting={resetRole.isPending}
            onSubmit={() => resetRole.mutate()}
          >
            {null}
          </FormDialog>

          {/* delete custom role (+ reassignment when members hold it) */}
          <FormDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            size="sm"
            title={t('roles.deleteTitle', { name: selected.name })}
            description={t('roles.deleteDesc')}
            submitLabel={t('roles.deleteRole')}
            submitting={deleteRole.isPending}
            disabled={memberCount > 0 && reassignTo === NONE}
            onSubmit={() => deleteRole.mutate()}
          >
            {memberCount > 0 && (
              <>
                <p className="text-sm">{t('roles.deleteHasMembers', { count: memberCount })}</p>
                <Field label={t('roles.reassignTo')} required>
                  <Select value={reassignTo} onValueChange={setReassignTo}>
                    <SelectTrigger><SelectValue placeholder={t('roles.reassignPlaceholder')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE} disabled>{t('roles.reassignPlaceholder')}</SelectItem>
                      {otherRoles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}
          </FormDialog>
        </>
      )}
    </div>
  );
}
