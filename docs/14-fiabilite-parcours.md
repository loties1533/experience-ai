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
| **F2 — Lieux et événements** | Liens fiables pour activités, restaurants et événements | F1 | En cours |
| **F3 — Hébergements** | Hébergements nommés vérifiés et liens correctement paramétrés | F1, F2 | À faire |
| **F4 — Vols et transports** | Recherches réelles avec IATA, dates et voyageurs | F0, F1 | À faire |
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

#### F2-B — Résolution fiable des liens — À faire

Tavily, `server/services/liens.ts`, le contrat `LienResolu`, le contrôle des
domaines et celui des redirections restent explicitement à traiter dans F2-B.
Le chantier F2 reste donc **En cours**.

**Terminé lorsque :** sur un échantillon documenté de 20 éléments, chaque lien
affiché mène au bon lieu ou événement ; l'absence de résultat fiable ne produit
pas de faux lien.

### F3 — Hébergements

Rechercher avant de nommer, rattacher l'hébergement à sa ville, vérifier son
existence puis construire la recherche Booking avec dates et voyageurs. Les
prix internes restent estimés ; le CTA devient « consulter le prix actuel ».

**Terminé lorsque :** chaque hébergement nommé existe et son lien utilise la
bonne ville, les bonnes dates et le bon nombre de voyageurs.

### F4 — Vols et transports

Auditer puis adapter les types et constructeurs TripGenie ; intégrer IATA,
origine, destination, dates, voyageurs, aller simple/retour et multi-villes.
Ne jamais inventer de numéro de vol : un lien peut ouvrir une recherche réelle
sans prétendre désigner une offre disponible.

**Terminé lorsque :** le clic ouvre une recherche avec les bons aéroports,
dates et voyageurs sur les scénarios testés.

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
