import type { RetentionCategory } from '@prisma/client';

/**
 * Record of processing activities (GDPR Art. 30) for what Astro itself does with personal data.
 * The organization is the controller; the text is a starting point its DPO completes. Retention
 * links to the live RetentionPolicy when one governs the activity.
 */
export interface ProcessingActivity {
  key: string;
  name: { fr: string; en: string };
  purpose: { fr: string; en: string };
  legalBasis: { fr: string; en: string };
  subjects: { fr: string; en: string };
  dataCategories: { fr: string; en: string };
  recipients: { fr: string; en: string };
  retention: { fr: string; en: string };
  retentionPolicy?: RetentionCategory;
  /** automated processing / AI involvement and its safeguard */
  ai: { fr: string; en: string } | null;
  /** register / module in Astro */
  module: string;
}

const t = (fr: string, en: string) => ({ fr, en });

export const PROCESSING_ACTIVITIES: ProcessingActivity[] = [
  {
    key: 'personnel-administration',
    name: t('Gestion administrative du personnel', 'Personnel administration'),
    purpose: t('Tenir le registre du personnel, l’organigramme, les contrats et les départs.', 'Keep the staff register, org chart, contracts and departures.'),
    legalBasis: t('Exécution du contrat de travail (art. 6(1)(b)) et obligation légale (art. 6(1)(c)).', 'Performance of the employment contract (Art. 6(1)(b)) and legal obligation (Art. 6(1)(c)).'),
    subjects: t('Salariés, intérimaires, anciens salariés', 'Employees, temporary staff, former employees'),
    dataCategories: t('Identité, coordonnées, n° CIN, poste, service, manager, dates d’embauche / de sortie, type de contrat, motif de sortie', 'Identity, contact details, national ID number, job, department, manager, hire / exit dates, contract type, exit reason'),
    recipients: t('RH, managers de leur service (visibilité par service), administrateurs', 'HR, managers of their department (department-scoped), administrators'),
    retention: t('Pendant le contrat, puis 5 ans après la sortie, puis anonymisation.', 'During the contract, then 5 years after exit, then anonymization.'),
    retentionPolicy: 'FORMER_EMPLOYEE',
    ai: null,
    module: '/hr/employees',
  },
  {
    key: 'competencies',
    name: t('Gestion des compétences', 'Competency management'),
    purpose: t('Évaluer les compétences au regard des fiches de poste, piloter la polyvalence (ISO 9001 § 7.2).', 'Assess competencies against job descriptions, manage cross-skilling (ISO 9001 § 7.2).'),
    legalBasis: t('Intérêt légitime de l’employeur (art. 6(1)(f)) et exigence de certification.', 'Legitimate interest of the employer (Art. 6(1)(f)) and certification requirement.'),
    subjects: t('Salariés', 'Employees'),
    dataCategories: t('Niveaux attendus / évalués, écarts, méthode d’évaluation, évaluateur', 'Expected / assessed levels, gaps, assessment method, assessor'),
    recipients: t('RH, managers du service', 'HR, department managers'),
    retention: t('Suit le dossier du collaborateur (niveaux conservés après anonymisation, sans identité).', 'Follows the employee file (levels kept after anonymization, without identity).'),
    retentionPolicy: 'FORMER_EMPLOYEE',
    ai: null,
    module: '/hr/competency-evaluation',
  },
  {
    key: 'training',
    name: t('Plan de formation', 'Training plan'),
    purpose: t('Planifier les formations, suivre la présence et l’efficacité (évaluations à chaud / à froid).', 'Plan training, track attendance and effectiveness (hot / cold evaluations).'),
    legalBasis: t('Obligation légale de formation (art. 6(1)(c)), intérêt légitime.', 'Legal training obligation (Art. 6(1)(c)), legitimate interest.'),
    subjects: t('Salariés, formateurs', 'Employees, trainers'),
    dataCategories: t('Participations, présence, évaluations de satisfaction', 'Attendance, presence, satisfaction ratings'),
    recipients: t('RH, managers du service', 'HR, department managers'),
    retention: t('Suit le dossier du collaborateur.', 'Follows the employee file.'),
    retentionPolicy: 'FORMER_EMPLOYEE',
    ai: null,
    module: '/hr/trainings',
  },
  {
    key: 'journeys',
    name: t('Intégration et départ', 'Onboarding and offboarding'),
    purpose: t('Accompagner l’arrivée (période d’essai signée) et le départ (passation, désactivation du compte).', 'Support arrival (signed trial period) and departure (handover, account deactivation).'),
    legalBasis: t('Exécution du contrat de travail (art. 6(1)(b)).', 'Performance of the employment contract (Art. 6(1)(b)).'),
    subjects: t('Nouveaux arrivants, partants', 'New hires, leavers'),
    dataCategories: t('Étapes, décision de fin de période d’essai, signature électronique, commentaires', 'Steps, trial-period decision, e-signature, comments'),
    recipients: t('RH, responsable du parcours, binôme', 'HR, plan owner, buddy'),
    retention: t('Suit le dossier du collaborateur.', 'Follows the employee file.'),
    retentionPolicy: 'FORMER_EMPLOYEE',
    ai: null,
    module: '/hr/journeys',
  },
  {
    key: 'surveys',
    name: t('Enquêtes collaborateurs', 'Employee surveys'),
    purpose: t('Mesurer le climat social et la satisfaction.', 'Measure workplace climate and satisfaction.'),
    legalBasis: t('Intérêt légitime (art. 6(1)(f)); anonymes par défaut.', 'Legitimate interest (Art. 6(1)(f)); anonymous by default.'),
    subjects: t('Salariés répondants', 'Responding employees'),
    dataCategories: t('Réponses ; nom / e-mail seulement pour les enquêtes nominatives', 'Answers; name / e-mail only for named surveys'),
    recipients: t('RH', 'HR'),
    retention: t('Identité effacée après 2 ans, réponses conservées pour les statistiques.', 'Identity erased after 2 years, answers kept for statistics.'),
    retentionPolicy: 'SURVEY_IDENTITY',
    ai: null,
    module: '/hr/surveys',
  },
  {
    key: 'recruiting',
    name: t('Recrutement assisté par IA', 'AI-assisted recruiting'),
    purpose: t('Recevoir les CV, les classer par preuves, planifier les entretiens.', 'Receive CVs, rank them by evidence, schedule interviews.'),
    legalBasis: t('Mesures précontractuelles à la demande du candidat (art. 6(1)(b)).', 'Pre-contractual steps at the candidate’s request (Art. 6(1)(b)).'),
    subjects: t('Candidats', 'Candidates'),
    dataCategories: t('CV (texte expurgé), profil extrait, scores par critère avec citation, messages, créneau', 'CV (redacted text), extracted profile, per-criterion scores with quotes, messages, slot'),
    recipients: t('RH recruteurs ; sous-traitants IA (Anthropic, OpenAI) sans conservation', 'HR recruiters; AI processors (Anthropic, OpenAI) without retention'),
    retention: t('2 ans après la dernière mise à jour pour les candidats non retenus, puis anonymisation (CV, vecteur, texte).', '2 years after the last update for candidates not hired, then anonymization (CV, vector, text).'),
    retentionPolicy: 'CANDIDATE_NOT_HIRED',
    ai: t(
      'Système à haut risque (AI Act, annexe III). Attributs protégés retirés avant tout modèle, chaque score cite le CV, aucune décision ni envoi sans validation RH.',
      'High-risk system (AI Act, Annex III). Protected attributes removed before any model, every score quotes the CV, no decision or send without HR approval.',
    ),
    module: '/recruiting',
  },
  {
    key: 'workforce-galaxy',
    name: t('Galaxie RH (analyse de la messagerie)', 'Workforce Galaxy (mail analysis)'),
    purpose: t('Détecter des signaux collectifs (charge, demandes sans réponse) et répondre aux questions RH avec citations.', 'Detect collective signals (workload, unanswered requests) and answer HR questions with citations.'),
    legalBasis: t('Intérêt légitime (art. 6(1)(f)) après analyse d’impact (AIPD) et information des salariés.', 'Legitimate interest (Art. 6(1)(f)) after a DPIA and employee notice.'),
    subjects: t('Salariés (expéditeurs / destinataires)', 'Employees (senders / recipients)'),
    dataCategories: t('Métadonnées et contenu des e-mails professionnels, thèmes RH (aucune catégorie sensible)', 'Work e-mail metadata and content, HR topics (no sensitive category)'),
    recipients: t('RH (contenu), managers (objets de leur service), salarié (son propre dossier) ; Google AI Studio', 'HR (content), managers (subjects in their department), employee (own file); Google AI Studio'),
    retention: t('12 mois glissants.', 'Rolling 12 months.'),
    ai: t('Pas de score individuel ; tout signal porte sa raison ; aucune action sans validation RH.', 'No individual scoring; every signal carries its reason; no action without HR approval.'),
    module: '/hr/galaxy',
  },
  {
    key: 'accounts',
    name: t('Comptes et sécurité', 'Accounts and security'),
    purpose: t('Authentifier les membres, gérer les rôles, protéger l’accès (2FA).', 'Authenticate members, manage roles, protect access (2FA).'),
    legalBasis: t('Intérêt légitime (sécurité, art. 32).', 'Legitimate interest (security, Art. 32).'),
    subjects: t('Utilisateurs de l’application', 'Application users'),
    dataCategories: t('Nom, e-mail, rôle, sessions, adresse IP, appareil', 'Name, e-mail, role, sessions, IP address, device'),
    recipients: t('Administrateurs de l’organisation', 'Organization administrators'),
    retention: t('Durée de l’adhésion ; sessions expirées purgées.', 'Duration of membership; expired sessions purged.'),
    ai: null,
    module: '/admin',
  },
  {
    key: 'audit-trail',
    name: t('Journal d’audit et traçabilité', 'Audit trail and traceability'),
    purpose: t('Prouver qui a consulté, modifié, exporté ou effacé quoi (responsabilité, art. 5(2)).', 'Prove who viewed, changed, exported or erased what (accountability, Art. 5(2)).'),
    legalBasis: t('Obligation légale (art. 5(2), 32) et intérêt légitime.', 'Legal obligation (Art. 5(2), 32) and legitimate interest.'),
    subjects: t('Utilisateurs ; personnes concernées par les enregistrements', 'Users; people the records are about'),
    dataCategories: t('Acteur, action, enregistrement, IP, appareil, contenu de la requête (masqué / effaçable)', 'Actor, action, record, IP, device, request body (masked / erasable)'),
    recipients: t('Administrateurs, RH, auditeurs (export scellé)', 'Administrators, HR, auditors (sealed export)'),
    retention: t('6 ans, puis purge derrière un sceau d’ancrage.', '6 years, then purge behind an anchor seal.'),
    retentionPolicy: 'AUDIT_LOG',
    ai: null,
    module: '/admin?tab=audit',
  },
];
