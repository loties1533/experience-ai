# 14 — Fiabilité des parcours et vérité des données

> **Chantier actif après la refonte R1 → R8.** Le domaine `Parcours` est
> conservé. La priorité est désormais qu'aucun lieu, événement, hébergement,
> prix ou lien non vérifié ne soit présenté comme une donnée réelle.

## Pourquoi ce chantier existe

La refonte a livré un socle fonctionnel : domaine, invariants, persistance,
intake, génération, modification ciblée, préférences et partage. Elle ne prouve
pas encore qu'un parcours généré est suffisamment fiable pour une présentation
publique.

Le risque principal identifié en F0 était le repli silencieux : lorsqu'une
recherche ou une boucle d'outils échouait, le système pouvait encore générer un
parcours sans données réelles. F1 remplace ce comportement pour la génération
outillée et inscrit l'exigence suivante dans le domaine :

> Mieux vaut expliquer qu'une donnée indispensable manque que présenter une
> invention comme une réalité.

## Contrat de confiance de F1

Trois niveaux sont persistés sur les éléments. Le refus est un résultat métier
de génération, jamais un niveau enregistré. Voir
[ADR-0008](decisions/ADR-0008.md), accepté à la clôture de F1.

| Niveau ou résultat | Signification | Présentation autorisée |
|---|---|---|
| **Vérifié** | Donnée retrouvée auprès d'une source réelle et validée | Nom réel, source, fournisseur et date de récupération visibles |
| **Estimé** | Valeur calculée ou approximative, sans garantie en temps réel | Libellé explicite ; jamais présentée comme prix ou disponibilité actuelle |
| **Suggestion** | Idée générique qui ne désigne pas un établissement ou événement confirmé | Formulation générique, sans faux nom propre ni faux lien |
| **Refus métier** | Une donnée essentielle manque ou ne peut pas être vérifiée | Génération arrêtée avec une explication utile (`422`), sans élément persisté |

Principes non négociables :

- ne jamais fabriquer une URL ;
- ne jamais présenter un lieu inventé comme un établissement réel ;
- ne jamais présenter un prix estimé comme un prix actuel ;
- ne jamais présenter une date d'événement non vérifiée comme certaine ;
- un lien Booking ou de recherche ne prouve pas à lui seul l'existence de
  l'hébergement ou du trajet ;
- la cascade de fournisseurs LLM peut continuer, mais elle ne doit pas abaisser
  silencieusement le niveau de confiance des données.

## Architecture cible

L'architecture reste centrée sur un orchestrateur qui possède le brief, la
chronologie, les villes, le budget, les participants et les invariants.

1. **Intake** — conversation vers brief structuré.
2. **Normalisation déterministe** — dates, villes, voyageurs, durée, budget,
   contraintes et fuseau horaire.
3. **Plan global** — villes, dates par ville, grands moments, déplacements et
   enveloppes ; aucun faux établissement à ce stade.
4. **Recherche spécialisée** — lieux, événements, hébergements, transports et
   météo selon le besoin.
5. **Sélection contrainte** — l'IA choisit uniquement dans les résultats
   disponibles ou formule une suggestion générique.
6. **Construction des liens** — services déterministes dès que possible.
7. **Assemblage** — création du parcours depuis les éléments qualifiés.
8. **Validation finale** — dates, villes, conflits, distances, budget,
   dépendances, URL, source et niveau de confiance.
9. **Affichage** — distinction explicite entre vérifié, estimé, suggestion et
   refus.

Un service déterministe ne devient pas un agent LLM sans besoin de raisonnement.
Construire une URL, convertir une ville en code IATA, comparer des dates,
additionner un budget ou vérifier une URL restent des fonctions déterministes.

## Plan de livraison

Les sprints `F` succèdent aux sprints de refonte `R`. Un sprint suivant peut
être préparé en parallèle, mais il n'est validé que lorsque ses dépendances et
sa définition de terminé sont satisfaites.

| Sprint | Objectif | Dépend de | Statut |
|---|---|---|---|
| **F0 — Audit du portage** | Matrice TripGenie → Experience AI des capacités utiles | — | Terminé |
| **F1 — Vérité des données** | Politique de confiance, traçabilité et refus explicite | F0 | Terminé |
| **F2 — Lieux et événements** | Liens fiables pour activités, restaurants et événements | F1 | Terminé |
| **F3 — Hébergements** | Hébergements nommés vérifiés et liens correctement paramétrés | F1, F2 | Terminé |
| **F4 — Vols et transports** | Recherches réelles avec IATA, dates et voyageurs | F0, F1 | En cours (jusqu'à F4-C2 ; C3 à venir) |
| **F5 — Génération progressive** | Plan puis lots validés, reprise locale en cas d'échec | F1 | À faire |
| **F6 — Benchmark modèles** | Choix du modèle par mesures comparables | F5 | À faire |
| **F7 — Dialogue fiable** | Dates relatives, état de dialogue, aucune question répétée | F1 | À faire |
| **F8 — Modification complète** | Régénération atomique des seuls dépendants concernés | F1, F5 | À faire |
| **F9 — Recette de sortie** | Robustesse NBA puis validation de valeur EVG | F2 → F8 | À faire |

### F0 — Audit du portage

Inventorier les services de TripGenie et les classer : **porté**, **à adapter**,
**à réécrire**, **abandonné volontairement**. Pour chaque capacité, documenter
son contrat, ses dépendances, ses tests historiques, son équivalent actuel et
la décision.

**Terminé lorsque :** aucune suppression ou réécriture n'est décidée sans que
la fonction réelle de la brique soit comprise.

**Résultat :** audit terminé et validé le 28 juillet 2026. Voir la
[matrice TripGenie → Experience AI](audits/tripgenie-vers-experience-ai.md).

### F1 — Vérité des données et stratégie de repli

Définir le schéma de confiance, la source, le fournisseur et la date de
récupération ; supprimer le repli silencieux ; distinguer donnée essentielle et
facultative ; rendre les erreurs utiles.

Scénarios obligatoires : Tavily absent, Foursquare indisponible, événement
introuvable, hôtel non vérifié, lien invalide, suggestions uniquement et refus
faute de données essentielles.

**Terminé lorsque :** aucun lieu inventé n'est présenté comme réel.

**État :** implémentation terminée et validée. Une panne technique des
sources rend un `503`, tandis qu'un manque métier de données essentielles rend
un `422`. Une donnée facultative absente reste une suggestion générique.

### F2 — Lieux, activités, restaurants et événements

Utiliser la ville du moment plutôt qu'une destination globale, renforcer
l'association nom/résultat, valider domaine et redirections, stocker la source
et tester les homonymes ou succursales.

#### F2-A — Identité, provenance et états de recherche — Terminé

F2-A a été livré par la
[PR #25](https://github.com/loties1533/experience-ai/pull/25), avec les commits :

- `bb2f7f1b84e7c17ab1823bfae891a14db8a01728` — contrat et recherches externes ;
- `8023b6f98fccd05910540655b83b86a88a13da1d` — compatibilité de l'adaptateur
  Foursquare historique.

Preuves de livraison :

- contrat discriminé `ok | vide | indisponible` ;
- provenance Foursquare ou PredictHQ conservée avec la date de récupération et
  l'identifiant externe ;
- cache différencié selon les résultats valides, vides ou indisponibles ;
- rapprochement conservateur par identité, ville et type métier ;
- impossibilité pour un lien Web seul de produire le niveau Vérifié ;
- distinction déterministe entre refus métier `422` et panne technique
  essentielle `503` ;
- ville propre à chaque moment pour les parcours multi-villes ;
- comportement générique de `foursquareRechercheLieux` préservé pour les
  restaurants, bars/sorties et activités ;
- 361/361 tests réussis localement, typecheck et lint réussis.

#### F2-B — Résolution fiable des liens — Terminé

Sous-lots terminés :

- **F2-B1** — contrat discriminé `LienResolu` et validation pure des URL ;
- **F2-B2** — connecteur Tavily structuré, avec distinction entre résultat
  valide, recherche vide et indisponibilité technique ;
- **F2-B3** — sélection conservatrice et déterministe : le rang Tavily ou un
  LLM ne peut pas décider, l'ambiguïté ne produit aucun lien, et réservation ou
  billetterie exigent des preuves explicites ;
- **F2-B4** — validation HTTPS et DNS, protection SSRF, connexion Undici
  épinglée, redirections manuelles et refus d'un changement de domaine
  enregistrable ;
- **F2-B5** — intégration dans la génération active
  ([PR #30](https://github.com/loties1533/experience-ai/pull/30)) : `resoudreLien`
  est appelé depuis `agents/generation.ts` pour chaque demande de lien
  rattachée à une identité métier (Foursquare ou PredictHQ) — aucune
  résolution n'est déclenchée depuis le seul nom d'un élément. Le pipeline
  sécurisé F2-B1 à B4 (sélection déterministe puis contrôle réseau) est
  intégralement conservé dans ce flux.

Foursquare et PredictHQ fournissent l'identité métier ; Tavily propose des
candidats Web. Le contrôle réseau intervient uniquement après la sélection
d'un candidat unique et distingue un lien `accessible`, `refuse` ou
`indisponible`. Une panne réseau ne devient ni une recherche vide ni un résultat
introuvable. Une URL accessible ne suffit pas à prouver un site officiel et,
faute de preuve externe forte, F2-B ne produit actuellement aucun lien
`officiel`.

> **Précision technique.** L'ancienne fonction `resoudreLiensReels` (résolution
> groupée par ville, antérieure à F2-B) reste présente dans le code et sa
> suite de tests, mais n'est plus appelée par la génération active — seule
> `resoudreLien` (au singulier, le pipeline F2-B) l'est désormais.

Le chantier F2 est donc **terminé** : F2-A (identité) puis F2-B1 à B5
(résolution, sécurisation et intégration des liens).

**Terminé lorsque :** sur un échantillon documenté de 20 éléments, chaque lien
affiché mène au bon lieu ou événement ; l'absence de résultat fiable ne produit
pas de faux lien.

### F3 — Hébergements — Terminé

Livré par les PR
[#31](https://github.com/loties1533/experience-ai/pull/31) (F3-B),
[#32](https://github.com/loties1533/experience-ai/pull/32) (F3-C1),
[#33](https://github.com/loties1533/experience-ai/pull/33) (F3-C2) et
[#34](https://github.com/loties1533/experience-ai/pull/34) (F3-D).

Rechercher avant de nommer, rattacher l'hébergement à sa ville, vérifier son
existence puis construire la recherche Booking avec dates et voyageurs. Les
prix internes restent estimés ; le CTA devient « consulter le prix actuel ».

- **Identité hôtelière Foursquare (F3-B)** — un hébergement nommé provient
  d'un fournisseur réel (catégorie Lodging `19009`) ou reste générique ; comme
  pour les lieux et événements (ADR-0008), **un nom généré par le LLM n'est
  pas une identité vérifiée** — une ville ou une catégorie contradictoire
  élimine le candidat.
- **Séjour et occupation (F3-C1)** — l'occupation de l'hébergement
  (`OccupationHebergement`, déclarée ou à confirmer) est un contrat
  **distinct** de l'occupation transport ; aucune copie automatique de l'une
  vers l'autre, aucun état partiel accepté dans le parcours persisté.
- **Lien de recherche Booking (F3-C2)** — `LienRechercheHebergement` est un
  lien de type `recherche`, construit depuis l'hôtel, la ville, les dates et
  l'occupation validés. Conformément à ADR-0008, un lien de recherche
  **ne prouve ni prix ni disponibilité** : Booking reste seul responsable de
  ses résultats.
- **Verrouillage des modifications (F3-D)** — la route de modification
  hôtelière utilise un contrat client strict et discriminé qui empêche un
  appelant de forger directement une confiance, une provenance, une identité
  Foursquare ou un lien Booking.

**Terminé lorsque :** chaque hébergement nommé existe et son lien utilise la
bonne ville, les bonnes dates et le bon nombre de voyageurs. *(Satisfait pour
le périmètre F3-B à F3-D ; aucune disponibilité ni réservation n'est
prétendue.)*

### F4 — Vols et transports — En cours

**F4-A — Audit transport.** Couvert par l'audit F0
([PR #22](https://github.com/loties1533/experience-ai/pull/22)) : la matrice
`docs/audits/tripgenie-vers-experience-ai.md` couvrait déjà la recherche de
vols et la logique IATA de TripGenie. F4-A ne correspond à aucun livrable, PR
ou branche séparée — ce n'est pas un sprint autonome.

Livré par les PR
[#35](https://github.com/loties1533/experience-ai/pull/35) (F4-B1),
[#36](https://github.com/loties1533/experience-ai/pull/36) (F4-B2),
[#37](https://github.com/loties1533/experience-ai/pull/37) (F4-C1) et
[#38](https://github.com/loties1533/experience-ai/pull/38) (F4-C2).

- **Contrats de domaine transport (F4-B1)** — `domaine/transport/` : modes,
  lieux demandés/confirmés, occupation, dates civiles, tronçons, segments,
  candidats, preuves, provenance. Un contrat peut représenter une preuve
  future ; F4-B1 n'en fabrique aucune.
- **Génération fail-closed (F4-B2)** — brancher ces contrats dans le brief et
  la génération active (`agents/brief.ts`, `intake.ts`, `generation.ts`) :
  sans source externe, le serveur ne conserve aucun détail de trajet qui
  ressemble à une observation réelle (opérateur, horaire, numéro, lien).
- **Résolution des lieux aériens (F4-C1)** — via Amadeus Airport & City
  Search : **une ville n'est jamais automatiquement un aéroport**, un
  candidat fournisseur n'est jamais automatiquement un lieu confirmé.
  Résolution unique, ambiguë, vide ou indisponible. Un offset horaire n'est
  jamais transformé en fuseau IANA.
- **Candidats de vols structurés (F4-C2)** — via Amadeus Flight Offers
  Search : une réponse fournisseur est une **observation**, jamais une
  réservation, un billet ou une disponibilité garantie. Aucun prix, aucune
  offre commerciale persistée, aucun lien, aucune sélection automatique du
  premier résultat. Une heure locale sans fuseau fiable n'est jamais promue en
  instant absolu (aucun `Z`, offset ou fuseau IANA inventé).

> **F4-C1 et F4-C2 sont implémentés, testés et internes.** Ils ne sont pas
> encore appelés par la génération active, les routes publiques, l'OpenAPI,
> le front ou la persistance — cette séparation est volontaire, pour valider
> chaque couche avant exposition.

**F4-C3 — trains et transports locaux structurés : non commencé.** C'est le
prochain sous-lot. Suivront F4-D1 (liens de recherche transport), F4-D2
(intégration des candidats dans la génération active) et F4-E (modifications,
API et front pour le transport).

**Terminé lorsque :** le clic ouvre une recherche avec les bons aéroports,
dates et voyageurs sur les scénarios testés — non atteint tant que F4-C3 à
F4-E ne sont pas livrés.

### F5 — Génération progressive

Créer un plan global, générer par ville ou lot de jours, valider chaque lot,
assembler après validation et reprendre uniquement le lot en échec. Préserver
les dépendances entre lots et mesurer temps et coût.

**Terminé lorsque :** un parcours multi-villes de trois semaines est généré
sans troncature et sans perdre les lots déjà validés.

### F6 — Benchmark des modèles

Comparer Haiku, un modèle Claude plus puissant disponible et, si utile, un
autre fournisseur sur les mêmes entrées et avec les mêmes outils. Mesurer JSON
valide, dates, usage des outils, inventions, cohérence, durée, coût,
modification ciblée et stabilité.

Scénarios minimum : soirée à Bordeaux, EVG de deux jours, voyage NBA
multi-villes de trois semaines.

**Terminé lorsque :** le modèle de production est choisi sur des résultats
reproductibles, pas uniquement sur son coût.

### F7 — Dialogue fiable

Introduire le contexte date/heure/fuseau, un résolveur temporel déterministe,
un état explicite et le choix du prochain champ côté code. Tester des
conversations complètes, interruptions et corrections.

**Terminé lorsque :** une information donnée une fois n'est pas redemandée sans
raison et les dates relatives sont normalisées correctement.

### F8 — Modification chirurgicale complète

Consolider la capacité déjà existante : classer l'impact, régénérer les
dépendants nécessaires, valider atomiquement et expliquer les changements.

**Terminé lorsque :** « change uniquement le restaurant » ne modifie aucun
élément non dépendant, y compris après la génération progressive.

### F9 — Recette de sortie

Le scénario NBA valide la robustesse technique ; le scénario EVG valide le
groupe et la valeur produit. La recette ne commence qu'avec lieux, liens,
hébergements, vols concernés, dates, repli et parcours longs fiabilisés.

**Terminé lorsque :** les preuves de recette sont consignées et que les
conditions de présentation publique sont satisfaites sans exception masquée.

## Hors priorité pendant ce chantier

Jusqu'à F9, aucune nouvelle verticale ni fonctionnalité visible ne passe devant
un défaut de vérité des données. Inspiration, mémoire contextuelle et
accompagnement restent dans la roadmap produit, mais ne sont pas des solutions
à un parcours non fiable.
