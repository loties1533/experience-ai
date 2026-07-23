<div align="center">

# TripGenie

### AI-Powered Travel Pack Generator

**Décris ton voyage. TripGenie génère tout le reste.**

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Vitest](https://img.shields.io/badge/Vitest-303_tests-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)

[Demo Live](https://tripgenie-api.onrender.com) · [API Docs](http://localhost:3000/api/docs) · [Issues](https://github.com/loties1533/tripgenie-app/issues)

---

</div>

## Présentation

Les comparateurs de voyage (Booking, Kayak, TripAdvisor) retournent **300 résultats bruts**. L'utilisateur doit filtrer, comparer, décider seul.

**TripGenie fait la synthèse à sa place.**

L'utilisateur décrit son voyage en langage naturel → l'app génère un **pack complet clé en main** en moins de 30 secondes :

- Vols avec prix et compagnies (Tavily recherche web temps réel)
- Hôtels sélectionnés selon le style de voyage
- Restaurants réels via Foursquare → Yelp (fallback)
- Événements locaux via PredictHQ → Tavily (fallback)
- Itinéraire jour par jour
- Météo prévue (Open-Meteo, sans clé API)
- Budget ventilé par poste
- Score de qualité du pack (0–1, algorithme déterministe)

---

## Fonctionnalités

### Onboarding conversationnel
L'IA pose des questions naturelles pour extraire destination, budget, style, dates — et génère le pack à la fin. Pas de formulaire complexe.

### Données temps réel
Vols, hôtels et événements sont récupérés via **Tavily** (recherche web) et **PredictHQ** (événements structurés) pour éviter les hallucinations LLM sur les prix et disponibilités.

### 5 modes de voyage + niveau de prix
`party` · `student` · `group` · `relax` · `surprise` — chaque mode (la **vibe**) adapte le prompt IA, le scoring et la répartition budgétaire.

Le **niveau de prix** est un **axe indépendant** (`premium: boolean`), pas un mode : n'importe quelle vibe peut être **Classique** ou **Premium**. Premium relève les plafonds de dépenses (hôtels, restauration, activités), oriente le prompt vers le haut de gamme et privilégie les catégories fine-dining. Ce découplage remplace l'ancien mode `luxury` qui mélangeait à tort ambiance et budget.

### Chat de modification post-génération
Après génération, l'utilisateur modifie le pack en langage naturel : *"Change l'hôtel pour quelque chose de moins cher"* → le pack se met à jour sans tout régénérer. C'est la seule partie **agentique** du projet.

### Carte interactive
Visualisation des activités et hôtels sur une carte Leaflet avec marqueurs géolocalisés.

### Partage public
Chaque voyage génère un lien public `/share/:id` — consultable sans compte, sans exposer les données privées de l'utilisateur.

### Vote collectif
En mode groupe, chaque membre vote pour/contre les éléments du pack pour construire un consensus.

### Documentation API interactive
Interface Swagger disponible sur `/api/docs` — toutes les routes sont testables directement depuis le navigateur.

---

## Architecture

> **Pipeline IA orchestré côté serveur — pas un agent autonome.** Les étapes sont prédéfinies et s'enchaînent toujours dans le même ordre. Seul le chat de modification (`/api/ai/chat`) est agentique.

> **Diagrammes en haute définition** — architecture, **MCD (Merise)**, modèle relationnel, séquences et scoring sont disponibles (sources `.mmd` + rendus PNG) dans **[`docs/architecture/`](docs/architecture/)**.

### Architecture en couches (3-tier)

```mermaid
flowchart TB
    subgraph PRES["COUCHE PRÉSENTATION"]
        UI["Frontend React<br/>pages · composants · Zustand"]
        REST["API REST Express<br/>auth · trips · ai · votes · preferences · collaborators · photos"]
    end
    subgraph LOGIC["COUCHE LOGIQUE MÉTIER"]
        Sec["Auth JWT · bcrypt · Validation Zod · Rate-limit"]
        Pipe["Pipeline IA : analyze → search → assemble → score"]
        Svc["Services : scoring · smartSearch · LLM cascade · restaurants"]
    end
    subgraph PERS["COUCHE PERSISTANCE"]
        ORM["Prisma ORM"]
        DB[("PostgreSQL — 6 tables (Docker)")]
    end
    UI -->|"HTTPS · Cookie httpOnly (JWT)"| REST
    REST --> Sec --> Pipe --> Svc
    Svc -->|"requêtes typées"| ORM
    ORM --- DB
    Pipe -.->|"APIs externes"| EXT["Tavily · Foursquare/Yelp · PredictHQ · Open-Meteo · Unsplash · Claude/Gemini/OpenRouter"]
```

### Le pipeline de génération

```
POST /api/ai/generate
        │
        ├─ 1. Validation Zod
        │
        ├─ 2. Recherches parallèles (chacune timeout 30s) :
        │       Promise.allSettled([
        │         smartFlightSearch(),      ← Tavily : vols réels
        │         smartEventsSearch(),      ← PredictHQ → Tavily fallback
        │         smartHotelSearch()        ← Tavily : hôtels
        │       ])
        │       + getRealWeather()          ← Open-Meteo (sans clé), en parallèle
        │       + getDestinationPhoto()     ← Unsplash (proxy backend), en parallèle
        │       + foursquareSearch() → yelpSearch() (fallback)
        │
        ├─ 3. assemblePack()               ← LLM + données réelles injectées
        │      Claude → Gemini → OpenRouter (cascade fallback)
        │
        ├─ 4. Merge restaurants            ← Foursquare/Yelp dans activities
        │
        ├─ 5. scorepack()                  ← Algorithme déterministe (0–1)
        │      pondération par mode de voyage
        │
        └─ 6. Sauvegarde PostgreSQL        ← via Prisma si l'utilisateur est connecté
```

### Cascade LLM (fallback automatique)

```
Claude Haiku  →  Gemini 2.0 Flash  →  OpenRouter (6 modèles gratuits)  →  Mocks statiques
```

Claude est le provider principal (JSON fiable) ; si sa clé est absente ou s'il échoue (quota, timeout 45s), le suivant prend le relais automatiquement. `Promise.allSettled` garantit que la génération continue même si un service externe est en panne.

### Séquence — génération d'un pack

```mermaid
sequenceDiagram
    actor U as Utilisateur
    participant F as Frontend
    participant A as API /ai/generate
    participant Ext as APIs externes
    participant LLM as LLM (cascade)
    participant DB as PostgreSQL
    U->>F: décrit son voyage (langage naturel)
    F->>A: POST /api/ai/generate
    A->>A: 1. Validation Zod
    par Recherches parallèles (Promise.allSettled)
        A->>Ext: vols · hôtels · événements · météo · photo
        A->>Ext: restaurants (Foursquare → Yelp)
    end
    Ext-->>A: données réelles
    A->>LLM: 2. assemblePack(données injectées)
    LLM-->>A: pack JSON structuré
    A->>A: 3. scoring déterministe (0–1)
    A->>DB: 4. sauvegarde via Prisma (si connecté)
    A-->>F: pack + score
    F-->>U: pack clé en main
```

---

## Base de données

PostgreSQL via l'**ORM Prisma**. Le schéma est défini dans `prisma/schema.prisma`, les requêtes sont **typées de bout en bout**, et PostgreSQL tourne en local dans **Docker**.

```sql
users        — Comptes, auth JWT custom
trips        — Voyages avec pack_data JSONB + score float 0-1
packs        — Packs générés par voyage (rank, selected)
trip_votes   — Votes collectifs par item (true/false)
preferences  — Préférences utilisateur (relation 1-1 avec users)
trip_collaborators — Collaborateurs par voyage (viewer/editor)
```

### Schéma relationnel (ERD)

```mermaid
erDiagram
    users ||--o{ trips : "possède"
    users ||--o| user_preferences : "a (1-1)"
    users ||--o{ trip_collaborators : "collabore"
    trips ||--o{ packs : "génère"
    trips ||--o{ trip_collaborators : "partagé via"
    packs ||--o{ trip_votes : "reçoit"
    users {
        uuid id PK
        text email UK
        text password
        text name
        text avatar_url
        timestamptz created_at
        timestamptz updated_at
    }
    trips {
        uuid id PK
        uuid user_id FK
        text title
        text destination
        text country
        text origin
        date departure
        date return_date
        int travelers
        text budget
        text mode
        text status
        float score
        jsonb pack_data
        timestamptz created_at
        timestamptz updated_at
    }
    packs {
        uuid id PK
        uuid trip_id FK
        int rank
        float score
        jsonb pack_data
        boolean selected
        timestamptz created_at
    }
    trip_votes {
        uuid id PK
        uuid pack_id FK
        text item_id
        text voter_name
        boolean vote_type
        timestamptz created_at
    }
    user_preferences {
        uuid user_id PK
        text default_mode
        text preferred_prefs
        text home_city
        text currency
        timestamptz updated_at
    }
    trip_collaborators {
        uuid trip_id PK
        uuid user_id PK
        text role
        timestamptz invited_at
    }
```

### Modèle Conceptuel de Données — MCD (Merise)

En amont du schéma relationnel ci-dessus, le **MCD** décrit les entités métier et leurs associations indépendamment de PostgreSQL. L'association **n-n** `COLLABORER` — porteuse de l'attribut *rôle* — se matérialise par la table d'association `trip_collaborators` (d'où le passage de 5 entités conceptuelles à 6 tables physiques).

![MCD Merise — 5 entités, 5 associations et cardinalités](docs/architecture/mcd.png)

### Isolation des données & autorisation

Les routes de **liste** filtrent systématiquement par utilisateur — `where: { user_id }`, l'`id` provenant du JWT signé. Les routes ciblant **une ressource précise** (`/trips/:id`) passent par un **helper d'autorisation partagé** (`tripAccess.ts`) : accès accordé au propriétaire et aux collaborateurs selon leur rôle (`editor` = lecture + écriture, `viewer` = lecture), tout accès non autorisé renvoyant 404. Un utilisateur ne peut donc jamais accéder aux données d'un autre sans y avoir été invité (vérifié dans la suite de tests sécurité).

```typescript
// Route de liste : un utilisateur ne voit que SES voyages
const trips = await prisma.trip.findMany({
  where: { user_id: req.user.id },
});
```

---

## Algorithme de Scoring

100% déterministe — zéro IA. Même entrée → même sortie. Score float entre 0 et 1.

| Mode | Hôtel | Activités | Vols | Prix | Événements | Calme |
|------|-------|-----------|------|------|------------|-------|
| party | 25% | 35% | 10% | 20% | 10% | — |
| student | 20% | 25%* | — | 45% | 10% | — |
| group | 35% | 30% | 15% | 20% | — | — |
| relax | 30% | 25% | — | 10% | — | 35% |
| surprise | — | — | — | — | — | — (global 60% + originalité 40%) |

*activités gratuites uniquement en mode student

Le scoring mesure l'adéquation à la **vibe** demandée ; le niveau de prix `premium` n'entre pas dans le scoring (c'est un axe budgétaire, pas de vibe).
Le mode `surprise` utilise une pondération à part (score global 60% + originalité 40%).

---

## Stack Technique

### Frontend
| Technologie | Rôle |
|-------------|------|
| React 18 + Vite | UI déclarative, HMR ultra-rapide |
| TypeScript | Typage statique partagé front/back |
| React Router v6 | SPA — navigation sans rechargement |
| Zustand v5 | State management global (auth + trips) |
| React Query v5 | Cache + fetching automatique |
| Tailwind CSS | Styles utilitaires |
| sonner | Notifications (toasts) |
| Leaflet | Carte interactive |
| Recharts | Graphique budget breakdown |
| react-helmet-async | Balises meta dynamiques (SEO par page) |
| date-fns | Formatage des dates |
| clsx | Classes CSS conditionnelles |

### Backend
| Technologie | Rôle |
|-------------|------|
| Node.js ≥18 + Express 4 | Runtime + framework HTTP |
| TypeScript | Typage statique strict (ES2022, NodeNext) |
| Prisma 6 | ORM typé pour PostgreSQL — requêtes type-safe, migrations versionnées |
| Zod v4 | Validation des inputs — aucun endpoint sans validation |
| JWT + bcryptjs | Auth stateless + hashage bcrypt (genSalt 10) |
| cookie-parser | Lecture cookie httpOnly `tg_token` |
| Helmet + CORS | Headers de sécurité HTTP |
| express-rate-limit | Protection DDoS (10 req/h routes IA) |
| swagger-ui-express | Documentation API interactive sur `/api/docs` |
| Morgan | Logger HTTP (méthode, route, status, durée) |

### IA & Services externes
| Service | Rôle | Fallback |
|---------|------|---------|
| Anthropic Claude Haiku | LLM principal (JSON fiable, appelé en premier si clé configurée) | Gemini |
| Google Gemini 2.0 Flash | LLM secondaire (repli, quota gratuit) | OpenRouter |
| OpenRouter | LLM tertiaire — 6 modèles gratuits | Mocks statiques |
| Tavily | Recherche web temps réel (vols, hôtels) | Données IA |
| PredictHQ | Événements structurés (concerts, festivals) | Tavily |
| Foursquare Places | Restaurants réels (1000 req/jour gratuit) | Yelp |
| Yelp Fusion | Restaurants fallback | `[]` (pack sans restos) |
| Open-Meteo | Météo temps réel — **sans clé API** | Données IA |
| Unsplash | Photos destinations (proxy backend) | Placeholder |

---

## Sécurité

| Menace | Solution |
|--------|----------|
| Vol de token JWT | Cookie httpOnly `tg_token` — inaccessible depuis JavaScript |
| XSS | Token hors portée JS + Helmet CSP headers |
| CSRF | `sameSite: strict` sur le cookie |
| Injection SQL | Prisma ORM — requêtes paramétrées automatiquement |
| Inputs malveillants | Validation Zod sur tous les endpoints |
| Spam / DDoS | Rate limiting par IP (global + par route IA) |
| Exposition clés API | Proxy backend Unsplash, variables d'env serveur uniquement |
| Accès inter-utilisateurs | Filtre `where: { user_id }` sur les listes + helper d'autorisation (propriétaire / editor / viewer) sur les ressources ciblées |
| IDOR | 404 si accès non autorisé (pas de 403 qui confirmerait l'existence de la ressource) |

### Séquence — authentification (login JWT)

```mermaid
sequenceDiagram
    actor U as Utilisateur
    participant F as Frontend
    participant A as API /auth/login
    participant DB as PostgreSQL (Prisma)
    U->>F: email + mot de passe
    F->>A: POST /api/auth/login
    A->>DB: findUnique({ email })
    DB-->>A: utilisateur + hash bcrypt
    A->>A: bcrypt.compare(motDePasse, hash)
    A->>A: jwt.sign({ id, email })
    A-->>F: 200 + Cookie httpOnly (tg_token)
    F-->>U: connecté
```

---

## Tests

```bash
npm test          # fichiers core (~0.8s)
npm run test:all  # 18 fichiers · 303 tests
```

```
tests/
├── api.test.ts                        — routes API (CRUD trips, auth, packs)
├── golden_path.test.ts                — scénario complet end-to-end
├── middleware.test.ts                 — auth, rate-limit, validation middleware
├── scoring.test.ts                    — algorithme scoring tous modes
├── unit/
│   ├── scoring-party.test.ts          — scoring mode party
│   ├── smartSearch-hotel.test.ts      — recherche hôtels
│   ├── pack-functions.test.ts         — fonctions d'assemblage de pack
│   └── liens.test.ts                  — service liens/URLs
├── services/
│   ├── predictHQ.test.ts              — événements PredictHQ
│   ├── foursquare.test.ts             — restaurants Foursquare
│   └── yelp.test.ts                   — fallback Yelp
├── security/
│   ├── auth-signup.test.ts            — inscription, bcrypt, cookie
│   ├── auth-login.test.ts             — connexion, JWT, logout
│   ├── auth-tokens.test.ts            — expiration, alg:none, IDOR
│   └── input-validation.test.ts       — Zod toutes routes
└── integration/
    ├── generate-restaurants.test.ts   — pipeline FSQ→Yelp
    ├── collaborators.test.ts          — gestion collaborateurs
    └── preferences.test.ts            — préférences utilisateur
─────────────────────────────────────────────────────────────────
  18 fichiers / 303 tests au total, services externes mockés (zéro clé API requise)
```

---

## Installation locale

### Prérequis
- Node.js ≥ 18
- PostgreSQL (en local via Docker — voir `docker-compose.yml`)
- Au moins une clé LLM (Gemini gratuit suffit)

### Setup

```bash
# 1. Cloner le repo
git clone https://github.com/loties1533/tripgenie-app.git
cd tripgenie-app

# 2. Installer les dépendances backend
npm install

# 3. Configurer les variables d'environnement
cp .env.example .env
# Remplir .env avec tes clés API

# 4. Lancer en développement
npm run dev          # Backend Express → http://localhost:3000
npm run client:dev   # Frontend Vite  → http://localhost:3001

# 5. Documentation API interactive
# http://localhost:3000/api/docs
```

### Variables d'environnement

```env
# Serveur
PORT=3000
NODE_ENV=development
JWT_SECRET=your-strong-secret-here
CLIENT_URL=http://localhost:3001

# Base de données (PostgreSQL via Prisma)
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/tripgenie?schema=public

# IA (au moins une clé requise — fallback automatique)
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...      # optionnel (Claude Haiku) — laisser vide si pas de clé API Anthropic
OPENROUTER_API_KEY=...

# Services (optionnels — fallback IA si absent)
TAVILY_API_KEY=...
UNSPLASH_ACCESS_KEY=...
FOURSQUARE_API_KEY=...
PREDICTHQ_API_KEY=...
# Open-Meteo : aucune clé requise
```

> Ne jamais committer le `.env` réel. Le `.env.example` ne contient aucune valeur sensible.

---

## Structure du projet

```
tripgenie/
├── server/                     # Backend Node.js / Express / TypeScript
│   ├── index.ts                # Point d'entrée — middleware, routes, démarrage
│   ├── routes/                 # auth · trips · ai · votes · photos
│   │                           # preferences · collaborators
│   ├── middleware/
│   │   ├── auth.ts             # requireAuth · optionalAuth (cookie + Bearer)
│   │   ├── limiter.ts          # Rate limiters (generate 10/h, chat 30/15min, auth 10/15min)
│   │   └── validation.ts       # Middleware de validation Zod centralisé
│   ├── services/
│   │   ├── claude/             # Pipeline IA principal
│   │   │   ├── core.ts         # Orchestrateur — appel LLM cascade
│   │   │   ├── analyze.ts      # Analyse intention utilisateur
│   │   │   ├── pack.ts         # Assemblage du pack voyage
│   │   │   ├── chat.ts         # Chat de modification agentique
│   │   │   └── index.ts        # Exports
│   │   ├── tools/
│   │   │   └── webSearch.ts    # Outil recherche web (Tavily, usage agentique)
│   │   ├── providers.ts        # Adaptateurs multi-LLM (Claude / Gemini / OpenRouter)
│   │   ├── scoring.ts          # Algorithme scoring déterministe 0–1
│   │   ├── smartSearch.ts      # Recherche vols / hôtels / événements (Tavily)
│   │   ├── foursquare.ts       # Restaurants réels Foursquare
│   │   ├── yelp.ts             # Restaurants fallback Yelp
│   │   ├── predictHQ.ts        # Événements structurés PredictHQ
│   │   ├── weather.ts          # Météo Open-Meteo (sans clé)
│   │   ├── photo.ts            # Photo destination Unsplash
│   │   ├── liens.ts            # Génération de liens enrichis
│   │   └── mocks.ts            # Fallback données statiques
│   ├── lib/
│   │   ├── AppError.ts         # Classe erreur custom + middleware global
│   │   ├── constants.ts        # MODES, BUDGET_RATIOS, DEFAULT_VALUES
│   │   ├── types.ts            # Types TypeScript partagés
│   │   ├── keys.ts             # Helpers clés API
│   │   └── url.ts              # Utilitaires URL
│   ├── db/
│   │   └── prisma.ts           # Client Prisma singleton
│   └── docs/
│       └── openapi.ts          # Spec OpenAPI 3.0.3 — toutes routes documentées
│
├── client-react/               # Frontend React / Vite / TypeScript
│   └── src/
│       ├── pages/              # Home · Trips · TripDetail · Login · Preferences
│       ├── components/
│       │   ├── chat/           # ChatWidget · ModifyChat
│       │   ├── results/        # PackResults · PackSkeleton · TripMap · VoteButtons
│       │   ├── layout/         # Header + PageLayout
│       │   └── ui/             # Atomes réutilisables · GenerationLoader · Logo
│       ├── store/index.ts      # Zustand : useSearchStore · useChatStore · useAuthStore · useThemeStore
│       └── lib/api.ts          # Toutes les requêtes HTTP vers l'API
│
├── prisma/
│   ├── schema.prisma           # Schéma DB — 6 modèles, snake_case, migrations versionnées
│   └── seed.ts                 # Données de test initiales
├── tests/                      # Vitest + Supertest — tous services mockés
├── .github/workflows/          # GitHub Actions CI (tests + tsc à chaque push)
└── render.yaml                 # Configuration déploiement Render (PaaS)
```

---

## Routes API

Documentation interactive complète → **`/api/docs`** (Swagger UI)

### Authentification
| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/api/auth/signup` | — | Création de compte (bcrypt + cookie JWT) |
| POST | `/api/auth/login` | — | Connexion + cookie httpOnly `tg_token` |
| POST | `/api/auth/logout` | — | Clear cookie |
| GET | `/api/auth/me` | Oui | Profil utilisateur connecté |

### IA
| Méthode | Route | Auth | Limite |
|---------|-------|------|--------|
| POST | `/api/ai/generate` | optionnel | 10/h/IP |
| POST | `/api/ai/chat` | optionnel | 30/15min/IP |
| POST | `/api/ai/analyze` | optionnel | 30/15min/IP |
| POST | `/api/ai/onboarding` | optionnel | 30/15min/IP |
| POST | `/api/ai/destinations` | optionnel | 10/h/IP |

### Voyages (CRUD complet)
| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/api/trips` | Oui | Liste (filtre mode/status, pagination) |
| POST | `/api/trips` | Oui | Créer un voyage |
| GET | `/api/trips/:id` | Oui | Détail + packs agrégés |
| PUT | `/api/trips/:id` | Oui | Modifier (title, status, pack_data…) |
| DELETE | `/api/trips/:id` | Oui | Supprimer |
| GET | `/api/trips/share/:id` | public | Partage public d'un voyage |

### Autres ressources
| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET/PUT | `/api/preferences` | Oui | Préférences utilisateur |
| GET/POST | `/api/trips/:id/collaborators` | Oui | Collaborateurs |
| DELETE | `/api/trips/:id/collaborators/:uid` | Oui | Retirer un collaborateur |
| POST | `/api/votes` | public | Voter sur un élément |
| GET | `/api/votes/:pack_id` | public | Récupérer les votes |
| GET | `/api/photos/:city` | public | Photo destination (proxy Unsplash) |
| GET | `/api/health` | public | Healthcheck |

---

<div align="center">

**Projet solo — Juin 2026**

*TripGenie — Explorez le monde, l'IA s'occupe du reste.*

</div>
