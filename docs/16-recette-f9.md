# 16 — Recette F9 : robustesse produit et matrice de capacités

> Recette de sortie du chantier fiabilité (F0 → F8). Objectif : dire
> précisément ce que le produit sait faire aujourd'hui, sans exception
> masquée. Voir [doc 14](14-fiabilite-parcours.md) pour le contrat de
> confiance et [ADR-0008](decisions/ADR-0008.md) pour les niveaux persistés.

> **Nature de ce document : instantané de clôture F9 du 2 août 2026.** Les
> travaux ultérieurs de préparation (destinations, NBA event-first,
> localisations typées) sont suivis dans `SPRINTS.md`. Ils n'effacent pas les
> limites mesurées ici. La disponibilité actuelle d'un fournisseur se vérifie
> en recette live, pas depuis cet instantané.

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
| International (hors France) | **PARTIAL** | Aucune restriction géographique n'existe dans le code (`grep France server/` : aucun résultat). Le comportement de repli est sûr par construction (une recherche `indisponible`/`vide` ne produit jamais un élément `verifie`, seulement une suggestion — testé `generationOutillee.test.ts:1421`). Une ville internationale simple, mono-ville, courte, n'a pas été rejouée en conditions réelles (pas de clés) : classée PARTIAL, pas SUPPORTED, tant qu'un scénario représentatif n'est pas démontré. Voir la section « NBA/New York » ci-dessous pour le cas multi-ville long. |
| Multi-ville | **PARTIAL** | Le découpage par lot et le scoping de ville sont corrects par construction et testés (F5, `decouperPlan`, `villeDuMoment`) ; chaque lot dispose de son propre budget d'outils et de ses reprises (`generation.ts:1211-1248`). Un parcours 2 villes/France est couvert par les tests unitaires. Un parcours multi-ville long échoue en benchmark (voir « NBA/New York ») — toujours par un échec honnête (502/503), jamais par une fabrication. Classé PARTIAL : le socle est correct, la robustesse d'un cas long réel n'est pas démontrée. |
| Budget | **SUPPORTED** | Aucun total recalculé côté serveur (toujours celui déclaré par l'utilisateur), aucun 0 € pour une donnée inconnue, aucun double comptage à la substitution d'élément (`modifications.ts:402-413`). |
| Modification / régénération ciblée (F8) | **SUPPORTED** | Ordonnancement topologique des dépendants, revalidation complète avant écriture, aucun orphelin possible (`domaine` fait échouer la validation sinon). Couverture de test la plus solide du dépôt (`parcoursModificationsAtomique.test.ts`, 8 scénarios nommés). |
| Persistance (génération) | **SUPPORTED** | Vérifié à la fois par construction (`routes/parcours.ts`) et désormais par un test d'intégration route dédié (`tests/unit/parcoursGenerationRoute.test.ts`, ajouté en F9) : refus (422), panne technique (503), sortie inexploitable (502) et schéma final invalide (500) produisent tous zéro écriture. |
| Partage | **SUPPORTED** | Invariants d'accès et de visibilité (privé/partagé/surprise, convier, révocation) couverts par `tests/unit/partage.test.ts` et `tests/unit/depotPartage.test.ts`, verts dans la suite complète exécutée en F9. Chemin actif branché sur les routes de partage. Non ré-audité ligne à ligne en F9 (aucun défaut ni changement depuis F0–F8), mais la couverture existante est réelle et représentative. |

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

## Le point le plus scruté : dépendance essentielle indisponible

Ce point a été ré-instruit en revue finale, car il conditionne la fermeture du
chantier. Conclusion : **la garantie « aucun faux parcours présenté comme réel »
est structurelle, pas dépendante du LLM.** Le détail :

- **Ce que le serveur sait de façon déterministe.** Chaque recherche exécutée
  est tracée avec son statut `ok`/`vide`/`indisponible`
  (`services/claude/outils.ts:475-493`, `recherchesTracees`), et le journal ne
  retient un candidat que pour une recherche `ok`. **Une recherche
  `indisponible` ou `vide` ne peut donc jamais produire un élément `verifie` :
  au pire une suggestion générique explicitement qualifiée.** C'est vérifié par
  un test déterministe et déjà présent :
  `tests/unit/generationOutillee.test.ts:1421` (« dégrade un hôtel vers une
  suggestion quand Foursquare est indisponible » — `confiance: {niveau:
  'suggestion'}`, `lieu` absent, `reservation` absente).
- **Ce que le serveur ne sait PAS de façon déterministe.** Pour une recherche
  de lieu ou d'événement *discrétionnaire*, l'**essentialité** (« l'utilisateur
  y tenait vraiment ») est un jugement sémantique. Le serveur connaît le statut,
  pas l'essentialité. C'est pourquoi le passage `422`→`503`
  (`generation.ts:1054-1063`) s'appuie sur le refus structuré du modèle
  (`besoinEssentiel`). Si le modèle choisit plutôt une suggestion générique
  honnête, le résultat est un `201` avec un élément `suggestion` — ce qui est
  **exactement** ce qu'ADR-0008 autorise pour une donnée facultative absente.
  Les deux issues (503 ou suggestion qualifiée) sont honnêtes ; aucune ne fait
  passer une invention pour une réalité.
- **Les essentiels réellement déterministes sont, eux, verrouillés côté
  serveur** : hébergement ou transport *déclarés nécessaires* mais incomplets
  produisent un `422` avant tout appel IA
  (`validerDonneesHotelieresEssentielles`, `validerDonneesTransportEssentielles`,
  `generation.ts:766-846`), et une boucle d'outils qui n'aboutit pas produit un
  `503` structurel (`services/claude/core.ts:281-289`).
- **Verdict sur ce risque.** Ce n'est pas un défaut structurel à corriger
  (option B écartée) : le serveur ne *peut pas* trancher l'essentialité d'un
  lieu discrétionnaire sans la déduire du sens, et forcer un `503` dès qu'une
  recherche facultative est `indisponible` violerait ADR-0008 (« absence
  facultative → suggestion ») et la règle « aucun 503 généralisé ». C'est une
  **limite correctement classée et acceptée** (option C) : le choix 503 vs
  suggestion honnête pour une donnée discrétionnaire relève légitimement du
  modèle ; l'invariant anti-fabrication, lui, est tenu par le serveur.

## Risques restants (non corrigés, documentés)

- **Niveau de confiance `estime` (élément) dormant.** Il faut distinguer deux
  mécanismes : le **prix estimé** (`prixEstime`, booléen séparé sur le prix) est
  bien produit et rendu dans l'UI (`ParcoursDetail.tsx:170,346`,
  `ParcoursPartage.tsx:121`) — capacité vivante, conforme à ADR-0008. En
  revanche le **niveau `confiance.niveau: 'estime'`** au niveau de l'élément
  n'est jamais émis par le serveur (seuls `verifie` et `suggestion` le sont).
  L'UI le gère si présent (`StatutMetier.tsx:70`, badge « Estimé ») : c'est donc
  un chemin dormant prêt à l'emploi, sans promesse produit trompeuse — pas une
  violation d'ADR-0008.
- **Robustesse multi-ville longue non démontrée** (voir « NBA/New York »
  ci-dessous) : le socle est correct et testé, mais un cas long réel échoue en
  benchmark — toujours honnêtement (502/503), jamais par fabrication.
- **Aucune observabilité sur les indisponibilités fournisseurs.** Ni Navitia,
  ni Amadeus, ni PredictHQ ne journalisent leur `raison: 'configuration_absente'`
  au-delà d'un `console.warn` isolé (PredictHQ) ou d'un retour silencieux
  (Navitia, Amadeus). Une absence de clé prolongée en production ne serait pas
  détectée autrement qu'en lisant les parcours générés.

## NBA / New York : ce que dit vraiment le benchmark

Le « 0/3 Haiku, 0/3 Sonnet » de F6 a été ré-examiné sur les données brutes
(`server/benchmark/resultats/benchmark-2026-07-31T22-47-12-345Z.json`,
scénario `nba-multi-villes`, 6 lots prévus). La cause n'est **pas unique**, et
n'est pas une règle « France » câblée (aucune n'existe) :

- **Haiku, 2 exécutions sur 3** : `sortie_inexploitable / json_invalide`,
  `tours: 1`, ~336–360 tokens de sortie — le modèle produit un JSON cassé dès le
  premier lot. C'est une **limite de qualité du modèle**, sans rapport avec le
  budget d'outils.
- **Haiku 1/3 et Sonnet 3/3** : `service_indisponible` — la boucle d'outils
  d'un lot n'aboutit pas (`tours` 4 à 11, `outilsIndisponibles` renvoyé par
  `core.ts:281-289`). Sonnet enchaîne 3 lots sur 6 puis bute sur le 4ᵉ. Le
  budget d'outils est **par lot** avec reprises (`generation.ts:1211-1248`),
  donc ce n'est pas un « budget global épuisé par la longueur », mais la
  non-convergence de la boucle sur un lot donné — cause exacte (modèle qui
  reréclame des outils, ou couverture fournisseur d'une ville US en run live)
  **non isolée déterministe** : à traiter comme hypothèse, pas comme conclusion.

Point qui compte pour la fiabilité : **aucune de ces exécutions ne produit un
parcours fabriqué.** Chaque échec est honnête (`502` JSON invalide ou `503`
sources indisponibles). Changer `MAX_TOURS_OUTILS` ou le modèle dépasse le
périmètre F9 (risque coût/latence, pas de scénario de recette reproductible
sans clés) et ne corrige aucun faux résultat — c'est un chantier de
performance produit, pas de fiabilité.

## Garanties tenues

Aucun faux parcours n'a été trouvé présenté comme réel. Chaque défaillance
technique observée (clé absente, HTTP en erreur, JSON invalide, timeout, boucle
non aboutie) route vers `indisponible`/`503`, vers un `502` explicite, ou vers
une suggestion générique explicitement qualifiée — jamais vers une invention
silencieuse. Cet invariant est tenu par le serveur (statut → confiance), pas
par la seule discipline du modèle.
