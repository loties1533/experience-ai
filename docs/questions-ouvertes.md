# Questions ouvertes

> Doc **vivant**. Les décisions qu'on ne tranche PAS aujourd'hui. On les stocke ; on distingue ce qui est **décidé** (les ADR) de ce qui est **à explorer** (ici). On retire une ligne quand elle est tranchée (→ elle devient un ADR).

## Produit / conception
- Comment « mesurer » une passion, ou son intensité ?
- Comment détecter une envie **passagère** vs **durable** ?
- Comment éviter que **deux parcours se ressemblent** (diversité) ?
- Faut-il un **score de cohérence** du parcours ? *(écho au scoring déterministe de TripGenie)*
- Un parcours a-t-il un **arc** explicite (montée, temps forts, respiration) ?
- Une **décision utilisateur** (arbitrage) est-elle un objet métier ou un simple événement de l'Historique ? *(Tranché provisoirement : événement. À rouvrir si plusieurs journeys réclament plus.)*
- Comment représenter les **temps libres** sans que ça ressemble à un trou ?

## IA / technique
- Quand faut-il **plusieurs agents** plutôt qu'un seul appel ?
- Comment garder les **coûts IA / API soutenables** à l'échelle ?
- Jusqu'où pousser la **fraîcheur des données** (horaires, dispos, prix) ?

## Business (les questions qui décident de la survie)
- ~~Qui paie ?~~ → tranché pour le MVP : [ADR-0008](decisions/ADR-0008.md) (B2C one-shot → B2B agences). À revalider au premier contact marché.
- ~~Premier périmètre ?~~ → tranché pour le MVP : [ADR-0007](decisions/ADR-0007.md) (EVG/EVJF, France, 2-3 villes).
- Comment un produit utilisé 1-2 fois/an devient-il **récurrent** ? (le levier inspiration reste à prouver)
- Quelles 2-3 villes exactes au lancement ?
