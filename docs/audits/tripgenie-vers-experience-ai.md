# Audit F0 — TripGenie-app vers Experience AI

**Date : 28 juillet 2026 · Statut : En revue**

## Périmètre

Comparaison en lecture seule de :

- `/Users/alexislaubert/tripgenie-app` — état courant et historique Git utile ;
- `/Users/alexislaubert/experience-ai-1` — état courant avant F1.

L'historique du même dépôt `tripgenie-app` a été consulté car les versions les
plus avancées des liens de réservation, de Booking et des vols apparaissent
notamment dans les commits `240ef86` et `d0ace62`, sans être toutes réunies
dans son snapshot courant.

## Conclusion

Le domaine `Parcours`, ses invariants, sa persistance et sa modification ciblée
sont des améliorations à conserver. Revenir au modèle `Trip` + `Pack` ferait
perdre ces garanties.

Le portage a en revanche affaibli plusieurs capacités indépendantes de `Pack` :

- recherche et liens de vols ;
- résolution IATA ;
- recherche préalable d'hébergements réels ;
- transmission du nombre de voyageurs à Booking ;
- traçabilité durable de la provenance ;
- distinction entre donnée réelle, estimation et suggestion.

## Matrice

| Capacité | État dans Experience AI | Décision |
|---|---|---|
| Domaine `Parcours` et invariants | Supérieur à `Pack` | Porté et amélioré |
| Auth, sécurité, cascade LLM | Adaptés au nouveau produit | Porté |
| Intake et préférences | Contrats plus stricts | Porté et amélioré |
| CRUD et persistance | Agrégat validé par Zod | Réécrit et amélioré |
| Partage et réactions | Jeton par participant, rôles métier | Réécrit et amélioré |
| Modification ciblée | Périmètre calculé, mais dépendants non régénérés | Porté partiellement |
| Foursquare | Recherche libre pilotée par l'intention | Porté et amélioré |
| PredictHQ, météo, photos | Connecteurs conservés | Porté |
| Tavily et résolveur de liens | Anti-hallucination présent | Porté, à renforcer |
| Booking | Constructeur présent, voyageurs non transmis | Porté partiellement |
| Recherche d'hôtels réels | Pas de service dédié avant sélection | À adapter |
| Recherche de vols | Absente | À réécrire |
| Kayak, Skyscanner et IATA | Absents | À adapter depuis TripGenie |
| Yelp en repli | Absent | À décider sur preuve fournisseur |
| Carte Leaflet | Retirée | Reportée en V2 |
| Score par mode | Retiré avec les modes figés | Abandonné volontairement |
| Top 3 de packs | Remplacé par un parcours modifiable | Abandonné volontairement |
| Mocks de packs | Remplacés par une indisponibilité explicite | Abandonné volontairement |

## Constats qui déclenchent F1

1. `Reservation` ne conserve que l'URL et un fournisseur facultatif.
2. La provenance connue par la boîte à outils disparaît après l'assemblage.
3. La boucle d'outils peut retomber sur une génération sans données réelles.
4. Un lien Booking peut être ajouté à un nom d'hôtel non vérifié.
5. La destination du résolveur est globale (`brief.lieux[0]`) et non celle de
   chaque moment.
6. Le brief ne porte pas toujours un nombre exact de voyageurs.
7. `elementsARegenerer` est calculé et affiché, mais pas régénéré.

## Classement final

### Porté

Auth, fournisseurs LLM, Foursquare, PredictHQ, météo, photos, préférences,
persistance et une première version du résolveur de liens.

### À adapter

Résolveur par ville, Booking, recherche d'hébergements, nombre de voyageurs,
types de liens et tests de validité sémantique.

### À réécrire

Vols, IATA, confiance des données, génération progressive et régénération
atomique des dépendants.

### Abandonné volontairement

`Pack`, modes figés, scoring par mode, sélection top 3, mocks de contenu et
ancienne collaboration.

## Décision proposée

Aucune restauration globale de TripGenie n'est justifiée. Après validation de
cette matrice, F1 peut commencer par le contrat de confiance, la traçabilité et
le remplacement du repli silencieux.
