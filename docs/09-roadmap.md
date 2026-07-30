# 09 — Roadmap

> Construire par couches et ne pas confondre **fonctionnel** avec **fiable**.
> Le détail exécutable des sprints vit dans [`SPRINTS.md`](SPRINTS.md) ; le
> plan détaillé de fiabilité dans [`14-fiabilite-parcours.md`](14-fiabilite-parcours.md).

## État au 29 juillet 2026

### 1. Cadre produit — terminé

Vision, problème, parcours, histoires utilisateur, modèle conceptuel,
capacités, décisions et principes d'évolution sont documentés.

### 2. Refonte Pack → Parcours — terminée (R1 → R8)

Le code porte désormais le domaine `Parcours`, ses invariants, la persistance,
l'intake, la génération, les préférences, la modification ciblée et le partage
au groupe. Ce socle n'est pas remis en cause.

### 3. Fiabilité des parcours — chantier actif (F0 → F9)

Le plan de fiabilité avance sprint par sprint (détail dans
[`14-fiabilite-parcours.md`](14-fiabilite-parcours.md)) :

1. auditer le portage TripGenie — **terminé** (F0, couvre aussi le transport :
   pas de sprint F4-A séparé) ;
2. définir et appliquer **Vérifié / Estimé / Suggestion / Refus** — **terminé** (F1) ;
3. fiabiliser lieux, événements et liens — **terminé** (F2) ;
4. vérifier les hébergements — **terminé** (F3) ;
5. reconstruire les liens vols et transports — **en cours** (F4 : contrats,
   génération fail-closed et connecteur Amadeus livrés jusqu'à F4-C2, mais
   **internes** — non appelés par la génération active, les routes, l'OpenAPI,
   le front ou la persistance. Prochain sous-lot : **F4-C3**, trains et
   transports locaux structurés. Puis F4-D — liens de recherche transport et
   intégration dans la génération active — et F4-E — modifications, API et
   front) ;
6. générer progressivement les parcours longs — à faire (F5) ;
7. benchmarker les modèles — à faire (F6) ;
8. fiabiliser dialogue et modification — à faire (F7, F8) ;
9. passer les recettes NBA et EVG — à faire (F9).

**Règle de passage :** aucune présentation publique ou validation marché
sérieuse avant la recette F9.

## Maturité produit après fiabilisation

- **A — Concrétisation** : ouvrir lorsqu'une envie doit devenir un parcours
  fiable. C'est le MVP visé par F9.
- **B — Fréquence** : inspiration et découverte, seulement après preuve du A.
- **C — Fidélisation** : mémoire contextuelle, recommandations proactives et
  accompagnement.

Inspiration, nouvelles verticales et mémoire avancée restent volontairement
derrière le chantier fiabilité.
