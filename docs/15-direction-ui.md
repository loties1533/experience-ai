# Direction UI — de UI-A → UI-D à « Papier & Lumière »

> Ce document conserve l'audit UI-A → UI-D qui a posé les premiers composants
> de fiabilité. Cette première direction « aventure » n'est plus l'état visuel
> courant. UI-1 → UI-5 l'ont fait évoluer vers **« Papier & Lumière »**.
> Le code Tailwind/CSS puis le
> [`MASTER.md`](../design-system/experience-ai/MASTER.md) font foi pour les
> tokens actuels ; l'exécution reste suivie dans [`SPRINTS.md`](SPRINTS.md).

## 0. Direction actuelle — « Papier & Lumière »

La promesse visuelle part de l'envie, pas de la destination. La photographie
évoque des situations et des émotions (sport, amis, concert, romantisme,
aventure, culture, évasion) ; elle ne sert jamais de preuve métier.

- **UI-1 — fondations** : ivoire, crème, encre brune, terracotta d'action,
  laiton en détail ; Fraunces pour les titres et Inter pour l'interface.
- **UI-2 — hero et header** : hero immersif puis compact, photographies
  éditoriales avec provenance, header transparent puis solide.
- **UI-3 — dialogue** : colonne sans carte SaaS, bulles chaudes, récapitulatif
  limité aux champs confirmés, composer collant dans le flux.
- **UI-4 — parcours** : carnet à filets, moments en sections, provenance
  lisible sans URL technique, bibliothèque sobre.
- **UI-5 — écrans secondaires** : login, préférences et partage alignés ;
  panne, chargement et vide ne sont jamais confondus.

Les garanties d'ADR-0008 restent prioritaires sur l'esthétique : une
suggestion est moins saillante qu'une donnée vérifiée, une panne n'est pas un
état vide et aucune donnée absente n'est inventée pour remplir l'écran.

---

## Archive de conception — première phase UI-A → UI-D

### 1. Pourquoi cette première phase a été lancée

Le métier est fiable : génération vérifiée, statuts `verifie`/`estime`/`suggestion`,
refus explicites, modification atomique (F0→F8 terminés). Le front, lui, date
essentiellement du sprint 7 (reprise visuelle) et n'a jamais été confronté à la
question « est-ce que l'interface rend visibles les garanties que le backend
tient déjà ? ». C'est l'objet de cette phase, avant F9 (recette de sortie).

### 2. Audit — état observé avant UI-A

Périmètre inspecté : `client-react/src` (7 pages, layout, composants partagés,
`index.css`, `tailwind.config.js`) et `client-react/public/assets/hero.png`.

### Ce qui existe déjà et qu'il faut garder

- Un vrai système de tokens Tailwind : palette « aventure » `soleil` (orange
  coucher de soleil) / `lagon` (teal carte) / `sable` (fond crème) / `encre`
  (texte) / `brume` (texte secondaire) / `sauge`, `corail` (sémantique). Pas de
  violet, pas de gradient bleu/violet générique — la base est saine.
- `BadgeConfiance` ([`ConfianceElement.tsx`](../client-react/src/components/ConfianceElement.tsx))
  distingue déjà `verifie`/`estime`/`suggestion` avec un libellé et un `title`
  explicatif — c'est la bonne fondation pour la stratégie du §7.
- Accessibilité déjà travaillée par endroits : `focus-visible` global, cibles
  tactiles `min-h-[44px]`, `aria-live` sur le fil de dialogue, `prefers-reduced-motion`
  respecté sur les animations (`aurora`, `typing-dot`, `msg-enter`, `skeleton`).
- Aucune dépendance visuelle superflue : pas de glassmorphism généralisé (un seul
  `backdrop-blur-md` sur le header sticky, usage raisonnable), pas d'accumulation
  de cartes identiques au-delà de ce que la timeline justifie.

### Problèmes classés

**Critique UX**

1. **`422` (refus) et `503` (panne technique) sont invisibles en tant que tels.**
   `lib/api.ts` les transforme en `Error` générique, affichée par un `toast.error`
   au même niveau visuel qu'un champ mal rempli. Or ADR-0008 fait du refus un
   résultat métier distinct d'une panne fournisseur — l'UI ne les distingue pas,
   alors que le message à donner à l'utilisateur diffère (« je ne peux pas
   honnêtement construire ça » vs « réessaie dans un instant »).
2. **Aucun état « indisponible »/« refus » au niveau écran.** `Envie.tsx` retombe
   sur un toast qui disparaît ; l'utilisateur reste devant le formulaire de saisie
   sans qu'on lui explique ce qui s'est passé ni ce qu'il peut faire (reformuler,
   réessayer, retirer une contrainte).
3. **La génération progressive n'a pas de vraie progression.** L'état
   `generationEnCours` affiche trois lignes de skeleton statiques et un texte fixe
   — F5 a livré un plan global puis des lots validés côté serveur, mais rien de
   cela n'est montré : l'utilisateur ne sait pas si 1 lot ou 5 ont été traités.

**Important**

4. **Aucune photographie nulle part.** `hero.png` n'est référencé par aucun
   composant : les 7 écrans sont 100 % texte/carte. Pour un produit qui se
   revendique « voyage / exploration », c'est le manque le plus visible.
5. **Les statuts de confiance sont sous-exploités visuellement.** `BadgeConfiance`
   existe mais n'apparaît qu'au niveau élément, en petit texte parmi d'autres
   badges (`Ancre`, `Accepté`, `Proposé`, `À remplacer`) sans hiérarchie entre eux
   — un lecteur pressé ne distingue pas un badge de confiance (fiabilité de la
   donnée) d'un badge de statut (décision de l'utilisateur).
6. **Densité inégale sur `ParcoursDetail`.** Chaque élément empile type, ancre,
   confiance, statut, nom, lieu, prix, lien, lien transport, justification, avis
   groupe, actions — jusqu'à 6-7 lignes d'information sans respiration ni
   priorité claire entre ce qui est décoratif et ce qui engage une décision.
7. **Pas de composant carte destination/moment illustré.** Toute la timeline est
   du texte dans des `<li className="carte">` — aucune structure ne réserve encore
   une zone image, donc l'intégration de photos (§8) demandera une vraie
   refonte de composant, pas un ajout.

**Cosmétique**

8. Répétition du bloc `champ` de saisie (classes Tailwind dupliquées dans
   `Envie.tsx`, `ParcoursDetail.tsx`, `PanneauPartage.tsx`) alors que la classe
   utilitaire `.champ` existe déjà dans `index.css` — juste pas utilisée partout.
9. Titre de page dupliqué entre `<h1>` et le `<title>` `Seo` sans jamais varier
   selon l'état (ex. « Parcours introuvable » ne change pas le `<title>`).
10. Le footer (`PageLayout`) est identique sur toutes les pages y compris le
    dialogue de création, où il ajoute une longueur de page inutile sur mobile.

### Grille des trois questions (écrans principaux)

| Écran | Compréhensible ? | Cohérent avec le backend ? | Assez qualitatif ? |
|---|---|---|---|
| Accueil / dialogue (`Envie`) | Oui, le fil de conversation est clair | Oui — reflète fidèlement les étapes 1→5 du doc 05 | Sobre mais sans identité visuelle forte, aucune image |
| Génération | Partiel — spinner/skeleton opaque | Non — ne montre pas la progression par lots que F5 a construite | Correct mais générique |
| Résultat parcours (`ParcoursDetail`) | Partiel — dense, hiérarchie faible entre confiance/statut | Oui pour verifie/estime/suggestion ; non pour refus/indisponible (absents) | Fonctionnel, manque de respiration et de photo |
| Modification | Oui — description + `elementsARegenerer` bien remontés | Oui | Correct |
| Partage (`PanneauPartage`) | Oui | Oui | Correct, dense sur mobile (formulaire + liste + fieldset) |

### 3. Une image existante à l'époque : `hero.png`

`client-react/public/assets/hero.png` est un triptyque (villa/piscine à Bali,
skyline nocturne façon Tokyo, Santorin au coucher de soleil) monté avec des
coutures verticales nettes, un étalonnage incohérent entre les trois panneaux
(jour/nuit/crépuscule) et une saturation uniforme qui écrase les trois lieux au
même traitement. C'est précisément l'esthétique « collage IA générique » que la
direction voulue veut éviter — ce n'est pas une question de qualité de rendu
mais de composition : trois clichés touristiques juxtaposés ne racontent pas
une histoire éditoriale, ils listent des destinations.

**Recommandation : ne pas l'utiliser comme hero.** Elle peut servir de repère
temporaire de proportions (ratio 1:1) pendant l'intégration technique, mais
sera remplacée par une vraie photographie personnelle en UI-C (§8). Ne pas la
modifier ni la garder comme référence de palette : ses couleurs (bleu nuit
néon, orange saturé artificiel) ne correspondent pas aux tokens `soleil`/`lagon`
déjà en place.

### 4. Première direction visuelle retenue

**Éditorial voyage, pas landing SaaS.** Grille asymétrique plutôt que colonnes de
cartes identiques, grande photographie plutôt que pictogrammes, typographie qui
porte la hiérarchie plutôt que des ombres et du glassmorphism. La palette
existante (`soleil` terracotta/orange, `lagon` teal, fond `sable` crème,
`encre` quasi-noir) est déjà alignée avec cette direction — on l'affine, on ne
la remplace pas.

Principes concrets :

- Un seul niveau de gris chaud pour tout le texte secondaire (`brume`), jamais
  de gris froid ajouté à côté.
- Ombres réservées aux éléments réellement flottants (barre de modification
  sticky, panneau de partage) — pas sur chaque carte.
- Un radius unique (`rounded-xl`, déjà le cas) — pas de mélange de rayons.
- Les animations restent fonctionnelles (apparition de message, chargement) et
  jamais décoratives ; toutes coupées par `prefers-reduced-motion` (déjà acquis).
- La photographie porte l'émotion voyage ; l'UI porte la clarté du produit. On
  ne mélange pas les deux registres sur un même élément (pas de texte sur image
  sans overlay contrôlé et testé en contraste).

### 5. Architecture alors visée pour les écrans

- **Accueil / dialogue** (`Envie`) — garder le dialogue conversationnel actuel
  comme mécanique ; ajouter une bande photographique en tête (pas plein écran :
  le formulaire doit rester visible sans scroll sur desktop) pour poser
  l'univers voyage/exploration avant le premier mot tapé.
- **Génération** — remplacer les trois lignes de skeleton fixes par un état qui
  reflète les lots réels de F5 (ex. « Transport et hébergement » → « Activités »
  → « Vérification ») sans jamais inventer un pourcentage que le serveur ne
  fournit pas.
- **Résultat parcours** — garder la timeline par moment ; resserrer la carte
  élément autour de deux niveaux de lecture : ligne principale (nom, statut de
  confiance, actions) et détail secondaire repliable (justification, avis
  groupe, liens) pour réduire la densité du point 6 de l'audit.
- **Modification** — inchangé dans son contrat, améliorer uniquement la
  visibilité de `elementsARegenerer` (actuellement un simple `toast.info` qui
  disparaît alors que les éléments concernés restent surlignés sur la page).
- **Partage** — inchangé fonctionnellement, resserrer le formulaire d'ajout de
  participant sur mobile (actuellement trois blocs `flex-wrap` qui se
  réorganisent de façon imprévisible sous 360px).

### 6. Design system minimal de la première phase

Pas de nouveaux tokens de couleur — la palette `soleil`/`lagon`/`sable`/`encre`/
`brume`/`sauge`/`corail` suffit et couvre déjà primaire, secondaire, surfaces,
texte, succès, danger. Ajouts strictement nécessaires :

- **Statuts métier absents** : deux couleurs sémantiques manquent pour
  « indisponible » (panne technique, 503) et « refus » (422) — voir §7, pas de
  nouveau token de couleur requis, réutilisation de `corail` (déjà le rouge
  sémantique) avec un traitement différent de la simple erreur de formulaire.
- **Typographie** : `Poppins` (titres) / `Open Sans` (texte) déjà en place et
  cohérents avec un rendu éditorial sobre — aucun changement.
- **Espacements** : garder l'échelle Tailwind par défaut, ne pas introduire une
  échelle custom pour un seul écran.
- **Ombres** : les deux `boxShadow` existants (`card`, `card-lg`) suffisent.

Rien à ajouter au-delà de ce que UI-B viendra réellement consommer — pas de
token créé par anticipation.

### 7. Stratégie des statuts métier

| Statut | Origine | Traitement visuel proposé |
|---|---|---|
| Vérifié | `element.confiance.niveau === 'verifie'` | Badge `lagon` (déjà en place) — teinte « confirmé », jamais utilisée ailleurs |
| Estimé | `'estime'` | Badge `soleil` (déjà en place) — même famille que la marque, lu comme « à nuancer » plutôt qu'alarmant |
| Suggestion | `'suggestion'` | Badge neutre `encre/5` (déjà en place) — délibérément discret pour ne jamais rivaliser visuellement avec `verifie` |
| Indisponible (503) | Panne technique d'un fournisseur/outil | Bandeau distinct du toast générique : ton neutre, action proposée (réessayer), jamais confondu avec un refus produit |
| Refus (422) | Résultat métier — donnée essentielle non établissable | Écran/bloc dédié dans le flux de dialogue, explique *pourquoi* en langage produit (pas le message technique brut), propose de reformuler |

Règle non négociable héritée d'ADR-0008 : aucune présentation ne doit rendre
`suggestion` visuellement plus proche de `verifie` qu'il ne l'est. Le badge
`suggestion` restera toujours le moins saillant des trois — c'est une contrainte
de contraste à vérifier explicitement en UI-D, pas seulement une intention.

### 8. Stratégie d'intégration envisagée pour les photos

Aucune image n'est ajoutée dans UI-A. Ce que UI-B doit préparer pour que UI-C
puisse simplement déposer des fichiers :

- Un composant `ImageContextuelle` unique (ratio contrôlé par prop —
  `hero` 21:9, `carte` 4:3, `vignette` 1:1) avec fallback : dégradé de surface
  `sable`/`soleil` très doux si aucune image n'est encore fournie pour ce
  contexte, jamais une image cassée ni un rectangle gris.
- Les images vivent dans `client-react/public/assets/` avec un nommage explicite
  par usage (`hero-accueil.jpg`, `moment-<type>.jpg`) plutôt que par lieu, pour
  rester réutilisables tant que les vraies photos de voyage n'existent pas
  toutes.
- `loading="lazy"` par défaut sauf pour l'image hero au-dessus de la ligne de
  flottaison ; toujours un `alt` descriptif non générique (jamais `alt="photo"`).
- Formats : accepter `.jpg`/`.png` fournis tels quels par l'utilisateur, pas de
  pipeline de conversion WebP dans cette phase — au-delà du périmètre produit
  actuel, à reconsidérer seulement si le poids des pages devient un problème
  mesuré.

### 9. Découpage historique des PR UI-B → UI-D

- **UI-B — fondations visuelles et composants.** `ImageContextuelle` (§8),
  refonte de la carte élément en deux niveaux de lecture (§5), bandeaux
  indisponible/refus (§7), nettoyage des classes dupliquées (audit point 8).
  Pas de nouvel écran.
- **UI-C — écrans principaux + photographies.** Intégration des vraies photos
  de l'utilisateur sur Accueil et timeline, état de génération par lots réel
  (§5), resserrement du formulaire de partage mobile.
- **UI-D — responsive, états, polish.** Vérification systématique mobile/
  tablette/desktop, contraste des badges de confiance (§7), focus clavier sur
  les nouveaux composants, suppression du footer sur l'écran de dialogue.

Ce découpage peut bouger si UI-B révèle qu'un composant doit être scindé — pas
de réécriture du plan sans raison observée pendant le build.

### 10. Hors périmètre de UI-A

Aucun contrat backend, aucune route API, aucun schéma Zod modifié. F9 reste
après cette phase UI (voir board dans [`SPRINTS.md`](SPRINTS.md)). Aucune image
générée, achetée ou téléchargée.
