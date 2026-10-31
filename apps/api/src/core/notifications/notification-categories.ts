/** Families shown as filters on the notifications page — derived from the notification type. */
export const NOTIFICATION_CATEGORIES = ['people', 'trainings', 'surveys', 'system', 'other'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

const EXACT: Record<string, NotificationCategory> = {
  hr_training_assigned: 'trainings',
  competency_expiring: 'people',
  onboarding_assigned: 'people',
  trial_period_due: 'people',
  handover_received: 'people',
  mention: 'people',
  record_shared: 'people',
  entity_deleted: 'system',
  entity_restored: 'system',
  license_expiring: 'system',
  generic: 'system',
};

const PREFIX: [string, NotificationCategory][] = [
  ['training_', 'trainings'],
  ['survey_', 'surveys'],
];

export function notificationCategory(type: string): NotificationCategory {
  if (EXACT[type]) return EXACT[type];
  return PREFIX.find(([p]) => type.startsWith(p))?.[1] ?? 'other';
}
