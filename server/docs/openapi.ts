// =============================================
// EXPERIENCE AI — server/docs/openapi.ts
// Spécification OpenAPI 3.0 décrivant TOUTE l'API REST.
// Servie en interface interactive (« Swagger UI ») sur /api/docs
// → on peut lire ET tester chaque route depuis le navigateur.
//
// Pourquoi un fichier de spec à la main plutôt que des annotations ?
//   - Une seule source de vérité, lisible d'un coup d'œil.
//   - Aucune dépendance de génération à brancher sur chaque route.
//   - Le contrat d'API est versionné avec le code.
//
// Zod reste l'autorité sur le détail du Parcours. La spec documente néanmoins
// les champs F1 visibles par les clients (confiance, prix et lien externe), afin
// que l'incertitude ne disparaisse pas à la frontière HTTP.
// =============================================

const proprietesBrief = {
  intention: { type: 'string', minLength: 1 },
  avecQui: {
    type: 'string',
    enum: ['solo', 'couple', 'famille', 'amis', 'groupe'],
  },
  duree: {
    type: 'object',
    required: ['valeur', 'unite'],
    properties: {
      valeur: { type: 'number', exclusiveMinimum: 0 },
      unite: { type: 'string', enum: ['heures', 'jours', 'semaines'] },
    },
  },
  dates: {
    type: 'object',
    required: ['debut', 'fin'],
    properties: {
      debut: { type: 'string', format: 'date-time' },
      fin: { type: 'string', format: 'date-time' },
    },
  },
  lieux: { type: 'array', items: { type: 'string', minLength: 1 } },
  budgetTotal: { type: 'number', exclusiveMinimum: 0 },
  ambiance: { type: 'string' },
  contraintes: { type: 'array', items: { type: 'string', minLength: 1 } },
  hebergement: { $ref: '#/components/schemas/HebergementBrief' },
  transport: { $ref: '#/components/schemas/TransportBrief' },
};

// Schémas réutilisables (composants) ------------------------------------------
const schemas = {
  Error: {
    type: 'object',
    properties: { error: { type: 'string', example: 'Non authentifié' } },
  },
  Message: {
    type: 'object',
    properties: { message: { type: 'string', example: 'Opération réussie' } },
  },
  User: {
    type: 'object',
    properties: {
      id:         { type: 'string', format: 'uuid' },
      email:      { type: 'string', format: 'email' },
      name:       { type: 'string', nullable: true },
      avatar_url: { type: 'string', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
    },
  },
  Confiance: {
    readOnly: true,
    oneOf: [
      {
        type: 'object',
        required: ['niveau', 'source', 'fournisseur', 'recupereLe'],
        additionalProperties: false,
        properties: {
          niveau:              { type: 'string', enum: ['verifie'] },
          source:              { type: 'string' },
          fournisseur:         { type: 'string' },
          recupereLe:          { type: 'string', format: 'date-time' },
          identifiantExterne:  { type: 'string' },
          categorieFournisseur: { type: 'string' },
          identifiantCategorieFournisseur: { type: 'string' },
          villeConfirmee: { type: 'string' },
          adresse: { type: 'string' },
        },
      },
      {
        type: 'object',
        required: ['niveau'],
        additionalProperties: false,
        properties: {
          niveau:      { type: 'string', enum: ['estime'] },
          source:      { type: 'string' },
          fournisseur: { type: 'string' },
          recupereLe:  { type: 'string', format: 'date-time' },
        },
      },
      {
        type: 'object',
        required: ['niveau'],
        additionalProperties: false,
        properties: {
          niveau: { type: 'string', enum: ['suggestion'] },
        },
      },
    ],
    discriminator: { propertyName: 'niveau' },
    description:
      'Confiance persistée sur un élément. Un refus de génération est un résultat métier HTTP 422, jamais un quatrième niveau.',
  },
  OccupationHebergementBrief: {
    oneOf: [
      {
        type: 'object',
        required: ['statut', 'adultes', 'enfants', 'chambres'],
        additionalProperties: false,
        properties: {
          statut: { type: 'string', enum: ['declaree'] },
          adultes: { type: 'integer', minimum: 1, maximum: 20 },
          enfants: { type: 'integer', minimum: 0, maximum: 20 },
          chambres: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
      {
        type: 'object',
        required: ['statut'],
        additionalProperties: false,
        properties: {
          statut: { type: 'string', enum: ['a_confirmer'] },
          adultes: { type: 'integer', minimum: 1, maximum: 20 },
          enfants: { type: 'integer', minimum: 0, maximum: 20 },
          chambres: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    ],
    discriminator: { propertyName: 'statut' },
    description:
      'Occupation explicitement déclarée par l’utilisateur. Les valeurs partielles restent à confirmer et ne sont jamais déduites de avecQui ou des participants.',
  },
  OccupationHebergement: {
    oneOf: [
      {
        type: 'object',
        required: ['statut', 'adultes', 'enfants', 'chambres'],
        additionalProperties: false,
        properties: {
          statut: { type: 'string', enum: ['declaree'] },
          adultes: { type: 'integer', minimum: 1, maximum: 20 },
          enfants: { type: 'integer', minimum: 0, maximum: 20 },
          chambres: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
      {
        type: 'object',
        required: ['statut'],
        additionalProperties: false,
        properties: {
          statut: { type: 'string', enum: ['a_confirmer'] },
        },
      },
    ],
    discriminator: { propertyName: 'statut' },
    description:
      'Occupation persistée. Une saisie partielle du dialogue n’est jamais recopiée dans le parcours.',
  },
  SejourHebergement: {
    type: 'object',
    required: ['ville', 'arrivee', 'depart'],
    additionalProperties: false,
    properties: {
      ville: { type: 'string', minLength: 1 },
      arrivee: { type: 'string', format: 'date', example: '2026-08-10' },
      depart: { type: 'string', format: 'date', example: '2026-08-12' },
    },
    description:
      'Dates civiles propres à un hébergement. Le départ doit être strictement postérieur à l’arrivée. Lorsque le parcours est daté, l’arrivée reste dans ses jours et le départ peut aller au plus jusqu’au lendemain du dernier jour.',
  },
  PlageHoraire: {
    type: 'object',
    required: ['debut', 'fin'],
    additionalProperties: false,
    properties: {
      debut: { type: 'string', format: 'date-time' },
      fin: { type: 'string', format: 'date-time' },
    },
  },
  HebergementBrief: {
    oneOf: [
      {
        type: 'object',
        required: ['necessaire'],
        additionalProperties: false,
        properties: { necessaire: { type: 'boolean', enum: [false] } },
      },
      {
        type: 'object',
        required: ['necessaire'],
        additionalProperties: false,
        properties: {
          necessaire: { type: 'boolean', enum: [true] },
          occupation: { $ref: '#/components/schemas/OccupationHebergementBrief' },
          sejours: {
            type: 'array',
            items: { $ref: '#/components/schemas/SejourHebergement' },
          },
        },
      },
    ],
    discriminator: { propertyName: 'necessaire' },
  },
  LieuTransportDemande: {
    type: 'object',
    required: ['ville'],
    additionalProperties: false,
    properties: {
      ville: { type: 'string', minLength: 1, maxLength: 120 },
      codePays: {
        type: 'string',
        pattern: '^[A-Z]{2}$',
        description:
          'Code pays déclaré pour lever une ambiguïté, jamais une résolution géographique.',
      },
    },
  },
  DateTransportDemandee: {
    type: 'object',
    required: ['date'],
    additionalProperties: false,
    properties: {
      date: { type: 'string', format: 'date' },
      creneau: {
        type: 'string',
        enum: ['matin', 'apres_midi', 'soir', 'nuit'],
      },
    },
    description:
      'Date civile et créneau symbolique demandés. Aucun horaire observé ou exact.',
  },
  OccupationTransportBrief: {
    oneOf: [
      {
        type: 'object',
        required: ['statut', 'adultes', 'enfants'],
        additionalProperties: false,
        properties: {
          statut: { type: 'string', enum: ['declaree'] },
          adultes: { type: 'integer', minimum: 1, maximum: 20 },
          enfants: { type: 'integer', minimum: 0, maximum: 20 },
        },
      },
      {
        type: 'object',
        required: ['statut'],
        additionalProperties: false,
        properties: {
          statut: { type: 'string', enum: ['a_confirmer'] },
          adultes: { type: 'integer', minimum: 1, maximum: 20 },
          enfants: { type: 'integer', minimum: 0, maximum: 20 },
        },
      },
    ],
    discriminator: { propertyName: 'statut' },
    description:
      'Brouillon d’occupation indépendant de avecQui, des participants et de l’hébergement.',
  },
  OccupationTransportDeclaree: {
    type: 'object',
    required: ['statut', 'adultes', 'enfants'],
    additionalProperties: false,
    properties: {
      statut: { type: 'string', enum: ['declaree'] },
      adultes: { type: 'integer', minimum: 1, maximum: 20 },
      enfants: { type: 'integer', minimum: 0, maximum: 20 },
    },
  },
  PreferencesTransport: {
    type: 'object',
    additionalProperties: false,
    properties: {
      correspondances: {
        type: 'string',
        enum: ['direct_uniquement', 'acceptees'],
      },
      dureeMaxMinutes: {
        type: 'integer',
        minimum: 1,
        maximum: 43200,
      },
      mobiliteReduite: { type: 'boolean' },
      budgetMax: {
        type: 'object',
        required: ['montant', 'devise', 'portee'],
        additionalProperties: false,
        properties: {
          montant: { type: 'number', exclusiveMinimum: 0 },
          devise: { type: 'string', pattern: '^[A-Z]{3}$' },
          portee: {
            type: 'string',
            enum: ['par_personne', 'total'],
          },
        },
      },
    },
    description:
      'Préférences déclarées, sans prix observé, disponibilité ni offre commerciale.',
  },
  TronconTransportBrief: {
    type: 'object',
    additionalProperties: false,
    properties: {
      origine: { $ref: '#/components/schemas/LieuTransportDemande' },
      destination: {
        $ref: '#/components/schemas/LieuTransportDemande',
      },
      depart: { $ref: '#/components/schemas/DateTransportDemandee' },
      modeSouhaite: {
        type: 'string',
        enum: [
          'avion',
          'train',
          'bus',
          'ferry',
          'voiture',
          'transport_local',
          'autre',
        ],
      },
    },
  },
  TronconTransportDemande: {
    type: 'object',
    required: ['origine', 'destination', 'depart'],
    additionalProperties: false,
    properties: {
      origine: { $ref: '#/components/schemas/LieuTransportDemande' },
      destination: {
        $ref: '#/components/schemas/LieuTransportDemande',
      },
      depart: { $ref: '#/components/schemas/DateTransportDemandee' },
      modeSouhaite: {
        type: 'string',
        enum: [
          'avion',
          'train',
          'bus',
          'ferry',
          'voiture',
          'transport_local',
          'autre',
        ],
      },
    },
  },
  TransportBrief: {
    oneOf: [
      {
        type: 'object',
        required: ['necessaire'],
        additionalProperties: false,
        properties: { necessaire: { type: 'boolean', enum: [false] } },
      },
      {
        type: 'object',
        required: ['necessaire', 'troncons', 'occupation'],
        additionalProperties: false,
        properties: {
          necessaire: { type: 'boolean', enum: [true] },
          troncons: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: {
              $ref: '#/components/schemas/TronconTransportBrief',
            },
          },
          occupation: {
            $ref: '#/components/schemas/OccupationTransportBrief',
          },
          preferences: {
            $ref: '#/components/schemas/PreferencesTransport',
          },
        },
      },
    ],
    discriminator: { propertyName: 'necessaire' },
    description:
      'Demande utilisateur en cours. Aucun fournisseur, lieu confirmé, segment, horaire observé, lien, réservation, disponibilité ou prix observé.',
  },
  DemandeTransport: {
    type: 'object',
    required: ['troncons', 'occupation'],
    additionalProperties: false,
    properties: {
      troncons: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          $ref: '#/components/schemas/TronconTransportDemande',
        },
      },
      occupation: {
        $ref: '#/components/schemas/OccupationTransportDeclaree',
      },
      preferences: {
        $ref: '#/components/schemas/PreferencesTransport',
      },
    },
    description:
      'Demande transport validée et persistée dans le JSON du parcours. Elle décrit uniquement l’intention utilisateur, sans preuve fournisseur ni détail observé.',
  },
  Brief: {
    type: 'object',
    required: ['intention', 'avecQui', 'duree'],
    additionalProperties: false,
    properties: proprietesBrief,
  },
  BriefPartiel: {
    type: 'object',
    additionalProperties: false,
    properties: proprietesBrief,
  },
  Reservation: {
    type: 'object',
    required: ['lienExterne', 'fournisseur', 'typeLien'],
    additionalProperties: false,
    readOnly: true,
    properties: {
      lienExterne: { type: 'string', format: 'uri' },
      fournisseur: { type: 'string' },
      typeLien: {
        type: 'string',
        enum: ['officiel', 'billetterie', 'reservation', 'recherche', 'carte'],
      },
    },
  },
  LienRechercheHebergement: {
    type: 'object',
    required: ['type', 'fournisseur', 'url', 'libelle', 'genereLe'],
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['recherche'] },
      fournisseur: { type: 'string', enum: ['Booking'] },
      url: {
        type: 'string',
        format: 'uri',
        description:
          'Recherche Booking préremplie. Ne prouve ni disponibilité, ni réservation, ni prix.',
      },
      libelle: {
        type: 'string',
        enum: ['Rechercher des hébergements sur Booking'],
      },
      genereLe: { type: 'string', format: 'date-time' },
    },
    description:
      'Lien de recherche hôtelier local. Booking n’est pas contacté pendant la génération et aucune réservation n’est effectuée.',
    readOnly: true,
  },
  LienRechercheTransport: {
    type: 'object',
    required: ['type', 'fournisseur', 'url', 'libelle', 'genereLe'],
    additionalProperties: false,
    properties: {
      type: {
        type: 'string',
        enum: [
          'recherche_vol',
          'recherche_train',
          'recherche_transport_local',
        ],
      },
      fournisseur: {
        type: 'string',
        enum: ['Google Flights', 'Google Maps'],
      },
      url: {
        type: 'string',
        format: 'uri',
        description:
          'Recherche transport préremplie. Ne prouve ni billet, ni réservation, ni disponibilité, ni prix.',
      },
      libelle: { type: 'string' },
      genereLe: { type: 'string', format: 'date-time' },
    },
    description:
      'Raccourci de recherche transport (vol ou itinéraire entre gares). Construit seulement après résolution unique des deux extrémités ; jamais un billet ni une réservation.',
    readOnly: true,
  },
  PropositionElementClient: {
    type: 'object',
    required: ['type', 'nom', 'justification'],
    additionalProperties: false,
    properties: {
      type: {
        type: 'string',
        enum: [
          'activite',
          'restaurant',
          'sortie',
          'evenement',
          'temps_libre',
        ],
        description:
          'Ni un hébergement ni un transport ne peuvent être créés ou remplacés par ce contrat générique : ils passent par leur contrat dédié (remplacer_hotel, modifier_demande_transport).',
      },
      nom: { type: 'string', minLength: 1, maxLength: 200 },
      lieu: {
        type: 'string',
        minLength: 1,
        maxLength: 300,
        description:
          'Libellé proposé par l’utilisateur, jamais une adresse fournisseur vérifiée.',
      },
      plage: { $ref: '#/components/schemas/PlageHoraire' },
      prix: {
        type: 'number',
        minimum: 0,
        description: 'Budget indicatif ; il reste estimé.',
      },
      justification: { type: 'string', minLength: 1, maxLength: 1000 },
    },
  },
  DemandeModificationClient: {
    oneOf: [
      {
        type: 'object',
        required: ['type', 'elementId', 'remplacement'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['remplacer_element'] },
          elementId: { type: 'string', minLength: 1 },
          remplacement: {
            $ref: '#/components/schemas/PropositionElementClient',
          },
        },
      },
      {
        type: 'object',
        required: ['type', 'elementId'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['supprimer_element'] },
          elementId: { type: 'string', minLength: 1 },
        },
      },
      {
        type: 'object',
        required: ['type', 'momentId', 'element'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['ajouter_element'] },
          momentId: { type: 'string', minLength: 1 },
          element: {
            $ref: '#/components/schemas/PropositionElementClient',
          },
        },
      },
      {
        type: 'object',
        required: ['type', 'elementId', 'justification'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['modifier_justification'] },
          elementId: { type: 'string', minLength: 1 },
          justification: {
            type: 'string',
            minLength: 1,
            maxLength: 1000,
          },
        },
      },
      {
        type: 'object',
        required: ['type', 'elementId', 'statut'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['changer_statut'] },
          elementId: { type: 'string', minLength: 1 },
          statut: {
            type: 'string',
            enum: ['propose', 'accepte', 'a_remplacer'],
          },
        },
      },
      {
        type: 'object',
        required: ['type', 'elementId', 'alternativeId'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['ecarter_alternative'] },
          elementId: { type: 'string', minLength: 1 },
          alternativeId: { type: 'string', minLength: 1 },
        },
      },
      {
        type: 'object',
        required: ['type', 'elementId', 'sejour'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['modifier_sejour_hebergement'],
          },
          elementId: { type: 'string', minLength: 1 },
          sejour: { $ref: '#/components/schemas/SejourHebergement' },
        },
      },
      {
        type: 'object',
        required: ['type', 'occupation'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['modifier_occupation_hebergement'],
          },
          occupation: {
            type: 'object',
            required: ['statut', 'adultes', 'enfants', 'chambres'],
            additionalProperties: false,
            properties: {
              statut: { type: 'string', enum: ['declaree'] },
              adultes: { type: 'integer', minimum: 1, maximum: 20 },
              enfants: { type: 'integer', minimum: 0, maximum: 20 },
              chambres: { type: 'integer', minimum: 1, maximum: 10 },
            },
          },
        },
      },
      {
        type: 'object',
        required: [
          'type',
          'elementId',
          'villeDemandee',
          'requete',
        ],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['remplacer_hotel'] },
          elementId: { type: 'string', minLength: 1 },
          villeDemandee: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
          },
          requete: { type: 'string', minLength: 1, maxLength: 200 },
          sejour: { $ref: '#/components/schemas/SejourHebergement' },
        },
      },
      {
        type: 'object',
        required: ['type', 'demandeTransport'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['modifier_demande_transport'],
          },
          demandeTransport: {
            allOf: [{ $ref: '#/components/schemas/DemandeTransport' }],
            description:
              'Nouvelle intention de trajet : villes, dates civiles, modes souhaités et occupation déclarée. Le serveur redérive les libellés et reconstruit les liens ; aucun code IATA, gare ou identifiant fournisseur n’est accepté ici.',
          },
        },
      },
    ],
    discriminator: { propertyName: 'type' },
    description:
      'Intention client stricte. Elle ne peut contenir ni confiance, provenance, identifiant externe, adresse fournisseur, réservation, disponibilité ou lien Booking. Une modification transport ne porte que des villes, jamais une gare, un aéroport ni un code.',
  },
  Element: {
    type: 'object',
    required: ['id', 'type', 'nom', 'justification', 'confiance', 'prixEstime'],
    additionalProperties: true,
    properties: {
      id:            { type: 'string', readOnly: true },
      type:          { type: 'string' },
      nom:           { type: 'string' },
      lieu: {
        type: 'string',
        description:
          'Pour un hébergement vérifié, cette adresse est produite par Foursquare et reste en lecture seule.',
      },
      prix:          { type: 'number', minimum: 0 },
      prixEstime:    { type: 'boolean', readOnly: true },
      justification: { type: 'string' },
      confiance: {
        allOf: [{ $ref: '#/components/schemas/Confiance' }],
        readOnly: true,
      },
      reservation: {
        allOf: [{ $ref: '#/components/schemas/Reservation' }],
        readOnly: true,
        description:
          'Lien externe sécurisé pour les éléments non hôteliers. Un hébergement ne porte jamais une réservation.',
      },
      lienRechercheHebergement: {
        allOf: [
          { $ref: '#/components/schemas/LienRechercheHebergement' },
        ],
        readOnly: true,
      },
      lienRechercheTransport: {
        allOf: [
          { $ref: '#/components/schemas/LienRechercheTransport' },
        ],
        readOnly: true,
        description:
          'Présent seulement sur un élément transport dont les deux extrémités se sont résolues. Un raccourci de recherche, jamais un billet.',
      },
      sejourHebergement: {
        allOf: [{ $ref: '#/components/schemas/SejourHebergement' }],
        readOnly: true,
      },
    },
  },
  Moment: {
    type: 'object',
    required: ['id', 'titre', 'elements'],
    additionalProperties: true,
    properties: {
      id:       { type: 'string' },
      titre:    { type: 'string' },
      elements: { type: 'array', items: { $ref: '#/components/schemas/Element' } },
    },
  },
  ContexteParcours: {
    type: 'object',
    additionalProperties: true,
    properties: {
      occupationHebergement: {
        allOf: [
          { $ref: '#/components/schemas/OccupationHebergement' },
        ],
        readOnly: true,
      },
      demandeTransport: {
        allOf: [{ $ref: '#/components/schemas/DemandeTransport' }],
        readOnly: true,
      },
    },
  },
  Parcours: {
    type: 'object',
    description: 'Agrégat complet (doc 06) : intention, contexte, éléments, dépendances, historique. Forme faisant foi : ParcoursSchema (Zod).',
    additionalProperties: true,
    properties: {
      id:         { type: 'string', format: 'uuid' },
      intention:  { type: 'object', additionalProperties: true },
      contexte:   { $ref: '#/components/schemas/ContexteParcours' },
      visibilite: { type: 'string', enum: ['prive', 'partage', 'surprise'] },
      timeline:   { type: 'array', items: { $ref: '#/components/schemas/Moment' } },
    },
  },
  ResumeParcours: {
    type: 'object',
    properties: {
      id:         { type: 'string', format: 'uuid' },
      intention:  { type: 'string', example: 'Un EVG à Lisbonne pour six' },
      visibilite: { type: 'string', enum: ['prive', 'partage', 'surprise'] },
      misAJourLe: { type: 'string', format: 'date-time' },
    },
  },
  EtatPartage: {
    type: 'object',
    description:
      'Le partage vu par l\'organisateur : la visibilité, et le lien de CHAQUE participant. ' +
      'Le serveur ne rend qu\'un chemin — le navigateur y met son origine.',
    properties: {
      visibilite: { type: 'string', enum: ['prive', 'partage', 'surprise'] },
      liens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            participantId: { type: 'string' },
            nom:           { type: 'string', example: 'Léo' },
            role:          { type: 'string', enum: ['organisateur', 'participant', 'heros'] },
            chemin:        { type: 'string', nullable: true, example: '/partage/8Kd2...' },
          },
        },
      },
    },
  },
  Preferences: {
    type: 'object',
    description: 'Mémoire simple (doc 07) : des contraintes SOUPLES, le brief prime toujours.',
    properties: {
      ambiances:      { type: 'array', items: { type: 'string' }, maxItems: 10 },
      rythme:         { type: 'string', enum: ['detendu', 'equilibre', 'intense'] },
      contraintes:    { type: 'array', items: { type: 'string' }, maxItems: 10 },
      lieuxFavoris:   { type: 'array', items: { type: 'string' }, maxItems: 10 },
      budgetHabituel: { type: 'number' },
    },
  },
};

// Réponses standard réutilisées ----------------------------------------------
const unauthorized = {
  description: 'Non authentifié (cookie tg_token absent ou invalide)',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};
const badRequest = {
  description: 'Requête invalide (échec de validation Zod)',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};
const forbidden = {
  description: 'Action interdite au rôle courant',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};
const notFound = {
  description: 'Ressource introuvable',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Experience AI — API',
    version: '2.0.0',
    description:
      "API REST d'Experience AI — cadrage d'une envie, génération d'un parcours, modification ciblée.\n\n" +
      "**Authentification** : JWT signé, transporté dans un cookie httpOnly `tg_token` " +
      "(un header `Authorization: Bearer <token>` est accepté en repli). " +
      "Sur les routes protégées, connectez-vous d'abord via `POST /api/auth/login` : " +
      "le cookie est posé automatiquement et renvoyé par le navigateur sur les appels suivants.\n\n" +
      "**Isolation des données** : filtre `user_id` systématique dans le dépôt, seule porte d'accès à la base.\n\n" +
      "**Méfiance envers le modèle** : toute sortie de LLM est revalidée (Zod) avant d'être appliquée ; " +
      "c'est le domaine qui accepte ou refuse une modification, jamais le modèle.",
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Développement local' },
  ],
  tags: [
    { name: 'Auth',        description: 'Inscription, connexion, session' },
    { name: 'Parcours',    description: 'Cadrage, génération, lecture et modification ciblée' },
    { name: 'Préférences', description: 'Mémoire simple réinjectée à la génération' },
    { name: 'Partage',     description: 'Partager le parcours au groupe et recueillir son avis' },
    { name: 'Divers',      description: 'Photos, santé' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'tg_token' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas,
  },
  paths: {
    // ---------------- AUTH ----------------
    '/api/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Créer un compte',
        description: 'Valide (Zod), vérifie l\'unicité de l\'email, hashe le mot de passe (bcrypt) et pose le cookie JWT.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email:    { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6, example: 'secret123' },
                  name:     { type: 'string', minLength: 2, example: 'Alexis' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Compte créé (cookie posé)', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
          400: badRequest,
          409: { description: 'Email déjà utilisé', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Se connecter',
        description: 'Vérifie le mot de passe (bcrypt.compare) puis pose le cookie httpOnly. Message d\'erreur unique (anti-énumération).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email:    { type: 'string', format: 'email', example: 'demo@experience-ai.fr' },
                  password: { type: 'string', example: 'secret123' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Connecté (cookie posé)', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
          400: badRequest,
          401: { description: 'Email ou mot de passe incorrect', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Se déconnecter',
        description: 'Efface le cookie tg_token.',
        responses: { 200: { description: 'Déconnecté', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Profil de l\'utilisateur connecté',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: { description: 'Profil', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
          401: unauthorized,
        },
      },
    },

    // ---------------- PARCOURS ----------------
    '/api/parcours/dialogue': {
      post: {
        tags: ['Parcours'],
        summary: 'Cadrer l\'envie (une réponse, une question à la fois)',
        description: 'Étapes 1→3 du doc 05 : l\'intake ne pose que les questions nécessaires et renvoie le brief compris, reformulé, à confirmer avant génération.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  brief:   { $ref: '#/components/schemas/BriefPartiel', description: 'Brief partiel de l\'échange précédent' },
                  message: { type: 'string', minLength: 1, maxLength: 500, example: 'Un EVG à Lisbonne, six personnes, un week-end de juin' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Étape suivante du dialogue (question, ou brief complet à confirmer)', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          400: badRequest,
          401: unauthorized,
          429: { description: 'Trop de messages (rate-limit)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/parcours': {
      post: {
        tags: ['Parcours'],
        summary: 'Générer un parcours depuis un brief confirmé',
        description:
          'Étape 4 du doc 05. Le brief et les données essentielles sont validés avant l’appel au modèle. ' +
          'Sans fournisseur transport, seuls la demande utilisateur et des transports génériques estimés peuvent être persistés : aucun horaire vérifié, lien, réservation ou disponibilité.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['brief'], properties: { brief: { $ref: '#/components/schemas/Brief' } } } } },
        },
        responses: {
          201: { description: 'Parcours généré et sauvegardé', content: { 'application/json': { schema: { type: 'object', properties: { parcours: { $ref: '#/components/schemas/Parcours' } } } } } },
          400: badRequest,
          401: unauthorized,
          429: { description: 'Trop de générations (rate-limit)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          422: { description: 'Refus métier : données essentielles insuffisamment fiables, séjour hôtelier incomplet, ou besoin/tronçon/occupation transport non confirmé', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          502: { description: 'Génération inexploitable (sortie refusée à la validation)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          503: { description: 'Fournisseur IA ou sources de vérification indisponibles', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      get: {
        tags: ['Parcours'],
        summary: 'Lister mes parcours (résumés)',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: { description: 'Mes parcours', content: { 'application/json': { schema: { type: 'object', properties: { parcours: { type: 'array', items: { $ref: '#/components/schemas/ResumeParcours' } } } } } } },
          401: unauthorized,
        },
      },
    },
    '/api/parcours/preferences': {
      get: {
        tags: ['Préférences'],
        summary: 'Lire ma mémoire',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: { description: 'Préférences (null si jamais renseignées)', content: { 'application/json': { schema: { type: 'object', properties: { preferences: { $ref: '#/components/schemas/Preferences' } } } } } },
          401: unauthorized,
        },
      },
      put: {
        tags: ['Préférences'],
        summary: 'Enregistrer ma mémoire',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Preferences' } } } },
        responses: {
          200: { description: 'Préférences enregistrées', content: { 'application/json': { schema: { type: 'object', properties: { preferences: { $ref: '#/components/schemas/Preferences' } } } } } },
          400: badRequest,
          401: unauthorized,
        },
      },
    },
    '/api/parcours/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Parcours'],
        summary: 'Lire un parcours',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: { description: 'Parcours', content: { 'application/json': { schema: { type: 'object', properties: { parcours: { $ref: '#/components/schemas/Parcours' } } } } } },
          400: badRequest,
          401: unauthorized,
          404: notFound,
        },
      },
      delete: {
        tags: ['Parcours'],
        summary: 'Supprimer un parcours',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { 204: { description: 'Supprimé' }, 400: badRequest, 401: unauthorized, 404: notFound },
      },
    },
    '/api/parcours/{id}/modifications': {
      post: {
        tags: ['Parcours'],
        summary: 'Modifier un élément sans tout régénérer',
        description:
          'Deux entrées possibles : une demande structurée (le front sait déjà quoi changer) ou une phrase que l\'agent Modification traduit. ' +
          'Dans les deux cas le domaine applique ou refuse. La régénération des dépendants (invariant 3) est faite ENTIÈREMENT en mémoire sur une copie avant toute écriture ; ' +
          '`elementsARegenerer` liste les ids déjà régénérés par le serveur dans la réponse — le front n’a rien à redemander. ' +
          'Un seul commit persiste le résultat final : si une étape échoue avant la validation complète, rien n’est écrit. ' +
          'Les preuves externes sont produites uniquement par le serveur. Une modification hôtelière peut mettre à jour un séjour ou une occupation déclarée, ou demander un remplacement qui repasse par Foursquare. ' +
          'Le lien Booking rendu est seulement une recherche : l’API ne fournit ni réservation ni disponibilité.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['demande'],
                    additionalProperties: false,
                    properties: {
                      demande: {
                        $ref:
                          '#/components/schemas/DemandeModificationClient',
                      },
                    },
                  },
                  {
                    type: 'object',
                    required: ['phrase'],
                    additionalProperties: false,
                    properties: {
                      phrase: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 500,
                        example: 'Change le resto du jour 3',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Modification appliquée',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    parcours:           { $ref: '#/components/schemas/Parcours' },
                    elementsARegenerer: { type: 'array', items: { type: 'string' } },
                    description:        { type: 'string', example: 'Restaurant du jour 3 remplacé' },
                  },
                },
              },
            },
          },
          400: badRequest,
          401: unauthorized,
          403: forbidden,
          404: notFound,
          422: { description: 'Modification refusée : elle rendrait le parcours incohérent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          503: {
            description:
              'Dépendance externe indispensable momentanément indisponible, par exemple Foursquare lors d’un remplacement hôtelier',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },

    // ---------------- PARTAGE ----------------
    // Un jeton par participant : c'est lui qui dit QUI consulte, donc quel rôle
    // s'applique. Consulter et réagir ne demandent pas de compte ; décider —
    // modifier, convier, changer la visibilité — en exige toujours un.
    '/api/parcours/{id}/partage': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Partage'],
        summary: 'État du partage : visibilité et lien de chaque participant',
        description: '`chemin` vaut `null` quand le domaine refuse de remettre un lien — le héros d\'une surprise, ou tout le monde si le parcours est privé.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: { description: 'État du partage', content: { 'application/json': { schema: { $ref: '#/components/schemas/EtatPartage' } } } },
          400: badRequest,
          401: unauthorized,
          404: notFound,
        },
      },
      put: {
        tags: ['Partage'],
        summary: 'Choisir la visibilité (privé / partagé / surprise)',
        description: 'Réservé à l\'organisateur (invariant 8). Passer en privé révoque tous les liens ; passer en surprise révoque celui du héros.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['visibilite'],
                properties: { visibilite: { type: 'string', enum: ['prive', 'partage', 'surprise'] } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Visibilité appliquée', content: { 'application/json': { schema: { type: 'object', properties: { parcours: { $ref: '#/components/schemas/Parcours' }, partage: { $ref: '#/components/schemas/EtatPartage' } } } } } },
          400: badRequest,
          401: unauthorized,
          404: notFound,
          422: { description: 'Refusé : le rôle de l\'auteur ne couvre pas ce geste', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/parcours/{id}/participants': {
      post: {
        tags: ['Partage'],
        summary: 'Convier quelqu\'un au parcours',
        description: 'L\'id du participant est attribué par le serveur. Réservé à l\'organisateur.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['nom', 'role'],
                properties: {
                  nom:  { type: 'string', minLength: 1, maxLength: 60, example: 'Léo' },
                  role: { type: 'string', enum: ['organisateur', 'participant', 'heros'] },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Participant ajouté', content: { 'application/json': { schema: { type: 'object', properties: { parcours: { $ref: '#/components/schemas/Parcours' }, partage: { $ref: '#/components/schemas/EtatPartage' } } } } } },
          400: badRequest,
          401: unauthorized,
          404: notFound,
          422: { description: 'Refusé par le domaine', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/parcours/{id}/participants/{participantId}': {
      delete: {
        tags: ['Partage'],
        summary: 'Retirer un participant (son lien et ses avis partent avec lui)',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'participantId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Participant retiré', content: { 'application/json': { schema: { type: 'object', properties: { parcours: { $ref: '#/components/schemas/Parcours' }, partage: { $ref: '#/components/schemas/EtatPartage' } } } } } },
          400: badRequest,
          401: unauthorized,
          404: notFound,
          422: { description: 'Refusé : on ne retire pas l\'organisateur', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/partage/{jeton}': {
      get: {
        tags: ['Partage'],
        summary: 'Consulter un parcours partagé (sans compte)',
        description:
          'Le jeton désigne un participant : la réponse dit sous quelle identité on consulte. ' +
          'Jeton inconnu, parcours redevenu privé, ou surprise dont on est le héros donnent la MÊME réponse (404) — on ne renseigne jamais le curieux.',
        parameters: [{ name: 'jeton', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Parcours et identité du porteur', content: { 'application/json': { schema: { type: 'object', properties: { parcours: { $ref: '#/components/schemas/Parcours' }, participant: { type: 'object', additionalProperties: true } } } } } },
          400: badRequest,
          404: { description: 'Ce lien n\'est plus valide', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/partage/{jeton}/reactions': {
      post: {
        tags: ['Partage'],
        summary: 'Donner son avis sur un élément (sans compte)',
        description:
          'L\'avis ÉCLAIRE, il ne décide pas : il ne change ni le statut de l\'élément ni quoi que ce soit d\'autre — l\'organisateur tranche (invariant 8). ' +
          'Le vote formel est en V2. Un jeton ne permet aucune autre écriture.',
        parameters: [{ name: 'jeton', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['elementId', 'avis'],
                properties: {
                  elementId: { type: 'string' },
                  avis:      { type: 'string', enum: ['pour', 'contre'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Avis enregistré', content: { 'application/json': { schema: { type: 'object', properties: { parcours: { $ref: '#/components/schemas/Parcours' }, description: { type: 'string', example: 'Léo est contre « Karting »' } } } } } },
          400: badRequest,
          404: { description: 'Ce lien n\'est plus valide', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          422: { description: 'Refusé par le domaine', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ---------------- DIVERS ----------------
    '/api/photos/{city}': {
      get: {
        tags: ['Divers'],
        summary: 'Photo d\'une ville (proxy Unsplash)',
        parameters: [{ name: 'city', in: 'path', required: true, schema: { type: 'string' }, example: 'Lisbonne' }],
        responses: { 200: { description: 'URL de la photo', content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string', nullable: true } } } } } }, 400: badRequest },
      },
    },
    '/api/health': {
      get: {
        tags: ['Divers'],
        summary: 'Santé du serveur',
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, time: { type: 'string', format: 'date-time' } } } } } } },
      },
    },
  },
};
