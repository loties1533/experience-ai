<div align="center">

# Experience AI

### Le moteur qui transforme une intention en parcours personnalisé

**Ne dis pas où tu veux aller. Dis ce que tu veux vivre.**

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-18.17+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Vitest](https://img.shields.io/badge/Vitest-suite_automatisee-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)

[Documentation produit](docs/README.md) · [Modèle de domaine](docs/06-modele-conceptuel.md) · [Décisions (ADR)](docs/11-decisions.md) · [Suivi des sprints](docs/SPRINTS.md)

---

</div>

## Présentation

Les plateformes de voyage commencent toutes par la même question : *où veux-tu aller ?* Elles supposent que l'utilisateur connaît déjà sa destination — ce qui n'est vrai qu'une fois sur deux.

**Experience AI commence par une autre question : *qu'as-tu envie de vivre ?***

L'utilisateur décrit son envie en langage naturel → l'IA dialogue jusqu'à comprendre l'intention et le contexte → elle génère un **parcours cohérent** de moments justifiés, construit à partir de **vrais lieux** :

- Dialogue de cadrage qui ne pose que les questions manquantes, puis reformule pour validation
- Génération **outillée** : le modèle cherche de vrais lieux (Foursquare) et événements (PredictHQ) avant de répondre — il n'invente pas
- Chaque élément porte sa **justification** (pourquoi il sert l'intention) et, quand il vient d'un vrai lieu, son adresse
- **Modification chirurgicale** : remplacer un élément ne régénère pas le parcours, et ne recalcule que ses dépendances
- **Partage au groupe** par lien, avec visibilité privée / partagée / surprise (le héros d'un EVG ne voit rien de ce qu'on lui prépare)
- Le groupe **réagit** aux éléments (pour/contre) — l'organisateur tranche, l'avis éclaire sans décider
- **Mémoire simple** : les préférences enregistrées orientent les générations suivantes
- Cache mémoire des recherches externes ; chaque élément affiche son niveau
  **Vérifié / Estimé / Suggestion**, et l'absence des outils indispensables
  provoque une indisponibilité technique explicite

Un week-end romantique, un EVG, un festival, un séjour NBA, une soirée improvisée : **même moteur**, aucune notion de voyage câblée en dur.

---

## Ce qui distingue ce projet

> Experience AI **succède** à [TripGenie](https://github.com/loties1533/tripgenie-app), dont il réutilise l'ossature technique (auth, Express, Prisma, la cascade de fournisseurs LLM) — **mais pas le modèle.** TripGenie généra un `pack` de voyage figé (vols, hôtels, itinéraire à 3 jours) ; regénérer entièrement était le seul moyen de le modifier. Voir [ADR-0001](docs/decisions/ADR-0001.md).

Le projet a été conçu **produit d'abord, technique ensuite** : philosophie, définition du parcours, histoires utilisateur, modèle de domaine et capacités ont été verrouillés (`docs/00` → `docs/13`) avant la première ligne de code serveur — voir [`docs/README.md`](docs/README.md).

Le domaine porte des **invariants** qui doivent toujours être vrais ([doc 06](docs/06-modele-conceptuel.md)) :

1. Un parcours a toujours une intention et un contexte
2. Chaque élément porte une justification
3. La portée d'un recalcul = la portée de la dépendance
4. Une réservation n'est jamais un achat dans le produit — Experience AI organise, il ne réserve pas
5. Ni durée ni format fixes
6. L'utilisateur garde le dernier mot
7. Un arbitrage est définitif — une option écartée n'est jamais reproposée
8. Toute modification s'exerce dans le cadre du rôle de son auteur
9. Un élément vérifié porte sa provenance ; un lien officiel, de billetterie
   ou de carte ne peut pas habiller une simple suggestion

---

## Architecture

> **Le domaine est un module TypeScript pur, sans dépendance technique.** Il ne connaît ni la base, ni HTTP, ni le LLM — testable en quelques millisecondes, seule autorité sur ce qu'est un parcours valide. Les agents proposent, le domaine tranche.

```
server/
├── domaine/                    ← le cœur métier, zéro dépendance technique
│   ├── parcours/
│   │   ├── schema.ts           ← le modèle (Zod) : Parcours, Moment, Élément, Alternative…
│   │   ├── invariants.ts       ← dépendants, conflits d'horaires, responsabilités des rôles
│   │   └── modifications.ts    ← modification ciblée, pure et immuable
│   ├── transport/               ← contrats transport purs (F4-B1) : modes, tronçons, occupation
│   └── preferences.ts
├── agents/                     ← les usages du LLM, un rôle par fichier
│   ├── intake.ts               ← dialogue : n'extrait/ne pose que ce qui manque
│   ├── brief.ts                ← reformulation + normalisation (dates, transport, etc.)
│   ├── generation.ts           ← brief → parcours complet, outillé (recherche de vrais lieux)
│   └── modification.ts         ← langage naturel → demande structurée
├── services/
│   ├── claude/
│   │   ├── core.ts             ← cascade de fournisseurs LLM + boucle d'outils
│   │   └── outils.ts           ← chercher_lieux · chercher_evenements · consulter_meteo
│   ├── tools/webSearch.ts       ← candidats Web structurés fournis par Tavily
│   ├── liens.ts                 ← sélection métier puis contrôle réseau (branché en génération)
│   ├── liens/                   ← contrat, validation URL, sélection, DNS et redirections
│   ├── amadeus/                  ← aéroports (F4-C1) et vols (F4-C2) — **interne, non branché**
│   └── foursquare.ts · predictHQ.ts · weather.ts · modificationHotel.ts
├── depots/                     ← la seule frontière avec PostgreSQL
│   ├── depotParcours.ts        ← valide à chaque lecture, projette à chaque écriture
│   ├── depotPartage.ts         ← un jeton de partage par participant
│   └── depotPreferences.ts
└── routes/                     ← auth · parcours · partage (public) · photos
```

### Génération outillée : le modèle cherche avant de répondre

```mermaid
sequenceDiagram
    actor U as Utilisateur
    participant F as Front React
    participant A as agents/generation.ts
    participant LLM as Claude (boucle d'outils)
    participant Ext as Foursquare · PredictHQ
    participant D as Domaine (invariants)
    participant DB as PostgreSQL

    U->>F: décrit son envie (dialogue de cadrage)
    F->>A: POST /api/parcours (brief validé)
    loop jusqu'à 3 tours d'outils
        A->>LLM: brief + outils disponibles
        LLM->>Ext: chercher_lieux / chercher_evenements
        Ext-->>LLM: vrais lieux, en cache si déjà interrogés
        LLM-->>A: éléments justifiés, ou demande d'un tour de plus
    end
    A->>A: attribution des ids, dépendances filtrées
    A->>D: validerParcours()
    D-->>A: parcours valide, ou erreurs lisibles
    A->>DB: sauvegarde (agrégat JSON validé)
    A-->>F: parcours complet
```

> **Contrat F1 validé.** Une génération outillée indisponible ne retombe plus sur un
> modèle sans sources : l'API renvoie une erreur technique `503`. Une recherche
> exécutée mais vide peut encore produire une idée générique, toujours marquée
> **Suggestion**, sans faux nom propre ni faux lien. Les éléments vérifiés
> conservent leur source, leur fournisseur et leur date de récupération. Un
> manque métier de données essentielles produit un refus `422`. Voir
> le [plan de fiabilité](docs/14-fiabilite-parcours.md) et
> [ADR-0008](docs/decisions/ADR-0008.md).

### Résolution sécurisée des liens

Foursquare et PredictHQ établissent l'identité métier ; Tavily fournit ensuite
des candidats Web sans décider seul. La sélection est déterministe, puis le
candidat unique passe par la validation de l'URL, le contrôle DNS/SSRF, une
connexion Undici épinglée et le contrôle manuel des redirections. Une ambiguïté
ne produit aucun lien, et une redirection vers un autre domaine enregistrable
invalide les preuves de réservation ou de billetterie. Faute de preuve externe
forte, F2-B ne produit actuellement aucun lien qualifié d'officiel.

La résolution sécurisée des liens est **intégrée dans la génération active**
(F2-B1 à F2-B5) : `resoudreLien` est appelé depuis `agents/generation.ts` pour
chaque demande de lien rattachée à une identité métier. L'ancien adaptateur
groupé par ville, sans identité métier, a été supprimé après confirmation de
l'absence de consommateur. Le
[pipeline détaillé](docs/architecture/README.md#pipeline-de-résolution-des-liens)
est documenté avec ses limites actuelles.

### Hébergements et transport (F3, F4)

**Hébergements (terminé) :** un nom d'hôtel proposé par le LLM n'est jamais
une identité — il est confronté à Foursquare (catégorie Lodging), rattaché à
un séjour et une occupation déclarés, puis accompagné d'un lien de
**recherche** Booking qui ne prouve ni prix ni disponibilité. Les
modifications hôtelières sont verrouillées contre toute donnée forgée.

**Transport (en cours) :** le brief transport est validé en fail-closed (une
donnée essentielle manquante refuse ou dégrade en suggestion générique,
jamais un trajet inventé). Un connecteur Amadeus interne sait résoudre des
aéroports réels (F4-C1) et rechercher des candidats de vols structurés
(F4-C2) — **mais ces deux capacités sont internes et non branchées** : aucun
appel depuis la génération active, les routes publiques, l'OpenAPI, le front
ou la persistance. Aucun vol n'est donc encore présenté à un utilisateur.
Prochain sous-lot : F4-C3 (trains et transports locaux). Détail complet dans
[le plan de fiabilité](docs/14-fiabilite-parcours.md) et
[l'architecture](docs/architecture/README.md).

### Modification ciblée : le cœur du produit

*« Le paddle du samedi matin, remplace-le par quelque chose de moins physique »* ne régénère pas le parcours : le domaine cible l'élément, calcule ses dépendants (`elementsDependants`), et ne touche à rien d'autre. Vérifié en conditions réelles — sur un parcours de 11 éléments, 1 seul change, les 10 autres restent identiques au caractère près.

### Cascade LLM pour les tâches sans outils

```mermaid
flowchart LR
    Req["callAI()"] --> C{"Claude Haiku"}
    C -->|"OK"| Out["Réponse JSON"]
    C -->|"échec"| G{"Gemini 2.0 Flash"}
    G -->|"OK"| Out
    G -->|"échec"| O{"OpenRouter — modèles de secours"}
    O -->|"OK"| Out
    O -->|"échec"| M["Indisponibilité explicite<br/>(refusée par Zod en aval)"]
    M --> Out
```

La génération de parcours suit un contrat plus strict : sa boucle d'outils
Claude ne bascule pas vers `callAI()` si elle est indisponible. Tant que les
autres fournisseurs ne prennent pas eux-mêmes en charge les outils, elle
signale honnêtement l'indisponibilité au lieu de produire des lieux non vérifiés.

D'autres diagrammes (authentification, scalabilité) sont dans [`docs/architecture/`](docs/architecture/) — en Mermaid inline, rendus nativement par GitHub.

---

## Base de données

PostgreSQL via Prisma, requêtes typées de bout en bout. Le parcours se persiste comme un **agrégat** — une table, un contenu JSON validé à chaque lecture — plutôt qu'en 7-8 tables normalisées : voir [ADR-0007](docs/decisions/ADR-0007.md) pour le raisonnement.

```sql
users                  — comptes, auth JWT
parcours               — l'agrégat complet (intention, contexte, timeline, participants…)
                          + colonnes de projection pour lister/filtrer sans désérialiser
preferences_parcours   — mémoire simple, réutilisée à la génération
partages_parcours      — un jeton par participant, jamais par parcours (la surprise tient à ça)
```

> **Base isolée de TripGenie** : port `5434` / base `experience_ai` (TripGenie reste sur `5433` / `tripgenie`). Aucune donnée, aucun schéma partagé.

---

## Démarrage

Prérequis : **Node.js >= 18.17**, npm, Docker et Docker Compose. `undici`
assure le transport HTTP épinglé et `tldts` la comparaison des domaines
enregistrables.

```bash
# 1. Dépendances
npm install

# 2. Configuration
cp .env.example .env        # JWT_SECRET, une clé LLM et les connecteurs utiles

# 3. Base de données
docker compose up -d db
npx prisma migrate deploy

# 4. Développement (API + front)
npm run dev:all
```

`TAVILY_API_KEY` active uniquement la recherche Web de **candidats de liens** :
elle ne valide jamais automatiquement un site officiel. Les variables
Foursquare et PredictHQ sont détaillées, avec les autres clés réellement lues,
dans [`.env.example`](.env.example).

### Tests

```bash
npm test
npx tsc --noEmit
npm run lint
```

La suite couvre le domaine, les dépôts (Prisma mocké), les agents (LLM mocké —
aucun test n'appelle une vraie API), les routes, l'authentification, le partage
et la validation des entrées.

---

## API

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/auth/signup` · `/api/auth/login` · `/api/auth/logout` | Authentification |
| `POST` | `/api/parcours/dialogue` | Dialogue de cadrage : reformule, ne demande que ce qui manque |
| `POST` | `/api/parcours` | Génère un parcours à partir du brief validé (outillé) |
| `GET` | `/api/parcours` | Liste les parcours de l'utilisateur |
| `GET` | `/api/parcours/:id` | Détail d'un parcours |
| `POST` | `/api/parcours/:id/modifications` | **Modification ciblée** d'un élément |
| `DELETE` | `/api/parcours/:id` | Supprime un parcours |
| `GET` `PUT` | `/api/parcours/preferences` | Mémoire simple |
| `GET` `PUT` | `/api/parcours/:id/partage` | Visibilité et liens de partage |
| `POST` `DELETE` | `/api/parcours/:id/participants` | Constituer le groupe (organisateur) |
| `GET` | `/api/partage/:jeton` | **Sans compte** : consulter le parcours partagé |
| `POST` | `/api/partage/:jeton/reactions` | **Sans compte** : réagir à un élément |

Les deux dernières routes sont les seules ouvertes du produit : un jeton permet de consulter et réagir, jamais de modifier — modifier exige un compte **et** le rôle qui l'autorise (invariant 8).

---

## Documentation

La documentation produit vit dans le dépôt et fait foi ([`docs/`](docs/README.md)) — **repo as code**, pas de Notion ni de Drive séparé qui divergerait ([ADR-0006](docs/decisions/ADR-0006.md)) :

- **[00 → 13](docs/README.md)** — de la philosophie au modèle conceptuel, aux histoires utilisateur et aux capacités
- **[ADR](docs/11-decisions.md)** — chaque décision structurante : contexte, alternatives, pourquoi, conséquences
- **[SPRINTS.md](docs/SPRINTS.md)** — le suivi de la refonte, sprint par sprint, chaque revue reliée à sa PR

Deux règles de gouvernance :
- **Le domaine n'évolue que sur preuve** — une preuve utilisateur (interview, test, usage réel) ou technique (le code révèle une impossibilité). Jamais sur une idée seule.
- **Une décision actée ne se rediscute pas ailleurs** — elle se lit dans son ADR.

---

## État du projet

Le modèle de domaine est **stable pour le MVP** : validé par crash-test contre six parcours très différents (passionné solo, couple avec surprise, soirée improvisée, famille, EVG, festival), puis par une recette manuelle de bout en bout qui a corrigé deux défauts réels (le brief qui perdait des informations, la génération qui échouait sur des dates de fin légitimes).

Le backend de fiabilité est **avancé** : F0, F1, **F2 — lieux et événements**
et **F3 — hébergements** sont terminés. Provenance persistée, niveaux de
confiance visibles, suggestions génériques, refus métier et panne technique
séparés (ADR-0008) ; liens réels intégrés à la génération (F2-B5) ; identité
hôtelière Foursquare, séjour, occupation, lien de recherche Booking et
verrouillage des modifications (F3-B à F3-D).

**F4 — vols et transports** est **en cours**, jusqu'à F4-C2 : contrats de
domaine, génération fail-closed et connecteur Amadeus (aéroports, candidats de
vols) sont livrés, mais Amadeus reste **interne** — non appelé par la
génération active, les routes, l'OpenAPI, le front ou la persistance. **Aucun
vol n'est donc encore actif dans un parcours utilisateur.** Prochaine étape :
F4-C3 (trains et transports locaux structurés), puis l'intégration active.
Voir le
[plan détaillé](docs/14-fiabilite-parcours.md) et
[l'avancement par sprint](docs/SPRINTS.md).

**Ce projet n'est pas prêt pour un lancement public ou un démarchage
sérieux** : la règle du chantier reste « aucun faux parcours présenté comme
réel », et la recette de sortie (F9) n'est ouverte qu'une fois F4 à F8
terminés. **Aucun vertical n'est retenu comme périmètre de validation.** Le
scénario NBA servira d'abord de test de robustesse et l'EVG de test de
valeur, après la fiabilisation. Le choix du premier marché reste une
[question ouverte](docs/questions-ouvertes.md).
