'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, MapPin, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineEdit } from '@/components/ui/inline-edit';
import { Input } from '@/components/ui/input';
import { ApiError, apiDelete, apiPatch, apiPost } from '@/lib/api';
import { useHasPermission } from '@/stores/session';

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  sites: AdminSite[];
}

export interface AdminSite {
  id: string;
  name: string;
  address: string | null;
  departments: { id: string; name: string }[];
}

export function AdminOrganization({ org }: { org: AdminOrg }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canAdmin = hasPermission('organization:admin');

  const [newSite, setNewSite] = useState({ name: '', address: '' });
  const [newDept, setNewDept] = useState<Record<string, string>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin'] });
    queryClient.invalidateQueries({ queryKey: ['organizations'] });
  };
  const onErr = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));

  const updateOrg = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch('/organizations/current', body),
    onSuccess: () => { invalidate(); toast.success(tc('saved')); },
    onError: onErr,
  });
  const createSite = useMutation({
    mutationFn: () => apiPost('/organizations/current/sites', { name: newSite.name, address: newSite.address || undefined }),
    onSuccess: () => { invalidate(); setNewSite({ name: '', address: '' }); },
    onError: onErr,
  });
  const updateSite = useMutation({
    mutationFn: (v: { id: string; name: string }) => apiPatch(`/organizations/current/sites/${v.id}`, { name: v.name }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const removeSite = useMutation({
    mutationFn: (id: string) => apiDelete(`/organizations/current/sites/${id}`),
    onSuccess: invalidate,
    onError: onErr,
  });
  const createDept = useMutation({
    mutationFn: (v: { siteId: string; name: string }) => apiPost(`/organizations/current/sites/${v.siteId}/departments`, { name: v.name }),
    onSuccess: (_, v) => { invalidate(); setNewDept((d) => ({ ...d, [v.siteId]: '' })); },
    onError: onErr,
  });
  const removeDept = useMutation({
    mutationFn: (id: string) => apiDelete(`/organizations/current/departments/${id}`),
    onSuccess: invalidate,
    onError: onErr,
  });

  return (
    <div className="flex flex-col gap-4">
      {/* identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" /> {t('org.identity')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('org.name')}</p>
            <InlineEdit
              value={org.name}
              disabled={!canAdmin}
              onSave={(name) => updateOrg.mutate({ name })}
              textClassName="text-sm font-medium"
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('org.slug')}</p>
            <p className="font-mono text-sm">{org.slug}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('org.createdAt')}</p>
            <p className="text-sm">{new Date(org.createdAt).toLocaleDateString()}</p>
          </div>
        </CardContent>
      </Card>

      {/* sites & departments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4" /> {t('org.sites')} · {org.sites.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {org.sites.map((site) => (
            <div key={site.id} className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <InlineEdit
                    value={site.name}
                    disabled={!canAdmin}
                    onSave={(name) => updateSite.mutate({ id: site.id, name })}
                    textClassName="text-sm font-medium"
                  />
                  {site.address && <p className="text-xs text-muted-foreground">{site.address}</p>}
                </div>
                {canAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    title={t('org.deleteSite')}
                    onClick={() => { if (confirm(t('org.deleteSiteConfirm', { name: site.name }))) removeSite.mutate(site.id); }}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {site.departments.map((d) => (
                  <Badge key={d.id} variant="secondary" className="gap-1 text-xs">
                    {d.name}
                    {canAdmin && (
                      <button onClick={() => removeDept.mutate(d.id)} aria-label={tc('delete')} className="hover:text-destructive">
                        <X className="size-3" />
                      </button>
                    )}
                  </Badge>
                ))}
                {canAdmin && (
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-7 w-40 text-xs"
                      placeholder={t('org.newDepartment')}
                      value={newDept[site.id] ?? ''}
                      onChange={(e) => setNewDept((d) => ({ ...d, [site.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        const name = (newDept[site.id] ?? '').trim();
                        if (e.key === 'Enter' && name) createDept.mutate({ siteId: site.id, name });
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={!(newDept[site.id] ?? '').trim() || createDept.isPending}
                      onClick={() => createDept.mutate({ siteId: site.id, name: (newDept[site.id] ?? '').trim() })}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {canAdmin && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">{t('org.newSite')}</p>
                <Input className="w-48" value={newSite.name} onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} />
              </div>
              <div className="grid flex-1 gap-1">
                <p className="text-xs text-muted-foreground">{t('org.address')}</p>
                <Input value={newSite.address} onChange={(e) => setNewSite({ ...newSite, address: e.target.value })} />
              </div>
              <Button size="sm" disabled={!newSite.name.trim() || createSite.isPending} onClick={() => createSite.mutate()}>
                <Plus className="size-3.5" /> {tc('add')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
