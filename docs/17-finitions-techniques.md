# Dettes et backlog

Ce document est le registre canonique des dettes et du backlog d’Experience AI.
Les ADR décrivent les décisions, `SPRINTS.md` conserve l’historique d’exécution et
les descriptions de PR restent des instantanés : aucun de ces documents ne remplace
le présent registre pour connaître l’état courant d’un sujet.

Dernière consolidation : 14 août 2026, sur `main` à
`50cc7d4d9daf87514567017f75b3a4625c905994` avant les corrections PR10.

## Registre

| ID | Catégorie | Priorité | État | Origine | Preuve actuelle | Impact | Action suivante | Dépendance |
|---|---|---:|---|---|---|---|---|---|
| DETTE-001 | dette_validation | P1 | bloquee | Recette PR8 | La recette live France multi-lots n’a pas été rejouée complètement après PR8/PR9, le fournisseur IA étant indisponible lors de la validation. | La cohérence réelle multi-lots reste non démontrée en environnement fournisseur. | Rejouer le vrai pipeline et archiver les observations, sans résultat synthétique. | Fournisseur IA disponible et crédité. |
| DETTE-002 | dette_validation | P1 | bloquee | Recette PR8 | La recette live Paris explicite n’a pas été rejouée complètement après PR8/PR9 pour la même indisponibilité. | Le parcours réel ville explicite reste à revalider avec les liens PR9. | Rejouer le vrai pipeline et archiver les observations, sans résultat synthétique. | Fournisseur IA disponible et crédité. |
| DETTE-003 | dette_technique | P2 | resolue | Audit PR70 | `predictHQEventsSearch` n’avait aucun import, appel, test dédié ni besoin de compatibilité ; les primitives PredictHQ actives sont distinctes. | Export public mort et ancien contrat maintenus inutilement. | Export et import de type supprimés par PR10. | Aucune. |
| DETTE-004 | dette_correction | P1 | resolue | Audit PR7 / PR10 | Les preuves lexicales ignoraient femme, mari, épouse, époux, enfant(s), fils et fille. | Une relation explicitement déclarée pouvait être perdue au cadrage. | Preuves bornées couple/famille ; copain/copine et leurs pluriels restent fail-closed même si le LLM propose couple ou amis. | Aucune. |
| DETTE-005 | dette_technique | P2 | resolue | Lint PR7–PR9 | `Envie.tsx` restaurait une saisie par `setState` dans un effet (`react-hooks/set-state-in-effect`). | Avertissement récurrent et rendu supplémentaire au retour de connexion. | Initialisation paresseuse testée, sans envoi automatique. | Aucune. |
| DETTE-006 | dette_technique | P3 | resolue | Lint PR7–PR9 | L’augmentation Express utilisait un namespace global (`@typescript-eslint/no-namespace`). | Avertissement récurrent sans impact produit. | Augmentation directe du module Express par PR10. | Aucune. |
| DETTE-007 | dette_technique | P3 | resolue | Lint PR7–PR9 | La validation des paramètres utilisait un cast `any` (`@typescript-eslint/no-explicit-any`). | Perte locale de précision de type. | Cast remplacé par le type des paramètres Express. | Aucune. |
| DETTE-008 | dette_technique | P3 | ouverte | Audit résolution | La résolution distingue explicitement Foursquare et PredictHQ, dont les contrats et capacités diffèrent. | Aucun coût concret aujourd’hui ; une abstraction générique serait spéculative avec deux fournisseurs. | Réévaluer seulement si un troisième fournisseur crée une duplication réelle. | Nouveau cas fournisseur concret. |
| DETTE-009 | dette_infrastructure | P1 | ouverte | Audit Docker PR10 | `docker-compose.yml` attend PostgreSQL puis lance `node dist-server/index.js` ; aucun `prisma migrate deploy` n’est exécuté. Render l’exécute séparément. | Un environnement Docker neuf peut démarrer sur un schéma non migré. | Concevoir puis tester une migration de démarrage idempotente dans une PR infrastructure dédiée. | Validation sur volume Docker neuf, sans toucher à Render/Neon. |
| DETTE-010 | backlog_produit | P2 | ouverte | Après PR5 | Le contrat sait qu’une zone n’est pas une ville, mais ne prouve pas encore l’appartenance ville→zone. | Une demande « Alpes » peut honnêtement clarifier ou refuser au lieu de proposer des villes. | Étudier une preuve géographique fournisseur, sans table régionale codée en dur. | Source géographique fiable. |
| DETTE-011 | backlog_produit | P2 | ouverte | Après PR5 | Les facettes prouvables ne couvrent pas encore précisément spa, bien-être et détente. | Ces envies peuvent être clarifiées ou refusées honnêtement. | Définir preuves et fournisseur avant d’étendre les facettes. | Contrat de preuve produit validé. |
| DETTE-012 | backlog_produit | P3 | ouverte | Roadmap fournisseurs | Aucun nouveau fournisseur n’est requis par un défaut de vérité actuel. | Couverture réelle limitée aux capacités déjà intégrées. | Ajouter un fournisseur uniquement pour un besoin produit priorisé et mesurable. | Besoin produit et contrat de vérité. |
| DETTE-013 | dette_technique | P2 | resolue | Compatibilité F2-B | Aucun consommateur produit, package, route ou réexport contractuel ; l’ancien adaptateur `resoudreLiensReels` a été supprimé en PR11. | Surface publique legacy et mocks supprimés. | Aucune. | Aucune. |
| DETTE-014 | dette_technique | P2 | resolue | Compatibilité Foursquare historique | Aucun consommateur produit, package, route ou réexport contractuel ; l’ancien adaptateur `foursquareRechercheLieux` et son type exclusif `LieuReel` ont été supprimés en PR11. | Ancien adaptateur parallèle supprimé ; chemin typé intact. | Aucune. | Aucune. |
| DETTE-015 | dette_technique | P3 | ouverte | Audit architecture | `server/routes/auth.ts` accède directement à Prisma ; aucun dépôt utilisateur ni second consommateur ne justifie encore une abstraction. | Écart local à la convention des dépôts, sans duplication actuelle. | Créer un dépôt seulement si un second consommateur utilisateur apparaît. | Second consommateur ou besoin de test concret. |
| DETTE-016 | resolu | P2 | resolue | Audit historique | `generation.ts`, autrefois signalé à 1 419 lignes, a été découpé et mesure environ 602 lignes sur le socle PR10. | L’ancienne proposition de découpage n’est plus une dette actuelle. | Aucune. | Aucune. |
| DETTE-017 | resolu | P1 | resolue | PR5-C | `compatibilite_sans_localisation` est absent des contrats et du code actif ; ses occurrences restantes sont des tests de rejet. | Aucun parcours planifiable sans ville ne subsiste. | Conserver les tests de non-régression. | Aucune. |

## Lecture rapide

- Ouvertes ou à vérifier : 8 sujets, dont 2 validations live bloquées.
- Résolues par PR10 : 5 sujets (`DETTE-003` à `DETTE-007`).
- Résolues par PR11 : 2 sujets (`DETTE-013`, `DETTE-014`).
- Historiquement déjà résolues : 2 sujets (`DETTE-016`, `DETTE-017`).
- Aucune entrée `P0` : aucun risque de faux résultat ou de corruption encore
  démontré par cet audit.

Toute nouvelle entrée reçoit un ID stable. Une résolution met à jour l’entrée
existante ; elle n’en crée pas une seconde et ne supprime pas l’historique utile.
