# 11 — Décisions (index des ADR)

Les décisions structurantes sont des **ADR** (Architecture Decision Records), une par fichier, dans [`decisions/`](decisions/).
Chaque ADR tient sur une page : **Contexte · Décision · Alternatives envisagées · Pourquoi · Conséquences.**

**À partir de l'ADR-0008, trois champs supplémentaires sont obligatoires :**
- **Hypothèse testée** — qu'est-ce que cette décision parie ?
- **Condition d'invalidation** — qu'est-ce qui prouverait qu'on a tort ?
- **Preuve de confirmation** — preuve *utilisateur* (interviews, tests, usage) ou preuve *technique* (le code révèle une impossibilité). Rien d'autre — une décision sans preuve possible n'est pas une décision, c'est une opinion.

> Une décision actée ne se rediscute pas ailleurs : on lit son ADR.

| ADR | Titre | Date | Statut |
|---|---|---|---|
| [0001](decisions/ADR-0001.md) | « Parcours » remplace « Voyage / Trip » | 2026-07-23 | Accepté |
| [0002](decisions/ADR-0002.md) | Conserver Express (pas de migration Next.js) | 2026-07-23 | Accepté |
| [0003](decisions/ADR-0003.md) | Les agents sont des modules, pas des microservices | 2026-07-23 | Accepté |
| [0004](decisions/ADR-0004.md) | Le parcours est modifiable élément par élément | 2026-07-23 | Accepté |
| [0005](decisions/ADR-0005.md) | Le contexte est un objet de premier niveau | 2026-07-23 | Accepté |
| [0006](decisions/ADR-0006.md) | Le repo est la source de vérité (docs as code) | 2026-07-23 | Accepté |
| [0007](decisions/ADR-0007.md) | Le parcours se persiste comme un agrégat (une table, contenu JSON validé) | 2026-07-23 | Accepté |
| [0008](decisions/ADR-0008.md) | Le partage se fait par un lien **par participant**, et les réactions vivent dans l'agrégat | 2026-07-24 | Accepté |
