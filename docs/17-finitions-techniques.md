# 17 — Finitions techniques et validation des intégrations

> Dernière passe après la fermeture du chantier fiabilité F0-F9 et de la revue UI-A→UI-D.
> Aucune nouvelle fonctionnalité produit n'est introduite ici.

## Audit restant

**A. `server/routes/auth.ts` — accès Prisma direct.**
Le rapport externe relevait un accès direct à Prisma dans les routes d'authentification, alors
que le reste du domaine (parcours, partage, préférences) passe par un dépôt dédié
(`server/depots/`, seule porte d'accès selon l'ADR-0007). Vérification faite : il n'existe
aujourd'hui **aucun dépôt `User`** dans `server/depots/` — les dépôts existants couvrent
`Parcours`, `PartageParcours` et `Preferences`, pas `User`. Créer un `depotUtilisateur.ts`
uniquement pour `auth.ts` serait une abstraction neuve sans second consommateur, donc
cosmétique au sens de cette mission. **Décision : ne pas refactorer maintenant.** Documenté
comme dette technique (voir Backlog).

**B. `GET /api/photos/:city` — absence de rate limiter.**
Confirmé : la route déclenche un appel Unsplash puis Pexels à chaque ville non encore en cache
(24 h), sans aucune limite par IP — contrairement à toutes les autres routes du projet
(`authLimiter`, `partageLimiter`, `aiChatLimiter`, `aiGenerateLimiter`). **Corrigé** : ajout de
`photosLimiter` (60 req/15 min, même mécanisme `express-rate-limit` déjà utilisé, aucune
nouvelle dépendance) dans `server/middleware/limiter.ts`, branché sur la route dans
`server/routes/photos.ts`.

**C. `server/agents/generation.ts` — fichier volumineux.**
Mesuré à **1419 lignes**. Voir section dédiée ci-dessous : proposition de découpage documentée,
**aucun découpage effectué**.

## Taille / découpage

Mesure du fichier le plus critique et proposition de découpage (non exécutée) :

`server/agents/generation.ts` (1419 lignes) regroupe des responsabilités naturellement
séparables :
1. dérivation du plan de génération par lots (`deriverPlan` et les helpers de date) ;
2. prompt système + schémas de sortie du LLM (`SYSTEM_GENERATION`, `SortieGenerationSchema`,
   schémas de refus) ;
3. synthèse déterministe du transport (`synthetiserTransport`, `nettoyerMomentsTransport`) ;
4. préparation et résolution des liens externes (`preparerMomentsPourResolution`,
   `resoudreDemandesLien`, `construireDemandeResolutionLien`, `tracerLieuReel`) ;
5. validation des données essentielles du brief (hébergement, transport) ;
6. rattachement des séjours hôteliers et liens de recherche ;
7. génération et assemblage des lots (`genererLot`, `namespacerLot`, `genererEtAssemblerLots`) ;
8. orchestrateur final exporté (`genererParcours`).

Un découpage en 6-7 modules est envisageable (ex. `planGeneration.ts`, `promptGeneration.ts`,
`transportSynthese.ts`, `resolutionLiensLot.ts`, `validationBriefEssentiel.ts`,
`lotGeneration.ts`), avec `generation.ts` réduit à l'orchestration. Il coche plusieurs critères
(responsabilités séparables, 10 fichiers de tests qui protégeraient le déplacement), mais pas
tous : plusieurs types internes (`ElementGenere`, `MomentGenere`, `MomentPrepare`) sont partagés
entre presque toutes les sections, et le déplacement toucherait des imports dans 10 fichiers de
tests. Ce n'est pas un découpage « petit et sans risque ». **Décision : SPLIT_LATER**,
documenté ici plutôt qu'exécuté dans cette mission de finitions.

Tableau des autres fichiers volumineux de `server/` (audit lecture seule) :

| Fichier | Lignes | Décision | Raison |
|---|---|---|---|
| server/agents/generation.ts | 1419 | SPLIT_LATER | Voir ci-dessus |
| server/docs/openapi.ts | 1278 | KEEP | Spec OpenAPI déclarative, taille inhérente au format |
| server/domaine/transport/schema.ts | 1094 | SPLIT_LATER | Sous-section « liens de recherche » repérable mais types largement réexportés |
| server/agents/intake.ts | 1077 | KEEP | Un seul agent, flux séquentiel |
| server/domaine/parcours/schema.ts | 1049 | KEEP | Structure cohérente (schémas puis types) |
| server/services/liens/controleRedirections.ts | 858 | SPLIT_LATER | Logique anti-SSRF sensible, découper = risque sans gain net |
| server/domaine/parcours/modifications.ts | 724 | KEEP | Cœur produit (invariant 3), cohérent |
| server/services/liens/selection.ts | 709 | KEEP | Un seul objet métier |
| server/agents/brief.ts | 563 | KEEP | Taille raisonnable |
| server/benchmark/logique.ts | 543 | SPLIT_LATER | Hors chemin produit critique, faible priorité |
| server/services/claude/outils.ts | 509 | KEEP | — |
| server/services/navitia/schema.ts | 494 | KEEP | Déclaratif |
| server/domaine/parcours/invariants.ts | 479→471 | KEEP | Fonction morte retirée (voir Corrections) |
| server/services/modificationHotel.ts | 445 | KEEP | — |
| server/agents/regenerationModification.ts | 395 | KEEP | — |
| server/services/foursquare.ts | 389 | KEEP | — |
| server/routes/parcours.ts | 364 | KEEP | — |
| server/services/amadeus/vols.ts | 321 | KEEP | — |
| server/agents/impactModification.ts | 302 | KEEP | — |
| server/services/amadeus/lieuxAeriens.ts | 298 | KEEP | — |
| server/services/predictHQ.ts | 289 | KEEP | — |
| server/services/claude/core.ts | 289→277 | KEEP | Fonction morte retirée (voir Corrections) |
| server/services/providers.ts | 231 | KEEP | — |
| server/agents/resolutionDatesRelatives.ts | 224 | KEEP | — |
| server/services/liens/validationUrl.ts | 219 | KEEP | — |

Aucun fichier ne justifiait un `SPLIT_NOW` (découpage évident, petit et sans risque).

Dette annexe trouvée et **corrigée** : deux fonctions mortes (aucun appelant, aucun test) —
`normalizeChips` (`server/services/claude/core.ts`) et `plageContenue`
(`server/domaine/parcours/invariants.ts`), déjà signalées en warning ESLint. Supprimées. Aucun
autre code mort, import inutilisé, TODO/FIXME significatif ni duplication réelle trouvés.

## Intégrations

Vérification directe (curl, hors CI) des clés `.env` réellement configurées. Aucun secret
n'apparaît ci-dessous ni n'a été journalisé.

| Fournisseur | Configuré | Auth | Test effectué | Impact produit |
|---|---|---|---|---|
| Anthropic | oui | VALID | `GET /v1/models` (non génératif, coût nul) → HTTP 200, 11 modèles listés | Génération/modification de parcours opérationnelle |
| Foursquare | oui | VALID | `GET /places/search` sur Bordeaux et New York (tier gratuit) → HTTP 200 les deux fois, résultats exploitables | Lieux/hébergements vérifiés opérationnels, y compris à l'international — aucune reproduction du problème New York déjà observé au niveau de l'appel brut |
| Tavily | oui | VALID | `POST /search`, requête minimale, `max_results:1` → HTTP 200, 1 résultat | Résolution de liens (F2-B) opérationnelle |
| Navitia | non | ABSENT | — | Capacité trajets Navitia inactive (comportement produit déjà : repli/absence gérée par le code) |
| Amadeus | non | ABSENT | — | Capacité vols Amadeus inactive |
| PredictHQ | non | ABSENT | — | Capacité événements datés inactive |

Rappel (AUTH FOURNISSEUR ≠ CAPACITÉ PRODUIT) : une clé valide confirme l'authentification et
l'accès à l'endpoint testé, pas que tout usage produit de ce fournisseur est garanti à 100 %
(ex. Foursquare valide ne garantit pas qu'un hébergement soit toujours trouvé pour toute ville).

Deux clés supplémentaires sont configurées mais hors du périmètre demandé par cette mission :
`UNSPLASH_ACCESS_KEY` et `OPENROUTER_API_KEY` — non testées (non listées dans les fournisseurs à
vérifier).

## Corrections réalisées

- Ajout de `photosLimiter` (60 req/15 min) sur `GET /api/photos/:city`, avec test ciblé
  (`tests/unit/photosLimiter.test.ts`) vérifiant le plafond et le branchement effectif sur la
  route. Mise à jour des mocks de `middleware/limiter.js` dans 9 fichiers de tests existants pour
  inclure `photosLimiter` (sans quoi Express refuse de monter la route avec un middleware
  `undefined`).
- Suppression de deux fonctions mortes : `normalizeChips` et `plageContenue`.

Aucune autre correction : les autres points relevés (dépôt `auth.ts`, découpage de
`generation.ts` et des fichiers `SPLIT_LATER`) ne remplissaient pas les critères de correction
immédiate (bug réel, faille de sécurité évidente, protection triviale manquante, code mort
certain, test manquant sur une correction réelle) — ils restent en backlog.

## Tests

- Tests ciblés (`photosLimiter.test.ts`, `api.test.ts`, `middleware.test.ts`) : verts.
- Suite complète : **1860/1860 tests verts** (64 fichiers), aucun appel réseau réel.

## Backlog restant

**Avant démo :** rien de bloquant identifié.

**Après démo :**
- Dépôt `User` pour `server/routes/auth.ts` si un second consommateur Prisma-direct apparaît un
  jour (aujourd'hui : abstraction à un seul appelant, non justifiée).
- Découpage de `server/agents/generation.ts` (proposition documentée ci-dessus), à faire sous
  supervision des 10 fichiers de tests existants.

**Refactor futur (faible priorité) :**
- `server/domaine/transport/schema.ts` — extraction possible de la sous-section « liens de
  recherche ».
- `server/services/liens/controleRedirections.ts` — découpage possible mais sensible
  (anti-SSRF), à ne toucher qu'avec une raison produit.
- `server/benchmark/logique.ts` — hors chemin produit critique.
- Navitia / Amadeus / PredictHQ : intégrations présentes dans le code mais non configurées en
  environnement local — aucune action requise tant qu'aucun besoin produit ne les active.
