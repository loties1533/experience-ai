// =============================================
// TRIPGENIE — server/docs/openapi.ts
// Spécification OpenAPI 3.0 décrivant TOUTE l'API REST.
// Servie en interface interactive (« Swagger UI ») sur /api/docs
// → on peut lire ET tester chaque route depuis le navigateur.
//
// Pourquoi un fichier de spec à la main plutôt que des annotations ?
//   - Une seule source de vérité, lisible d'un coup d'œil.
//   - Aucune dépendance de génération à brancher sur chaque route.
//   - Le contrat d'API est versionné avec le code.
// =============================================

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
  Trip: {
    type: 'object',
    properties: {
      id:          { type: 'string', format: 'uuid' },
      user_id:     { type: 'string', format: 'uuid' },
      title:       { type: 'string', nullable: true },
      destination: { type: 'string' },
      country:     { type: 'string', nullable: true },
      origin:      { type: 'string', nullable: true },
      departure:   { type: 'string', format: 'date', nullable: true },
      return_date: { type: 'string', format: 'date', nullable: true },
      travelers:   { type: 'integer' },
      budget:      { type: 'string', nullable: true },
      mode:        { type: 'string', enum: ['party', 'student', 'group', 'relax', 'surprise'] },
      premium:     { type: 'boolean', description: 'Niveau de prix haut de gamme (indépendant du mode)' },
      pack_data:   { type: 'object', description: 'Pack complet sérialisé (JSONB)', additionalProperties: true },
      score:       { type: 'number', nullable: true },
      status:      { type: 'string', enum: ['draft', 'confirmed', 'archived'] },
      created_at:  { type: 'string', format: 'date-time' },
      updated_at:  { type: 'string', format: 'date-time' },
    },
  },
  Pack: {
    type: 'object',
    properties: {
      id:        { type: 'string', format: 'uuid' },
      trip_id:   { type: 'string', format: 'uuid' },
      rank:      { type: 'integer', example: 1 },
      score:     { type: 'number', example: 0.78 },
      selected:  { type: 'boolean' },
      pack_data: { type: 'object', additionalProperties: true },
    },
  },
  Vote: {
    type: 'object',
    properties: {
      id:         { type: 'string', format: 'uuid' },
      pack_id:    { type: 'string', format: 'uuid' },
      item_id:    { type: 'string', example: 'hotel_1' },
      voter_name: { type: 'string', example: 'Anonyme' },
      vote_type:  { type: 'boolean', description: 'true = pour, false = contre' },
      created_at: { type: 'string', format: 'date-time' },
    },
  },
  Preferences: {
    type: 'object',
    properties: {
      user_id:         { type: 'string', format: 'uuid' },
      default_mode:    { type: 'string', enum: ['party', 'student', 'group', 'relax', 'surprise'] },
      default_premium: { type: 'boolean', description: 'Niveau de prix premium par défaut' },
      preferred_prefs: { type: 'array', items: { type: 'string' } },
      home_city:       { type: 'string' },
      currency:        { type: 'string', example: 'EUR' },
      updated_at:      { type: 'string', format: 'date-time' },
    },
  },
  Score: {
    type: 'object',
    properties: {
      total:   { type: 'number', example: 0.78 },
      details: { type: 'object', additionalProperties: { type: 'number' } },
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
const notFound = {
  description: 'Ressource introuvable',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'TripGenie API',
    version: '1.0.0',
    description:
      "API REST de TripGenie — génération de packs de voyage par pipeline IA orchestré.\n\n" +
      "**Authentification** : JWT signé, transporté dans un cookie httpOnly `tg_token` " +
      "(un header `Authorization: Bearer <token>` est accepté en repli). " +
      "Sur les routes protégées, connectez-vous d'abord via `POST /api/auth/login` : " +
      "le cookie est posé automatiquement et renvoyé par le navigateur sur les appels suivants.\n\n" +
      "**Sécurité base** : isolation des données par filtre applicatif `user_id` systématique sur chaque requête Prisma (`where: { user_id }`).",
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Développement local' },
    { url: 'https://tripgenie-api.onrender.com', description: 'Production (Render)' },
  ],
  tags: [
    { name: 'Auth',          description: 'Inscription, connexion, session' },
    { name: 'IA',            description: 'Pipeline de génération + chat de modification' },
    { name: 'Voyages',       description: 'CRUD des voyages (trips)' },
    { name: 'Votes',         description: 'Consensus public sur les éléments d\'un pack' },
    { name: 'Préférences',   description: 'Préférences utilisateur (1-1)' },
    { name: 'Collaborateurs', description: 'Partage d\'un voyage (N-N)' },
    { name: 'Divers',        description: 'Photos, santé' },
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
                  email:    { type: 'string', format: 'email', example: 'demo@tripgenie.app' },
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

    // ---------------- IA ----------------
    '/api/ai/generate': {
      post: {
        tags: ['IA'],
        summary: 'Générer un pack de voyage (pipeline orchestré)',
        description:
          'Recherches parallèles (Promise.allSettled : vols, événements, hôtels, météo, photo, restos) → ' +
          'assemblage LLM → scoring déterministe. Sauvegardé si connecté. Limité à 10/heure/IP.',
        security: [{ cookieAuth: [] }, {}],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['destination', 'departure', 'budget', 'travelers'],
                properties: {
                  destination: { type: 'string', example: 'Lisbonne' },
                  origin:      { type: 'string', example: 'Paris' },
                  departure:   { type: 'string', format: 'date', example: '2026-07-10' },
                  return_date: { type: 'string', format: 'date', example: '2026-07-14' },
                  travelers:   { type: 'integer', minimum: 1, maximum: 20, example: 2 },
                  budget:      { type: 'number', minimum: 1, maximum: 50000, example: 1200 },
                  mode:        { type: 'string', enum: ['party', 'student', 'group', 'relax', 'surprise'], example: 'relax' },
                  premium:     { type: 'boolean', example: false, description: 'Niveau de prix haut de gamme' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Pack généré et scoré',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    pack:          { type: 'object', additionalProperties: true },
                    trip_id:       { type: 'string', nullable: true },
                    pack_id:       { type: 'string', nullable: true },
                    flights_found: { type: 'integer' },
                    events_found:  { type: 'integer' },
                    score:         { type: 'number' },
                  },
                },
              },
            },
          },
          400: badRequest,
          429: { description: 'Trop de générations (rate-limit)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/ai/chat': {
      post: {
        tags: ['IA'],
        summary: 'Modifier un pack par conversation (partie agentique)',
        description: 'Le LLM décide librement quoi modifier dans le pack. Persiste si connecté + trip_id fourni. 30 msg/15min/IP.',
        security: [{ cookieAuth: [] }, {}],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message:      { type: 'string', maxLength: 1000, example: 'Remplace l\'hôtel par quelque chose de moins cher' },
                  current_pack: { type: 'object', additionalProperties: true },
                  mode:         { type: 'string', enum: ['party', 'student', 'group', 'relax', 'surprise'] },
                  trip_id:      { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Réponse + modifications', content: { 'application/json': { schema: { type: 'object', properties: { reply: { type: 'string' }, modifications: { type: 'object', additionalProperties: true } } } } } },
          400: badRequest,
        },
      },
    },
    '/api/ai/analyze': {
      post: {
        tags: ['IA'],
        summary: 'Analyser une demande en langage naturel',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['input'], properties: { input: { type: 'string', maxLength: 1000, example: 'Un week-end festif à Barcelone pour 4 amis, budget 800€' } } } } } },
        responses: { 200: { description: 'Analyse extraite', content: { 'application/json': { schema: { type: 'object', properties: { analysis: { type: 'object', additionalProperties: true } } } } } }, 400: badRequest },
      },
    },
    '/api/ai/destinations': {
      post: {
        tags: ['IA'],
        summary: 'Suggérer des destinations selon le mode',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['party', 'student', 'group', 'relax', 'surprise'] }, premium: { type: 'boolean' }, budget: { type: 'number' }, travelers: { type: 'integer' }, duration: { type: 'integer' }, origin: { type: 'string' }, departure: { type: 'string', format: 'date' } } } } } },
        responses: { 200: { description: 'Liste de destinations', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, 400: badRequest },
      },
    },
    '/api/ai/onboarding': {
      post: {
        tags: ['IA'],
        summary: 'Onboarding conversationnel (extraction progressive)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['userMessage'], properties: { userMessage: { type: 'string', maxLength: 1000 }, currentData: { type: 'object', additionalProperties: true } } } } } },
        responses: { 200: { description: 'Données extraites + réponse', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, 400: badRequest },
      },
    },

    // ---------------- VOYAGES ----------------
    '/api/trips': {
      get: {
        tags: ['Voyages'],
        summary: 'Lister mes voyages',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'mode',   in: 'query', schema: { type: 'string' }, description: 'Filtrer par mode' },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'confirmed', 'archived'] } },
          { name: 'limit',  in: 'query', schema: { type: 'integer', default: 20, minimum: 1, maximum: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0, minimum: 0 } },
        ],
        responses: {
          200: { description: 'Voyages', content: { 'application/json': { schema: { type: 'object', properties: { trips: { type: 'array', items: { $ref: '#/components/schemas/Trip' } }, count: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } },
          401: unauthorized,
        },
      },
      post: {
        tags: ['Voyages'],
        summary: 'Créer un voyage manuellement',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['destination', 'mode'], properties: { destination: { type: 'string' }, mode: { type: 'string', enum: ['party', 'student', 'group', 'relax', 'surprise'] }, premium: { type: 'boolean' }, title: { type: 'string' }, country: { type: 'string' }, origin: { type: 'string' }, departure: { type: 'string', format: 'date' }, return_date: { type: 'string', format: 'date' }, travelers: { type: 'integer', minimum: 1, maximum: 50 }, budget: { oneOf: [{ type: 'string' }, { type: 'number' }] }, pack_data: { type: 'object', additionalProperties: true }, score: { type: 'number' } } } } } },
        responses: { 201: { description: 'Voyage créé', content: { 'application/json': { schema: { type: 'object', properties: { trip: { $ref: '#/components/schemas/Trip' } } } } } }, 400: badRequest, 401: unauthorized },
      },
    },
    '/api/trips/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Voyages'],
        summary: 'Détail d\'un voyage (+ ses packs)',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { 200: { description: 'Voyage', content: { 'application/json': { schema: { type: 'object', properties: { trip: { $ref: '#/components/schemas/Trip' } } } } } }, 401: unauthorized, 404: notFound },
      },
      put: {
        tags: ['Voyages'],
        summary: 'Mettre à jour un voyage',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, status: { type: 'string', enum: ['draft', 'confirmed', 'archived'] }, pack_data: { type: 'object', additionalProperties: true }, score: { type: 'number' }, travelers: { type: 'integer' }, budget: { oneOf: [{ type: 'string' }, { type: 'number' }] } } } } } },
        responses: { 200: { description: 'Voyage mis à jour', content: { 'application/json': { schema: { type: 'object', properties: { trip: { $ref: '#/components/schemas/Trip' } } } } } }, 400: badRequest, 401: unauthorized, 404: notFound },
      },
      delete: {
        tags: ['Voyages'],
        summary: 'Supprimer un voyage',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { 200: { description: 'Supprimé', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } }, 401: unauthorized },
      },
    },
    '/api/trips/share/{id}': {
      get: {
        tags: ['Voyages'],
        summary: 'Voir un voyage partagé (public, sans compte)',
        description: 'Lecture via fonction SECURITY DEFINER au périmètre minimal (aucune donnée utilisateur exposée).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Voyage public', content: { 'application/json': { schema: { type: 'object', properties: { trip: { type: 'object', additionalProperties: true } } } } } }, 404: notFound },
      },
    },

    // ---------------- COLLABORATEURS ----------------
    '/api/trips/{trip_id}/collaborators': {
      parameters: [{ name: 'trip_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Collaborateurs'],
        summary: 'Lister les collaborateurs (propriétaire)',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { 200: { description: 'Collaborateurs', content: { 'application/json': { schema: { type: 'object', properties: { collaborators: { type: 'array', items: { type: 'object', additionalProperties: true } } } } } } }, 401: unauthorized, 404: notFound },
      },
      post: {
        tags: ['Collaborateurs'],
        summary: 'Inviter un collaborateur par email',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, role: { type: 'string', enum: ['viewer', 'editor'], default: 'viewer' } } } } } },
        responses: { 201: { description: 'Invité', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, 400: badRequest, 401: unauthorized, 404: notFound },
      },
    },
    '/api/trips/{trip_id}/collaborators/{user_id}': {
      delete: {
        tags: ['Collaborateurs'],
        summary: 'Retirer un collaborateur (propriétaire)',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'trip_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'user_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: 'Retiré', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } }, 401: unauthorized, 404: notFound },
      },
    },

    // ---------------- VOTES ----------------
    '/api/votes': {
      post: {
        tags: ['Votes'],
        summary: 'Voter pour/contre un élément (public)',
        description: 'Accessible sans compte via lien de partage. 10 votes/min/IP.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['pack_id', 'item_id', 'vote_type'], properties: { pack_id: { type: 'string', format: 'uuid' }, item_id: { type: 'string', example: 'hotel_1' }, vote_type: { type: 'boolean' }, voter_name: { type: 'string', maxLength: 50 } } } } } },
        responses: { 201: { description: 'Vote enregistré', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, vote: { $ref: '#/components/schemas/Vote' } } } } } }, 400: badRequest },
      },
    },
    '/api/votes/{pack_id}': {
      get: {
        tags: ['Votes'],
        summary: 'Lister les votes d\'un pack',
        parameters: [{ name: 'pack_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Votes', content: { 'application/json': { schema: { type: 'object', properties: { votes: { type: 'array', items: { $ref: '#/components/schemas/Vote' } } } } } } } },
      },
    },

    // ---------------- PRÉFÉRENCES ----------------
    '/api/preferences': {
      get: {
        tags: ['Préférences'],
        summary: 'Lire mes préférences',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { 200: { description: 'Préférences (null si jamais créées)', content: { 'application/json': { schema: { type: 'object', properties: { preferences: { $ref: '#/components/schemas/Preferences' } } } } } }, 401: unauthorized },
      },
      put: {
        tags: ['Préférences'],
        summary: 'Créer/mettre à jour mes préférences (upsert)',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { default_mode: { type: 'string', enum: ['party', 'student', 'group', 'relax', 'surprise'] }, default_premium: { type: 'boolean' }, preferred_prefs: { type: 'array', items: { type: 'string' }, maxItems: 10 }, home_city: { type: 'string' }, currency: { type: 'string', minLength: 3, maxLength: 3, example: 'EUR' } } } } } },
        responses: { 200: { description: 'Préférences enregistrées', content: { 'application/json': { schema: { type: 'object', properties: { preferences: { $ref: '#/components/schemas/Preferences' } } } } } }, 400: badRequest, 401: unauthorized },
      },
    },

    // ---------------- DIVERS ----------------
    '/api/photos/{city}': {
      get: {
        tags: ['Divers'],
        summary: 'Photo d\'une ville (proxy Unsplash)',
        parameters: [{ name: 'city', in: 'path', required: true, schema: { type: 'string' }, example: 'Tokyo' }],
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
