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
| R4 — Entrée orientée envie | Brief en langage naturel, dialogue minimal, reformulation avant génération | À venir |
| R5 — Mémoire simple | Préférences utilisateur | À venir |
| R6 — Bascule & nettoyage | Basculer les routes sur Parcours, **supprimer** le modèle Pack, maîtrise des coûts (cache) | À venir |

### Revue R1 (en cours)
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
