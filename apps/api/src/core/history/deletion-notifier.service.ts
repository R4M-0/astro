import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { DeleteEvent } from './history-context';
import { MODEL_RESOURCE } from './history-map';

const ADMIN_ROLE_KEYS = ['hr_manager', 'org_admin'];

/** Humanised French labels for the common models; fallback = the model name. */
const ENTITY_LABEL_FR: Record<string, [string, string]> = {
  Employee: ['collaborateur', 'collaborateurs'],
  EmployeeJourney: ['parcours', 'parcours'],
  JobDescription: ['fiche de poste', 'fiches de poste'],
  Skill: ['compétence', 'compétences'],
  HrTraining: ['formation', 'formations'],
  HrSurvey: ['enquête', 'enquêtes'],
  CompetencyEvaluation: ['évaluation de compétence', 'évaluations de compétence'],
  Department: ['service', 'services'],
  Site: ['site', 'sites'],
};

function labelFor(model: string, count: number): string {
  const pair = ENTITY_LABEL_FR[model];
  const noun = pair ? (count > 1 ? pair[1] : pair[0]) : model;
  return `${count} ${noun}`;
}

@Injectable()
export class DeletionNotifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async flush(events: DeleteEvent[], actorId: string | null) {
    const byOrg = new Map<string, DeleteEvent[]>();
    for (const e of events) {
      if (!e.organizationId) continue;
      byOrg.set(e.organizationId, [...(byOrg.get(e.organizationId) ?? []), e]);
    }
    for (const [orgId, evs] of byOrg) {
      await this.notifyOrg(orgId, evs, actorId).catch(() => undefined);
    }
  }

  private async adminIds(orgId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        deletedAt: null,
        role: { key: { in: ADMIN_ROLE_KEYS } },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  private async readersOf(orgId: string, resource: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        deletedAt: null,
        role: { permissions: { some: { permission: { resource, action: 'read' } } } },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  private async notifyOrg(orgId: string, events: DeleteEvent[], actorId: string | null) {
    const admins = await this.adminIds(orgId);
    const actorIsAdmin = actorId ? admins.includes(actorId) : false;

    const counts: Record<string, number> = {};
    for (const e of events) counts[e.entityType] = (counts[e.entityType] ?? 0) + 1;
    const types = Object.keys(counts);
    if (!types.length) return;

    // recipient → set of entity types they should be told about
    const recipients = new Map<string, Set<string>>();
    const add = (uid: string, type: string) => {
      if (uid === actorId) return;
      recipients.set(uid, (recipients.get(uid) ?? new Set()).add(type));
    };

    if (!actorIsAdmin) {
      // anything deleted by a non-admin → the admins are notified
      for (const uid of admins) for (const t of types) add(uid, t);
    } else {
      // an admin deleted → everyone with read access to that resource is notified
      for (const type of types) {
        const resource = MODEL_RESOURCE[type];
        const readers = resource ? await this.readersOf(orgId, resource) : admins;
        for (const uid of readers) add(uid, type);
      }
    }
    if (!recipients.size) return;

    const actor = actorId
      ? await this.prisma.user.findUnique({
          where: { id: actorId },
          select: { firstName: true, lastName: true },
        })
      : null;
    const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : 'Le système';
    const title = actorIsAdmin ? 'Élément(s) supprimé(s)' : 'Suppression à vérifier';

    for (const [uid, typeSet] of recipients) {
      const summary = [...typeSet].map((t) => labelFor(t, counts[t])).join(', ');
      const body = actorIsAdmin
        ? `${actorName} (administrateur) a supprimé ${summary}.`
        : `${actorName} a supprimé ${summary}.`;
      await this.notifications
        .notify({
          organizationId: orgId,
          userIds: [uid],
          type: 'entity_deleted',
          title,
          body,
          link: '/admin',
        })
        .catch(() => undefined);
    }
  }
}
