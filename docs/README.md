# Documentation Produit — Experience AI

**La source de vérité du produit.** Le code est le premier projet ; cette connaissance est le second.

## Trois niveaux (à ne pas mélanger)
- **Founder Book** — vision, origine, intuition, *pourquoi*.
- **Documentation Produit** — *comment fonctionne le produit*. → **ce dossier**.
- **Documentation Technique** — *comment fonctionne le code*. → [`architecture/`](architecture/).

## Règles de gouvernance
- Chaque document a un **rôle unique**.
- Chaque décision structurante est un **ADR** dans [`decisions/`](decisions/).
- **Google Drive n'est plus une référence** : partage / présentation / note temporaire uniquement. Le dépôt Git fait foi ([ADR-0006](decisions/ADR-0006.md)).

## Sommaire
| # | Document | État |
|---|---|---|
| 00 | [introduction](00-introduction.md) | ✅ |
| 01 | [philosophie · vision · mission · Constitution](01-philosophie.md) | ✅ |
| 02 | [probleme](02-probleme.md) | ✅ |
| 03 | [definition-parcours](03-definition-parcours.md) | ✅ |
| 04 | [histoires-utilisateur](04-histoires-utilisateur.md) | ✅ |
| 05 | [product-journey](05-product-journey.md) | ✅ |
| 06 | [modele-conceptuel](06-modele-conceptuel.md) | ✅ |
| 07 | [capacites-produit](07-capacites-produit.md) | ✅ |
| 08 | [architecture-ia](08-architecture-ia.md) | 🟡 actuel + cible en évolution |
| 09 | [roadmap](09-roadmap.md) | 🟡 chantier fiabilité actif — F0→F3 terminés, F4 en cours |
| 10 | [business](10-business.md) | ✅ |
| 11 | [decisions (index ADR)](11-decisions.md) | ✅ |
| 12 | [glossaire](12-glossaire.md) | ✅ |
| 13 | [principes-evolution](13-principes-evolution.md) | ✅ |
| 14 | [fiabilite-parcours](14-fiabilite-parcours.md) | 🟡 chantier F4 en cours (C1/C2 internes, C3 à venir) |

**Suivi d'exécution :** [SPRINTS](SPRINTS.md) — historique R1 → R8 et suivi
des sprints de fiabilité F0 → F9.

**Docs vivants :** [questions-ouvertes](questions-ouvertes.md) ·
[audit F0 TripGenie → Experience AI](audits/tripgenie-vers-experience-ai.md) ·
[decisions/ (ADR-0001 → 0008)](decisions/)

## Rôle de chaque source (pour ne pas dupliquer)

| Source | Rôle | Ne pas y chercher |
|---|---|---|
| [ADR-0008](decisions/ADR-0008.md) | **Politique de confiance** — seule source des niveaux Vérifié / Estimé / Suggestion / Refus | Un état d'avancement |
| [SPRINTS.md](SPRINTS.md) | **Avancement réel** — board par sprint, revues reliées à leur PR | Une décision de fond ou une trajectoire produit |
| [09-roadmap.md](09-roadmap.md) | **Trajectoire** — vue haute des couches et des chantiers, sans détail d'implémentation | Le détail d'un sous-lot |
| [14-fiabilite-parcours.md](14-fiabilite-parcours.md) | **Plan détaillé de fiabilité** — critères de terminé, dépendances entre sprints F0 → F9 | Un compte de tests ou un détail de PR |
| [architecture/README.md](architecture/README.md) | **Architecture technique actuelle** — diagrammes de ce qui tourne réellement | Un historique de décision |

Pour l'état d'avancement courant, consulter [`docs/SPRINTS.md`](SPRINTS.md).
