<div align="center">

# Experience AI

### Transformer une intention en parcours personnalisé

**Dis ce que tu veux vivre. Le produit construit le parcours — et tu le modifies élément par élément.**

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Vitest](https://img.shields.io/badge/Vitest-tests_verts-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)

[Documentation produit](docs/README.md) · [Modèle de domaine](docs/06-modele-conceptuel.md) · [Décisions (ADR)](docs/11-decisions.md)

---

</div>

## Ce qu'est ce produit

La plupart des plateformes commencent par « où veux-tu aller ? ». Experience AI commence par **« qu'as-tu envie de vivre ? »**.

À partir d'une intention (une envie, une passion, une occasion) et d'un contexte (avec qui, combien de temps, quel budget), le produit construit un **parcours** : une suite cohérente de moments, où chaque élément est justifié.

Le différenciateur n'est pas la génération — c'est la **modification ciblée** : *« change juste le resto du samedi soir »* ne reconstruit pas le week-end, il remplace un élément et ne recalcule que ce qui en dépend.

Le voyage n'est qu'un format parmi d'autres : une soirée, un EVG, un festival ou un séminaire suivent exactement le même modèle.

> **Ce produit succède à TripGenie**, dont il réutilise l'ossature technique mais **pas** le modèle : là où TripGenie figeait un « voyage » (vols, hôtels, itinéraire à 3 jours), Experience AI repose sur un modèle de domaine générique. Voir [ADR-0001](docs/decisions/ADR-0001.md).

---

## Architecture

Le projet est construit **produit d'abord, technique en dernier** : le modèle de domaine existe en TypeScript pur, indépendamment de la base et du transport.

```
server/
├── domaine/                  ← le cœur métier, zéro dépendance technique
│   ├── parcours/
│   │   ├── schema.ts         ← le modèle (Zod) : Parcours, Moment, Élément…
│   │   ├── invariants.ts     ← règles métier : dépendants, conflits, validation
│   │   └── modifications.ts  ← modification ciblée, pure et immuable
│   └── preferences.ts
├── agents/                   ← les usages du LLM, un rôle par fichier
│   ├── intake.ts             ← dialogue : ne poser que les questions utiles
│   ├── brief.ts              ← intention + contexte extraits et reformulés
│   ├── generation.ts         ← brief → parcours complet et justifié
│   └── modification.ts       ← langage naturel → demande de modification
├── depots/                   ← la seule frontière avec PostgreSQL
│   ├── depotParcours.ts      ← valide à chaque lecture, projette à chaque écriture
│   └── depotPreferences.ts
└── routes/                   ← auth · parcours · photos
```

**Pourquoi le domaine est séparé** : il est testable en quelques millisecondes, il survit à un changement de base ou de framework, et il reste la seule autorité sur ce qu'est un parcours valide. Les agents proposent, le domaine tranche.

### Les invariants du domaine

Le modèle porte des règles qui doivent **toujours** être vraies ([doc 06](docs/06-modele-conceptuel.md)) :

1. Un parcours a toujours une intention et un contexte
2. Chaque élément porte une justification
3. La portée d'un recalcul = la portée de la dépendance
4. Une réservation n'est jamais un achat dans le produit
5. Ni durée ni format fixes
6. L'utilisateur garde le dernier mot
7. Un arbitrage est définitif — une option écartée n'est jamais reproposée
8. Toute modification s'exerce dans le cadre du rôle de son auteur

---

## Démarrage

```bash
# 1. Dépendances
npm install

# 2. Configuration
cp .env.example .env        # puis renseigner JWT_SECRET et une clé LLM

# 3. Base de données (PostgreSQL isolé, port 5434)
docker compose up -d db
npx prisma migrate deploy

# 4. Développement (API + front)
npm run dev:all
```

> **La base est propre à ce projet** (port `5434`, base `experience_ai`). Elle n'est jamais partagée avec TripGenie, qui vit sur le `5433`. Ne pas réutiliser une `DATABASE_URL` de l'ancien projet.

### Tests

```bash
npx vitest run
```

La suite couvre le domaine (logique pure), les dépôts (Prisma mocké), les routes, l'authentification et la validation des entrées.

---

## API

Toutes les routes `parcours` exigent un JWT et filtrent sur l'utilisateur du token.

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/auth/signup` · `/api/auth/login` | Authentification |
| `POST` | `/api/parcours/dialogue` | Dialogue de cadrage : reformule et ne demande que ce qui manque |
| `POST` | `/api/parcours` | Génère un parcours à partir du brief validé |
| `GET` | `/api/parcours` | Liste les parcours de l'utilisateur |
| `GET` | `/api/parcours/:id` | Détail d'un parcours |
| `POST` | `/api/parcours/:id/modifications` | **Modification ciblée** d'un élément |
| `DELETE` | `/api/parcours/:id` | Supprime un parcours |
| `GET` `PUT` | `/api/parcours/preferences` | Mémoire simple : préférences réutilisées à la génération |

---

## Documentation

La documentation produit est la **source de vérité** du projet et vit dans le dépôt ([`docs/`](docs/README.md)) :

- **[00-13](docs/README.md)** — de la philosophie au modèle conceptuel, en passant par les histoires utilisateur et les capacités
- **[ADR](docs/11-decisions.md)** — chaque décision structurante, avec son contexte, ses alternatives et ses conséquences
- **[SPRINTS.md](docs/SPRINTS.md)** — le suivi de la refonte, sprint par sprint

Deux règles de gouvernance :

- **Le domaine n'évolue que sur preuve** — une preuve utilisateur (interview, test, usage réel) ou une preuve technique (le code révèle une impossibilité). Jamais sur une idée seule.
- **Une décision actée ne se rediscute pas ailleurs** — elle se lit dans son ADR.

---

## État du projet

Le modèle de domaine est **stable pour le MVP** : validé par crash-test contre six parcours très différents (passionné solo, couple avec surprise, soirée improvisée, famille, EVG, festival).

**Aucun vertical n'est retenu comme périmètre de validation.** Le produit ne dépend d'aucun d'entre eux : dès qu'un parcours se vit à plusieurs, il se partage et se modifie à plusieurs, que ce soit un EVG, un festival ou un week-end en famille. Le choix d'un premier marché reste une question ouverte (voir [questions ouvertes](docs/questions-ouvertes.md)).
