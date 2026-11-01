'use client';

import { useQuery } from '@tanstack/react-query';
import { EyeOff, Layers, Lock, ShieldCheck, Users } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DetailPage } from '@/components/layout/detail-page';
import { NoAccess } from '@/components/layout/no-access';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

interface DeptRef {
  id: string;
  name: string | null;
}

interface EffectiveAccess {
  member: {
    membershipId: string;
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    isActive: boolean;
    deactivatedAt: string | null;
    twoFactorEnabled: boolean;
  };
  role: { id: string; name: string; key: string; departmentScoped: boolean };
  permissions: string[];
  departments: {
    main: DeptRef | null;
    extra: DeptRef[];
    fromGroups: { groupId: string; groupName: string; departmentIds: string[]; departments: DeptRef[] }[];
  };
  groups: { id: string; name: string; description: string | null; color: string | null; departments: DeptRef[] }[];
  registers: {
    model: string;
    parent: string | null;
    resource: string;
    group: string;
    mode: 'organization' | 'process' | 'members';
    restricted: boolean;
    canRead: boolean;
    visibleCount: number;
    totalCount: number;
  }[];
}

const ACTION_ORDER = ['read', 'create', 'update', 'delete', 'approve', 'export', 'admin'];

export default function MemberEffectiveAccessPage() {
  const params = useParams();
  const membershipId = params.membershipId as string;
  const t = useTranslations('admin');
  const tm = useTranslations('admin.members.access');
  const canAdmin = useHasPermission()('users:admin');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'members', 'effective-access', membershipId],
    queryFn: () => apiGet<EffectiveAccess>(`/users/${membershipId}/effective-access`),
    enabled: canAdmin,
  });

  const label = (key: string, fallback: string) => (t.has(key as never) ? t(key as never) : fallback);
  const deptName = (d: DeptRef) => d.name ?? '—';
  const name = data ? `${data.member.firstName} ${data.member.lastName}` : '';

  // permissions grouped by resource
  const byResource = new Map<string, string[]>();
  for (const p of data?.permissions ?? []) {
    const i = p.lastIndexOf(':');
    const res = p.slice(0, i);
    byResource.set(res, [...(byResource.get(res) ?? []), p.slice(i + 1)]);
  }
  const resources = [...byResource.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // effective access is a users:admin view (the members list only links here for admins)
  if (!canAdmin) return <NoAccess />;

  return (
    <DetailPage
      backHref="/admin"
      backLabel={tm('back')}
      loading={isLoading}
      reference={data?.member.email}
      title={data ? tm('title', { name }) : error ? '—' : undefined}
      subtitle={data ? (data.member.jobTitle ?? tm('desc')) : undefined}
      badges={
        data && (
          <>
            <Badge variant="secondary">
              <ShieldCheck /> {data.role.name}
            </Badge>
            <Badge variant="outline">{data.role.departmentScoped ? tm('scoped') : tm('notScoped')}</Badge>
            {data.departments.main && <Badge variant="outline">{deptName(data.departments.main)}</Badge>}
            {data.departments.extra.map((d) => (
              <Badge key={d.id} variant="outline" className="text-muted-foreground">
                {deptName(d)}
              </Badge>
            ))}
            {!data.member.isActive && (
              <Badge variant="outline" className="border-destructive/40 text-destructive">
                {tm('inactive')}
              </Badge>
            )}
          </>
        )
      }
    >
      {error && !data && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {data && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">{tm('desc')}</p>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Processus */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="size-4" /> {tm('processes')}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{tm('main')}</p>
                  {data.departments.main ? <Badge>{deptName(data.departments.main)}</Badge> : <span className="text-muted-foreground">{tm('none')}</span>}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{tm('extra')}</p>
                  <div className="flex flex-wrap gap-1">
                    {data.departments.extra.length ? (
                      data.departments.extra.map((d) => <Badge key={d.id} variant="secondary">{deptName(d)}</Badge>)
                    ) : (
                      <span className="text-muted-foreground">{tm('none')}</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{tm('fromGroups')}</p>
                  {data.departments.fromGroups.length ? (
                    <ul className="flex flex-col gap-1.5">
                      {data.departments.fromGroups.map((g) => (
                        <li key={g.groupId} className="flex flex-wrap items-center gap-1">
                          <span className="mr-1 text-xs font-medium">{g.groupName} :</span>
                          {g.departments.map((d) => <Badge key={d.id} variant="outline">{deptName(d)}</Badge>)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">{tm('none')}</span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Groupes */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4" /> {tm('groups')}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {data.groups.length ? (
                  <ul className="flex flex-col divide-y">
                    {data.groups.map((g) => (
                      <li key={g.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                        <span className="flex items-center gap-2 font-medium">
                          <span className="size-2.5 rounded-full bg-primary" style={g.color ? { backgroundColor: g.color } : undefined} />
                          {g.name}
                        </span>
                        {g.description && <span className="text-xs text-muted-foreground">{g.description}</span>}
                        {g.departments.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {g.departments.map((d) => <Badge key={d.id} variant="outline" className="text-[11px]">{deptName(d)}</Badge>)}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">{tm('noGroups')}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Permissions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4" /> {tm('permissions')}
              </CardTitle>
              <CardDescription>{tm('permissionsCount', { count: data.permissions.length, role: data.role.name })}</CardDescription>
            </CardHeader>
            <CardContent>
              {resources.length ? (
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
                  {resources.map(([res, actions]) => (
                    <div key={res} className="flex min-w-0 flex-wrap items-center gap-1 border-b py-1.5">
                      <span className="mr-1 min-w-0 truncate text-xs font-medium" title={res}>{label(`resources.${res}`, res)}</span>
                      {[...actions]
                        .sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b))
                        .map((a) => (
                          <Badge key={a} variant={a === 'read' ? 'outline' : 'secondary'} className="text-[10px]">
                            {label(`roles.actions.${a}`, a)}
                          </Badge>
                        ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{tm('noPermissions')}</p>
              )}
            </CardContent>
          </Card>

          {/* Visibilité par registre */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <EyeOff className="size-4" /> {tm('visibility')}
              </CardTitle>
              <CardDescription>{tm('visibilityDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tm('register')}</TableHead>
                      <TableHead className="w-44">{tm('mode')}</TableHead>
                      <TableHead className="w-24">{tm('restricted')}</TableHead>
                      <TableHead className="w-64">{tm('visible')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.registers.map((r) => {
                      const pct = r.totalCount ? Math.round((r.visibleCount / r.totalCount) * 100) : 100;
                      return (
                        <TableRow key={r.model} className={cn(!r.canRead && 'text-muted-foreground')}>
                          <TableCell>
                            <div className={cn('flex flex-col', r.parent && 'pl-4')}>
                              <span className="text-sm font-medium">
                                {label(`visibility.registers.${r.model}`, r.model)}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {label(`visibility.groups.${r.group}`, r.group)}
                                {!r.canRead && (
                                  <span className="ml-2 inline-flex items-center gap-1 text-warning-foreground dark:text-warning">
                                    <Lock className="size-3" /> {tm('noRead')}
                                  </span>
                                )}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{label(`visibility.modes.${r.mode}`, r.mode)}</TableCell>
                          <TableCell>
                            {r.restricted ? (
                              <Badge variant="outline" className="border-warning/50 text-warning-foreground dark:text-warning">{tm('restrictedYes')}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">{tm('restrictedNo')}</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn('h-full rounded-full', r.canRead ? 'bg-primary' : 'bg-muted-foreground/40')}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="w-20 text-right text-xs tabular-nums">
                                {r.visibleCount} / {r.totalCount}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </DetailPage>
  );
}
