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
- Quels services spécialisés justifieront réellement un **sous-agent LLM**,
  plutôt qu'une fonction déterministe pilotée par l'orchestrateur ?
- Quelles données sont **essentielles** selon le type de parcours et doivent
  provoquer un refus lorsqu'elles manquent ?
- Quel seuil et quelle méthode de rapprochement prouvent qu'un résultat désigne
  le bon établissement, notamment pour les homonymes et succursales ?
- Comment garder les **coûts IA / API soutenables** à l'échelle ?
- Jusqu'où pousser la **fraîcheur des données** (horaires, dispos, prix) ?

## Business (les questions qui décident de la survie)
- **Qui paie, et pour quoi ?** B2C · B2B · white-label ? (non tranché)
- **Premier périmètre de validation** : quel type de parcours, quelle ville ? (non tranché — l'EVG n'est qu'un candidat parmi d'autres)
- Comment un produit utilisé 1-2 fois/an devient-il **récurrent** ? (le levier inspiration reste à prouver)
- Quelles 2-3 villes exactes au lancement ?
