/**
 * Models that are never recorded to history and never raise delete
 * notifications — logs, auth churn, chat, join tables and high-frequency feeds.
 */
export const HISTORY_SKIP_MODELS = new Set<string>([
  'HistoryEntry',
  // User is not tenant-scoped and carries credentials (passwordHash, TOTP secret,
  // recovery codes) — it must never be diffed into an org-readable history.
  'User',
  'AuditLogEntry',
  'ActivityEntry',
  'Notification',
  'Session',
  'VerificationToken',
  'RolePermission',
  'Permission',
  'ReadReceipt',
  'PlatformAuditLog',
  // licensing: the install clock ticks every few minutes; issued tokens are SaaS staff data
  'InstallState',
  'IssuedLicense',
  'AiConversation',
  'AiMessage',
  'Conversation',
  'ConversationMember',
  'Message',
  'MessageEntityRef',
  'KpiDatapoint',
  'Clause',
  // survey answers: high-volume public submissions (respondent anonymity)
  'HrSurveyResponse',
  'HrSurveyAnswer',
  // éco-carte layout versions are themselves the map's history
  'EnvMapRevision',
  // immutable snapshots — the revision list is its own history
  'DocumentRevision',
]);

/** Scalar fields never worth diffing. */
export const HISTORY_IGNORE_FIELDS = new Set<string>(['updatedAt', 'createdAt']);

/**
 * Secret-bearing fields stripped from every history diff/snapshot, whatever the
 * model (defense in depth on top of HISTORY_SKIP_MODELS).
 */
export const HISTORY_REDACT_FIELDS = new Set<string>([
  'passwordHash',
  'twoFactorSecret',
  'recoveryCodes',
  'refreshTokenHash',
  'tokenHash',
  'publicToken',
  'hotToken',
  'coldToken',
  'apiKey',
  'secret',
]);

/**
 * Prisma model name → RBAC resource, used to resolve "everyone with read
 * access" when an admin deletes a record. Child rows map to their parent's
 * resource. Unmapped models fall back to notifying the org admins only.
 */
export const MODEL_RESOURCE: Record<string, string> = {
  CompetencyEvaluation: 'competency-evaluations',
  EmployeeJourney: 'employees',
  EmployeeJourneyItem: 'employees',
  OnboardingTemplateItem: 'job-descriptions',
  Department: 'organization',
  Employee: 'employees',
  HrTraining: 'hr-trainings',
  HrSurvey: 'hr-surveys',
  HrSurveyQuestion: 'hr-surveys',
  HrSurveyOption: 'hr-surveys',
  JobActivity: 'job-descriptions',
  JobAssignment: 'job-descriptions',
  JobDescription: 'job-descriptions',
  JobSkillRequirement: 'job-descriptions',
  Membership: 'users',
  Organization: 'organization',
  Role: 'roles',
  Site: 'organization',
  Skill: 'skills',
  TrainingFeedback: 'hr-trainings',
  TrainingParticipant: 'hr-trainings',
  User: 'users',
};
