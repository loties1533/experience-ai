# 07 — Capacités produit

> Les « l'utilisateur peut… ». Chaque capacité doit passer le filtre [`13-principes-evolution`](13-principes-evolution.md).

## MVP (un parcours éditable, seul ou à plusieurs)
- Décrire une envie en langage naturel (sans destination imposée).
- Dialoguer : le produit ne pose que les questions nécessaires.
- Voir reformulé ce qui est compris, avant génération.
- Recevoir un parcours complet et cohérent, avec **justification par élément** et budget ventilé.
- Explorer le parcours moment par moment.
- **Modifier un élément sans tout refaire** (le cœur) ; ajouter / supprimer un élément.
- Changer une contrainte globale (budget, durée) et voir le parcours se réadapter.
- Garder le dernier mot sur chaque proposition.
- Enregistrer, retrouver, reprendre un parcours.
- Renseigner ses préférences (**mémoire simple**).
- **Partager le parcours au groupe** par un lien, avec une **visibilité choisie** (privé / partagé / surprise : le héros ne voit rien).
- **Réagir à plusieurs** sur les éléments (l'avis du groupe éclaire la décision) — l'organisateur tranche (invariant 8).

### Condition de sortie du MVP

Ces capacités sont implémentées, mais leur présence ne suffit pas à déclarer le
MVP présentable. La sortie exige aussi la fiabilité décrite dans le
[doc 14](14-fiabilite-parcours.md) : provenance des données, niveaux de
confiance visibles, absence de faux lieux présentés comme réels, liens vérifiés
et refus explicite lorsqu'une donnée essentielle manque.

> **Pourquoi le partage est dans le MVP.** Ce n'est pas une fonctionnalité liée à l'EVG : c'est la conséquence directe du contexte « avec qui » (doc 03, propriété 2). Dès qu'un parcours se vit à plusieurs, il doit pouvoir se partager pour se modifier ensemble — sinon l'organisateur reste seul avec la charge, ce que le produit prétend justement supprimer (doc 02). Le domaine le porte déjà : `Participants`, `Rôles`, `Visibilité`, budget partagé. Le scénario de référence (doc 05) l'inclut explicitement.

## V2
- **Inspiration / découverte** (ouvrir sans besoin précis) → fréquence.
- Carte · export · dupliquer un parcours.
- Changer l'ambiance générale ; annuler une modification.
- Arbitrage collectif outillé (vote formel, compromis proposé par le produit).

## V3
- **Mémoire contextuelle** (apprend les goûts selon le contexte).
- Recommandations **proactives**.
- Accompagnement **pendant** le parcours · feedback **après**.

> Hors périmètre (au moins au début) : réservation automatique, paiement, couverture mondiale.

---

## Le thème — clarification du concept

Un besoin de vocabulaire est apparu à l'usage : on parle de « parcours EVG », « parcours surf », « parcours NBA ». Ce document fixe ce qu'est — et ce que n'est **pas** — un *thème*, avant toute décision d'implémentation.

**Ce qu'est un thème.** L'univers autour duquel un parcours prend sa cohérence : l'EVG, le basket, le surf, le festival techno, l'anniversaire de couple, le séminaire. C'est ce qui fait qu'un élément « a sa place » ou non — un club à 2h du matin sert un EVG, pas un week-end en famille. Le thème est ce qui manquait à TripGenie : générique, il produisait des assemblages sans âme ; Experience AI tient sa cohérence du thème.

**Ce qu'un thème n'est PAS.** Pas un « mode » à la TripGenie (`party`/`relax`/`student`), qui était une case figée pilotant un scoring pondéré. Un thème ne se choisit pas dans une liste fermée : il **émerge de l'intention** exprimée en langage naturel. « Vivre la NBA un mois » porte son thème sans qu'on le nomme.

**État actuel (implicite).** Aujourd'hui, le thème n'existe **nulle part dans le domaine** — ni champ `theme`, ni liste, ni règle. Le LLM le déduit seul de l'intention et l'exprime via l'ambiance générée. Constaté en recette : « EVG à Bordeaux » → fête + sport ; « anniversaire de couple à Lyon » → romantique et intimiste, sans thème codé. **Ça fonctionne comme effet de la génération, pas comme capacité conçue.**

**Question ouverte (à trancher sur preuve — règle doc 06).** Faut-il rendre le thème **explicite** ?
- *Pour* : des règles par thème (« festival → billetterie + horaires de line-up stricts », « surf → marée/météo décisives ») pourraient fiabiliser des cas que le langage seul rate.
- *Contre* : figer une notion de thème risque de rigidifier le modèle (retour du « mode » TripGenie) et de brider l'émergence par le langage, qui est justement la force actuelle.

**Décision provisoire : le thème reste implicite** (porté par l'intention), tant qu'un cas concret — un vrai parcours qui échoue faute de thème structuré — ne prouve pas le besoin. Le jour où ce cas apparaît, il fera l'objet d'un ADR et passera le crash-test du doc 06. Voir aussi [`questions-ouvertes.md`](questions-ouvertes.md).
