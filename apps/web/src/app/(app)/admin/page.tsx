'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, MapPin, ScrollText, ShieldCheck, Users } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { AdminAudit } from '@/components/admin/admin-audit';
import { AdminBilling } from '@/components/admin/admin-billing';
import { AdminLicense } from '@/components/admin/admin-license';
import { SELF_HOSTED } from '@/lib/deployment';
import { AdminGroups } from '@/components/admin/admin-groups';
import { AdminMembers, type AdminRole } from '@/components/admin/admin-members';
import { AdminOrganization, type AdminOrg } from '@/components/admin/admin-organization';
import { AdminDepartments } from '@/components/admin/admin-departments';
import { AdminRoles } from '@/components/admin/admin-roles';
import { AdminVisibility } from '@/components/admin/admin-visibility';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiGet } from '@/lib/api';
import { useHasPermission } from '@/stores/session';

const noopSubscribe = () => () => {};

export default function AdminPage() {
  const t = useTranslations('admin');
  const hasPermission = useHasPermission();

  const canUsers = hasPermission('users:read');
  const canRoles = hasPermission('roles:read');
  const canAudit = hasPermission('audit-log:read');
  const canOrg = hasPermission('organization:read');
  // self-hosted: the signed license replaces the SaaS subscription
  const canBilling = canOrg && !SELF_HOSTED;
  const canLicense = SELF_HOSTED && hasPermission('organization:admin');
  // `?tab=billing` deep-link (e.g. from a locked add-on module)
  const urlTab = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get('tab'),
    () => null,
  );
  const [pickedTab, setTab] = useState<string | null>(null);
  const tab = pickedTab ?? urlTab;

  const { data: org, isLoading: orgLoading } = useQuery({
    queryKey: ['admin', 'org'],
    queryFn: () => apiGet<AdminOrg>('/organizations/current'),
  });
  const { data: roles } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiGet<AdminRole[]>('/roles'),
    enabled: canRoles,
  });
  const { data: membersMeta } = useQuery({
    queryKey: ['admin', 'members-count'],
    queryFn: () => apiGet<{ meta: { total: number } }>('/users?page=1&pageSize=1'),
    enabled: canUsers,
  });
  const { data: auditMeta } = useQuery({
    queryKey: ['admin', 'audit-count'],
    queryFn: () => apiGet<{ meta: { total: number } }>('/audit-log?page=1&pageSize=1'),
    enabled: canAudit,
  });

  const sites = org?.sites ?? [];
  const departments = sites.reduce((s, site) => s + site.departments.length, 0);

  const tiles = [
    { label: t('tiles.members'), value: membersMeta?.meta.total ?? '—', icon: Users },
    { label: t('tiles.roles'), value: roles?.length ?? '—', icon: ShieldCheck },
    { label: t('tiles.sites'), value: sites.length, icon: MapPin },
    { label: t('tiles.departments'), value: departments, icon: Building2 },
    { label: t('tiles.auditEvents'), value: auditMeta?.meta.total ?? '—', icon: ScrollText },
  ];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={t('title')} description={t('desc')} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardContent className="flex items-start justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">{tile.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
              </div>
              <tile.icon className="size-4 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      {orgLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Tabs value={tab ?? (canUsers ? 'members' : 'organization')} onValueChange={setTab}>
          <TabsList className="h-auto flex-wrap">
            {canUsers && <TabsTrigger value="members">{t('tabs.members')}</TabsTrigger>}
            {canUsers && <TabsTrigger value="departments">{t('tabs.departments')}</TabsTrigger>}
            {canUsers && <TabsTrigger value="groups">{t('tabs.groups')}</TabsTrigger>}
            {canRoles && <TabsTrigger value="roles">{t('tabs.roles')}</TabsTrigger>}
            {canOrg && <TabsTrigger value="visibility">{t('tabs.visibility')}</TabsTrigger>}
            <TabsTrigger value="organization">{t('tabs.organization')}</TabsTrigger>
            {canBilling && <TabsTrigger value="billing">{t('tabs.billing')}</TabsTrigger>}
            {canLicense && <TabsTrigger value="license">{t('tabs.license')}</TabsTrigger>}
            {canAudit && <TabsTrigger value="audit">{t('tabs.audit')}</TabsTrigger>}
          </TabsList>

          {canUsers && (
            <TabsContent value="members" className="mt-4">
              <AdminMembers roles={roles ?? []} sites={sites} />
            </TabsContent>
          )}
          {canUsers && (
            <TabsContent value="departments" className="mt-4">
              <AdminDepartments />
            </TabsContent>
          )}
          {canUsers && (
            <TabsContent value="groups" className="mt-4">
              <AdminGroups />
            </TabsContent>
          )}
          {canOrg && (
            <TabsContent value="visibility" className="mt-4">
              <AdminVisibility />
            </TabsContent>
          )}
          {canRoles && (
            <TabsContent value="roles" className="mt-4">
              <AdminRoles roles={roles ?? []} />
            </TabsContent>
          )}
          <TabsContent value="organization" className="mt-4">
            {org && <AdminOrganization org={org} />}
          </TabsContent>
          {canBilling && (
            <TabsContent value="billing" className="mt-4">
              <AdminBilling />
            </TabsContent>
          )}
          {canLicense && (
            <TabsContent value="license" className="mt-4">
              <AdminLicense />
            </TabsContent>
          )}
          {canAudit && (
            <TabsContent value="audit" className="mt-4">
              <AdminAudit />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
