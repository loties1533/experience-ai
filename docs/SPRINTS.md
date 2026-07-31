# Suivi Agile — Experience AI (refonte) puis TripGenie (historique)

## Chantier fiabilité — plan actif à partir du 28 juillet 2026

> La refonte R1 → R8 a livré le socle fonctionnel. Elle ne prouve pas encore la
> vérité des lieux, événements, hébergements, prix et liens proposés.
> Le nouveau cap est : **Aucun faux parcours présenté comme réel.**
>
> Les critères, dépendances et définitions de terminé détaillés vivent dans le
> [doc 14](14-fiabilite-parcours.md). Cette section est le board d'exécution.

| Sprint | Objectif | Statut |
|---|---|---|
| F0 — Audit du portage | Matrice TripGenie → Experience AI | Terminé |
| F1 — Vérité des données | Confiance, traçabilité et refus explicite | Terminé |
| F2 — Lieux et événements | Liens fiables par ville et établissement | Terminé |
| F3 — Hébergements | Existence vérifiée et recherche Booking correcte | Terminé |
| F4 — Vols et transports | IATA, dates, voyageurs et multi-villes | Terminé |
| F5 — Génération progressive | Plan global puis lots validés | En cours |
| F6 — Benchmark modèles | Choix mesuré du modèle de production | En cours |
| F7 — Dialogue fiable | Dates relatives et absence de répétitions | À faire |
| F8 — Modification complète | Régénération atomique des seuls dépendants | À faire |
| F9 — Recette de sortie | Robustesse NBA puis valeur EVG | À faire |

### Board — avancement du chantier

**F0 — Audit du portage**

- [x] Inventorier les services, types, utilitaires et tests de TripGenie
- [x] Classer chaque brique : porté / à adapter / à réécrire / abandonné
- [x] Relier chaque brique à son équivalent actuel ou à son manque
- [x] Documenter son contrat, ses dépendances et ses tests
- [x] Vérifier en priorité : liens locaux, Booking, vols, IATA et contrôles de cohérence
- [x] Faire valider la matrice avant toute suppression ou réécriture

Rapport validé :
[`docs/audits/tripgenie-vers-experience-ai.md`](audits/tripgenie-vers-experience-ai.md).

**F1 — Vérité des données** *(terminé)*

- [x] Définir les niveaux persistés Vérifié / Estimé / Suggestion
- [x] Définir la provenance : source, fournisseur, date et identifiant externe
- [x] Distinguer refus métier (`422`), panne technique (`503`) et donnée
  facultative absente
- [x] Normaliser les anciennes réservations sans leur accorder Vérifié
- [x] Afficher le niveau de confiance et le caractère estimé des prix
- [x] Valider les scénarios F1 par la suite automatisée
- [x] Faire accepter [ADR-0008](decisions/ADR-0008.md) dans la PR

**F2 — Lieux et événements** *(terminé)*

**F2-A — Identité, provenance et états de recherche** *(terminé)*

> Livré par la [PR #25](https://github.com/loties1533/experience-ai/pull/25).
>
> Commits :
> `bb2f7f1b84e7c17ab1823bfae891a14db8a01728` et
> `8023b6f98fccd05910540655b83b86a88a13da1d`.

- [x] Distinguer les recherches `ok`, `vide` et `indisponible`
- [x] Conserver la provenance Foursquare ou PredictHQ
- [x] Différencier le cache des résultats valides, vides et indisponibles
- [x] Rapprocher les candidats par identité, ville et type métier
- [x] Empêcher un lien Web seul de produire le niveau Vérifié
- [x] Distinguer déterministement le refus métier `422` de la panne essentielle `503`
- [x] Utiliser la ville propre à chaque moment dans un parcours multi-ville
- [x] Préserver le comportement générique de l'adaptateur historique
  `foursquareRechercheLieux` pour les restaurants, bars/sorties et activités
- [x] Valider localement 361/361 tests, le typecheck et le lint

**F2-B — Résolution fiable des liens** *(terminé)*

> F2-B1 à F2-B3 ont été livrés par la
> [PR #27](https://github.com/loties1533/experience-ai/pull/27). F2-B4 a été
> livré par la [PR #28](https://github.com/loties1533/experience-ai/pull/28).
> F2-B5 a été livré par la
> [PR #30](https://github.com/loties1533/experience-ai/pull/30).

- [x] **F2-B1** — définir `LienResolu` et la validation pure des URL
- [x] **F2-B2** — structurer Tavily avec les états `ok`, `vide` et
  `indisponible`
- [x] **F2-B3** — sélectionner les candidats de manière déterministe, sans LLM
  décisionnaire ni premier résultat arbitraire
- [x] **F2-B4** — contrôler HTTPS, DNS, SSRF et redirections avec un transport
  Undici épinglé ; refuser le transfert de preuve entre domaines enregistrables
- [x] **F2-B5** — intégrer `resoudreLien` dans `agents/generation.ts` : le
  pipeline sécurisé F2-B1 à B4 est désormais **branché** dans la génération
  active. Aucune résolution depuis le seul nom : chaque demande de lien est
  rattachée à une identité métier (Foursquare ou PredictHQ) avant recherche.
  L'ancienne fonction `resoudreLiensReels` (résolution groupée par ville, sans
  identité métier) reste dans le code et sa suite de tests, mais **n'est plus
  appelée par le flux actif** — seul `resoudreLien` (singulier) l'est.

F2 est donc **terminé** : identité et provenance (F2-A) puis résolution
sécurisée et intégrée des liens (F2-B1 à B5).

> **Note historique.** Les revues R6 ci-dessous expliquent pourquoi le système
> avait été conçu pour « sortir un parcours dans tous les cas ». Elles restent
> conservées comme historique, mais cette stratégie est désormais remplacée
> par F1.

**F3 — Hébergements** *(terminé)*

> Livré par les PR
> [#31](https://github.com/loties1533/experience-ai/pull/31) (F3-B),
> [#32](https://github.com/loties1533/experience-ai/pull/32) (F3-C1),
> [#33](https://github.com/loties1533/experience-ai/pull/33) (F3-C2) et
> [#34](https://github.com/loties1533/experience-ai/pull/34) (F3-D).

- [x] **F3-B** — identité hôtelière Foursquare (catégorie Lodging `19009`) :
  un nom d'hôtel généré par le LLM n'est pas une identité — l'hébergement
  nommé provient d'un fournisseur réel ou reste générique ; une ville ou une
  catégorie contradictoire élimine le candidat
- [x] **F3-C1** — contrat de séjour et d'occupation hôtelière
  (`OccupationHebergement` déclarée ou à confirmer) ; l'occupation de l'hôtel
  est un contrat **distinct** de l'occupation transport, jamais copiée de
  l'un à l'autre
- [x] **F3-C2** — lien de recherche Booking (`LienRechercheHebergement`,
  type `recherche`) construit depuis l'hôtel, la ville, les dates et
  l'occupation validés ; ce lien ne prouve **ni prix ni disponibilité**,
  Booking reste responsable de ses propres résultats
- [x] **F3-D** — verrouillage des modifications hôtelières : la route de
  modification utilise un contrat client strict et discriminé, qui empêche
  un appelant de forger directement une confiance, une provenance, une
  identité Foursquare ou un lien Booking

**F4 — Vols et transports** *(en cours)*

**F4-A — Audit transport** — couvert par l'audit F0
([PR #22](https://github.com/loties1533/experience-ai/pull/22)), sans
livrable séparé. La matrice de `docs/audits/tripgenie-vers-experience-ai.md`
couvrait déjà la recherche de vols et la logique IATA de TripGenie ; F4-A ne
correspond à aucune branche ni PR dédiée.

> F4-B1 à F4-C2 ont été livrés par les PR
> [#35](https://github.com/loties1533/experience-ai/pull/35) (F4-B1),
> [#36](https://github.com/loties1533/experience-ai/pull/36) (F4-B2),
> [#37](https://github.com/loties1533/experience-ai/pull/37) (F4-C1) et
> [#38](https://github.com/loties1533/experience-ai/pull/38) (F4-C2).

- [x] **F4-B1** — contrats de domaine transport purs (`domaine/transport/`) :
  modes, lieux demandés/confirmés, occupation, dates civiles, tronçons,
  segments, candidats, preuves, provenance — sans fournisseur ni intégration
- [x] **F4-B2** — brief et génération transport **fail-closed**, branchés
  dans `agents/brief.ts`, `intake.ts` et `generation.ts` : sans source
  externe, aucun détail de trajet ressemblant à une observation réelle n'est
  conservé (aucun opérateur, horaire, numéro ou lien inventé)
- [x] **F4-C1** — résolution des lieux aériens via Amadeus Airport & City
  Search (`services/amadeus/`) : une ville n'est jamais automatiquement un
  aéroport, un candidat fournisseur n'est jamais automatiquement un lieu
  confirmé ; résolution unique, ambiguë, vide ou indisponible
- [x] **F4-C2** — candidats de vols structurés via Amadeus Flight Offers
  Search (`services/amadeus/vols.ts`) : une réponse fournisseur est une
  observation, jamais une réservation, un billet ou une disponibilité
  garantie ; aucun prix, aucun lien, aucune sélection automatique
- [ ] **F4-C3** — trains et transports locaux structurés : **en cours**
  - [x] **F4-C3a** — contrat intermédiaire de gare Navitia et normalisation
    pure (`services/navitia/`), sans réseau
  - [x] **F4-C3b** — client interne Navitia et résolution des gares
    (`unique`, `ambigu`, `vide`, `indisponible`), sans branchement actif
  - [x] **F4-C3c** — trajets ferroviaires internes via `/journeys`, à heures
    locales, sans branchement actif
- [x] **F4-D1** — liens de recherche transport (`lib/liensTransport.ts`) :
  construction déterministe de liens de **recherche** vers Google Flights
  (vols, codes IATA) et Google Maps (gares et transport local, API « Maps
  URLs »), sans branchement actif
- [x] **F4-D2** — intégration des liens de recherche transport dans la
  génération active (`agents/enrichissementLiensTransport.ts`) : résolution
  aérienne (Amadeus) ou ferroviaire (Navitia) uniquement pour un mode éligible,
  lien F4-D1 seulement après résolution unique des deux extrémités, absence
  prudente sinon
- [x] **F4-E** — modifications, API et front pour le transport
  ([PR #45](https://github.com/loties1533/experience-ai/pull/45)) : contrat
  client `modifier_demande_transport`, reconstruction des liens via la
  résolution prudente F4-D2, exposition OpenAPI et affichage du lien dans le
  détail et le partage

> **F4-C1 et F4-C2 sont implémentés, testés et internes.** Ils ne sont
> appelés ni par la génération active, ni par les routes publiques, ni par
> l'OpenAPI, ni par le front, ni par la persistance — vérifié : aucun fichier
> hors `server/services/amadeus/` n'importe ce module. Leur intégration
> réelle dans un parcours est le périmètre de F4-D2, qui dépend de F4-C3.

F4 est désormais **terminé** : B1, B2, C1, C2 et C3 (a, b, c) posés en
interne, puis D1, D2 et E qui les branchent réellement dans la génération, la
modification, l'OpenAPI et le front.

### Revue F4-C3a — la gare Navitia comme candidat, rien de plus (30/07)

- **Un contrat intermédiaire, pas un lieu confirmé.** `CandidatGareNavitia`
  (`services/navitia/schema.ts`) porte seulement des faits observés :
  identifiant Navitia, nom, coordonnées, fuseau IANA, code métier, source et
  date de récupération. Il ne porte **ni ville, ni code pays, ni niveau de
  confiance** : Navitia ne les garantit pas depuis ses régions administratives,
  et les inventer serait exactement le faux parcours qu'ADR-0008 interdit. Le
  contrat est `.strict()` — horaire, opérateur, prix, disponibilité ou
  réservation y sont refusés par construction.
- **Le domaine générique n'a pas bougé.** `CodeLieuTransportSchema` est réutilisé
  tel quel : ses systèmes `UIC` et `NAVITIA` étaient déjà prévus depuis F4-B1.
  Le candidat vit dans `services/navitia/` parce qu'il est indissociable du
  format Navitia — un billettiste ferroviaire n'exposerait pas la même identité.
- **L'UIC est facultatif, l'identité Navitia ne l'est pas.** Un code UIC
  illisible est ignoré — jamais reformaté ni renuméroté — au profit d'un UIC
  valide déclaré à côté de lui, ou du repli sur l'identifiant Navitia réel. En
  revanche, **deux codes UIC valides et contradictoires refusent la gare** :
  c'est une ambiguïté d'identité, et aucun des deux n'est choisi arbitrairement.
- **La provenance est fournie, jamais devinée.** `candidatDepuisStopArea` reçoit
  la source exacte et la date de récupération ; aucune valeur par défaut, aucune
  configuration, aucun `process.env`, aucune horloge implicite. F4-C3b pourra
  donc enregistrer l'URL de couverture réellement interrogée.
- **Un décalage ne devient jamais un fuseau.** Le fuseau est validé puis
  canonisé par le runtime (`europe/paris` → `Europe/Paris`). `Intl` acceptant
  `+02:00` comme zone sur les runtimes récents, un décalage seul est écarté
  avant cette lecture — la règle F4-C1 tient.
- **Les coordonnées textuelles de Navitia ne deviennent jamais zéro.** Une
  chaîne vide ou non numérique refuse la gare ; les bornes latitude/longitude
  sont contrôlées une seule fois, par le contrat du candidat.
- 92 tests (`tests/unit/navitiaNormalisation.test.ts`), 1288 verts sur toute la
  suite, typecheck OK, lint sans erreur. Deux garde-fous : aucun appel à `fetch`
  pendant la normalisation, et **aucune référence directe au module Navitia dans
  les couches actives contrôlées** (`server/agents`, `server/routes`,
  `server/docs`, `server/depots`, `client-react/src`, `prisma`) — une recherche
  textuelle sur ces couches, pas une preuve du graphe d'imports transitifs.
- **Aucun branchement actif.** Ni route, ni OpenAPI, ni front, ni persistance,
  ni génération. Prochain sous-lot : **F4-C3b** — configuration, client HTTP,
  authentification et résolution interne des gares (`unique`, `ambigu`, `vide`,
  `indisponible`) avec cache.

### Revue F4-C3b — résoudre une gare sans jamais la choisir (30/07)

- **Un connecteur interne, pas une intégration.** `services/navitia/` gagne sa
  configuration, son authentification, son client HTTP et sa recherche de gares
  via `/places`. Rien n'est branché : ni génération, ni route, ni OpenAPI, ni
  front, ni persistance.
- **Quatre issues explicites, jamais confondues** : `unique`, `ambigu`, `vide`,
  `indisponible`. `unique` signifie seulement que Navitia a rendu une seule gare
  compatible — **pas** que c'est la gare voulue par l'utilisateur, et rien n'est
  confirmé ni persisté. En cas d'ambiguïté, **aucun premier candidat n'est
  choisi** : les deux gares remontent telles quelles.
- **Une panne ne devient jamais un résultat vide.** Configuration absente,
  401/403, 429, 404, 5xx, timeout, réseau, contenu non JSON et enveloppe
  invalide produisent tous une indisponibilité qualifiée, distincte d'une
  recherche réellement sans résultat.
- **Un `stop_area` inconvertible refuse toute la réponse**, tandis qu'un objet
  d'un autre `embedded_type` (adresse, POI, région) est simplement ignoré comme
  hors cible. Le silence serait ici le vrai danger : écarter une gare illisible
  pourrait transformer une ambiguïté en faux résultat unique, et donc désigner
  une gare que personne n'a demandée.
- **La déduplication ne se fait que par identité fournisseur**
  (`identifiantExterne`). Ni le nom, ni des coordonnées proches, ni un code
  supposé ne fusionnent deux gares : deux identifiants distincts restent deux
  candidats, donc une ambiguïté honnête.
- **Le jeton ne fuit nulle part.** Authentification HTTP Basic (jeton en
  identifiant, mot de passe vide), en-tête construit à un seul endroit ; le
  jeton n'apparaît ni dans l'URL, ni dans la provenance enregistrée, ni dans une
  raison d'indisponibilité. La lecture d'environnement est centralisée dans
  `config.ts`.
- **Cache différencié** : 24 h pour une résolution positive (un référentiel de
  gares bouge peu), 10 minutes pour un résultat vide (une faute de frappe
  corrigée doit pouvoir retrouver la gare), et **jamais** pour une
  indisponibilité. La clé normalise casse et espaces, sépare les couvertures, et
  la requête envoyée à Navitia reste celle saisie.
- 70 tests ajoutés (`navitiaAuth`, `navitiaGares`), 1358 verts sur toute la
  suite, typecheck OK, lint sans erreur. Tout le HTTP est simulé : aucun appel
  réseau réel, aucun jeton réel.
- Prochain sous-lot : **F4-C3c** — trajets ferroviaires via `/journeys`.

### Revue F4-C3c — des trajets observés, jamais des billets (30/07)

- **`/journeys` interne, entre deux gares déjà résolues.** La recherche exige
  des `CandidatGareNavitia` — pas de simples chaînes : une ville ou un nom saisi
  ne peut donc pas devenir une gare au passage.
- **Les heures restent locales.** Navitia rend `AAAAMMJJTHHMMSS` sans décalage :
  la valeur est seulement reponctuée en `AAAA-MM-JJTHH:mm:ss`, jamais promue en
  instant absolu. Aucun `Date.parse` sur une heure locale, aucun fuseau système
  appliqué, aucun offset déduit. Le fuseau IANA de chaque extrémité est conservé
  **séparément**, lu uniquement là où Navitia le publie (sur un `stop_area`) —
  sans fuseau fiable, le trajet est refusé plutôt qu'inventé. Un trajet qui
  passe minuit garde ses dates locales complètes.
- **Un train reste un train.** Le mode vient du `physical_mode` exact publié par
  Navitia, par correspondance stricte — jamais par sous-chaîne ni depuis le nom
  commercial d'une ligne. Un mode inconnu devient `autre`, et un itinéraire sans
  aucune section ferroviaire est ignoré : bus, métro ou tram seuls ne
  deviennent jamais un trajet en train. Marche, correspondance et attente sont
  conservées pour ne pas faire passer un trajet mixte pour un train de bout en
  bout.
- **Réseau n'est pas vendeur, code de ligne n'est pas billet.** Seuls les champs
  réellement publiés sont conservés (réseau, mode commercial, mode physique,
  code de ligne, direction), sous des noms qui ne promettent rien de commercial.
  Le nombre de correspondances est celui du fournisseur, pas un calcul maison.
- **Théorique et temps réel ne se confondent pas.** `base_schedule` par défaut,
  `realtime` seulement si demandé ; la fraîcheur est conservée sur chaque
  candidat et entre dans la clé de cache. Ni l'un ni l'autre n'est présenté
  comme une disponibilité ou une garantie de circulation.
- **Un itinéraire inconvertible refuse toute la réponse**, tandis qu'un
  itinéraire valide mais sans train est simplement ignoré. Écarter en silence un
  trajet illisible retirerait un choix de la liste et ferait passer les trajets
  restants pour l'offre complète. Une absence de solution déclarée par Navitia
  (`no_solution`) est un résultat **vide** ; toute autre erreur reste une
  indisponibilité — aucune panne ne devient un résultat vide.
- **Aucune élection de « meilleur » trajet** : l'ordre du fournisseur est
  conservé, sans tri, sans score, sans prix, sans lien, sans réservation. La
  déduplication n'utilise qu'une signature de faits fournisseur.
- **Cache différencié** : 30 min pour un horaire théorique, 2 min pour du temps
  réel, 5 min pour un résultat vide, jamais pour une indisponibilité. La clé
  sépare origine, destination, date, sens, fraîcheur, couverture et nombre
  demandé — un aller et son retour ne se mélangent pas.
- 127 tests ajoutés (`navitiaNormalisationTrajets`, `navitiaJourneys`), 1485
  verts sur toute la suite, typecheck OK, lint sans erreur. Tout le HTTP est
  simulé.
- **F4-C3 est terminé comme chantier interne** (a, b, c) : toujours aucun
  branchement dans la génération, les routes, l'OpenAPI, le front ou la
  persistance. Prochaine étape : **F4-D1** (liens de recherche transport) puis
  **F4-D2** (intégration des candidats dans la génération active).

### Revue F4-D1 — des liens de recherche, jamais des billets (31/07)

- **Un lien est une recherche, rien de plus.** Le contrat
  `LienRechercheTransport` ne porte que `type`, `fournisseur`, `url`, `libelle`
  et `genereLe` — aucun prix, billet, disponibilité ni réservation n'y existe.
  Le type (`recherche_vol`, `recherche_train`, `recherche_transport_local`) et
  le libellé rendent la confusion impossible.
- **Deux fournisseurs, choisis pour leur robustesse.** Les gares et le
  transport local passent par l'**API officielle « Maps URLs »** de Google Maps
  (itinéraire `dir` entre deux lieux, `travelmode=transit` pour le
  ferroviaire). Pour les vols, **aucun paramètre de préremplissage Google
  Flights n'est officiellement documenté** (ni `?q=`, ni le deep link `tfs`
  encodé) : le lien renvoie donc vers la page de recherche générique
  `google.com/travel/flights`, honnête plutôt que fragile — l'IATA et la date
  restent validés en amont mais n'apparaissent pas dans l'URL.
- **Aucune ville promue en aéroport ou gare.** Un vol exige deux codes IATA
  valides et distincts, sinon aucun lien. Les gares sont désignées par leur
  **nom observé**, jamais par un identifiant Navitia ou un code UIC que Maps
  n'interprète pas. Aucune date n'est injectée dans l'URL Maps, qui ne la
  supporte pas.
- **Refus prudent.** Identité essentielle absente, origine = destination, nom
  vide ou tentative d'URL en guise de lieu : le résultat est `null`, pas une
  erreur ni un faux lien.
- **Construction déterministe et sûre.** `URL`/`URLSearchParams` pour tout
  encodage, domaine et chemin verrouillés puis revalidés par le contrat, aucun
  appel réseau, aucun secret, aucune horloge implicite (`genereLe` injectable).
- **Aucun branchement actif.** Le module `lib/liensTransport.ts` n'est importé
  ni par la génération, ni par les routes, ni par le front — un test
  d'architecture le garantit. L'intégration réelle relève de **F4-D2**.
- 35 tests ajoutés (`tests/unit/liensTransport.test.ts`), 1533 verts sur toute
  la suite, typecheck OK, lint sans erreur, aucun appel réseau.

### Revue F4-D2 — brancher les liens, jamais forcer un trajet (31/07)

- **Un seul point d'intégration.** `genererParcours` appelle
  `ajouterLiensRechercheTransport` (`agents/enrichissementLiensTransport.ts`)
  après l'enrichissement hôtelier, sur le parcours déjà validé, avant la
  revalidation finale du domaine. Le résolveur legacy `resoudreLiensReels`
  reste inutilisé.
- **Modes réellement couverts : avion et train.** L'avion résout ses deux
  extrémités via Amadeus (`preference: 'aeroport'`, jamais une ville promue en
  aéroport) puis appelle `creerLienRechercheVol`. Le train résout ses gares via
  Navitia et n'utilise que le **nom observé** — aucun identifiant Navitia ni
  code UIC dans l'URL — puis appelle `creerLienRechercheTrain`. Le transport
  local est **hors périmètre** : la demande ne porte que des villes, jamais un
  lieu observé, et une paire de villes ne doit pas être promue en lieux réels.
- **Lien seulement sur deux identités uniques.** Toute résolution ambiguë,
  vide, sans code IATA, indisponible, ou aux extrémités identiques produit
  l'absence de lien. Une panne fournisseur laisse le transport sans lien sans
  jamais faire échouer la génération ni se déguiser en résultat normal.
- **Aucune URL assemblée hors de F4-D1.** L'enrichissement délègue toute
  construction d'URL aux constructeurs F4-D1 ; ni `?q=`, ni `tfs`, ni domaine
  arbitraire. Le contrat de sortie gagne un champ optionnel
  `lienRechercheTransport` réservé aux éléments transport ; le nom, la
  justification et le niveau de confiance (`suggestion`) du transport restent
  inchangés. Aucun prix, billet, réservation ni disponibilité.
- Nouveau branchement testé sans réseau réel
  (`tests/unit/enrichissementLiensTransport.test.ts`) ; garde d'architecture
  F4-D1 adapté au branchement désormais légitime. Prochaine étape : **F4-E**
  (modifications, API et front pour le transport).

### Revue F4-E — modifier le trajet sans jamais forger un lieu (31/07)

- **Un seul contrat client ajouté.** `modifier_demande_transport` rejoint la
  discrimination stricte de la route de modification. Il ne porte qu'une
  `DemandeTransportParcours` — villes prudentes, dates civiles, modes souhaités,
  occupation déclarée. Le schéma persistant refuse déjà toute gare, aéroport,
  terminal ou code fournisseur : aucune identité IATA ou UIC ne peut être forgée
  côté client, y compris via une ville déguisée (« Aéroport de… », « BOD »).
- **Reconstruction déléguée, jamais réinventée.** Le service
  `modificationTransport.ts` met à jour la demande, redérive libellé et
  justification côté serveur (contrat positionnel tronçon ↔ élément, comme la
  génération) puis réutilise **tel quel** l'enrichissement F4-D2
  (`ajouterLiensRechercheTransport`) : Amadeus/Navitia, résolution unique
  obligatoire, aucune URL assemblée hors des constructeurs F4-D1. Une résolution
  ambiguë, vide ou indisponible retire l'ancien lien et n'en pose aucun, sans
  faire échouer la modification. `resoudreLiensReels` reste inactif.
- **Fail-closed sur le périmètre.** Modifier le nombre de trajets, ou modifier
  un parcours sans demande transport, est refusé (422) : ajouter ou retirer un
  transport relève des opérations d'élément existantes, hors de ce lot. Le
  niveau de confiance (`suggestion`) et le transport local restent inchangés.
- **Le transport n'a plus qu'une seule porte client.** Comme l'hébergement, le
  type `transport` est désormais exclu du contrat générique
  (`PropositionElementClientSchema`) : `ajouter_element` et `remplacer_element`
  ne peuvent plus créer ni remplacer un transport. Sans cette exclusion, un
  ajout générique aurait pu désynchroniser la correspondance positionnelle
  tronçon ↔ élément et rattacher un lien au mauvais tronçon. La reconstruction
  positionnelle est donc sûre : aucune route cliente ne peut plus la fausser.
- **OpenAPI synchronisée.** `LienRechercheTransport` documenté et exposé en
  lecture seule sur `Element` ; dixième discriminant ajouté au contrat de
  modification. Front : un composant unique réutilisé par le détail et le
  partage affiche le lien seulement s'il existe, comme une recherche externe
  explicite, jamais comme une réservation.
- Tests ajoutés pour le service (`tests/unit/modificationTransport.test.ts`) et
  pour l'exclusion transport du chemin générique
  (`modifications.test.ts`, `transportActif.test.ts`), OpenAPI resynchronisée,
  1568 verts sur toute la suite, typecheck OK, lint sans nouvelle erreur, aucun
  appel réseau. F4 est terminé.

**F5 — Génération progressive** *(en cours)*

- [x] **F5-A** — plan dérivé pur et transport déterministe
- [x] **F5-B** — génération lot par lot, assemblage et reprise du lot en échec

**F6 — Benchmark des modèles** *(en cours)*

- [x] **F6-A** — instrumentation des appels IA (modèle injectable, métriques)

### Revue F6-A — modèle injectable et métriques sans changer le produit (31/07)

- **Modèle Anthropic injectable, comportement inchangé.** `callClaudeOutils`
  et `callAIAvecOutils` acceptent désormais une option `modele` ; sans elle,
  `MODELE_CLAUDE` (Haiku 4.5) reste utilisé exactement comme avant. Aucun
  appelant existant (`genererLot`, tests) n'a été modifié : la boîte à outils,
  le contexte et les mocks historiques restent compatibles tels quels.
- **Métriques remontées par callback, jamais par retour de valeur.** Une
  option `onMetriques` rend, à la fin d'un appel outillé complet : modèle,
  tokens d'entrée et de sortie agrégés sur tous les tours (capturés via
  `usage` de la réponse Anthropic, jusque-là ignoré), durée, nombre de tours
  et succès ou type d'échec (`cle_absente`, `boucle_interrompue`). Jamais de
  prompt, de réponse ou d'intention utilisateur dans ces métriques.
  La classification métier existante (422 refus, 502 sortie inexploitable,
  503 indisponibilité) reste entièrement dans `genererLot`, inchangée : cette
  instrumentation ne porte que sur la boucle d'outils elle-même.
- **Prépare F6-B sans l'anticiper.** Aucun routage automatique, aucun autre
  fournisseur, aucun calcul de coût (les tarifs ne sont pas versionnés dans
  le dépôt) : uniquement les grandeurs nécessaires à un futur script de
  benchmark comparant les modèles sur les mêmes scénarios.
- Tests ajoutés (`tests/unit/callAIAvecOutilsMetriques.test.ts`,
  `tests/unit/callAIAvecOutilsMetriquesSansCle.test.ts`) : modèle par défaut,
  modèle explicite transmis au provider, agrégation des tokens sur plusieurs
  tours, durée non négative, classification d'échec sans fuite de contenu,
  absence de clé, compatibilité avec l'appel historique sans options. 1622
  verts sur toute la suite, typecheck OK, lint sans nouvelle erreur, aucun
  appel réseau réel.

### Revue F5-B — génération progressive par lots (31/07)

> Livré par la [PR #47](https://github.com/loties1533/experience-ai/pull/47).

- **Le plan est branché.** `genererParcours` appelle `deriverPlan`, puis génère
  chaque lot par son propre appel `callAIAvecOutils`, restreint à sa ville et à
  sa plage via un brief de lot (le transport est retiré, l'hébergement limité
  aux séjours de la ville). L'ancien appel IA unique a disparu : le cas mono-lot
  emprunte exactement le même pipeline, sans cohabitation de deux modèles.
- **Refs namespacées, dépendances contrôlées.** Chaque lot voit ses refs
  préfixées et ses `dependDe` réécrits simultanément ; une dépendance qui ne
  cible pas une ref du même lot fait échouer le lot plutôt que d'être supprimée
  en silence. Deux lots peuvent donc réutiliser la même ref sans collision d'id.
- **Assemblage puis queue unique.** Les lots validés sont assemblés dans l'ordre
  du plan, avec un marqueur de transition à chaque changement de ville ; la suite
  (transport déterministe, ids, résolution des liens, enrichissements hébergement
  et transport, validation finale) s'exécute **une seule fois sur l'agrégat**.
  Aucun `resoudreLiensReels`. Les transports sont synthétisés entre les villes,
  jamais relégués en fin de parcours.
- **Reprise ciblée et bornée.** Une indisponibilité technique (503) rejoue le
  seul lot concerné, au plus `TENTATIVES_MAX_PAR_LOT` fois, sans régénérer les
  lots déjà validés ; au-delà, la génération échoue **sans exposer de parcours
  partiel**. Un refus métier (422) ou une sortie inexploitable (502) échoue sans
  relancer les autres lots. Durée et volume de chaque lot sont journalisés, sans
  secret ni donnée personnelle.
- Tests ajoutés (`tests/unit/generationProgressive.test.ts` : mono/multi-lots,
  ville longue, namespacing, reprise 503, échec persistant, 422, transport et
  scénario trois semaines) et adaptés (`generationOutillee`, `agents`) à la
  génération par lots. 1611 verts sur toute la suite, typecheck OK, lint sans
  nouvelle erreur, aucun appel réseau réel.

### Revue F5-A — un plan dérivé, un transport aligné sur la demande (31/07)

> Livré par la [PR #46](https://github.com/loties1533/experience-ai/pull/46).

- **Un plan dérivé, pas encore branché.** `deriverPlan` (et les contrats
  internes `PlanGeneration` / `LotPrevu`) découpe un parcours en lots par ville
  et par blocs de jours, à partir du seul brief : aucun appel IA, aucun réseau,
  aucune horloge. La génération reste **un unique appel IA** — on construit le
  nouveau avant de basculer, sans faire cohabiter deux pipelines. F5-B
  l'utilisera pour générer lot par lot avec reprise.
- **Découpage déterministe et borné.** Blocs de 2 à 5 jours, répartition la plus
  égale possible : aucun lot de plus de cinq jours, aucun lot orphelin d'un jour
  (un seul jour disponible reste un cas légitime), couverture exacte sans trou
  ni chevauchement. Sans dates : un lot par ville. Plusieurs villes datées :
  répartition contiguë des jours, sauf si chaque ville ne peut recevoir deux
  jours — on renonce alors aux plages plutôt que d'inventer un déséquilibre.
- **Transport synthétisé depuis la seule demande.** `nettoyerMomentsTransport`
  ne dépend plus des placeholders du LLM : il produit **exactement un transport
  par tronçon, dans l'ordre de la demande**, quel que soit ce que le modèle a
  émis (zéro, un ou cinq). Ni la référence, ni le prix du placeholder ne
  survivent : un prix absent de la demande reste absent plutôt qu'inventé. Le
  contrat positionnel tronçon ↔ élément réutilisé par l'enrichissement F4-D2 en
  sort renforcé, puisque le nombre et l'ordre ne varient plus avec le LLM.
- **Garanties F4 inchangées.** Niveau `suggestion`, absence de lieu, d'horaire,
  de réservation et de preuve : les invariants transport restent tenus. Aucun
  parcours partiel n'est introduit — le chemin de génération est identique, à la
  synthèse transport près.
- Tests ajoutés (`tests/unit/planGeneration.test.ts`, découpages 1 à 16 jours,
  mono-ville, multi-villes et dates absentes) et adaptés (`transportActif`,
  `agents`) au transport déterministe. 1596 verts sur toute la suite, typecheck
  OK, lint sans nouvelle erreur, aucun appel réseau. Prochain sous-lot : **F5-B**.

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
| R6 — Bascule & nettoyage | Basculer les routes sur Parcours, **supprimer** le modèle Pack, maîtrise des coûts (cache) | Terminé |
| R7 — Domaine complété | Les manques révélés par le code et le prototype : invariants 7 et 8, vraies dates de parcours | Terminé |
| R8 — Partage au groupe | Un lien par participant, la visibilité respectée, les réactions du groupe | Terminé |

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

**R6 — Bascule & nettoyage** *(terminé le 24/07)*
- [x] Front basculé sur les routes `parcours` (R6a, 23/07)
- [x] **Suppression** du modèle Pack (routes trips/votes, services pack, tables) — jamais deux modèles qui cohabitent
- [x] Cache des appels externes (maîtrise des coûts)
- [x] Recette manuelle de bout en bout (R6c, 24/07)
- [x] La génération cherche de vrais lieux (outils, repli, traçabilité) — R6d, 24/07

**R7 — Domaine complété** *(terminé le 24/07)*

> Deux manques constatés **en implémentant**, pas en théorisant (règle d'évolution
> du domaine, doc 06) : le code ne portait que 6 invariants sur 8, et le
> prototype utilisateur a réclamé de vraies dates.

- [x] Invariant 7 — arbitrage définitif : option écartée mémorisée, jamais reproposée
- [x] Invariant 8 — chaque modification est signée, le rôle de l'auteur doit la couvrir
- [x] Dates réelles du parcours (début / fin) et cohérence avec les plages des éléments

**R8 — Partage au groupe** *(terminé le 24/07)*

> La dernière capacité MVP qui manquait (doc 07). Jusqu'ici le produit était
> solo : on générait, on modifiait, on ne montrait rien à personne.

- [x] Constituer le groupe : ajouter / retirer un participant avec son rôle (responsabilité *convier*)
- [x] Choisir la visibilité (privé / partagé / surprise) et obtenir un lien **par participant**
- [x] Table `partages_parcours` + migration `ajout_liens_de_partage`
- [x] Routes ouvertes `GET /api/partage/:jeton` et `POST /api/partage/:jeton/reactions`
- [x] Réagir sur un élément (pour / contre, signé) et voir l'avis du groupe côté organisateur
- [x] Front : panneau de partage sur le détail, page `/partage/:jeton` pour le groupe

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

### Revue R7 — invariants 7 et 8 (24/07)
- **Invariant 7 (arbitrage définitif).** Une alternative porte désormais un
  drapeau `ecartee` : la forme la plus simple qui tienne l'invariant, sans
  inventer d'objet « Arbitrage » (l'Historique raconte déjà quand on a tranché).
  Nouvelle demande `ecarter_alternative`, et `alternativesProposables()` : c'est
  la **seule** liste d'options que voient le front et l'agent Modification, qui
  ne peut donc plus reproposer ce qui a été écarté. Un arbitrage survit au
  remplacement de l'élément qui le portait — on ne blanchit pas une décision en
  changeant l'élément.
- **Invariant 8 (responsabilités du rôle).** `appliquerModification` est
  désormais signée : elle prend l'identité de l'auteur et refuse proprement
  (message français, `ok:false`) si son rôle ne couvre pas la responsabilité
  engagée — proposer / ajuster / supprimer / arbitrer (tableau dans le doc 06).
  Max, le héros de son EVG, ne peut plus toucher à son parcours ; un auteur
  étranger au parcours non plus.
- Sur la route, l'auteur est l'utilisateur du JWT. Le dépôt ne rendant que ses
  propres parcours, il en est propriétaire : s'il ne figure pas dans les
  participants (un parcours généré porte un participant « Organisateur » d'id
  aléatoire), il est rattaché à l'organisateur. À revoir le jour du partage :
  chaque invité aura alors son propre participant et son propre rôle.
- 209 tests verts, typecheck serveur et client OK, lint sans erreur.

### Revue R7 — les dates du parcours (24/07)
- Le parcours peut porter de **vraies dates** (`contexte.dates`), optionnelles.
  Même objet-valeur qu'une plage d'élément : une seule règle de comparaison
  dans le domaine, et « début avant fin » vient avec.
- **Durée et dates cohabitent sans se contredire** (détaillé dans le doc 06) :
  la durée est l'ordre de grandeur de l'envie et existe toujours ; les dates
  sont le calendrier réel et font foi quand elles existent. Ni recalcul de
  l'une depuis l'autre, ni refus en cas d'écart — une envie de trois semaines
  posée sur cinq jours de congés n'est pas une erreur, c'est la vie.
- `validerParcours` garantit que rien ne se passe en dehors : toute plage (d'un
  moment comme d'un élément) tombe dans les dates quand elles existent. Une
  modification qui ferait déborder un élément est donc refusée, comme toute
  autre incohérence.
- Le chemin complet suit : le brief accepte des dates (jamais déduites de la
  durée), la reformulation les annonce (« du 12 juillet 2026 au 14 juillet
  2026 »), l'orchestrateur les transmet et le front les affiche quand elles
  existent.
- 220 tests verts, typecheck serveur et client OK, lint sans erreur.

### Revue R8 — le partage au groupe (24/07)

> Livré par la [PR #1](https://github.com/loties1533/experience-ai/pull/1).
- **Le produit n'est plus solo.** L'organisateur constitue son groupe (prénom +
  rôle), choisit la visibilité, et obtient un lien à envoyer à chacun. Le
  porteur du lien consulte le parcours et dit ce qu'il en pense ; l'organisateur
  voit l'avis du groupe sur chaque élément et tranche.
- **La forme du lien : un jeton PAR PARTICIPANT**, pas un jeton par parcours. C'est ce qui rend la
  surprise vraie : le héros n'a aucun lien à présenter, il n'y a rien à
  contourner. Un jeton unique aurait obligé le porteur à déclarer qui il est —
  et Max n'aurait eu qu'à se déclarer « Léo ». Effet de bord heureux : la
  réaction est signée sans que personne ait à saisir son nom.
- **Deux responsabilités nées du code** (règle d'évolution du doc 06) :
  *convier* (constituer le groupe, choisir la visibilité — l'organisateur seul,
  décider qui voit c'est décider) et *réagir* (ouverte aux trois rôles, héros
  compris : l'invariant 8 protège la décision, pas l'expression).
- **L'avis éclaire, il ne décide pas.** Une réaction ne change aucun statut, ne
  déclenche aucun recalcul, ne se compte pas, et ne s'inscrit pas dans
  l'Historique (qui journalise les modifications du parcours, pas les
  conversations). Le vote formel reste explicitement en V2.
- **Sécurité :** un jeton ne donne jamais les droits d'un compte. Les deux
  seules routes ouvertes du produit lisent et enregistrent un avis, rien de
  plus ; le propriétaire sous lequel on écrit vient de la ligne de partage,
  jamais du client. Modifier, convier ou changer la visibilité exigent
  `requireAuth` **et** le rôle. Jeton inconnu, parcours redevenu privé et
  surprise dont on est le héros rendent la même 404 — on n'apprend pas à Max
  qu'une surprise se prépare.
- L'agent Modification a été **rétréci** : son vocabulaire de sortie
  (`DemandeSurElementSchema`) s'arrête aux éléments. Partager est un geste
  délibéré, pas une phrase mal comprise.
- 289 tests verts (18 fichiers), typecheck serveur et client OK, lint sans
  erreur. Spec OpenAPI complétée (tag Partage) — et l'énumération `visibilite`
  y était incomplète (`surprise` manquait) : corrigé au passage.
- Faiblesses assumées : **un lien se transfère** (le
  produit sait qui un lien désigne, pas qui le clique) ; deux avis simultanés
  sur le même parcours s'écrasent (relecture-réécriture du JSON entier) ;
  l'organisateur copie autant de liens qu'il y a de participants.

### Revue R6c — la recette manuelle, et ce qu'elle a trouvé (24/07)

> Livré par la [PR #3](https://github.com/loties1533/experience-ai/pull/3).

Première recette **dans le navigateur** (les précédentes passaient par l'API) :
inscription, dialogue, génération, modification. Trois défauts, dont un bloquant.

- **Bloquant — la génération échouait 3 fois sur 4.** Le domaine exigeait que
  *tout* élément tombe entre les dates du parcours. Or un hébergement se rend le
  lendemain matin du dernier jour (`04/09 14:00 → 07/09 11:00`) et un club ferme
  après minuit : ces deux cas, parfaitement justes, rendaient le parcours
  « incohérent ». Désormais seul le **début** est contrôlé ; la fin peut déborder.
  Mesuré avant/après sur le même brief : **1/4 → 4/4**.
- **« Du 4 au 6 septembre » excluait le 6.** Le modèle rend des dates à minuit,
  si bien qu'une fin au 6 à 00:00 mettait le brunch du dimanche hors bornes. Une
  fin posée à minuit est maintenant étendue à la fin de sa journée ; une fin qui
  porte une heure explicite est respectée telle quelle.
- **L'envie saisie est perdue à la connexion.** Un visiteur non connecté écrit
  son envie, clique, et se retrouve sur la page de connexion — texte effacé, sans
  explication. C'est la promesse du produit qui s'évapore au premier geste.
- **Les sorties sont typées « temps libre ».** Sur 2 générations sur 4, la virée
  bars et la boîte de nuit — les temps forts d'un EVG — portaient le type
  `temps_libre`. Le domaine a six types et aucun ne désigne une sortie : le
  modèle range donc le club avec les pauses café. L'interface affichera le
  sommet de la soirée comme un temps mort. **Constat, pas décision** : ajouter un
  type touche au modèle, cela relève d'un arbitrage explicite.
- Variance d'extraction observée : sur une phrase mêlant plusieurs idées, une
  contrainte négative (« pas de paintball ») a été perdue au profit d'une autre.
  Le code est en cause nulle part — c'est la qualité du prompt d'intake.

### Revue R6f — migrations propres (24/07)

L'historique des migrations rejouait TripGenie à chaque base neuve : `init`
créait `trips`/`packs`/`trip_votes`/… pour que `suppression_modele_pack` les
détruise trois étapes plus loin. Les 6 migrations sont écrasées par **une seule
`init_experience_ai`** qui crée directement les 4 tables du produit (users,
parcours, preferences_parcours, partages_parcours). Sans donnée de production,
c'est sans risque ; la base locale de dev se resynchronise par `migrate reset`.

### Revue R6e — ménage des résidus TripGenie (24/07)

Le projet est né d'une copie de TripGenie : la plomberie réutilisée était juste
(auth, Express, Prisma, CI, cascade LLM), mais la périphérie estampillée
TripGenie n'avait jamais été nettoyée. Passe dédiée :

- **Config / branding corrigés** : `robots.txt` interdisait `/trips` (routes
  disparues) → `/parcours` ; `Seo.tsx` pointait vers `tripgenie-api.onrender.com` ;
  en-tête OpenRouter `X-Title: TripGenie` ; base de test CI `tripgenie_test` ;
  README front.
- **Code mort retiré** : `yelp.ts` (plus aucun import) et sa suite de tests ;
  les recherches de **vols et d'hôtels** de `smartSearch.ts` (l'ancien TripGenie
  réservait ; nous non — invariant 4). Seule la recherche d'**événements**
  reste, vivante via PredictHQ. Fichier passé de 205 à ~80 lignes.
- **Cache de build** `vite.config.js.timestamp-*.mjs` versionné par erreur →
  supprimé et ignoré.
- Séparation d'avec TripGenie finalisée hors dépôt : suppression de la vieille
  copie locale `experience-ai` (doublon qui pointait sur le même dépôt), mémoire
  projet consolidée.

290 tests verts (les 22 retirés testaient le code mort supprimé), typecheck
serveur et client propres.

### Revue R6d — de vrais lieux, et le cache (24/07)

> Livré par la [PR #4](https://github.com/loties1533/experience-ai/pull/4) — avec le type `sortie` et l'envie préservée à la connexion.

La recette avait sorti « Bar à cocktails réputé du centre » : un nom plausible,
vérifiable nulle part. Sur un produit dont la valeur est la **cohérence avec un
thème**, un lieu faux ruine la confiance plus sûrement qu'un parcours moyen. La
génération ne faisait qu'un appel LLM, et le modèle puisait dans sa mémoire
d'entraînement — pendant que les connecteurs (Foursquare, PredictHQ, météo)
conservés au sprint R6b n'étaient appelés par personne.

- **L'orchestrateur cherche avant d'écrire.** Il reçoit trois outils
  (`chercher_lieux`, `chercher_evenements`, `consulter_meteo`), décide lui-même
  quoi chercher, lit de vrais résultats et construit le parcours à partir d'eux.
  Chaque outil est adossé à un connecteur qui existait déjà : rien de neuf côté
  fournisseurs, seulement des câbles enfin branchés. Foursquare a gagné une
  recherche **libre** (`foursquareRechercheLieux`) : ses catégories figées par
  mode ne connaissaient que le repas et la fête, alors que le modèle doit
  pouvoir chercher ce que l'intention réclame.
- **Sans casser l'existant.** `callAI` (prompt → texte) ne bouge pas : l'intake
  et l'agent Modification, qui n'ont rien à chercher, passent exactement par où
  ils passaient. La boucle vit à côté, dans `callAIAvecOutils`.
- **Trois tours d'outils au maximum**, soit **quatre appels au modèle** pour une
  génération. Le modèle est Haiku 4.5 et sait grouper ses recherches dans un
  même tour : en pratique il lui en faut un, deux s'il complète. Au dernier
  tour, les outils lui sont retirés — il n'a plus qu'à écrire.
- **Le repli est explicite, jamais une panne affichée.** Pas de clé Anthropic →
  génération par la voie simple, sans données réelles. Connecteur sans clé, en
  panne ou muet → l'outil rend « aucun résultat réel », et le prompt lui
  interdit d'inventer un nom d'établissement : il redevient générique et
  honnête (« un bar à cocktails du centre »). Boucle interrompue (quota,
  réseau) → repli sur l'appel simple. Dans tous les cas, un parcours sort.
- **Le cache** (`lib/cacheMemoire.ts`) est en mémoire, sans nouvelle
  dépendance : deux générations sur la même ville ne repaient pas la même
  recherche. Durées de vie choisies sur ce que la donnée a de périssable — 24 h
  pour un lieu, 6 h pour un événement, 3 h pour la météo. On mémorise la
  promesse (deux générations simultanées partagent l'appel) et jamais un échec.
- **La traçabilité ne passe pas par le modèle.** Quand le nom proposé
  correspond à un lieu rendu par une recherche, le serveur lui rattache son
  adresse (`lieu`) et son lien de carte (`reservation`, un LIEN EXTERNE —
  invariant 4, jamais un achat, et jamais sur un temps libre). Le modèle n'a
  aucune URL à écrire : on ne lui en transmet même pas.
- **Le domaine n'a pas bougé d'une ligne.** `validerParcours` reste seul juge,
  les ids naissent côté serveur, la sortie est revalidée champ par champ.
- 312 tests verts (20 fichiers, 17 ajoutés), typecheck serveur et client OK,
  lint sans erreur. La suite ne peut plus toucher une vraie API : les clés du
  `.env` sont neutralisées dans la configuration Vitest.
- **Faiblesses assumées.** Rien n'a été vérifié contre les vraies API : la clé
  PredictHQ est expirée et les tests mockent tout — le format de réponse réel
  n'est donc pas confirmé par cette branche. Le rapprochement entre le nom
  proposé et le lieu trouvé se fait par comparaison de chaînes (accents et
  ponctuation ignorés, inclusion tolérée) : un modèle qui reformule un nom perd
  son lien de carte, et deux établissements homonymes dans la même ville
  seraient confondus. Le cache est par instance — deux instances chercheraient
  chacune de leur côté. Enfin, un repli après une boucle interrompue repaie une
  génération complète : c'est le prix d'un parcours qui sort quand même.

### Revue R6g — durcir le cache, retirer le code mort (25/07)

> Livré par la [PR #9](https://github.com/loties1533/experience-ai/pull/9).
>
> Le tableau affichait encore R6 « en cours » alors que toutes ses cartes
> étaient cochées depuis le 24/07 : un statut oublié, pas un travail en retard.
> Statut corrigé. En le vérifiant, deux angles morts méritaient d'être fermés.

- **La route photo échappait au cache.** `GET /api/photos/:city` rappelait
  Unsplash puis Pexels à chaque affichage, alors qu'une ville ne change pas de
  visage. `getDestinationPhoto` passe désormais par `memoriser` (clé = ville,
  24 h). On ne mémorise **que** les vraies photos : quand aucune source ne
  répond, `chercherPhoto` lève, le cache ne retient pas l'échec, et l'appelant
  rend le repli générique — qui sera retenté la fois suivante.
- **Le cache n'avait aucun test.** C'est de la logique pure : un test unitaire
  (`tests/unit/cacheMemoire.test.ts`) défend ses quatre invariants — mémoriser,
  partager une promesse en vol, ne jamais garder une panne, recalculer une fois
  le temps de vie écoulé.
- **Code mort retiré.** `smartEventsSearch` et sa recherche web `searchWeb`
  (Tavily) étaient définis mais appelés par personne — un repli événementiel
  jamais branché. Supprimés (règle « pas de code mort »), avec les commentaires
  et logs qui promettaient encore un « repli Tavily » inexistant. Le type
  `EventSearchResult`, lui, était bien vivant : déplacé dans `lib/types.ts`.
- 294 tests verts, typecheck OK, lint sans erreur. Le besoin d'un vrai repli
  événementiel reviendra s'il se prouve en recette — on le reconstruira alors
  pour le problème constaté, pas depuis une version dormante.

### Finition — trois défauts trouvés en recette live (25/07)

> Livré par la [PR #10](https://github.com/loties1533/experience-ai/pull/10).
> Recette de bout en bout dans le navigateur (scénario EVG à Bordeaux), clé
> Anthropic à sec — ce qui a justement révélé le premier défaut. Ce ne sont pas
> des idées : ce sont des choses vues à l'écran.

- **Le 502 mentait.** Sur clé morte, la génération bascule sur le repli ; le mode
  secours renvoie `{ indisponible: true }` — un signal honnête — mais
  `generation.ts` le jetait et levait un 502 « résultat inexploitable, réessaie »,
  alors que réessayer tout de suite ne change rien. On détecte désormais
  l'indisponibilité **avant** la validation de schéma et on rend un **503** avec un
  message clair. Deux pannes enfin distinguées : charabia du modèle (502) vs
  aucun fournisseur (503).
- **La reformulation vouvoyait** (« Vous voulez… ») quand tout le produit tutoie.
  Elle tutoie maintenant, et le prompt d'intake impose le « tu » (le « Vous
  cherchez… » venait du modèle, faute de consigne).
- **« sur 1 jours »** → accord de la durée (« sur 1 jour », « sur 2 jours »).
- 297 tests verts (+3 : le 503, le tutoiement, l'accord), typecheck et lint OK.
  Le reste de la recette (génération réelle → modification → partage) attend le
  rechargement de la clé Anthropic.

### Finition — front : focus clavier et retour d'appui (25/07)

> Livré par la [PR #11](https://github.com/loties1533/experience-ai/pull/11).
> Audit UI/UX des pages accueil / login / préférences, pas refonte : le front
> était déjà propre (SVG, ARIA, palette cohérente). Deux vrais manques, corrigés
> au niveau des classes pour valoir partout.

- **Focus clavier presque invisible.** Les champs faisaient `focus:outline-none`
  + simple bordure, ce qui écrasait l'outline global : au clavier, on ne voyait
  plus où on était. Nouvelle classe `.champ` avec un anneau de focus net ; les
  champs dupliqués (Login, Préférences, accueil) factorisés dessus.
- **Aucun retour d'appui.** Boutons et chips gagnent un léger enfoncement au
  clic (`active:scale`), coupé si `prefers-reduced-motion`.
- CSS/Tailwind seul, aucune dépendance ajoutée. Vérifié au navigateur.
- **Signalé (non touché) :** `design-system/experience-ai/MASTER.md` (rose
  fashion + police manuscrite) ne correspond pas au vrai front (orange/teal/navy) —
  doc design périmée, jamais suivie. Sort à trancher.

### Finition front (suite) & design system remis en conformité (25/07)

> Livré par les PR [#12](https://github.com/loties1533/experience-ai/pull/12)
> et [#13](https://github.com/loties1533/experience-ai/pull/13).

- **PR #12** — même correctif d'anneau de focus, appliqué aux 3 champs restés
  hors des pages déjà auditées : la demande de modification (détail du
  parcours) et les deux champs du panneau de partage (participant, rôle).
  Liste **Mes parcours** auditée : rien à corriger.
- **PR #13** — `MASTER.md` était périmé, pas ignoré : enquête git montrant
  qu'un mauvais cadrage (« Road Trip Planner ») avait produit un thème rose
  jamais implémenté, quand la vraie palette « aventure » (orange/teal/navy)
  venait d'un second passage de la skill, celui-là suivi. Fichier réécrit à
  partir du code réel (`tailwind.config.js` + `index.css`) : le code reste la
  source de vérité, le doc ne fait que le refléter.

### Génération : dates sans fuseau, échec systématique (25/07)

> Livré par la [PR #14](https://github.com/loties1533/experience-ai/pull/14).
> Recette live (voyage NBA multi-villes), clé Anthropic avec du crédit — donc
> un bug distinct de la carte #10 (indisponibilité), révélé seulement une fois
> une vraie génération tentée.

- **Chaque génération avec horaires échouait en 502**, peu importe la clé. Le
  LLM écrit systématiquement un ISO sans le suffixe `Z`
  (`"2025-01-15T08:00:00"`), que `z.iso.datetime()` rejette seul. Diagnostic
  posé en direct (log temporaire, retiré) : confirmé sur les 40 plages
  horaires d'une même génération.
- **`PlageHoraireSchema` corrige au lieu d'espérer.** Un `z.preprocess` ajoute
  le `Z` manquant avant validation si le format le permet ; un ISO déjà
  correct n'est pas touché, un format réellement invalide reste rejeté. Même
  principe que pour les ids ou les refs inventées : le domaine ne fait jamais
  confiance à la sortie du LLM, il la corrige.
- Prompt de génération durci en complément (jamais de prose hors JSON).
- 2 tests ajoutés, 299 verts. **Vérifié de bout en bout au navigateur** : un
  vrai parcours NBA (Los Angeles / New York / Miami / Chicago) se génère et
  s'affiche, avec hébergement et justifications.

### Premier déploiement public — Render + Neon (25-26/07)

> Le compte Render (celui de TripGenie, qui expire le 30/07) n'autorise
> qu'une seule base PostgreSQL gratuite à la fois. Plutôt que d'attendre ou de
> sacrifier TripGenie, la base d'Experience AI vit sur **Neon** (gratuit, sans
> cette limite) ; Render n'héberge que le service web. `DATABASE_URL` n'est
> qu'une chaîne de connexion — rien n'oblige les deux à cohabiter chez le même
> hébergeur.

- Projet Render dédié (« Experience AI »), isolé de TripGenie : ni base, ni
  service, ni URL partagés (déjà prévu par `render.yaml`, ADR-0006 dans
  l'esprit — jamais deux projets mélangés).
- **Deux bugs de configuration, propres à un premier déploiement, invisibles
  en local :**
  - `NODE_ENV=production` (nécessaire à l'exécution) affecte aussi le `npm
    install` du **build** : les devDependencies (`@types/node`,
    `@vitejs/plugin-react`) ne s'installaient plus, cassant `tsc` puis Vite.
    Build Command corrigé : `npm install --include=dev && npx prisma migrate
    deploy && npx tsc && npm run build` (le script `build` racine installe
    *aussi* les dépendances de `client-react`, contrairement à
    `client:build`).
  - Un déploiement a hérité d'une lenteur infra ponctuelle (8m30 sans jamais
    logger le démarrage) — annulé puis relancé manuellement, reparti en 1m00s
    à l'identique. Pas un défaut du projet.
- **Application en ligne : https://experience-ai.onrender.com**

### Trois bugs de dialogue trouvés en recette live, sur le tout premier message (26/07)

> Livrés par les PR [#15](https://github.com/loties1533/experience-ai/pull/15),
> [#16](https://github.com/loties1533/experience-ai/pull/16) et
> [#17](https://github.com/loties1533/experience-ai/pull/17). Les trois sont
> nés du même test, dans l'ordre où ils sont apparus — chacun révélant le
> suivant une fois corrigé.

- **« semaines » manquait du schéma de durée** (PR #15). La toute première
  suggestion de l'accueil — « Vivre la NBA pendant 3 semaines » — donnait
  systématiquement « sur 3 jours » : `ContexteSchema.duree.unite` n'acceptait
  que `heures|jours`, alors que le commentaire du schéma citait déjà « trois
  semaines » comme exemple. Un oubli, jamais branché.
- **Une durée seule n'ancre le parcours à aucune vraie date** (PR #16). Sans
  date, le prompt de génération n'impose plus rien sur les plages horaires :
  le modèle en invente une (vu : `2025-01-20`, sans rapport avec le vrai
  séjour), et chercher de vrais événements (PredictHQ) sur une date inventée
  n'a alors aucune valeur réelle. `dates` devient un champ requis du
  **dialogue** (`champsManquants`), tout en restant optionnel au niveau du
  domaine (`BriefSchema`) — un point de départ seul suffit, la fin se
  **calcule** depuis la durée (`calculerDates`, arithmétique pure, jamais
  confiée au LLM). Au passage : une correction qui n'aboutissait à rien
  (dates ambiguës) rejouait la confirmation mot pour mot, donnant l'impression
  d'être ignoré — elle le dit maintenant franchement.
- **« point de départ » était ambigu** (PR #17). Le libellé introduit par la
  PR #16 pour réclamer une date a été comprise par le modèle comme une
  **ville** (« De quel point de départ tu pars ? » → « Bordeaux »), faisant
  tourner le dialogue en rond. Renommé partout en « date de départ » avec une
  précision explicite dans le prompt (« à quel moment, pas d'où »).
- Prompt d'intake durci pour garder l'unité de durée exacte dite par
  l'utilisateur (« 3 semaines » retombait parfois sur « 3 jours » malgré le
  schéma déjà corrigé — un modèle rapide sans consigne explicite retombe par
  habitude sur l'unité la plus commune).
- 302 tests verts au fil des trois PR, typecheck et lint OK à chaque fois.

### Vulnérabilités npm détectées en déployant — deux corrigées, une laissée ouverte (26/07)

> Livré par la [PR #17](https://github.com/loties1533/experience-ai/pull/17),
> avec les fixes de dialogue ci-dessus.

- **Corrigées sans risque** (`npm audit fix`, non cassant) : `@babel/core`
  (lecture de fichier arbitraire) et `postcss` (traversée de chemin /
  lecture arbitraire via `sourceMappingURL`). Les deux ne s'exécutent que
  côté outillage de **build** — jamais exposées à un visiteur du site en
  ligne.
- **⚠️ Laissée ouverte, volontairement : `react-router` — redirection
  ouverte** (CVE via `<Link>`/`useNavigate`, et injection de constructeur
  arbitraire en hydratation SSR — cette dernière ne s'applique pas ici, le
  front n'étant pas server-rendu). Celle-ci *s'exécute dans le navigateur de
  l'utilisateur*, en prod — la seule des trois qui compte vraiment. Le
  correctif exige un saut de version **majeure** (6.30 → 7.18), un vrai
  risque de casse de toute la navigation de l'app, qu'on ne peut pas tester
  sérieusement en pleine session de recette live. `vite`/`esbuild` (dev-only,
  jamais déployé) restent aussi en l'état pour la même raison de risque de
  casse, mais sans urgence puisque non exposés en prod.
- **À faire dans un chantier dédié** : upgrade react-router 6→7 avec une
  vraie recette de non-régression sur toute la navigation (accueil,
  connexion, détail parcours, partage) avant de merger.

### Une plage de dates comprise par le modèle, mais jamais structurée (26/07)

> Livré par une PR distincte, née du même test que les trois précédentes.
> Repéré en inspectant les vraies requêtes réseau du dialogue, pas en
> lisant seulement les réponses affichées.

- **Le LLM peut dire une chose et en écrire une autre.** Message unique
  « solo du 15/08 au 10/09 avec un budget de 8000 euros » : la réponse
  reformulait bien *« tu pars seul du 15 août au 10 septembre »*, mais le
  JSON structuré ne portait **aucun** champ `dates`. Le dialogue tournait en
  rond (redemandait sans cesse la date) alors que le modèle l'avait pourtant
  comprise — une divergence entre le texte libre et les données structurées,
  invisible tant qu'on ne compare pas les deux.
- **Un filet déterministe, indépendant du LLM.** Une expression régulière
  générique (`JJ/MM au JJ/MM`, aucune date câblée en dur) reconnaît une plage
  explicite directement dans le message brut, en repli si le modèle ne l'a
  pas structurée. Le LLM reste la voie principale pour tout le langage flou
  (« mi-août », « dans deux semaines ») — le filet ne couvre que le format
  chiffré, le cas qui venait justement d'échouer.
- Même principe que pour les dates sans fuseau (PR #14) ou les ids inventés :
  un champ aussi structurant pour la suite (chercher de vrais événements) ne
  peut pas dépendre entièrement de la fiabilité du modèle.
- 2 tests ajoutés (plage explicite structurée malgré une extraction LLM
  vide ; plage inversée ou absurde rejetée plutôt que propagée), 304 verts.

### Le résolveur de vrais liens, oublié lors du portage TripGenie (26/07)

> Repéré en testant un parcours daté de bout en bout : les liens rendus
> n'étaient que des recherches Google Maps, les hébergements 100% inventés,
> sans aucun ancrage réel. « je ne montre pas ce produit dans cet état, ça
> n'a pas d'intérêt si c'est pour générer des faux voyages. »

- **Deux morceaux de logique jamais portés.** En comparant avec TripGenie
  (repo de référence), rien dans leur logique ne dépendait de Pack ni de
  Parcours — ils sont simplement passés à la trappe pendant la réécriture du
  domaine : `services/liens.ts` (recherche web ciblée + LLM pour associer un
  nom de lieu à sa vraie page, avec un filet anti-hallucination : une URL
  n'est retenue que si elle existe littéralement dans les résultats de
  recherche) et `construireLienHotel` dans `lib/url.ts` (lien Booking.com
  pré-rempli avec les dates et le nombre de voyageurs — Booking, pas nous,
  connaît le vrai prix).
- **`tracerLieuReel` priorise maintenant en trois niveaux** : lien réel
  (site officiel / billetterie) > Booking.com pour un hébergement > carte
  Foursquare (repli existant, jamais un lien cassé). Un temps libre ne se
  réserve toujours pas (invariant 4).
- **Les vols (liens IATA/Kayak) sont délibérément laissés de côté** : mieux
  vaut n'afficher aucun lien de vol que d'en inventer un sans donnée fiable
  derrière.
- Nécessite `TAVILY_API_KEY` en variable d'environnement sur Render (déjà
  prévue dans `render.yaml`, jamais renseignée faute d'usage jusqu'ici).
- 23 tests ajoutés (filet anti-hallucination, dégradation propre à null,
  priorité des trois niveaux de lien), 327 verts.

### Un parcours long (NBA, 3 semaines, 4 villes) échouait systématiquement (26/07)

> Repéré juste après avoir déployé le chantier des liens réels : même brief,
> même échec deux fois de suite en recette live — reproduit ensuite en local
> pour diagnostiquer sans deviner.

- **Rien à voir avec les liens.** L'échec (« résultat inexploitable ») se
  produit avant même que le résolveur de liens s'exécute — confirmé en
  reproduisant en local avec des logs temporaires (retirés une fois la cause
  trouvée).
- **`max_tokens: 4000`, codé en dur, trop court pour un long parcours.** Un
  voyage sur plusieurs semaines et plusieurs villes dépasse vite cette
  limite : le modèle tronque son JSON en plein milieu d'une valeur. Relevé à
  8192 pour `callClaudeOutils` (la boucle d'outils) et `callClaude` (son
  repli), qui produisent le même JSON.
- **Un second bug, plus sournois, caché derrière le premier.** Quand la
  boucle d'outils est interrompue (délai dépassé, ce que confirme
  `TIMEOUT_IA_MS` relevé de 45 s à 60 s), le repli renvoie tel quel le system
  prompt d'origine à un appel qui, lui, n'a AUCUN outil : le modèle a alors
  tenté d'invoquer un outil en écrivant une syntaxe inventée en pleine prose,
  cassant le JSON. Le repli précise désormais explicitement qu'aucun outil
  n'est disponible pour cette réponse.
- 5 reproductions en local après correctif, 5 succès (contre un échec
  systématique avant), 327 tests toujours verts.

---

# TripGenie — Suivi Agile historique (sprints, revues et rétrospectives)

> **Archive uniquement.** Tout ce qui suit concerne l'ancien projet TripGenie.
> Le board Trello, les anciennes issues et leurs statuts ne pilotent pas
> Experience AI. Le suivi actuel d'Experience AI se trouve en tête de ce
> document, conformément à l'[ADR-0006](decisions/ADR-0006.md).

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
| S7 — Harmonisation et lisibilité | 9 – 13 juillet | Cohérence visuelle de l'interface, uniformisation des textes, clarté et allègement du code | Clos avec TripGenie |

Priorisation MoSCoW : indispensable (authentification, génération, modification,
score) ; souhaitable (préférences, votes, collaborateurs, données réelles) ;
optionnel (partage public par lien) ; écarté pour la v1 (réservation et paiement
in-app).

Dépendances : base de données → authentification → pipeline IA → scoring → CRUD →
front-end → intégration continue → déploiement.

---

## Revues de sprint

> Chaque revue porte le lien de la **PR** qui l'a livrée : le sprint dit *pourquoi*, la PR montre *quoi*. On ne crée jamais de nouveau document — on met celui-ci à jour.

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

## Outils de suivi historiques de TripGenie

Ces références sont conservées comme traces du projet précédent ; elles ne
représentent pas l'état actuel d'Experience AI.

- Board Trello TripGenie :
  https://trello.com/b/GfQ3gMc8/tripgenie-agile-board
- Anciennes GitHub Issues TripGenie : douze issues fermées
- Ancienne intégration continue TripGenie : tests et typecheck à chaque push
