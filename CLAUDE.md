# Experience AI — mémoire projet (CLAUDE.md)

> Règles stables de travail pour les agents qui interviennent dans ce dépôt.
> Ce fichier ne recopie pas la documentation produit ou d'avancement : il y renvoie.
> Règle d'or : **produit d'abord, technique ensuite.** Toute évolution du modèle passe d'abord par `docs/06-modele-conceptuel.md`.

## Le produit en une phrase
**Transformer une intention en parcours personnalisé.** Détail complet :
[`docs/01-philosophie.md`](docs/01-philosophie.md) (vision) et
[`docs/03-definition-parcours.md`](docs/03-definition-parcours.md) (définition verrouillée).

## Vocabulaire
**Parcours**, pas « voyage ». Le glossaire complet fait foi :
[`docs/12-glossaire.md`](docs/12-glossaire.md).

## Où sont les docs
- **Produit / fondations** → ce repo : `docs/00` → `docs/13` + `docs/decisions/` (le repo fait foi, ADR-0006 ; Drive = partage/présentation uniquement).
- **Avancement courant** → `docs/SPRINTS.md` (board + revues par PR) et `docs/09-roadmap.md` (trajectoire vue haute). Ne jamais dupliquer un statut de sprint dans ce fichier — toujours y renvoyer.
- **Architecture technique** → `docs/architecture/README.md`.
- **Politique de confiance des données** → [ADR-0008](docs/decisions/ADR-0008.md), seule source ; les autres documents y renvoient.
- **Décisions durables & état** → mémoire Claude (`~/.claude/.../memory/`).

## Conventions de code
- TypeScript strict. Fonctions **courtes, une responsabilité**, nommage FR explicite (comme l'existant : `validerParcours`, `rechercherLieuxAeriens`, `creerLienRechercheHebergement`).
- **Zod** à toutes les entrées. **Ne jamais faire confiance à la sortie du LLM** (valider / sanitizer).
- Composants front petits ; logique extraite des composants.
- Sécu : authz sur chaque route, Helmet, rate-limit (déjà en place).
- **Pas de code mort** : on supprime, on ne commente pas.
- Toute migration de modèle de domaine : **construire le nouveau → basculer → SUPPRIMER l'ancien.** Jamais deux modèles qui cohabitent.
- **Tests (Vitest)** pour toute logique nouvelle (le domaine et les agents = logique pure → très testables).

## Definition of Done (chaque sprint de build)
tests verts · typecheck OK · entrées validées · aucun code mort · petit diff relu · `docs/SPRINTS.md` à jour.

## Économie de tokens (règles de session)
- Tâches **ciblées** (une capacité / un fichier), jamais « refais tout ».
- **Nommer les fichiers** concernés ; lire le doc pertinent, pas tout le repo.
- Petits diffs. Mettre à jour mémoire + SPRINTS au fil de l'eau.
- Ce fichier reste **court** : il pointe vers les docs détaillés, il ne les recopie pas.

## Branches, PR et documentation (règles imposées)
- Chaque modification se fait sur une **branche dédiée**, jamais sur `main`.
- Elle s'explique dans une **PR détaillée** (le pourquoi, pas le quoi) + une revue dans `docs/SPRINTS.md`, **qui porte le lien de sa PR**.
- **Regrouper** : une PR porte un chantier cohérent. Pas de PR pour deux lignes.
- **Interdit de créer un nouveau document.** On s'appuie sur la doc existante ; le seul fichier qu'un sprint met à jour est `docs/SPRINTS.md`.
- La doc de `docs/` est la **ligne directrice** : elle ne bouge pas en effet de bord d'une implémentation. Elle n'évolue que par décision explicite d'Alexis, dans sa propre branche — et seulement si le code ou un utilisateur l'exige (règle d'évolution, doc 06).

## Commits (préférence utilisateur)
Messages naturels en français, signés au nom d'Alexis. **Aucune trace d'IA** (pas de `Co-Authored-By`, pas d'emoji IA).
