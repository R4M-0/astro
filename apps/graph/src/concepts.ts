// Interpretable concept taxonomy. Dimension i of every "concept" vector = CONCEPTS[i],
// so XQdrant's dims_explained maps straight back to a human-readable reason.
// Deliberately excludes sensitive inferences (health conditions, religion, politics...).
export const CONCEPTS = [
  "leave", "sick_leave", "parental_leave", "payroll", "compensation", "benefits",
  "remote_work", "relocation", "onboarding", "training", "career_growth", "performance_review",
  "conflict", "workload", "wellbeing", "resignation", "equipment", "it_access",
  "expenses", "travel", "policy_question", "project_collab", "recognition", "mentoring",
  "referral", "schedule_change", "overtime", "contract", "team_event", "feedback",
  "security_incident", "offboarding",
] as const;
export type Concept = (typeof CONCEPTS)[number];

export const CONCEPT_LABEL: Record<Concept, string> = {
  leave: "Leave", sick_leave: "Sick leave", parental_leave: "Parental leave", payroll: "Payroll",
  compensation: "Compensation", benefits: "Benefits", remote_work: "Remote work", relocation: "Relocation",
  onboarding: "Onboarding", training: "Training", career_growth: "Career growth", performance_review: "Performance review",
  conflict: "Conflict", workload: "Workload", wellbeing: "Wellbeing", resignation: "Resignation",
  equipment: "Equipment", it_access: "IT access", expenses: "Expenses", travel: "Travel",
  policy_question: "Policy question", project_collab: "Project collaboration", recognition: "Recognition", mentoring: "Mentoring",
  referral: "Referral", schedule_change: "Schedule change", overtime: "Overtime", contract: "Contract",
  team_event: "Team event", feedback: "Feedback", security_incident: "Security incident", offboarding: "Offboarding",
};

export function conceptVector(topics: Partial<Record<Concept, number>>): number[] {
  return CONCEPTS.map(c => topics[c] ?? 0);
}
