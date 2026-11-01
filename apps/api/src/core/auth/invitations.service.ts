import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { escapeHtml } from '../../common/html';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const SET_PASSWORD_TTL_MS = 72 * 3600 * 1000;
const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * How an invited address is attached to an organization (H-1):
 *  - `new`        no account yet → created with an unusable password, the invitee sets one via a link;
 *  - `unverified` self-registered account that never proved control of the mailbox → its password is
 *                 reset and its sessions revoked (whoever registered it loses access), then same link;
 *  - `verified`   genuine existing account → must explicitly accept the invitation.
 * In every case the membership stays pending (`acceptedAt = null`, no access) until the link is used.
 */
export type InviteeKind = 'new' | 'unverified' | 'verified';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /** Finds or creates the invitee's account, neutralising unverified pre-registrations. */
  async prepareInvitee(input: { email: string; firstName: string; lastName: string }): Promise<{ user: User; kind: InviteeKind }> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!existing) {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash: await this.unusableHash(),
        },
      });
      return { user, kind: 'new' };
    }
    if (existing.deletedAt) throw new BadRequestException('This account is closed');
    if (existing.emailVerifiedAt) return { user: existing, kind: 'verified' };
    const user = await this.prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: await this.unusableHash(), twoFactorEnabled: false, twoFactorSecret: null, recoveryCodes: [] },
    });
    await this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    this.gateway.disconnectUser(user.id);
    return { user, kind: 'unverified' };
  }

  /**
   * Mails the invitation link for a pending membership: a set-password link (72 h) when the invitee
   * has no usable password, an accept link (7 days) for a verified account. Never mails a password.
   */
  async sendInvitation(membershipId: string, kind: InviteeKind) {
    const m = await this.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: { user: true, organization: { select: { name: true } } },
    });
    const token = randomBytes(32).toString('base64url');
    const accept = kind === 'verified';
    await this.prisma.verificationToken.create({
      data: {
        userId: m.userId,
        membershipId: m.id,
        type: accept ? 'INVITATION' : 'PASSWORD_RESET',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + (accept ? INVITATION_TTL_MS : SET_PASSWORD_TTL_MS)),
      },
    });
    const appUrl = this.config.get('APP_URL');
    const url = accept ? `${appUrl}/accept-invitation?token=${token}` : `${appUrl}/reset-password?token=${token}`;
    const org = escapeHtml(m.organization.name);
    const href = escapeHtml(url);
    await this.mail.send({
      to: m.user.email,
      subject: `Invitation — ${m.organization.name} on Astro`,
      html: accept
        ? `<p>You've been invited to join <b>${org}</b> on Astro.</p>
           <p><a href="${href}">Accept the invitation</a> (link valid for 7 days).</p>
           <hr/>
           <p>Vous avez été invité(e) à rejoindre <b>${org}</b> sur Astro.</p>
           <p><a href="${href}">Accepter l'invitation</a> (lien valable 7 jours).</p>
           <p>If you did not expect this, ignore this email. / Si vous n'attendiez pas cette invitation, ignorez cet e-mail.</p>`
        : `<p>You've been invited to join <b>${org}</b> on Astro.</p>
           <p><a href="${href}">Choose your password</a> to access it (link valid for 72 hours).</p>
           <hr/>
           <p>Vous avez été invité(e) à rejoindre <b>${org}</b> sur Astro.</p>
           <p><a href="${href}">Choisissez votre mot de passe</a> pour y accéder (lien valable 72 heures).</p>`,
    });
  }

  /** Re-sends the right link for a membership (pending or not): set-password unless the account is verified & usable. */
  async resend(membershipId: string) {
    const m = await this.prisma.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { user: true } });
    await this.sendInvitation(m.id, m.user.emailVerifiedAt ? 'verified' : 'new');
  }

  /** `POST /auth/invitations/accept` — consumes an INVITATION token. */
  async accept(token: string) {
    const record = await this.prisma.verificationToken.findFirst({
      where: { tokenHash: sha256(token), type: 'INVITATION', usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!record?.membershipId) throw new BadRequestException('Invalid or expired invitation link');
    await this.prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    const membership = await this.activateMembership(record.membershipId, record.userId);
    return { accepted: true, organizationId: membership.organizationId };
  }

  /**
   * Marks a pending membership as accepted (the token proved control of the mailbox, so the
   * address is verified too). Becomes the default org only if the user has none.
   */
  async activateMembership(membershipId: string, userId: string) {
    const m = await this.prisma.membership.findFirst({ where: { id: membershipId, userId, deletedAt: null } });
    if (!m) throw new ForbiddenException('This invitation has been withdrawn');
    const hasDefault = await this.prisma.membership.count({
      where: { userId, deletedAt: null, isDefault: true, acceptedAt: { not: null }, id: { not: m.id } },
    });
    const now = new Date();
    const [membership] = await this.prisma.$transaction([
      this.prisma.membership.update({
        where: { id: m.id },
        data: { acceptedAt: m.acceptedAt ?? now, ...(hasDefault ? {} : { isDefault: true }) },
      }),
      this.prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } }),
    ]);
    return membership;
  }

  private async unusableHash() {
    return argon2.hash(randomBytes(32).toString('base64url'));
  }
}
