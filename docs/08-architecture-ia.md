# 08 — Architecture IA

> **Différé.** Les agents sont une *conséquence* du produit, pas un point de départ (voir [ADR-0003](decisions/ADR-0003.md) : agents = modules, pas microservices).

Principe retenu : **peu d'agents, chacun justifié par une capacité.**
- **Agent Modification** — le premier vrai agent (modif chirurgicale d'un élément + ses dépendances).
- Les autres (recherche, mémoire, groupe…) seront ajoutés **au besoin**, jamais par anticipation.

Ce document sera détaillé à l'étape build, une fois le modèle ([`06`](06-modele-conceptuel.md)) et les capacités ([`07`](07-capacites-produit.md)) stabilisés.
