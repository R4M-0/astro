'use client';

import { createContext, useContext } from 'react';

/**
 * The survey engine (builder, share link, results) reads its register's API base, routes and RBAC
 * resource from this context (RH → Enquêtes by default).
 */
export interface SurveyScopeConfig {
  scope: 'HR';
  /** API base, e.g. `/hr/surveys` */
  api: string;
  /** web route of a survey detail page */
  route: (id: string) => string;
  /** where the detail page's back link goes */
  listHref: string;
  /** React Query key prefix */
  queryKey: readonly string[];
  perms: { create: string; update: string; delete: string };
  /** entity type for history / linked actions (registry slug) */
  entityType: string;
}

export const HR_SURVEY_SCOPE: SurveyScopeConfig = {
  scope: 'HR',
  api: '/hr/surveys',
  route: (id) => `/hr/surveys/${id}`,
  listHref: '/hr/surveys',
  queryKey: ['hr', 'surveys'],
  perms: { create: 'hr-surveys:create', update: 'hr-surveys:update', delete: 'hr-surveys:delete' },
  entityType: 'hr-survey',
};

const SurveyScopeContext = createContext<SurveyScopeConfig>(HR_SURVEY_SCOPE);

export const SurveyScopeProvider = SurveyScopeContext.Provider;

export function useSurveyScope() {
  return useContext(SurveyScopeContext);
}
