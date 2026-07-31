# Experience AI — mémoire projet (CLAUDE.md)

> Règles stables de travail pour les agents qui interviennent dans ce dépôt.
> Ce fichier ne recopie pas la documentation produit ou l’avancement : il y renvoie.
> Règle d’or : **produit d’abord, technique ensuite.**
> Toute évolution du modèle passe d’abord par `docs/06-modele-conceptuel.md`.

## Le produit en une phrase

**Transformer une intention en parcours personnalisé.**

Détail complet :

- [`docs/01-philosophie.md`](docs/01-philosophie.md) — vision ;
- [`docs/03-definition-parcours.md`](docs/03-definition-parcours.md) — définition verrouillée.

## Vocabulaire

**Parcours**, pas « voyage ».

Le glossaire complet fait foi :
[`docs/12-glossaire.md`](docs/12-glossaire.md).

## Sources de vérité

- **Produit et fondations** → `docs/00` à `docs/14` et `docs/decisions/`.
- **Modèle conceptuel** → `docs/06-modele-conceptuel.md`.
- **Avancement courant** → `docs/SPRINTS.md` pour le board et les revues de PR.
- **Trajectoire générale** → `docs/09-roadmap.md`.
- **Architecture technique** → `docs/architecture/README.md`.
- **Politique de confiance des données** → [`ADR-0008`](docs/decisions/ADR-0008.md), seule source de vérité sur les niveaux de confiance.
- **Décisions durables** → `docs/decisions/`.
- **Mémoire de session Claude** → `~/.claude/.../memory/`, uniquement pour le contexte de travail temporaire.

Le dépôt fait foi conformément à l’ADR-0006. Drive sert uniquement au partage et à la présentation.

Ne jamais recopier dans ce fichier un statut de sprint, une décision produit détaillée ou une règle déjà portée par une source de vérité.

## Lois produit

- **Aucun faux parcours présenté comme réel.**
- Une suggestion ne doit jamais ressembler à une observation fournisseur.
- Une donnée fournisseur ne devient pas automatiquement une confirmation produit.
- Une ville n’est ni un aéroport ni une gare.
- Un candidat, un résultat ou un lien de recherche n’est jamais une réservation.
- Ne jamais inventer un prix, une disponibilité, une adresse, un horaire, un identifiant, un opérateur ou une URL.
- Une ambiguïté ne doit jamais être résolue automatiquement en choisissant le premier résultat.
- Une panne technique ne doit jamais être transformée en résultat vide.
- Une donnée essentielle absente doit produire un refus explicite ou une absence prudente de résultat.
- Une donnée facultative absente peut produire une suggestion générique, jamais une donnée précise inventée.
- Respecter les statuts `verifie`, `estime` et `suggestion` définis par l’ADR-0008.
- Un résultat de recherche externe ne constitue ni une offre garantie, ni une disponibilité, ni un billet.

## Langue et nommage

- Répondre, expliquer, commenter et rédiger les rapports en français.
- Utiliser des noms français explicites pour les fonctions, variables, types, schémas et fichiers créés dans le projet.
- Respecter le vocabulaire et les conventions déjà présents dans le dépôt.
- Exemples conformes :
  - `validerParcours`
  - `rechercherLieuxAeriens`
  - `creerLienRechercheHebergement`
  - `DemandeLienRechercheVolSchema`
- Conserver en anglais uniquement ce qui est imposé par :
  - TypeScript ou JavaScript ;
  - une bibliothèque ;
  - une API externe ;
  - un protocole ;
  - un format fournisseur ;
  - un champ externe déjà défini.
- Ne pas traduire artificiellement les mots-clés du langage, les méthodes natives ou les propriétés d’API externes.

## Conventions de code

- TypeScript strict.
- Fonctions courtes avec une seule responsabilité.
- Nommage français explicite et cohérent avec l’existant.
- Zod à toutes les frontières d’entrée.
- Ne jamais faire confiance à une sortie du LLM : valider, nettoyer ou refuser.
- Composants front petits ; logique métier extraite des composants.
- Sécurité :
  - autorisation sur chaque route concernée ;
  - Helmet ;
  - rate-limit ;
  - aucun secret dans le code, les logs ou les tests ;
  - aucun domaine arbitraire injecté par l’utilisateur.
- Pas de code mort : supprimer au lieu de commenter.
- Pas d’export inutilisé.
- Pas de dépendance ajoutée sans nécessité démontrée.
- Toute migration du modèle de domaine suit :
  **construire le nouveau → basculer → supprimer l’ancien**.
- Ne jamais maintenir deux modèles concurrents sans décision explicite.
- Ajouter des tests Vitest pour toute logique nouvelle.
- Les tests du domaine et des agents doivent rester aussi purs et déterministes que possible.
- Aucun appel réseau réel dans les tests unitaires.

## Sobriété d’implémentation

- Implémenter uniquement la capacité demandée.
- Réutiliser les contrats, services, schémas et helpers existants avant d’en créer.
- Chercher d’abord si une abstraction équivalente existe déjà.
- Ne pas créer une nouvelle couche pour un seul appel ou un seul consommateur sans bénéfice réel.
- Ne pas anticiper un besoin futur absent du périmètre.
- Refuser les abstractions prématurées, les contrats trop génériques et les champs sans consommateur.
- Préférer la plus petite solution qui respecte toutes les garanties produit.
- Ne pas ajouter plusieurs fournisseurs sans bénéfice produit démontré.
- Ne pas créer de compatibilité temporaire inutile entre un ancien et un nouveau modèle.
- Ne pas multiplier les tests qui vérifient exactement le même mécanisme.
- Regrouper les cas analogues avec `it.each` lorsque cela améliore la lisibilité.
- Une grande quantité de code ou de tests n’est jamais une preuve de qualité.
- Avant le commit, rechercher ce qui peut être supprimé ou simplifié sans réduire les garanties.
- Ne pas réduire un diff uniquement pour réduire son nombre de lignes : la sécurité et les invariants utiles restent prioritaires.

## Méthode de travail

- Une conversation et une branche correspondent à un seul chantier cohérent.
- Commencer par vérifier l’état Git attendu.
- Ne jamais travailler directement sur `main`.
- Lire uniquement les fichiers nécessaires au chantier en cours.
- Lire le document directement lié au lot, pas toute la documentation.
- Ne pas relire un fichier ou un document déjà compris sans raison précise.
- Vérifier les contrats existants avant de coder.
- Identifier les impacts immédiats sur les lots suivants sans les implémenter prématurément.
- Rechercher les angles morts, les régressions et la dette créée par la solution.
- Ne pas transformer une auto-revue en nouveau chantier hors périmètre.
- Faire une seule auto-revue complète avant le commit.
- Corriger directement les défauts réels trouvés pendant cette auto-revue.
- Ne pas refaire plusieurs audits successifs du même diff sans nouveau signal.
- Ne pas commenter chaque commande ou chaque lecture de fichier.
- Expliquer uniquement les décisions, risques, blocages et résultats utiles.
- Les rapports finaux doivent être factuels, structurés et courts, environ 20 lignes sauf demande contraire.
- Ne pas produire de longs rapports intermédiaires lorsque le travail peut continuer directement.

## Definition of Done

Chaque sprint de build exige :

- tests ciblés verts ;
- suite complète verte ;
- typecheck réussi ;
- lint sans nouvelle erreur ;
- entrées validées ;
- aucun code mort ;
- aucun export inutilisé ;
- aucun secret exposé ;
- aucun réseau réel dans les tests unitaires ;
- aucun comportement hors périmètre ;
- petit diff relu ;
- auto-revue effectuée une seule fois ;
- `docs/SPRINTS.md` à jour ;
- CI verte avant fusion.

## Économie de contexte et de tokens

- Une tâche correspond à une capacité cohérente.
- Nommer les fichiers pertinents plutôt que parcourir tout le dépôt.
- Ne pas répéter dans les prompts les règles déjà présentes dans ce fichier.
- Ne pas recopier la documentation dans les rapports.
- Ne pas produire de résumé après chaque commande.
- Commencer par les tests ciblés.
- Ne lancer la suite complète qu’après stabilisation du lot.
- Ne pas relancer la suite complète après chaque petite modification.
- Ne pas effectuer de recherche Web lorsque le dépôt ou la documentation officielle déjà disponible suffit.
- Utiliser une recherche Web uniquement lorsqu’un comportement externe actuel doit réellement être vérifié.
- Ce fichier doit rester court et pointer vers les sources détaillées.

## Branches, PR et documentation

- Chaque modification se fait sur une branche dédiée, jamais directement sur `main`.
- Une PR porte un seul chantier cohérent.
- Regrouper les modifications qui appartiennent à la même capacité.
- Éviter une PR isolée pour une modification triviale.
- La PR explique surtout :
  - le pourquoi ;
  - les garanties ;
  - les limites ;
  - le hors périmètre ;
  - les vérifications réalisées.
- Chaque PR de build ajoute une revue concise dans `docs/SPRINTS.md`.
- La revue dans `docs/SPRINTS.md` porte le lien de la PR.
- Interdiction de créer un nouveau document pour un sprint.
- Le seul document normalement modifié par un sprint est `docs/SPRINTS.md`.
- La documentation directrice ne change pas comme effet de bord d’une implémentation.
- Elle n’évolue que sur décision explicite d’Alexis, dans une branche dédiée, lorsque le code ou un besoin utilisateur réel l’exige.
- Ne jamais fusionner une PR sans autorisation explicite.
- Ne jamais supprimer une branche locale ou distante sans demande explicite.
- Après fusion, conserver les branches sauf instruction contraire.

## Commits

- Messages naturels en français.
- Commits signés au nom d’Alexis.
- Ajouter uniquement les fichiers du chantier.
- Vérifier le diff intégral avant le commit.
- Aucune trace d’IA :
  - pas de `Co-Authored-By` ;
  - pas de mention de Claude, Codex ou ChatGPT ;
  - pas d’emoji lié à l’IA.