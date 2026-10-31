import { LEGAL_ROUTES, type LegalDoc, type LegalDocKey, type LegalIdentity } from './company';

const r = LEGAL_ROUTES;

export function subprocessorsEn(L: LegalIdentity): string[][] {
  return [
    [L.host, 'Hosting of the application, databases, files and backups', L.hostLocation, 'Service data (all categories)'],
    [L.mailProvider, 'Delivery of transactional e-mails (verification, invitations, notifications)', L.mailProviderLocation, 'Name, e-mail address, e-mail content'],
    ['Anthropic, PBC', 'AI copilot, only when a user calls an AI feature', 'United States (standard contractual clauses)', 'Text of the request and the record excerpts needed to answer it'],
  ];
}

export function legalEn(L: LegalIdentity): Record<LegalDocKey, LegalDoc> {
  const sub = { head: ['Sub-processor', 'Purpose', 'Location', 'Data concerned'], rows: subprocessorsEn(L) };
  const editor = `${L.entity}, ${L.legalForm} with a share capital of ${L.capital}, registered under number ${L.registration}, whose registered office is at ${L.address}`;

  return {
    notice: {
      title: 'Legal notice',
      intro: `Information about the publisher of the website ${L.site} and of the ${L.brand} service.`,
      sections: [
        {
          id: 'publisher',
          title: 'Publisher',
          blocks: [
            `The ${L.brand} website and service are published by ${editor}.`,
            { list: [`VAT number: ${L.vatId}`, `Phone: ${L.phone}`, `E-mail: ${L.email}`, `Publication director: ${L.director}`] },
          ],
        },
        {
          id: 'host',
          title: 'Hosting',
          blocks: [`The service is hosted by ${L.host}, ${L.hostAddress}. Production data is stored in ${L.hostLocation}.`],
        },
        {
          id: 'ip',
          title: 'Intellectual property',
          blocks: [
            `All elements of the website and of the ${L.brand} software (texts, interfaces, graphics, logos, code, databases) are protected by intellectual property law and belong to ${L.entity} or are used under license. Any reproduction, representation or adaptation, in whole or in part, without prior written permission is prohibited.`,
            'ISO 9001, ISO 14001, ISO 45001 and ISO 22000 are standards published by the International Organization for Standardization (ISO). Astro is not affiliated with ISO or with any certification body; using the software does not constitute certification.',
          ],
        },
        {
          id: 'data',
          title: 'Personal data and cookies',
          blocks: [`How we process personal data is described in the [privacy policy](${r.privacy}). The cookies we use are described in the [cookie policy](${r.cookies}).`],
        },
        {
          id: 'contact',
          title: 'Contact',
          blocks: [`For any question, write to ${L.email} or use the [contact form](/contact).`],
        },
      ],
    },

    privacy: {
      title: 'Privacy policy',
      intro: `This policy explains how ${L.entity} (“we”) processes personal data when you visit ${L.site}, create an account or use ${L.brand}, in accordance with Regulation (EU) 2016/679 (GDPR) and applicable data protection laws.`,
      sections: [
        {
          id: 'roles',
          title: '1. Who is responsible for your data?',
          blocks: [
            `**Controller.** ${L.entity} is the controller for processing related to the website, account creation and management, the commercial relationship, billing, security and support.`,
            `**Processor.** For the data our customers record in ${L.brand} (employees, suppliers, nonconformities, complaints, documents…), the customer is the controller and we act as a processor, on its instructions and under the [data processing agreement](${r.dpa}). If you are a data subject of such data, please first contact the organisation that uses ${L.brand}.`,
            `Data protection contact: ${L.privacyEmail} — ${L.address}.`,
          ],
        },
        {
          id: 'data',
          title: '2. What data do we process, why, and on what basis?',
          blocks: [
            {
              table: {
                head: ['Purpose', 'Data', 'Legal basis', 'Retention'],
                rows: [
                  ['Creating and managing your account, authentication', 'First and last name, e-mail, password (hashed), organisation, language, 2FA secret (encrypted), date terms were accepted', 'Performance of the contract', 'Lifetime of the account, then deleted within 30 days of closure (except backups, see § 5)'],
                  ['Providing the service and support', 'Data entered in the application, exchanges with support', 'Performance of the contract', 'Subscription term + 30 days so you can export your data'],
                  ['Security, fraud and abuse prevention', 'IP address, browser, timestamps, sessions, sign-in attempts, audit log', 'Legitimate interest (securing the service)', '12 rolling months for technical logs; audit log for the lifetime of the account'],
                  ['Answering contact and demo requests', 'Name, e-mail, organisation, message', 'Legitimate interest (answering your request) or pre-contractual steps', '3 years from the last contact'],
                  ['Billing and accounting obligations', 'Customer identity, billing details, invoices', 'Legal obligation', 'Statutory retention period for accounting records (10 years in France)'],
                  ['Service e-mails (verification, invitations, reminders)', 'E-mail, name, notification content', 'Performance of the contract', 'Time of delivery; notification preferences for the lifetime of the account'],
                  ['AI copilot (on your request only)', 'Your question and the record excerpts needed', 'Performance of the contract', 'Not kept by us beyond the conversation history, which you can delete'],
                ],
              },
            },
            'Fields marked as required in our forms are needed to create your account or handle your request; without them we cannot proceed.',
            'We do not sell your data, do not use it for advertising and do not take decisions based solely on automated processing that produce legal effects concerning you. The AI copilot’s proposals are always subject to a user’s approval.',
          ],
        },
        {
          id: 'recipients',
          title: '3. Who receives your data?',
          blocks: [
            'Your data is accessible to our authorised staff (support, operations, billing) within the limits of their duties, and to members of your organisation according to the rights set by your administrator.',
            'We use the following sub-processors, bound by confidentiality and security commitments in line with Article 28 GDPR:',
            { table: sub },
            'We may disclose data where required by law (judicial or administrative authorities).',
          ],
        },
        {
          id: 'transfers',
          title: '4. Transfers outside the European Union',
          blocks: [
            'Where data is transferred outside the European Economic Area (in particular to Anthropic in the United States, only for requests sent to the AI copilot), the transfer is covered by the European Commission’s standard contractual clauses or by an adequacy decision. Content sent to the AI provider is not used to train its models, under its commercial terms. Your administrator can ask for AI features to be disabled.',
          ],
        },
        {
          id: 'backups',
          title: '5. Backups',
          blocks: ['Encrypted backups of the database and files are kept for 30 rolling days so the service can be restored after an incident. Deleted data therefore disappears from backups at the latest 30 days after deletion.'],
        },
        {
          id: 'security',
          title: '6. Security',
          blocks: [
            {
              list: [
                'Encrypted connections (HTTPS/TLS) and two-factor secrets encrypted at rest',
                'Hashed passwords (Argon2), revocable sessions, lockout after failed attempts',
                'Strict isolation of each organisation’s data and role-based access control',
                'File access through signed, time-limited links',
                'Change history and audit log',
                'Encrypted, verified backups',
              ],
            },
            'If a personal data breach is likely to result in a risk to your rights, we notify the competent authority and, where applicable, the data subjects or the customer acting as controller within the statutory deadlines.',
          ],
        },
        {
          id: 'rights',
          title: '7. Your rights',
          blocks: [
            'You have the right of access, rectification, erasure, restriction, portability and objection, and the right to withdraw your consent at any time where processing is based on it. In France you can also set instructions about what happens to your data after your death.',
            `To exercise your rights, write to ${L.privacyEmail}. We answer within one month, which may be extended by two months for complex requests; we may ask you to prove your identity. Most of your account data can be edited directly in Settings.`,
            `If you believe your rights are not respected, you can lodge a complaint with the competent supervisory authority: ${L.authority}.`,
          ],
        },
        {
          id: 'cookies',
          title: '8. Cookies',
          blocks: [`We only use strictly necessary or preference cookies and storage, with no analytics or advertising. Details are in the [cookie policy](${r.cookies}).`],
        },
        {
          id: 'changes',
          title: '9. Changes',
          blocks: ['We may update this policy. The last-updated date is shown at the top of the page; for significant changes we inform you by e-mail or in the application.'],
        },
      ],
    },

    terms: {
      title: 'Terms of service and sale',
      intro: `These terms (the “Terms”) govern access to and use of the ${L.brand} service published by ${L.entity}. They are intended for business customers. By creating an account or using the service, you accept them on behalf of the organisation you represent.`,
      sections: [
        {
          id: 'service',
          title: '1. Purpose and service',
          blocks: [
            `${L.brand} is online software (SaaS) for managing quality management systems and, as add-ons, environment, occupational health and safety and food safety. The service is provided as described in its documentation and on the website, and evolves regularly.`,
            'The service is a support tool: it does not grant any certification and does not replace the judgement of quality professionals, the requirements of the standards or the opinion of a certification body. The AI copilot’s proposals may be inaccurate and must be checked before use.',
          ],
        },
        {
          id: 'accounts',
          title: '2. Accounts and access',
          blocks: [
            'The customer appoints one or more administrators who manage members, roles and rights. Each user has personal credentials, which they keep confidential; enabling two-factor authentication is recommended.',
            'The customer is responsible for its users’ use of the service and ensures the information provided is accurate and up to date.',
          ],
        },
        {
          id: 'use',
          title: '3. Acceptable use',
          blocks: [
            'In particular, it is prohibited to:',
            {
              list: [
                'access or attempt to access another organisation’s data, or bypass security measures;',
                'introduce malware, deliberately overload the service or disrupt its operation;',
                'store unlawful content, or data the customer has no right to use;',
                'resell, sublicense or copy the service, or extract its code, without written agreement.',
              ],
            },
            'In the event of a serious breach or a security risk, we may suspend the access concerned, after prior notice except in an emergency.',
          ],
        },
        {
          id: 'subscription',
          title: '4. Subscription, prices and payment',
          blocks: [
            'The service is offered by subscription according to the plans and add-ons (Environment, OH&S, HACCP…) described on the [Pricing](/pricing) page or in a commercial proposal. The number of accounts, term and price are set in the subscription. Prices are exclusive of taxes.',
            'Unless agreed otherwise, the subscription is entered into for the chosen period (monthly or yearly) and renews automatically for the same period unless cancelled before the end of the current period. Invoices are payable within 30 days. Late payment, after a formal notice that remains unanswered, makes late-payment interest at the statutory rate and a fixed recovery fee payable, and allows the service to be suspended.',
            'We may change our prices; any increase is notified at least 30 days before the renewal concerned, and the customer may then cancel.',
          ],
        },
        {
          id: 'data',
          title: '5. Customer data',
          blocks: [
            `The customer remains the owner of the data it records in the service. We process it only to provide the service, under the [data processing agreement](${r.dpa}), which forms an integral part of these Terms.`,
            'The customer can export all its data and files at any time (ZIP archive). At the end of the subscription, data remains exportable for 30 days and is then deleted, subject to backups and statutory retention obligations.',
          ],
        },
        {
          id: 'availability',
          title: '6. Availability, maintenance and support',
          blocks: [
            'We use reasonable efforts to keep the service available and secure, take regular backups and fix defects. Planned interruptions may occur for maintenance; we try to announce them in advance and perform them outside business hours. A specific service-level commitment may be agreed in a commercial proposal.',
            `Support is available at ${L.email}.`,
          ],
        },
        {
          id: 'ip',
          title: '7. Intellectual property',
          blocks: [`${L.entity} retains all rights to the software, its documentation and its templates. During the subscription, the customer has a personal, non-exclusive and non-transferable right to use it for its internal needs. The form templates provided may be freely adapted by the customer for its own use.`],
        },
        {
          id: 'liability',
          title: '8. Liability',
          blocks: [
            'Each party is liable for direct damage caused by its breaches. We are not liable for indirect damage (loss of revenue, reputation, opportunity…), for the consequences of decisions the customer makes based on the service, or for the outcome of an audit or certification.',
            'Except in case of gross negligence or wilful misconduct, and to the extent permitted by law, our total liability is limited to the amounts paid by the customer in the twelve months preceding the event giving rise to the claim.',
          ],
        },
        {
          id: 'term',
          title: '9. Term and termination',
          blocks: ['The customer may cancel its subscription at any time, effective at the end of the current period, from the administration area or in writing. Either party may terminate for a serious breach by the other not remedied within 30 days of a formal notice. Amounts already paid for the current period are not refunded, unless we are in breach.'],
        },
        {
          id: 'confidentiality',
          title: '10. Confidentiality',
          blocks: ['Each party keeps confidential the other party’s non-public information it learns in connection with the contract, during its term and for five years after it ends.'],
        },
        {
          id: 'changes',
          title: '11. Changes to the Terms',
          blocks: ['We may change these Terms. Material changes are notified at least 30 days in advance; if the customer refuses them, it may cancel its subscription before they take effect.'],
        },
        {
          id: 'law',
          title: '12. Governing law and disputes',
          blocks: [`These Terms are governed by ${L.governingLaw}. Failing an amicable settlement, any dispute falls under the exclusive jurisdiction of the courts of ${L.jurisdiction}.`],
        },
      ],
    },

    cookies: {
      title: 'Cookie policy',
      intro: `This page describes the cookies and local storage used by ${L.site} and the ${L.brand} application.`,
      sections: [
        {
          id: 'approach',
          title: 'Our approach',
          blocks: ['We use no advertising cookies, no audience-measurement tools and no social-media trackers. The only cookies and storage we use are strictly necessary for the service to work or remember your preferences: they are exempt from consent, so no banner asks you for it.'],
        },
        {
          id: 'list',
          title: 'Cookies and storage used',
          blocks: [
            {
              table: {
                head: ['Name', 'Type', 'Purpose', 'Duration'],
                rows: [
                  ['astro_rt', 'HTTP cookie (secure, httpOnly)', 'Keep your session secure (refresh token)', 'Session lifetime, 30 days maximum'],
                  ['astro.locale', 'Cookie', 'Remember the chosen language (French / English)', '12 months'],
                  ['theme', 'Local storage', 'Remember the light or dark theme', 'Until cleared'],
                  ['astro.*', 'Local storage', 'Interface preferences (active organisation, menus, filters, views)', 'Until cleared'],
                ],
              },
            },
          ],
        },
        {
          id: 'manage',
          title: 'Managing cookies',
          blocks: ['You can delete these items at any time from your browser settings. Deleting the session cookie signs you out; deleting preferences restores the default settings.'],
        },
        {
          id: 'changes',
          title: 'Changes',
          blocks: ['If we ever use trackers that require consent, we will ask for it first and update this page.'],
        },
      ],
    },

    dpa: {
      title: 'Data processing agreement (DPA)',
      intro: `This agreement, entered into under Article 28 GDPR, forms part of the [Terms](${r.terms}). It applies to the personal data the customer (the “Controller”) records in ${L.brand} and that ${L.entity} (the “Processor”) processes on its behalf.`,
      sections: [
        {
          id: 'description',
          title: '1. Description of the processing',
          blocks: [
            {
              list: [
                '**Subject and duration:** provision of the service for the subscription term, then 30 days for return of data.',
                '**Nature:** hosting, storage, backup, consultation, provision, sending notifications, export and deletion.',
                '**Purpose:** enabling the Controller to run its management system (quality, environment, health and safety, food safety).',
                '**Data subjects:** employees, users, candidates, customers, suppliers and providers, interested-party contacts.',
                '**Categories of data:** identity and contact details, professional information (job, department, competencies, trainings, evaluations), record content and attached files, connection data. The Controller refrains from recording special categories of data (health, etc.) unless necessary and on an appropriate legal basis.',
              ],
            },
          ],
        },
        {
          id: 'obligations',
          title: '2. Processor obligations',
          blocks: [
            {
              list: [
                'process the data only on the Controller’s documented instructions — these Terms and the use of the service constitute instructions — and inform it if an instruction appears to infringe the regulations;',
                'ensure the confidentiality of the data and that authorised persons are bound by confidentiality;',
                'implement the security measures described in section 4;',
                'assist the Controller in responding to data subject requests, in particular through the service’s edit, export and deletion features;',
                'assist it in ensuring security, carrying out impact assessments and consulting the supervisory authority where required;',
                'notify any personal data breach without undue delay and no later than 48 hours after becoming aware of it, with the information available;',
                'keep a record of the processing carried out on behalf of its customers.',
              ],
            },
          ],
        },
        {
          id: 'subprocessors',
          title: '3. Sub-processors',
          blocks: [
            `The Controller gives a general authorisation to use the sub-processors listed on the [Sub-processors](${r.subprocessors}) page. The Processor informs the customer of any addition or replacement at least 30 days in advance; the customer may object on reasonable grounds and, failing a solution, terminate the service concerned. Each sub-processor is bound by the same data protection obligations.`,
            'Any transfer outside the European Economic Area is covered by an adequacy decision or by the European Commission’s standard contractual clauses.',
          ],
        },
        {
          id: 'security',
          title: '4. Security measures',
          blocks: [
            {
              list: [
                'logical isolation of data per organisation, checked on every request;',
                'role-based access control, visibility by process, two-factor authentication, account lockout after failures;',
                'TLS encryption in transit, encrypted authentication secrets, hashed passwords;',
                'logging of access and changes (history and audit log);',
                'encrypted, verified daily backups kept for 30 days;',
                'regular security updates and dependency reviews;',
                'Processor staff access limited to what is strictly necessary.',
              ],
            },
          ],
        },
        {
          id: 'end',
          title: '5. End of the contract',
          blocks: ['At the end of the service, the Controller can export all its data for 30 days. The Processor then deletes the data and its copies, except where the law requires retention; they disappear from backups at the latest 30 days later.'],
        },
        {
          id: 'audit',
          title: '6. Audit',
          blocks: [`The Processor makes available the information needed to demonstrate compliance with this agreement. The Controller may carry out an audit, at its own expense, at most once a year, with 30 days’ notice, by an auditor bound by confidentiality and without compromising other customers’ security. Contact: ${L.privacyEmail}.`],
        },
      ],
    },

    subprocessors: {
      title: 'Sub-processors',
      intro: `The providers that process personal data on behalf of ${L.entity} as part of the ${L.brand} service.`,
      sections: [
        { id: 'list', title: 'Current list', blocks: [{ table: sub }] },
        {
          id: 'changes',
          title: 'Changes',
          blocks: [`We inform our customers at least 30 days before adding or replacing a sub-processor, under the [data processing agreement](${r.dpa}). To be notified, write to ${L.privacyEmail}.`],
        },
        {
          id: 'self-hosted',
          title: 'Installations on your servers',
          blocks: ['For self-hosted installations under license, data stays on the customer’s infrastructure: we have no access to it and the sub-processors above do not apply, unless the customer itself enables an external AI or e-mail provider.'],
        },
      ],
    },
  };
}
