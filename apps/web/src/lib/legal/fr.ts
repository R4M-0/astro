import { LEGAL_ROUTES, type LegalDoc, type LegalDocKey, type LegalIdentity } from './company';

const r = LEGAL_ROUTES;

export function subprocessorsFr(L: LegalIdentity): string[][] {
  return [
    [L.host, 'Hébergement de l’application, des bases de données, des fichiers et des sauvegardes', L.hostLocation, 'Données du service (toutes catégories)'],
    [L.mailProvider, 'Envoi des e-mails transactionnels (vérification, invitations, notifications)', L.mailProviderLocation, 'Nom, adresse e-mail, contenu de l’e-mail'],
    ['Anthropic, PBC', 'Copilote IA, uniquement lorsqu’un utilisateur sollicite une fonctionnalité d’IA', 'États-Unis (clauses contractuelles types)', 'Texte de la demande et extraits des enregistrements nécessaires à la réponse'],
  ];
}

export function legalFr(L: LegalIdentity): Record<LegalDocKey, LegalDoc> {
  const sub = { head: ['Sous-traitant', 'Finalité', 'Localisation', 'Données concernées'], rows: subprocessorsFr(L) };
  const editor = `${L.entity}, ${L.legalForm} au capital de ${L.capital}, immatriculée sous le numéro ${L.registration}, dont le siège est situé ${L.address}`;

  return {
    notice: {
      title: 'Mentions légales',
      intro: `Informations relatives à l’éditeur du site ${L.site} et du service ${L.brand}.`,
      sections: [
        {
          id: 'editeur',
          title: 'Éditeur',
          blocks: [
            `Le site et le service ${L.brand} sont édités par ${editor}.`,
            { list: [`N° de TVA intracommunautaire : ${L.vatId}`, `Téléphone : ${L.phone}`, `E-mail : ${L.email}`, `Directeur de la publication : ${L.director}`] },
          ],
        },
        {
          id: 'hebergeur',
          title: 'Hébergeur',
          blocks: [`Le service est hébergé par ${L.host}, ${L.hostAddress}. Les données de production sont stockées en ${L.hostLocation}.`],
        },
        {
          id: 'propriete',
          title: 'Propriété intellectuelle',
          blocks: [
            `L’ensemble des éléments du site et du logiciel ${L.brand} (textes, interfaces, graphismes, logos, code, bases de données) est protégé par le droit de la propriété intellectuelle et appartient à ${L.entity} ou fait l’objet d’une licence. Toute reproduction, représentation ou adaptation, totale ou partielle, sans autorisation écrite préalable est interdite.`,
            'ISO 9001, ISO 14001, ISO 45001 et ISO 22000 sont des normes publiées par l’Organisation internationale de normalisation (ISO). Astro n’est ni affilié à l’ISO ni à un organisme de certification ; l’utilisation du logiciel ne vaut pas certification.',
          ],
        },
        {
          id: 'donnees',
          title: 'Données personnelles et cookies',
          blocks: [
            `Le traitement de vos données personnelles est décrit dans la [politique de confidentialité](${r.privacy}). Les cookies utilisés sont décrits dans la [politique cookies](${r.cookies}).`,
          ],
        },
        {
          id: 'contact',
          title: 'Contact',
          blocks: [`Pour toute question, écrivez à ${L.email} ou utilisez le [formulaire de contact](/contact).`],
        },
      ],
    },

    privacy: {
      title: 'Politique de confidentialité',
      intro: `Cette politique explique comment ${L.entity} (« nous ») traite les données personnelles lorsque vous visitez ${L.site}, créez un compte ou utilisez ${L.brand}, conformément au Règlement (UE) 2016/679 (RGPD) et aux lois applicables en matière de protection des données.`,
      sections: [
        {
          id: 'roles',
          title: '1. Qui est responsable de vos données ?',
          blocks: [
            `**Responsable de traitement.** ${L.entity} est responsable des traitements liés au site, à la création et à la gestion des comptes, à la relation commerciale, à la facturation, à la sécurité et au support.`,
            `**Sous-traitant.** Pour les données que nos clients enregistrent dans ${L.brand} (collaborateurs, fournisseurs, non-conformités, réclamations, documents…), le client est responsable de traitement et nous agissons en tant que sous-traitant, selon ses instructions et l’[accord de sous-traitance](${r.dpa}). Si vous êtes une personne concernée par ces données, adressez-vous d’abord à l’organisme qui utilise ${L.brand}.`,
            `Contact protection des données : ${L.privacyEmail} — ${L.address}.`,
          ],
        },
        {
          id: 'donnees',
          title: '2. Quelles données traitons-nous, pourquoi et sur quelle base ?',
          blocks: [
            {
              table: {
                head: ['Finalité', 'Données', 'Base légale', 'Durée de conservation'],
                rows: [
                  ['Création et gestion de votre compte, authentification', 'Nom, prénom, e-mail, mot de passe (haché), organisme, langue, secret 2FA (chiffré), date d’acceptation des conditions', 'Exécution du contrat', 'Durée du compte, puis suppression sous 30 jours après sa clôture (hors sauvegardes, voir § 5)'],
                  ['Fourniture du service et support', 'Données saisies dans l’application, échanges avec le support', 'Exécution du contrat', 'Durée de l’abonnement + 30 jours pour vous permettre d’exporter vos données'],
                  ['Sécurité, prévention de la fraude et des abus', 'Adresse IP, navigateur, horodatages, sessions, tentatives de connexion, journal d’audit', 'Intérêt légitime (sécuriser le service)', '12 mois glissants pour les journaux techniques ; journal d’audit pendant la durée du compte'],
                  ['Réponse aux demandes de contact et de démonstration', 'Nom, e-mail, organisme, message', 'Intérêt légitime (répondre à votre demande) ou mesures précontractuelles', '3 ans à compter du dernier contact'],
                  ['Facturation et obligations comptables', 'Identité du client, coordonnées de facturation, factures', 'Obligation légale', 'Durée légale de conservation des pièces comptables (10 ans en France)'],
                  ['E-mails de service (vérification, invitations, rappels)', 'E-mail, nom, contenu de la notification', 'Exécution du contrat', 'Le temps de l’envoi ; préférences de notification pendant la durée du compte'],
                  ['Copilote IA (à votre demande uniquement)', 'Votre question et les extraits d’enregistrements nécessaires', 'Exécution du contrat', 'Non conservées par nos soins au-delà de l’historique de conversation que vous pouvez supprimer'],
                ],
              },
            },
            'Les champs signalés comme obligatoires dans nos formulaires sont nécessaires pour créer votre compte ou traiter votre demande ; sans eux, nous ne pouvons pas y donner suite.',
            'Nous ne vendons pas vos données, ne les utilisons pas à des fins publicitaires et ne prenons aucune décision fondée exclusivement sur un traitement automatisé produisant des effets juridiques à votre égard. Les propositions du copilote IA sont toujours soumises à la validation d’un utilisateur.',
          ],
        },
        {
          id: 'destinataires',
          title: '3. Qui reçoit vos données ?',
          blocks: [
            'Vos données sont accessibles à nos équipes habilitées (support, exploitation, facturation), dans la limite de leurs fonctions, et aux membres de votre organisation selon les droits définis par votre administrateur.',
            'Nous faisons appel aux sous-traitants suivants, liés par des engagements de confidentialité et de sécurité conformes à l’article 28 du RGPD :',
            { table: sub },
            'Nous pouvons communiquer des données lorsque la loi l’exige (autorité judiciaire ou administrative).',
          ],
        },
        {
          id: 'transferts',
          title: '4. Transferts hors de l’Union européenne',
          blocks: [
            'Lorsque des données sont transférées hors de l’Espace économique européen (notamment vers Anthropic aux États-Unis, uniquement pour les demandes adressées au copilote IA), ce transfert est encadré par les clauses contractuelles types de la Commission européenne ou par une décision d’adéquation. Les contenus transmis au fournisseur d’IA ne sont pas utilisés pour entraîner ses modèles, conformément à ses conditions commerciales. Votre administrateur peut demander la désactivation des fonctionnalités d’IA.',
          ],
        },
        {
          id: 'conservation',
          title: '5. Sauvegardes',
          blocks: [
            'Les sauvegardes chiffrées de la base de données et des fichiers sont conservées 30 jours glissants afin de permettre une restauration en cas d’incident. Les données supprimées disparaissent donc définitivement des sauvegardes au plus tard 30 jours après leur suppression.',
          ],
        },
        {
          id: 'securite',
          title: '6. Sécurité',
          blocks: [
            {
              list: [
                'Chiffrement des échanges (HTTPS/TLS) et chiffrement des secrets de double authentification au repos',
                'Mots de passe hachés (Argon2), sessions révocables, verrouillage après tentatives échouées',
                'Cloisonnement strict des données de chaque organisation et contrôle d’accès par rôles',
                'Accès aux fichiers par liens temporaires signés',
                'Historique des modifications et journal d’audit',
                'Sauvegardes chiffrées et vérifiées',
              ],
            },
            'En cas de violation de données susceptible d’engendrer un risque pour vos droits, nous notifions l’autorité compétente et, le cas échéant, les personnes concernées ou le client responsable de traitement dans les délais légaux.',
          ],
        },
        {
          id: 'droits',
          title: '7. Vos droits',
          blocks: [
            'Vous disposez d’un droit d’accès, de rectification, d’effacement, de limitation, de portabilité et d’opposition, ainsi que du droit de retirer votre consentement à tout moment lorsque le traitement repose sur celui-ci. En France, vous pouvez également définir des directives relatives au sort de vos données après votre décès.',
            `Pour exercer vos droits, écrivez à ${L.privacyEmail}. Nous répondons dans un délai d’un mois, prolongeable de deux mois en cas de demande complexe ; nous pouvons vous demander de justifier de votre identité. Une grande partie de vos données de compte est modifiable directement dans Paramètres.`,
            `Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès de l’autorité de contrôle compétente : ${L.authority}.`,
          ],
        },
        {
          id: 'cookies',
          title: '8. Cookies',
          blocks: [`Nous n’utilisons que des cookies et stockages strictement nécessaires ou de préférence, sans mesure d’audience ni publicité. Le détail figure dans la [politique cookies](${r.cookies}).`],
        },
        {
          id: 'modifications',
          title: '9. Modifications',
          blocks: ['Nous pouvons faire évoluer cette politique. La date de dernière mise à jour figure en haut de la page ; en cas de changement important, nous vous en informons par e-mail ou dans l’application.'],
        },
      ],
    },

    terms: {
      title: 'Conditions générales d’utilisation et de vente',
      intro: `Les présentes conditions (les « Conditions ») régissent l’accès et l’utilisation du service ${L.brand} édité par ${L.entity}. Elles s’adressent à des clients professionnels. En créant un compte ou en utilisant le service, vous les acceptez au nom de l’organisme que vous représentez.`,
      sections: [
        {
          id: 'objet',
          title: '1. Objet et service',
          blocks: [
            `${L.brand} est un logiciel en ligne (SaaS) de gestion de systèmes de management de la qualité et, en option, de l’environnement, de la santé-sécurité au travail et de la sécurité des aliments. Le service est fourni « tel que décrit » dans sa documentation et sur le site, et évolue régulièrement.`,
            'Le service est un outil d’aide : il ne délivre aucune certification et ne se substitue ni au jugement des professionnels de la qualité, ni aux exigences des normes, ni à l’avis d’un organisme certificateur. Les propositions du copilote IA peuvent être inexactes et doivent être vérifiées avant usage.',
          ],
        },
        {
          id: 'compte',
          title: '2. Comptes et accès',
          blocks: [
            'Le client désigne un ou plusieurs administrateurs qui gèrent les membres, les rôles et les droits. Chaque utilisateur dispose d’identifiants personnels, qu’il garde confidentiels ; l’activation de la double authentification est recommandée.',
            'Le client est responsable de l’usage fait du service par ses utilisateurs et veille à ce que les informations fournies soient exactes et à jour.',
          ],
        },
        {
          id: 'usage',
          title: '3. Utilisation acceptable',
          blocks: [
            'Il est interdit notamment :',
            {
              list: [
                'd’accéder ou de tenter d’accéder aux données d’une autre organisation, ou de contourner les mesures de sécurité ;',
                'd’introduire des logiciels malveillants, de surcharger volontairement le service ou d’en perturber le fonctionnement ;',
                'de stocker des contenus illicites, ou des données dont le client n’a pas le droit de disposer ;',
                'de revendre, sous-licencier ou copier le service, ou d’en extraire le code, sauf accord écrit.',
              ],
            },
            'En cas de manquement grave ou de risque pour la sécurité, nous pouvons suspendre l’accès concerné, après information préalable sauf urgence.',
          ],
        },
        {
          id: 'abonnement',
          title: '4. Abonnement, prix et paiement',
          blocks: [
            `Le service est proposé par abonnement selon les formules et options (Environnement, SST, HACCP…) décrites sur la page [Tarifs](/pricing) ou dans une proposition commerciale. Le nombre de comptes, la durée et le prix figurent dans la souscription. Les prix sont indiqués hors taxes.`,
            'Sauf stipulation contraire, l’abonnement est conclu pour la période choisie (mensuelle ou annuelle) et se renouvelle tacitement pour une durée identique, sauf résiliation avant la fin de la période en cours. Les factures sont payables à 30 jours. Tout retard de paiement entraîne, après mise en demeure restée sans effet, l’exigibilité de pénalités de retard au taux légal en vigueur et d’une indemnité forfaitaire pour frais de recouvrement, ainsi que la possibilité de suspendre le service.',
            'Nous pouvons faire évoluer nos prix ; toute hausse est notifiée au moins 30 jours avant le renouvellement concerné, le client pouvant alors résilier.',
          ],
        },
        {
          id: 'donnees',
          title: '5. Données du client',
          blocks: [
            `Le client reste propriétaire des données qu’il enregistre dans le service. Nous les traitons uniquement pour fournir le service, conformément à l’[accord de sous-traitance](${r.dpa}), qui fait partie intégrante des présentes Conditions.`,
            'Le client peut exporter à tout moment l’intégralité de ses données et fichiers (archive ZIP). À la fin de l’abonnement, les données restent exportables pendant 30 jours, puis sont supprimées, sous réserve des sauvegardes et des obligations légales de conservation.',
          ],
        },
        {
          id: 'disponibilite',
          title: '6. Disponibilité, maintenance et support',
          blocks: [
            'Nous mettons en œuvre des moyens raisonnables pour assurer la disponibilité et la sécurité du service, réaliser des sauvegardes régulières et corriger les anomalies. Des interruptions planifiées peuvent intervenir pour maintenance ; nous nous efforçons de les annoncer à l’avance et de les réaliser en dehors des heures ouvrées. Un engagement de niveau de service spécifique peut être convenu dans une proposition commerciale.',
            `Le support est accessible à ${L.email}.`,
          ],
        },
        {
          id: 'propriete',
          title: '7. Propriété intellectuelle',
          blocks: [
            `${L.entity} conserve tous les droits sur le logiciel, sa documentation et ses modèles. Le client bénéficie, pendant la durée de l’abonnement, d’un droit d’utilisation personnel, non exclusif et non transférable, pour ses besoins internes. Les modèles de fiches fournis peuvent être librement adaptés par le client pour son propre usage.`,
          ],
        },
        {
          id: 'responsabilite',
          title: '8. Responsabilité',
          blocks: [
            'Chaque partie est responsable des dommages directs causés par ses manquements. Nous ne sommes pas responsables des dommages indirects (perte de chiffre d’affaires, d’image, de chance…), ni des conséquences des décisions prises par le client à partir du service, ni des résultats d’un audit ou d’une certification.',
            'Sauf faute lourde ou dolosive, et dans les limites permises par la loi, notre responsabilité totale est limitée aux sommes payées par le client au titre des douze mois précédant le fait générateur.',
          ],
        },
        {
          id: 'duree',
          title: '9. Durée et résiliation',
          blocks: [
            'Le client peut résilier son abonnement à tout moment avec effet à la fin de la période en cours, depuis l’administration ou par écrit. Chaque partie peut résilier en cas de manquement grave de l’autre non corrigé dans les 30 jours suivant une mise en demeure. Les sommes déjà réglées pour la période en cours ne sont pas remboursées, sauf manquement de notre part.',
          ],
        },
        {
          id: 'confidentialite',
          title: '10. Confidentialité',
          blocks: ['Chaque partie garde confidentielles les informations non publiques de l’autre partie dont elle a connaissance à l’occasion du contrat, pendant sa durée et cinq ans après sa fin.'],
        },
        {
          id: 'modifications',
          title: '11. Modification des Conditions',
          blocks: ['Nous pouvons modifier les présentes Conditions. Les modifications substantielles sont notifiées au moins 30 jours à l’avance ; si le client les refuse, il peut résilier son abonnement avant leur entrée en vigueur.'],
        },
        {
          id: 'droit',
          title: '12. Droit applicable et litiges',
          blocks: [`Les présentes Conditions sont régies par le ${L.governingLaw}. À défaut d’accord amiable, tout litige relève de la compétence exclusive des tribunaux de ${L.jurisdiction}.`],
        },
      ],
    },

    cookies: {
      title: 'Politique cookies',
      intro: `Cette page décrit les cookies et stockages locaux utilisés par ${L.site} et l’application ${L.brand}.`,
      sections: [
        {
          id: 'principe',
          title: 'Notre approche',
          blocks: [
            'Nous n’utilisons ni cookies publicitaires, ni outils de mesure d’audience, ni traceurs de réseaux sociaux. Les seuls cookies et stockages utilisés sont strictement nécessaires au fonctionnement du service ou mémorisent vos préférences : ils sont exemptés de consentement et aucun bandeau ne vous est donc demandé.',
          ],
        },
        {
          id: 'liste',
          title: 'Liste des cookies et stockages',
          blocks: [
            {
              table: {
                head: ['Nom', 'Type', 'Finalité', 'Durée'],
                rows: [
                  ['astro_rt', 'Cookie HTTP (sécurisé, httpOnly)', 'Maintenir votre session de façon sécurisée (jeton de renouvellement)', 'Durée de la session, 30 jours maximum'],
                  ['astro.locale', 'Cookie', 'Mémoriser la langue choisie (français / anglais)', '12 mois'],
                  ['theme', 'Stockage local', 'Mémoriser le thème clair ou sombre', 'Jusqu’à effacement'],
                  ['astro.*', 'Stockage local', 'Préférences d’interface (organisation active, menus, filtres, affichages)', 'Jusqu’à effacement'],
                ],
              },
            },
          ],
        },
        {
          id: 'gerer',
          title: 'Gérer les cookies',
          blocks: ['Vous pouvez supprimer ces éléments à tout moment depuis les réglages de votre navigateur. La suppression du cookie de session vous déconnecte ; celle des préférences rétablit les réglages par défaut.'],
        },
        {
          id: 'evolution',
          title: 'Évolution',
          blocks: ['Si nous devions un jour utiliser des traceurs soumis à consentement, nous vous le demanderions au préalable et mettrions à jour cette page.'],
        },
      ],
    },

    dpa: {
      title: 'Accord de sous-traitance des données (DPA)',
      intro: `Le présent accord, conclu en application de l’article 28 du RGPD, fait partie des [Conditions générales](${r.terms}). Il s’applique aux données personnelles que le client (le « Responsable de traitement ») enregistre dans ${L.brand} et que ${L.entity} (le « Sous-traitant ») traite pour son compte.`,
      sections: [
        {
          id: 'description',
          title: '1. Description du traitement',
          blocks: [
            {
              list: [
                '**Objet et durée :** fourniture du service pendant la durée de l’abonnement, puis 30 jours de restitution.',
                '**Nature :** hébergement, stockage, sauvegarde, consultation, mise à disposition, envoi de notifications, export et suppression.',
                '**Finalité :** permettre au Responsable de traitement de gérer son système de management (qualité, environnement, santé-sécurité, sécurité des aliments).',
                '**Personnes concernées :** collaborateurs, utilisateurs, candidats, clients, fournisseurs et prestataires, contacts de parties intéressées.',
                '**Catégories de données :** identité et coordonnées, informations professionnelles (poste, département, compétences, formations, évaluations), contenus des enregistrements et fichiers joints, données de connexion. Le Responsable de traitement s’abstient d’enregistrer des catégories particulières de données (santé, etc.) sauf nécessité et base légale appropriée.',
              ],
            },
          ],
        },
        {
          id: 'obligations',
          title: '2. Obligations du Sous-traitant',
          blocks: [
            {
              list: [
                'traiter les données uniquement sur instruction documentée du Responsable de traitement — les présentes Conditions et l’usage du service valent instructions — et l’informer si une instruction lui paraît contraire à la réglementation ;',
                'garantir la confidentialité des données et veiller à ce que les personnes autorisées soient soumises à une obligation de confidentialité ;',
                'mettre en œuvre les mesures de sécurité décrites à l’article 4 ;',
                'aider le Responsable de traitement à répondre aux demandes d’exercice des droits, notamment grâce aux fonctions de modification, d’export et de suppression du service ;',
                'l’aider à garantir la sécurité, à réaliser des analyses d’impact et à consulter l’autorité de contrôle lorsque cela est nécessaire ;',
                'notifier toute violation de données personnelles dans les meilleurs délais et au plus tard 48 heures après en avoir pris connaissance, avec les informations disponibles ;',
                'tenir un registre des traitements effectués pour le compte de ses clients.',
              ],
            },
          ],
        },
        {
          id: 'sous-traitants',
          title: '3. Sous-traitants ultérieurs',
          blocks: [
            `Le Responsable de traitement autorise de manière générale le recours aux sous-traitants ultérieurs listés sur la page [Sous-traitants](${r.subprocessors}). Le Sous-traitant informe le client de tout ajout ou remplacement au moins 30 jours à l’avance ; le client peut s’y opposer pour un motif raisonnable et, à défaut de solution, résilier le service concerné. Chaque sous-traitant ultérieur est soumis aux mêmes obligations de protection des données.`,
            'Tout transfert hors de l’Espace économique européen est encadré par une décision d’adéquation ou par les clauses contractuelles types de la Commission européenne.',
          ],
        },
        {
          id: 'securite',
          title: '4. Mesures de sécurité',
          blocks: [
            {
              list: [
                'cloisonnement logique des données par organisation, contrôlé à chaque requête ;',
                'contrôle d’accès par rôles, visibilité par processus, double authentification, verrouillage des comptes après échecs ;',
                'chiffrement TLS des échanges, chiffrement des secrets d’authentification, mots de passe hachés ;',
                'journalisation des accès et des modifications (historique et journal d’audit) ;',
                'sauvegardes quotidiennes chiffrées et vérifiées, conservées 30 jours ;',
                'mises à jour de sécurité régulières et revue des dépendances ;',
                'accès des équipes du Sous-traitant limité au strict nécessaire.',
              ],
            },
          ],
        },
        {
          id: 'fin',
          title: '5. Fin du contrat',
          blocks: ['À la fin du service, le Responsable de traitement peut exporter l’intégralité de ses données pendant 30 jours. Le Sous-traitant supprime ensuite les données et leurs copies, à l’exception de celles dont la loi impose la conservation ; elles disparaissent des sauvegardes au plus tard 30 jours plus tard.'],
        },
        {
          id: 'audit',
          title: '6. Audit',
          blocks: [`Le Sous-traitant met à disposition les informations nécessaires pour démontrer le respect du présent accord. Le Responsable de traitement peut réaliser un audit, à ses frais, une fois par an au plus, avec un préavis de 30 jours, par un auditeur tenu au secret et sans porter atteinte à la sécurité des autres clients. Contact : ${L.privacyEmail}.`],
        },
      ],
    },

    subprocessors: {
      title: 'Sous-traitants ultérieurs',
      intro: `Liste des prestataires qui traitent des données personnelles pour le compte de ${L.entity} dans le cadre du service ${L.brand}.`,
      sections: [
        { id: 'liste', title: 'Liste actuelle', blocks: [{ table: sub }] },
        {
          id: 'changements',
          title: 'Changements',
          blocks: [`Nous informons nos clients au moins 30 jours avant l’ajout ou le remplacement d’un sous-traitant, conformément à l’[accord de sous-traitance](${r.dpa}). Pour être prévenu, écrivez à ${L.privacyEmail}.`],
        },
        {
          id: 'auto-heberge',
          title: 'Installations sur vos serveurs',
          blocks: ['Pour les installations auto-hébergées sous licence, les données restent sur l’infrastructure du client : nous n’y avons pas accès et les sous-traitants ci-dessus ne s’appliquent pas, sauf si le client active lui-même un fournisseur d’IA ou d’e-mail externe.'],
        },
      ],
    },
  };
}
