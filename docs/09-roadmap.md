# 09 — Roadmap

> Construire par couches et ne pas confondre **fonctionnel** avec **fiable**.
> Le détail exécutable des sprints vit dans [`SPRINTS.md`](SPRINTS.md).

## État au 28 juillet 2026

### 1. Cadre produit — terminé

Vision, problème, parcours, histoires utilisateur, modèle conceptuel,
capacités, décisions et principes d'évolution sont documentés.

### 2. Refonte Pack → Parcours — terminée (R1 → R8)

Le code porte désormais le domaine `Parcours`, ses invariants, la persistance,
l'intake, la génération, les préférences, la modification ciblée et le partage
au groupe. Ce socle n'est pas remis en cause.

### 3. Fiabilité des parcours — prochain chantier (F0 → F9)

Le produit peut encore générer après l'échec des outils et présenter des
éléments insuffisamment vérifiés. La priorité est donc le
[plan de fiabilité](14-fiabilite-parcours.md) :

1. auditer le portage TripGenie ;
2. définir et appliquer **Vérifié / Estimé / Suggestion / Refus** ;
3. fiabiliser lieux, événements et liens ;
4. vérifier les hébergements ;
5. reconstruire les liens vols et transports ;
6. générer progressivement les parcours longs ;
7. benchmarker les modèles ;
8. fiabiliser dialogue et modification ;
9. passer les recettes NBA et EVG.

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
