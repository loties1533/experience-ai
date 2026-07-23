# Suivi Agile — Experience AI (refonte) puis TripGenie (historique)

## Refonte Experience AI — plan de build

> Démarré le 23 juillet 2026, une fois les étapes produit 1→5 verrouillées
> (docs 00→13 + ADR 0001→0006). Les sprints suivent les phases de la
> [roadmap](09-roadmap.md). Migration `Pack` → `Parcours` : construire le
> nouveau → basculer → supprimer l'ancien.

| Sprint | Objectif | Statut |
|--------|----------|--------|
| R1 — Modèle de domaine | Traduction de [06-modele-conceptuel](06-modele-conceptuel.md) en TypeScript pur (Zod + invariants + tests), zéro Prisma | Terminé |
| R2 — Persistance | Schéma Prisma déduit du domaine, migration, dépôt Parcours | Terminé |
| R3 — Cœur | Parcours = état adressable + opérations de modification ciblée (logique pure) | Terminé |
| R4 — Entrée orientée envie | Brief en langage naturel, dialogue minimal, reformulation avant génération | Terminé |
| R5 — Mémoire simple | Préférences utilisateur | Terminé |
| R6 — Bascule & nettoyage | Basculer les routes sur Parcours, **supprimer** le modèle Pack, maîtrise des coûts (cache) | En cours (R6a fait) |

### Board — backlog par sprint

> Le board vit ici (ADR-0006 : le repo fait foi — pas de Trello séparé qui
> divergerait). Une carte = une tâche livrable ; on coche au fil de l'eau,
> la revue de sprint raconte le reste.

**R4 — Entrée orientée envie** *(terminé le 23/07)*
- [x] Schéma Zod du **brief** (intention + contexte extraits du dialogue)
- [x] Service `agents/intake` : dialogue minimal (ne poser que les questions nécessaires), sortie LLM validée/sanitisée
- [x] Reformulation du brief compris, affichable avant génération
- [x] Service `agents/generation` : brief → Parcours complet (justification par élément)
- [x] Interprétation NL → `DemandeModification` (« change le resto du jour 3 »), le domaine reste seule autorité
- [x] Routes `parcours` (créer / lire / modifier / lister / supprimer) branchées sur le dépôt, authz sur chaque route

**R5 — Mémoire simple** *(terminé le 23/07)*
- [x] Préférences utilisateur (schéma + dépôt) injectées dans la génération
- [x] Routes GET/PUT `/api/parcours/preferences`

**R6 — Bascule & nettoyage** *(en cours)*
- [x] Front basculé sur les routes `parcours` (R6a, 23/07)
- [x] **Suppression** du modèle Pack (routes trips/votes, services pack, tables) — jamais deux modèles qui cohabitent
- [ ] Cache des appels externes (maîtrise des coûts)
- [ ] Recette manuelle de bout en bout

### Revue R1 (terminé le 23/07)
- 23/07 — Module `server/domaine/parcours/` créé : `schema.ts` (agrégat complet
  du doc 06, invariants 1-2 portés par Zod), `invariants.ts` (dépendants
  transitifs pour le recalcul ciblé, détection de conflits d'horaires durs,
  validation structurelle). 12 tests unitaires verts (`tests/unit/parcours.test.ts`),
  typecheck OK. Aucun code existant touché.
- 23/07 — Relecture critique du module (logique / dette / clean code) :
  détection des boucles de dépendances étendue aux cycles indirects
  (resto → bar → resto), comparaisons d'horaires passées de chaînes ISO à de
  vraies dates (les millisecondes faussaient l'ordre). 13 tests verts.
  Dette connue et assumée : `detecterConflits` est en O(n²) — sans enjeu à
  l'échelle d'un parcours (quelques dizaines d'éléments).

### Revue R2 (terminé le 23/07)
- Décision de traduction actée dans l'[ADR-0007](decisions/ADR-0007.md) : une
  table `parcours` (projections + `contenu` JSONB), le dépôt comme seule
  frontière — Zod à chaque lecture, projections dérivées à chaque écriture.
- Table `Parcours` ajoutée au schéma Prisma (migration
  `20260723170456_ajout_table_parcours`, appliquée), sans toucher aux tables
  Pack (suppression au sprint R6).
- Dépôt `server/depots/depotParcours.ts` : sauvegarder (refus d'écraser le
  parcours d'autrui), charger (rejette une ligne corrompue), lister, supprimer.
- 7 tests unitaires sur le dépôt (Prisma mocké, comme les tests existants) ;
  20 tests verts au total, typecheck OK.
- Relecture : dette assumée — la vérification de propriété puis l'upsert font
  deux requêtes non atomiques ; fenêtre théorique uniquement (il faudrait
  connaître l'UUID d'un parcours d'autrui pendant sa création), à revoir si
  l'app devient multi-instance.

### Revue R3 (terminé le 23/07)
- `server/domaine/parcours/modifications.ts` : quatre demandes validées par Zod
  (remplacer / supprimer / ajouter / changer le statut) et `appliquerModification`,
  pure et immuable — le parcours d'origine n'est jamais muté.
- **Pensé pour le front** : adressage stable (un remplacement garde l'id de
  l'élément remplacé), `elementsARegenerer` dit exactement quoi rafraîchir,
  chaque description et chaque erreur est affichable telle quelle.
- Toute modification qui rendrait le parcours incohérent est **refusée avant
  application** (validerParcours en aval) ; les acceptées sont journalisées
  dans l'historique (base de l'annulation, prévue V2).
- 13 tests rattachés aux invariants 3 et 6 et à l'histoire de Thomas
  (« change juste le resto ») ; 126 tests verts au total, typecheck OK.
- Relecture : choix assumé — un remplaçant porte **ses propres** dépendances
  (il n'hérite pas de celles du remplacé), c'est à la demande de décrire le
  graphe voulu. L'interprétation en langage naturel (« change le resto du
  jour 3 » → DemandeModification) est volontairement au sprint R4 : elle
  produira ces demandes, le domaine restant la seule autorité.

### Revue R4 (terminé le 23/07)
- **Deux IA distinctes**, actées dans le [doc 08](08-architecture-ia.md) réécrit :
  l'orchestrateur (`agents/generation.ts`, brief → parcours complet) et l'agent
  Modification (`agents/modification.ts`, phrase → une demande ciblée, incapable
  de régénérer l'ensemble). Plus l'intake (`agents/brief.ts` + `agents/intake.ts`) :
  cadrage, questions nécessaires uniquement, reformulation validée avant génération
  (cycle du doc 05, étapes 1→4).
- Méfiance systématique envers le LLM : sorties validées par Zod, ids attribués
  côté serveur, refs inventées écartées, le domaine applique ou refuse.
- Routes `/api/parcours` (dialogue, génération, lecture, liste, modifications,
  suppression) : authz partout, rate-limit IA, entrées Zod. La modification
  accepte une demande structurée (front) ou une phrase (agent).
- 10 tests agents (LLM mocké, frontière de validation réelle) ; 343 tests verts
  sur toute la suite (préexistants inclus), typecheck OK.
- Relecture : les échecs de `test:all` sans variables d'env (JWT_SECRET absent)
  sont préexistants et environnementaux — rien à voir avec la refonte ; la
  suite passe entière avec les variables fournies. Budget « ventilé » reporté :
  le prix par élément existe, la ventilation d'affichage viendra avec le front (R6).

### Revue R5 (terminé le 23/07)
- Mémoire simple (doc 07) : `domaine/preferences.ts` (schéma Zod — ambiances,
  rythme, contraintes récurrentes, lieux favoris, budget habituel), table
  `preferences_parcours` (migration `ajout_preferences_parcours`, même principe
  agrégat JSON que l'ADR-0007), dépôt `depotPreferences.ts`.
- Injection dans l'orchestrateur : les préférences sont des contraintes
  SOUPLES — « le brief prime toujours » est écrit dans le prompt même.
- Routes GET/PUT `/api/parcours/preferences` (déclarées avant `/:id`).
- 5 tests ; 348 verts au total, typecheck OK.
- Relecture : choix assumé — des préférences illisibles rendent `null` au lieu
  de bloquer (la mémoire ne doit jamais empêcher de générer). L'ancienne route
  `preferences` de TripGenie vit encore ; elle part au sprint R6 avec Pack.

### Revue R6a — reprise du front (23/07)
- Direction visuelle produite avec la skill **UI/UX Pro Max** et figée dans
  `design-system/experience-ai/MASTER.md` : style Aurora UI assagi, palette
  « aventure » (orange coucher de soleil + teal carte), Poppins / Open Sans.
- Pages reconstruites sur les routes `/api/parcours` : `Envie` (dialogue de
  cadrage + confirmation avant génération), `MesParcours`, `ParcoursDetail`
  (timeline, justification visible, actions par élément, modification en
  langage naturel, historique), `Preferences`, `Login`.
- Les éléments dépendants renvoyés par le domaine (`elementsARegenerer`) sont
  **surlignés** dans la timeline : la modification ciblée devient visible.
- Checklist UI Pro Max passée : cibles tactiles ≥ 44 px, libellés de champ
  explicites, focus clavier visible, `prefers-reduced-motion` respecté,
  squelettes de chargement, états vides guidés, icônes SVG (aucun emoji).
- Code mort supprimé (pages Home/Trips/TripDetail, composants results/ et
  chat/) ; typecheck, lint et build du client verts ; rendu vérifié au
  navigateur en 375 px et en bureau.
- Reste au sprint R6b : suppression du modèle Pack côté serveur (routes
  trips/votes/ai, services pack, tables), cache et recette de bout en bout.

### Revue R6b — suppression du modèle Pack (23/07)
- **Un seul modèle de domaine.** Routes supprimées : `trips`, `votes`,
  `collaborators`, `ai`, ainsi que l'ancienne route `preferences` de TripGenie.
  Il ne reste que `auth`, `parcours` et `photos`.
- Services partis avec elles : `claude/pack.ts`, `claude/chat.ts`,
  `claude/analyze.ts`, `scoring.ts`, `liens.ts`, `mocks.ts` et le helper
  `lib/tripAccess.ts`. `lib/types.ts` et `lib/constants.ts` sont réduits à ce
  qui sert encore (JWT, connecteurs externes) : le vocabulaire de l'ancien
  modèle (modes, ratios de budget, statuts de voyage) est parti avec lui.
- Le repli « aucun fournisseur IA » ne fabrique plus de fausse réponse à la
  forme attendue : il rend une indisponibilité explicite, que la validation Zod
  de l'appelant refuse proprement. Mieux vaut un refus lisible qu'un contenu
  inventé.
- Tables supprimées (migration `suppression_modele_pack`, écrite à la main —
  base indisponible au moment du nettoyage) : `trips`, `packs`, `trip_votes`,
  `trip_collaborators` et `user_preferences`. Restent `users`, `parcours` et
  `preferences_parcours`. `user_preferences` n'était plus lue que par l'ancienne
  route : la mémoire du produit vit dans `preferences_parcours` depuis R5.
- Tests : les suites qui ne testaient que du legacy sont supprimées ; celles qui
  testaient l'**authentification** à travers `/api/trips` ont été **réécrites**
  sur `/api/parcours` (middleware, tokens JWT, isolation inter-utilisateurs), et
  la suite de validation des entrées couvre désormais les routes parcours
  (dialogue, génération, modification, préférences). 189 tests verts, typecheck
  serveur et client OK, lint sans erreur.
- Conservé volontairement : les connecteurs de données réelles (Foursquare,
  Yelp, PredictHQ, météo, photo, recherche web, `smartSearch`) et leurs tests.
  Ils ne portaient pas le modèle Pack — ce sont des sources de données que la
  génération de parcours réutilisera pour sortir du tout-LLM. Ils ne sont
  appelés par aucune route pour l'instant : à rebrancher, sinon à supprimer.
- Reste au sprint R6c : cache des appels externes, recette manuelle de bout en
  bout, et réécriture du README (il décrit encore le produit TripGenie).

---

# TripGenie — Suivi Agile historique (sprints, revues et rétrospectives)

Projet mené en solo selon une approche Scrum, découpé en six sprints d'environ une
semaine. N'étant pas en équipe, j'ai tenu tour à tour les rôles de chef de projet,
de gestion de version, de qualité et de développement. Le suivi au quotidien se
faisait sur un board Trello, une colonne par sprint.

Board Trello (public) : https://trello.com/b/GfQ3gMc8/tripgenie-agile-board

---

## Planification des sprints

Le développement a été découpé en six sprints, les tâches priorisées avec la méthode
MoSCoW.

| Sprint | Période | Objectif | Statut |
|--------|---------|----------|--------|
| S1 — Fondations | 27 mai – 3 juin | Serveur, base de données, authentification, première génération de pack | Terminé |
| S2 — Pipeline IA et sécurité | 4 – 10 juin | Pipeline IA orchestré, scoring, validation des entrées | Terminé |
| S3 — Cœur IA | 11 – 19 juin | Passage en TypeScript, suite de tests, conteneurisation | Terminé |
| S4 — CRUD et fonctionnalités | 20 – 24 juin | Parcours complet, diagrammes, recette et corrections | Terminé |
| S5 — Industrialisation | 25 juin – 1 juillet | Migration Prisma, PostgreSQL en Docker, documentation | Terminé |
| S6 — Finalisation et mise en production | 2 – 8 juillet | Intégration continue, déploiement, accessibilité, performances | Terminé |
| S7 — Harmonisation et lisibilité | 9 – 13 juillet | Cohérence visuelle de l'interface, uniformisation des textes, clarté et allègement du code | En cours |

Priorisation MoSCoW : indispensable (authentification, génération, modification,
score) ; souhaitable (préférences, votes, collaborateurs, données réelles) ;
optionnel (partage public par lien) ; écarté pour la v1 (réservation et paiement
in-app).

Dépendances : base de données → authentification → pipeline IA → scoring → CRUD →
front-end → intégration continue → déploiement.

---

## Revues de sprint

À la fin de chaque sprint, je confrontais l'incrément livré à l'objectif fixé.

Sprint 1 — Inscription et connexion sécurisées (cookie httpOnly), base de données à
six tables, première génération de pack par un LLM.

Sprint 2 — Pipeline complet (recherches parallèles puis assemblage), scoring
déterministe, validation des entrées sur toutes les routes.

Sprint 3 — Suite de tests verte (Vitest et Supertest), conteneurisation Docker,
en-têtes de sécurité (Helmet).

Sprint 4 — Application de bout en bout (onboarding, pack, carte, mes voyages),
diagrammes, recette manuelle avec correction de quatre bugs.

Sprint 5 — Migration complète vers Prisma, PostgreSQL conteneurisé, rédaction de la
documentation technique.

Sprint 6 — Intégration continue verte à chaque push, déploiement sur Render,
ajustements d'accessibilité et de performance.

Sprint 7 — Reprise d'ensemble de l'interface (palette de couleurs resserrée,
arrondis et animations uniformisés, textes revus pour un ton plus sobre) et travail
de lisibilité côté serveur : messages et clés internes en français, retrait de code
inutilisé, simplification de la génération et du calcul de score.

---

## Rétrospectives

Après chaque revue, un point rapide sur ce qui a fonctionné, ce qui a posé problème
et ce que j'en ai retiré pour la suite.

Sprint 1 — Le socle a été posé proprement dès le départ (TypeScript strict, Prisma)
et l'authentification était solide. En revanche, les APIs externes (vols, hôtels) se
sont révélées peu fiables. J'ai décidé de prévoir des solutions de repli
systématiques, mises en place au sprint suivant.

Sprint 2 — Le passage à `Promise.allSettled` a réglé le point bloquant : un service
en panne n'interrompt plus la génération. Restaient les quotas des fournisseurs de
LLM, d'où la mise en place d'une cascade de repli (Claude, puis Gemini, puis
OpenRouter, puis des données de secours).

Sprint 3 — La suite de tests a servi de vrai filet de sécurité. Quelques
incohérences d'affichage sur les données générées m'ont amené à prévoir une recette
manuelle dédiée, réalisée au sprint 4.

Sprint 4 — La recette a permis de repérer et corriger des bugs d'affichage en direct
(camembert du budget, formats de dates). Pour ne pas casser le rythme, j'ai reporté
les anomalies mineures dans un backlog.

Sprint 5 — La bascule complète vers Prisma a rendu le code plus cohérent et plus
facile à maintenir. Il restait à étendre la couverture de tests, ce qui a été
poursuivi ensuite.

Sprint 6 — Le MVP est passé en production tout en restant couvert par les tests. Le
parcours collaborateur était d'abord incomplet (l'accès en lecture manquait), ce qui
m'a conduit à unifier le contrôle d'accès en lecture et en écriture.

Sprint 7 — Reprendre le front et le back avec du recul a nettement amélioré la
cohérence de l'ensemble : une charte visuelle et des composants unifiés d'un côté, un
code serveur plus lisible et plus simple à maintenir de l'autre. J'en retiens
l'intérêt de fixer tôt quelques conventions (couleurs, nommage) pour éviter que les
petites incohérences ne s'accumulent.

---

## Outils de suivi

- Board Trello (planification et statut des cartes) : https://trello.com/b/GfQ3gMc8/tripgenie-agile-board
- GitHub Issues (suivi des bugs et des tâches, douze issues fermées)
- GitHub Actions (intégration continue : tests et typecheck à chaque push)
