export type Lens = 'department' | 'manager' | 'topic' | 'location';

export interface GNode {
  ref: string;
  id: string;
  name: string;
  title: string | null;
  department: string;
  team: string;
  level: string;
  managerRef: string | null;
  hireDate: string | null;
  exitDate: string | null;
  location: string;
  contract: string | null;
  isHr: boolean;
  topic: string;
  topics: { concept: string; label: string; weight: number }[];
  activity: number;
  hrCount: number;
  bridge: number;
  bridgeDepts: string[];
  // force-graph runtime fields
  x?: number;
  y?: number;
  z?: number;
}

export interface GEdge {
  source: string | GNode;
  target: string | GNode;
  weight: number;
  months: Record<string, number>;
  topic: string;
  hr: boolean;
  tree?: boolean;
}

export interface GalaxyData {
  departments: { name: string; color: string }[];
  concepts: { key: string; label: string }[];
  months: string[];
  nodes: GNode[];
  edges: GEdge[];
  me: string | null;
  role: string;
}

export interface Reason {
  concept: string;
  label: string;
  contribution: number;
}

export interface AskResult {
  answer: string;
  citations: { id: string; date: string; subject: string; from: string; fromName?: string }[];
  policies: string[];
  employees: { ref: string; name: string; department: string; title: string | null; relevance: number; reasons: Reason[]; explainedBy: string; evidence: string[] }[];
  highlight: string[];
  queryConcepts: { concept: string; label: string; weight: number }[];
  flaggedWithheld: number;
  scope: string;
}

export interface Signal {
  id: string;
  kind: string;
  severity: 'info' | 'attention' | 'important';
  title: string;
  reason: string;
  refs: string[];
  evidence: string[];
}

export interface Bridge {
  ref: string;
  name: string;
  department: string;
  title: string | null;
  score: number;
  connects: string[];
}

export interface TimelineMail {
  id: string;
  thread: string;
  date: string;
  kind: string;
  hr: boolean;
  subject: string;
  from: string;
  fromName: string;
  toNames: string[];
  topics: { concept: string; label: string; weight: number }[];
  sentiment: number;
  flagged: string | null;
  body: string | null;
}

export interface EmployeeDetail {
  id: string;
  ref: string;
  name: string;
  email: string | null;
  title: string | null;
  department: string;
  team: string;
  level: string;
  hireDate: string | null;
  exitDate: string | null;
  trialEndDate: string | null;
  contract: string | null;
  active: boolean;
  location: string;
  skills: string[];
  leave: { annual: number; taken: number; remaining: number };
  sickDays: number;
  manager: { ref: string; name: string } | null;
  reports: { ref: string; name: string }[];
  topics: { concept: string; label: string; weight: number }[];
  bridge: number;
  bridgeDepts: string[];
  neighbors: { ref: string; name?: string; department?: string; weight: number; topic: string; hr: boolean }[];
  timeline: TimelineMail[];
  signals: Omit<Signal, 'refs'>[];
  canReadMail: boolean;
}

export interface HrAction {
  id: string;
  ref: string;
  replyTo?: string;
  intent: string;
  subject: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

/** Topic hues for beams and the topic lens. */
export const TOPIC_COLOR: Record<string, string> = {
  leave: '#7dd3fc', sick_leave: '#93c5fd', parental_leave: '#c4b5fd', payroll: '#fcd34d', compensation: '#fbbf24', benefits: '#fde68a',
  remote_work: '#5eead4', relocation: '#2dd4bf', onboarding: '#86efac', training: '#4ade80', career_growth: '#a3e635', performance_review: '#d9f99d',
  conflict: '#f87171', workload: '#fb7185', wellbeing: '#f9a8d4', resignation: '#ef4444', equipment: '#cbd5e1', it_access: '#94a3b8',
  expenses: '#fdba74', travel: '#fb923c', policy_question: '#e2e8f0', project_collab: '#818cf8', recognition: '#f0abfc', mentoring: '#c084fc',
  referral: '#a78bfa', schedule_change: '#67e8f9', overtime: '#fda4af', contract: '#bef264', team_event: '#f5d0fe', feedback: '#a5b4fc',
  security_incident: '#dc2626', offboarding: '#fca5a5',
};
