# 09 — Roadmap

> Construire par couches et ne pas confondre **fonctionnel**, **fiable** et
> **validé par le marché**. Le détail exécutable vit dans
> [`SPRINTS.md`](SPRINTS.md), les limites techniques dans la
> [recette F9](16-recette-f9.md) et le backlog courant dans
> [`17-finitions-techniques.md`](17-finitions-techniques.md).

## État au 16 août 2026

### 1. Cadre produit — terminé

Vision, problème, définition du parcours, histoires utilisateur, modèle de
domaine, capacités, décisions et principes d'évolution sont documentés. Le
modèle reste générique : une envie et son contexte, jamais une destination ou
un format imposé.

### 2. Refonte Pack → Parcours — terminée (R1 → R8)

Le code porte un seul domaine `Parcours` : invariants, persistance, intake,
génération, préférences, modification ciblée et partage. `Pack`, les modes
figés et la régénération globale de TripGenie ont été supprimés.

### 3. Fiabilité des parcours — terminée pour F0 → F9

Le chantier a livré :

1. l'audit du portage TripGenie ;
2. les niveaux Vérifié / Estimé / Suggestion et les refus explicites ;
3. l'identité des lieux, événements et hébergements ;
4. la résolution sécurisée des liens ;
5. les contrats et liens de recherche transport ;
6. la génération progressive par lots ;
7. le benchmark et le choix du modèle ;
8. le dialogue déterministe ;
9. la régénération atomique des dépendants ;
10. la recette de sortie et sa matrice de capacités.

F9 confirme la règle « aucun faux parcours présenté comme réel ». Il ne
confirme pas une couverture universelle : vols, événements sportifs,
international et multi-ville long conservent les limites détaillées dans le
[doc 16](16-recette-f9.md).

### 4. Préparation de génération — socle livré, recettes live à poursuivre

Après F9, la génération a été précédée d'un cadrage planifiable :

- localisations utilisateur typées (ville, pays, zone ou inconnue) ;
- découverte générique de destinations à partir de preuves géographiques ;
- stratégie NBA event-first : les événements réels peuvent déterminer les
  villes sans réécrire le brief utilisateur ;
- clarification lorsqu'une période ou une localisation reste indispensable ;
- vérité temporelle, intake stabilisé et assemblage sans répétitions ;
- liens externes actionnables seulement lorsqu'ils restent compatibles avec
  le contrat de confiance.

Deux recettes live sont encore bloquées par la disponibilité des fournisseurs
(`DETTE-001`, `DETTE-002`). Elles doivent être rejouées sur le pipeline réel,
sans données synthétiques, avant d'affirmer que ces scénarios sont démontrés en
conditions fournisseur.

### 5. Interface — refonte « Papier & Lumière »

- UI-1 : fondations visuelles — terminé ;
- UI-2 : hero et header — terminé ;
- UI-3 : dialogue — terminé ;
- UI-4 : parcours généré et bibliothèque — terminé ;
- UI-5 : login, préférences, partage et écrans secondaires — PR #91 en revue.

Cette phase reste visuelle et front : elle ne change ni le domaine, ni les
contrats serveur, ni les règles de vérité.

## Maturité produit

- **A — Concrétisation** : transformer une envie déjà présente en parcours
  fiable. Le socle existe ; les recettes live restantes doivent encore être
  démontrées avant une promesse publique large.
- **B — Fréquence** : inspiration et découverte récurrente, seulement après
  preuve d'usage du niveau A.
- **C — Fidélisation** : mémoire contextuelle, recommandations proactives et
  accompagnement pendant/après.

Le prochain grand choix n'est pas une nouvelle fonctionnalité générale : c'est
le premier périmètre de validation et le modèle économique, encore ouverts
dans [`questions-ouvertes.md`](questions-ouvertes.md).
