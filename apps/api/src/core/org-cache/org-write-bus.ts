/**
 * Reports which organization a write touched, so per-org read caches (dashboard
 * aggregates) can be dropped. Fed by the Prisma extension for every write.
 */

/** Writes that never affect cached org aggregates (auth, logs, chat, notifications). */
export const ORG_CACHE_IGNORED_MODELS = new Set([
  'Session',
  'VerificationToken',
  'Notification',
  'AuditLogEntry',
  'HistoryEntry',
  'PlatformAuditLog',
  'Conversation',
  'ConversationMember',
  'Message',
  'MessageEntityRef',
  'AiConversation',
  'AiMessage',
]);

/** `null` = the organization could not be determined → drop every org's entries. */
type Listener = (orgId: string | null) => void;
const listeners = new Set<Listener>();

export function onOrgWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitOrgWrite(orgId: string | null) {
  for (const listener of listeners) {
    try {
      listener(orgId);
    } catch {
      // cache invalidation must never fail a write
    }
  }
}
