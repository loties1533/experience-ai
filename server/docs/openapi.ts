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
// Le détail du Parcours (éléments, dépendances, historique) n'est pas recopié
// ici : il est décrit par Zod dans server/domaine/parcours/schema.ts, seule
// autorité. La spec renvoie un objet libre plutôt qu'une copie qui divergerait.
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
  Parcours: {
    type: 'object',
    description: 'Agrégat complet (doc 06) : intention, contexte, éléments, dépendances, historique. Forme faisant foi : ParcoursSchema (Zod).',
    additionalProperties: true,
    properties: {
      id:         { type: 'string', format: 'uuid' },
      intention:  { type: 'object', additionalProperties: true },
      visibilite: { type: 'string', enum: ['prive', 'partage'] },
      elements:   { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
  },
  ResumeParcours: {
    type: 'object',
    properties: {
      id:         { type: 'string', format: 'uuid' },
      intention:  { type: 'string', example: 'Un EVG à Lisbonne pour six' },
      visibilite: { type: 'string', enum: ['prive', 'partage'] },
      misAJourLe: { type: 'string', format: 'date-time' },
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
                  brief:   { type: 'object', additionalProperties: true, description: 'Brief partiel de l\'échange précédent' },
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
        description: 'Étape 4 du doc 05. L\'orchestrateur produit un parcours complet (chaque élément justifié), le domaine le valide, le dépôt le sauvegarde.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['brief'], properties: { brief: { type: 'object', additionalProperties: true } } } } },
        },
        responses: {
          201: { description: 'Parcours généré et sauvegardé', content: { 'application/json': { schema: { type: 'object', properties: { parcours: { $ref: '#/components/schemas/Parcours' } } } } } },
          400: badRequest,
          401: unauthorized,
          429: { description: 'Trop de générations (rate-limit)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          502: { description: 'Génération inexploitable (sortie refusée à la validation)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
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
          'Dans les deux cas le domaine applique ou refuse, et renvoie `elementsARegenerer` : exactement ce qui dépend du changement.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { type: 'object', required: ['demande'], properties: { demande: { type: 'object', additionalProperties: true } } },
                  { type: 'object', required: ['phrase'], properties: { phrase: { type: 'string', minLength: 1, maxLength: 500, example: 'Change le resto du jour 3' } } },
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
          404: notFound,
          422: { description: 'Modification refusée : elle rendrait le parcours incohérent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
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
