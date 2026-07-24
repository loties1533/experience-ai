# Experience AI — mémoire projet (CLAUDE.md)

> Copie repensée de TripGenie. Phase actuelle : **BUILD (étape 6)** — les étapes produit 1→5 sont verrouillées (docs 00→13 + ADR).
> Règle d'or : **produit d'abord, technique ensuite.** Toute évolution du modèle passe d'abord par `docs/06-modele-conceptuel.md`.

## Le produit en une phrase
**Transformer une intention en parcours personnalisé.**
Une intention (envie / passion / objectif) + un contexte → un **parcours** cohérent de moments.
Le voyage n'est qu'un *format* de parcours (soirée, EVG, festival, séjour NBA, journée gastro…).

## La vision en version finie (à connaître par cœur)

> **Experience AI est un moteur de conception de parcours personnalisés. Il comprend l'intention et le contexte d'une personne, les transforme en un parcours cohérent composé de moments et d'éléments adressables, puis permet de modifier ce parcours de manière chirurgicale sans repartir de zéro.**

Ce que ça implique, dans l'ordre où le produit le vit :

1. **On ne part jamais du lieu, on part du pourquoi.** TripGenie cherchait une destination ; Experience AI cherche une intention.
2. **Le langage devient du domaine.** « On est huit » → participants. « Max ne peut pas boire » → contrainte. « 250 € chacun » → budget partagé. Le texte disparaît, le modèle reste.
3. **Le parcours n'est pas un planning.** Chaque moment existe pour une raison et sert l'intention : montée, temps fort, respiration, second pic. C'est un récit, pas un agenda.
4. **Chaque moment contient des éléments adressables** (prix, horaire, alternatives, contraintes). C'est ce qui rend la suite possible.
5. **La modification est chirurgicale** — le cœur du produit. On remplace *un* élément, on recalcule *ses* dépendances, le reste ne bouge pas.
6. **Le groupe fait partie du domaine, pas d'une option** : qui décide, qui propose, qui ne voit rien.
7. **L'historique retient les décisions du parcours**, pas les goûts de la personne : une option écartée n'est jamais reproposée.
8. **Ce qui est sauvegardé, c'est le domaine** — intention, contexte, moments, éléments, décisions, alternatives. Pas la conversation, qui n'était qu'un moyen.
9. **On revient trois semaines plus tard et on ajuste** sans rien recommencer.
10. **Le vertical change, le moteur ne change pas.** Le domaine n'a jamais parlé d'EVG.

⚠️ **Hugo et son EVG ne sont qu'une tranche de MVP**, choisie pour aller chercher des retours réels — jamais la définition du produit. NBA, surf, festival, séminaire, anniversaire : même moteur. Ce qui fait la valeur, c'est que le parcours soit **cohérent avec un thème**, là où TripGenie était générique et désorganisé.

## Vocabulaire (à respecter partout)
- **Parcours** = ce que le produit *construit* (l'objet, la structure). Remplace « voyage ».
- **Expérience** = ce que l'utilisateur *vit* (le ressenti).
- **Parcours = Intention + Contexte + Moments + Items.**
- Le contexte (seul / couple / famille / amis…) est **co-égal à l'intention**.
- Jamais « l'IA / les agents » comme argument produit. Le produit = le parcours ; les agents ne sont qu'un moyen.

## Méthode de travail (ordre imposé — ne pas sauter d'étape)
1. Définir ce qu'est un parcours — ✅ (`docs/03`)
2. Personas par **intention + contexte** — ✅ (`docs/04`)
3. Parcours utilisateurs de bout en bout — ✅ (`docs/05`)
4. Modèle de données (déduit des parcours) — ✅ (`docs/06`)
5. Capacités du MVP + périmètre restreint — ✅ (`docs/07`)
6. Technique — ⬅️ **on est ici** : plan de refonte dans `docs/SPRINTS.md` (sprint R1 : domaine `server/domaine/parcours/`)

## Définition verrouillée
> Une expérience, c'est un **parcours personnalisé** : un ensemble **cohérent** de moments construit autour d'une **intention** et d'un **contexte**.

## Où sont les docs
- **Produit / fondations** → ce repo : `docs/00` → `docs/13` + `docs/decisions/` (le repo fait foi, ADR-0006 ; Drive = partage/présentation uniquement).
- **Ingénierie / plan** → ce repo : `docs/SPRINTS.md`, `docs/architecture/`.
- **Décisions durables & état** → mémoire Claude (`~/.claude/.../memory/`).

## Conventions de code (dormantes jusqu'à l'étape 6)
- TypeScript strict. Fonctions **courtes, une responsabilité**, nommage FR explicite (comme l'existant : `construirePromptPack`, `calculerNuits`).
- **Zod** à toutes les entrées. **Ne jamais faire confiance à la sortie du LLM** (valider / sanitizer).
- Composants front petits ; logique extraite des composants.
- Sécu : authz sur chaque route, Helmet, rate-limit (déjà en place).
- **Pas de code mort** : on supprime, on ne commente pas.
- Migration `Pack` → `Parcours` : **construire le nouveau → basculer → SUPPRIMER l'ancien.** Jamais deux modèles qui cohabitent.
- **Tests (Vitest)** pour toute logique nouvelle (le modèle et l'agent de modif = logique pure → très testables).

## Definition of Done (chaque sprint de build)
tests verts · typecheck OK · entrées validées · aucun code mort · petit diff relu · `docs/SPRINTS.md` à jour.

## Économie de tokens (règles de session)
- Tâches **ciblées** (une capacité / un fichier), jamais « refais tout ».
- **Nommer les fichiers** concernés ; lire le doc pertinent, pas tout le repo.
- Petits diffs. Mettre à jour mémoire + SPRINTS au fil de l'eau.
- Ce fichier reste **court** : il pointe vers les docs détaillés, il ne les recopie pas.

## Branches, PR et documentation (règles imposées)
- Chaque modification se fait sur une **branche dédiée**, jamais sur `main`.
- Elle s'explique dans une **PR détaillée** (le pourquoi, pas le quoi) + le sprint.
- **Regrouper** : une PR porte un chantier cohérent. Pas de PR pour deux lignes.
- **Interdit de créer un nouveau document.** On s'appuie sur la doc existante ; le seul fichier qu'un sprint met à jour est `docs/SPRINTS.md`.
- La doc de `docs/` est la **ligne directrice** : elle ne bouge pas en effet de bord d'une implémentation. Elle n'évolue que par décision explicite d'Alexis, dans sa propre branche — et seulement si le code ou un utilisateur l'exige (règle d'évolution, doc 06).

## Commits (préférence utilisateur)
Messages naturels en français, signés au nom d'Alexis. **Aucune trace d'IA** (pas de `Co-Authored-By`, pas d'emoji IA).
