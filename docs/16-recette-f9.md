# 16 — Recette F9 : robustesse produit et matrice de capacités

> Recette de sortie du chantier fiabilité (F0 → F8). Objectif : dire
> précisément ce que le produit sait faire aujourd'hui, sans exception
> masquée. Voir [doc 14](14-fiabilite-parcours.md) pour le contrat de
> confiance et [ADR-0008](decisions/ADR-0008.md) pour les niveaux persistés.

## Méthode

Audit du code réel (services externes, `agents/generation.ts`,
`agents/regenerationModification.ts`, routes, schéma de domaine) confronté
aux tests existants et aux revues déjà consignées dans `docs/SPRINTS.md`.
Aucune clé Navitia, Amadeus ou PredictHQ n'est configurée dans l'environnement
local (`.env`) : leur comportement à clé absente a donc été vérifié en
conditions réelles (fail-closed, pas simulé). Foursquare et Tavily disposent
de clés réelles ; leur comportement a été vérifié par lecture de code et par
la suite de tests existante (aucun appel réseau réel ajouté, conformément à
la règle « pas d'appel réseau réel dans les tests »).

## Matrice de capacités

| Capacité | Statut | Preuve / limite |
|---|---|---|
| Activités génériques | **SUPPORTED** | Foursquare (`services/foursquare.ts`) : `ok/vide/indisponible` propre, jamais de donnée inventée. Ville du moment correctement scopée par lot (`agents/generation.ts`, `outils.ts`). |
| Restaurants | **SUPPORTED** | Même connecteur, mêmes garanties. |
| Hébergements nommés | **SUPPORTED** | F3 : identité Foursquare (catégorie Lodging), occupation dédiée, lien Booking de type `recherche` uniquement. |
| Vols (recherche) | **PARTIAL** | Résolution d'aéroport (Amadeus Airport & City Search) branchée via F4-D2 pour fabriquer un lien de recherche Google Flights. `rechercherVolsAeriens` (offres structurées Amadeus) reste **interne, jamais appelé** par la génération active. Aucune clé Amadeus configurée en local → fail-closed vérifié (`configuration_absente`, aucun réseau). |
| Trains / transport local | **PARTIAL** | Résolution de gare Navitia (`unique/ambigu/vide/indisponible`) branchée via F4-D2. Sans clé Navitia (cas local actuel) : indisponibilité propre, pas de lien, génération non bloquée (dégradation silencieuse assumée et testée, pas un 503 exposé au client — c'est un enrichissement optionnel, pas une donnée essentielle). |
| Événements / sport (matchs réels) | **PARTIAL** | PredictHQ correctement fail-closed (`configuration_absente`) sans clé. Le prompt interdit explicitement d'inventer une date de match ou un nom d'événement (`generation.ts:224`) : le résultat est soit une suggestion générique honnête, soit un refus (`422`/`503`), jamais un faux événement vérifié. **Aucune donnée sportive datée n'est actuellement vérifiable** en l'absence de clé PredictHQ — la capacité « match réel confirmé » est donc non atteignable en l'état, par construction et non par bug. |
| International (hors France) | **PARTIAL / UNAVAILABLE selon le scénario** | Aucune restriction géographique n'existe dans le code (`grep France` : aucun résultat serveur). La limite observée (benchmark F6, scénario NBA New York/LA/Chicago : 0/3 pour Haiku et Sonnet) vient du **budget d'outils** (`MAX_TOURS_OUTILS = 3`, `services/claude/core.ts`) insuffisant pour couvrir les recherches d'un parcours multi-ville long, et du jugement du modèle qui refuse plutôt que d'improviser — comportement conforme au contrat (refus propre, jamais d'invention). Une ville internationale simple, mono-ville, courte, n'est pas démontrée en échec ni en succès faute de scénario testé ; à documenter comme risque plutôt que capacité confirmée. |
| Multi-ville | **PARTIAL** | Le découpage par lot et le scoping de ville sont corrects par construction (F5, `decouperPlan`, `villeDuMoment`). La limite observée est le nombre de lots/villes réalisable dans le budget d'outils par génération — non quantifiée précisément par un scénario de recette dédié dans ce sprint faute de clés fournisseurs suffisantes pour reproduire un cas long en conditions réelles. Un parcours 2 villes/France reste couvert par les tests unitaires de `generation.ts` et `regenerationModification.ts`. |
| Budget | **SUPPORTED** | Aucun total recalculé côté serveur (toujours celui déclaré par l'utilisateur), aucun 0 € pour une donnée inconnue, aucun double comptage à la substitution d'élément (`modifications.ts:402-413`). |
| Modification / régénération ciblée (F8) | **SUPPORTED** | Ordonnancement topologique des dépendants, revalidation complète avant écriture, aucun orphelin possible (`domaine` fait échouer la validation sinon). Couverture de test la plus solide du dépôt (`parcoursModificationsAtomique.test.ts`, 8 scénarios nommés). |
| Persistance (génération) | **SUPPORTED** | Vérifié à la fois par construction (`routes/parcours.ts`) et désormais par un test d'intégration route dédié (`tests/unit/parcoursGenerationRoute.test.ts`, ajouté en F9) : refus (422), panne technique (503), sortie inexploitable (502) et schéma final invalide (500) produisent tous zéro écriture. |
| Partage | **SUPPORTED** | Hors périmètre de cet audit (aucun défaut signalé côté F0–F8, non retesté en F9 faute de risque identifié). |

## Défauts trouvés

Aucun bug reproductible bloquant n'a été trouvé dans le pipeline de
génération, les connecteurs externes ou la persistance. Le seul manque réel
identifié était une absence de preuve — pas une absence de garantie : la
garantie « refus/panne → zéro écriture » n'était démontrée que par lecture de
code, jamais par un test au niveau route HTTP.

### Correction apportée

- **`tests/unit/parcoursGenerationRoute.test.ts`** (nouveau) : 5 scénarios
  `POST /api/parcours` (succès, 422, 503, 502, schéma final invalide) qui
  vérifient que le dépôt Prisma n'est appelé en écriture que sur un succès
  réel. Comble la lacune identifiée en audit — jusqu'ici seule la persistance
  de F8 (modification) avait un test d'intégration équivalent.

## Risques restants (non corrigés, documentés)

- **Discipline du prompt plutôt que contrôle serveur structurel.** Le passage
  `422`→`503` sur une recherche essentielle indisponible dépend du modèle qui
  déclare un refus structuré avec `besoinEssentiel`
  (`agents/generation.ts:1054-1063`). Si le modèle ignore cette instruction et
  répond par un `Parcours possible` normal contenant une suggestion générique
  à la place, rien côté serveur ne force alors un `503` : la génération
  réussit en `201` avec un élément `suggestion`, sans que l'appelant sache
  qu'une panne technique s'est produite pour une donnée qui aurait dû être
  essentielle. Ce n'est ni reproduit ni reproductible de façon déterministe
  (dépend du comportement du LLM), donc non corrigé dans ce sprint — à
  surveiller si des refus manquants sont constatés en recette live.
- **Niveau `estimé` jamais produit en pratique.** Le schéma le définit et les
  invariants du domaine l'acceptent, mais aucun chemin de génération, de
  régénération ou de modification ne l'assigne actuellement (seuls `verifie`
  et `suggestion` sortent du serveur). Pas une violation d'ADR-0008 (rien
  n'impose son usage), mais un écart entre contrat documenté et usage réel.
- **International et multi-ville long non quantifiés en conditions réelles.**
  L'échec NBA (F6) est expliqué par le budget d'outils, pas par une règle
  géographique câblée — mais aucune clé Amadeus/Navitia/PredictHQ locale ne
  permettait de rejouer un scénario international complet en conditions
  réelles pour ce sprint. Le comportement de repli (refus propre, jamais de
  faux parcours) est démontré par construction et par les tests existants,
  mais la limite précise (nombre de villes, longueur de séjour) reste une
  estimation, pas une mesure.
- **Aucune observabilité sur les indisponibilités fournisseurs.** Ni Navitia,
  ni Amadeus, ni PredictHQ ne journalisent leur `raison: 'configuration_absente'`
  au-delà d'un `console.warn` isolé (PredictHQ) ou d'un retour silencieux
  (Navitia, Amadeus). Une absence de clé prolongée en production ne serait pas
  détectée autrement qu'en lisant les parcours générés.

## Garanties tenues

Aucun faux parcours n'a été trouvé présenté comme réel. Chaque défaillance
technique observée dans le code (clé absente, HTTP en erreur, JSON invalide,
timeout) route vers `indisponible`/`503` ou vers une suggestion générique
explicitement qualifiée — jamais vers une invention silencieuse.
