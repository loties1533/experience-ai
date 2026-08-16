# Design System — Experience AI

> **Source de vérité : le code.** Les couleurs, polices et ombres vivent dans
> `client-react/tailwind.config.js`; les classes et animations dans
> `client-react/src/index.css`. Ce document décrit ce qui est réellement
> implémenté après UI-1 → UI-5. En cas d'écart, le code fait foi et le document
> doit être remis à jour.

**Direction :** « Papier & Lumière »

**Ton :** éditorial, chaleureux, personnel et sobre

**Stack :** React, Vite et Tailwind ; animations CSS uniquement

La photographie porte l'émotion. L'interface porte la compréhension et la
confiance. L'ensemble doit évoquer un carnet contemporain, jamais une landing
SaaS générique ni un assemblage de cartes touristiques.

## Palette

| Rôle | Token Tailwind | Valeur |
|---|---|---|
| Fond principal | `ivoire` | `#FAF6EF` |
| Surface secondaire / bulle produit | `creme` | `#F3EBDD` |
| Filets et bordures | `sable` | `#E7DAC5` |
| Filets soutenus | `sable-dark` | `#DBCBB0` |
| Texte principal | `encre` | `#2E241B` |
| Texte principal atténué | `encre-light` | `#4A3D30` |
| Texte secondaire | `brume` | `#6F6152` |
| Action principale | `terracotta` | `#BE5A38` |
| Action claire | `terracotta-light` | `#EBC9B8` |
| Action foncée | `terracotta-dark` | `#9A4526` |
| Détail éditorial | `laiton` | `#B98A3E` |
| Détail clair | `laiton-light` | `#E7CE9B` |
| Détail foncé | `laiton-dark` | `#8A6520` |
| Succès / vérifié | `sauge` | `#4F7A5B` |
| Succès foncé | `sauge-dark` | `#3C5E46` |
| Danger / refus | `corail` | `#B4462F` |

Le laiton reste un détail : labels, filets et états. Il ne devient jamais un
grand aplat dominant. La terracotta porte les actions, pas la décoration.

## Typographie

- **Titres (`font-heading`) :** Fraunces, serif.
- **Interface et texte (`font-sans`) :** Inter, sans-serif.
- Les titres sont éditoriaux sans devenir décoratifs ; le corps reste compact
  et très lisible.
- Les labels de champ utilisent une petite capitale espacée en `laiton-dark`.

**Écart résiduel connu :** `App.tsx` fixe encore `Open Sans` en style inline
sur les notifications Sonner. Cette police n'est plus chargée et retombe sur
`sans-serif`. Le corriger relève du code UI ; ce document ne transforme pas ce
résidu en convention.

## Surfaces, rayons et ombres

- Rayon standard : `rounded-xl` pour champs, boutons et anciennes surfaces
  encore justifiées ; `rounded-2xl` pour les bulles.
- `shadow-card` : `0 4px 24px rgba(46,36,27,0.07)`.
- `shadow-card-lg` : `0 14px 44px rgba(46,36,27,0.12)`.
- Les ombres sont réservées aux éléments réellement flottants. Les pages de
  contenu utilisent d'abord des filets, des surfaces chaudes et de l'espace.
- Le fond `.aurora` est désormais statique : nappes très diluées sur ivoire.

## Classes partagées

| Classe | Usage |
|---|---|
| `.carte` | Surface blanche bordée ; à utiliser seulement lorsqu'une vraie carte est nécessaire |
| `.champ` | Champ avec focus laiton visible |
| `.btn-primaire` | CTA terracotta foncé, texte blanc |
| `.btn-secondaire` | Action secondaire bordée |
| `.chip` | Suggestion ou choix rapide, survol laiton discret |
| `.bulle-produit` | Bulle crème à gauche |
| `.bulle-utilisateur` | Bulle terracotta très claire à droite |
| `.badge-accepte` | Statut accepté en sauge |
| `.badge-propose` | Statut proposé en laiton |
| `.badge-a-remplacer` | Statut à revoir en terracotta |
| `.skeleton` | Chargement sur surface sable |
| `.conteneur` | Largeur générale et gouttières partagées |
| `.conteneur-etroit` | Colonne de dialogue et formulaires |
| `.titre-page` / `.titre-section` | Hiérarchie éditoriale commune |
| `.texte-secondaire` / `.micro-copie` | Information secondaire et aide |
| `.label-champ` | Label court en capitales espacées |

## Hero et photographie

- Le hero associe sept familles d'envies : sport, amis, concert, romantisme,
  aventure, culture et évasion.
- Il illustre une émotion ou une situation, jamais une disponibilité, une
  réservation ou une preuve métier.
- La conversation prend ensuite la main : le hero devient compact dès le
  premier échange.
- `.hero-img` respecte un point focal distinct sur mobile et desktop.
- `.hero-zoom` applique un agrandissement très léger, désactivé lorsque
  `prefers-reduced-motion` est actif.
- La provenance et les limites de droits sont consignées dans
  `client-react/public/assets/hero/PROVENANCE.md`.

## Statuts et vérité des données

- **Vérifié** : sauge, provenance lisible dans le détail.
- **Estimé** : nuance prudente ; un prix estimé reste distinct de la confiance
  globale de l'élément.
- **Suggestion** : traitement neutre et volontairement moins saillant.
- **Refus 422** : bloc métier explicatif, jamais un toast technique brut.
- **Indisponibilité 503** : état temporaire avec action de réessai.

Une URL de provenance technique n'apparaît ni dans le texte, ni dans un
`title`, ni dans un `aria-label`. Un état vide ne masque jamais une panne.

## Mouvement et accessibilité

- Animations CSS de 150 à 300 ms pour les interactions ; zoom du hero sur un
  temps plus long et presque imperceptible.
- `prefers-reduced-motion` coupe `typing-dot`, `msg-enter`, `skeleton` et
  `hero-zoom`.
- Focus global visible en terracotta foncé.
- Cibles tactiles d'au moins 44 × 44 px.
- Contraste minimum AA pour le texte et les badges.
- Ordre de lecture logique et aucun débordement horizontal à 320/375 px.
- Icônes SVG, jamais d'emoji utilisé comme pictogramme.

## Anti-patterns

- Réintroduire l'ancienne palette orange/teal « aventure ».
- Utiliser Poppins/Open Sans comme système typographique de référence.
- Revenir au collage de destinations ou à une esthétique « voyage générique ».
- Empiler des cartes blanches quand un filet et une section suffisent.
- Présenter une suggestion comme une donnée vérifiée.
- Copier les utilitaires d'un composant partagé au lieu de réutiliser sa
  classe ou son composant.
- Ajouter une couleur en dur lorsqu'un token existe.
- Masquer l'outline sans focus de remplacement.
- Ajouter une animation décorative non désactivable.

## Vérification avant livraison

- [ ] L'intention reste plus visible que la destination.
- [ ] Les niveaux de confiance et les états d'erreur restent honnêtes.
- [ ] Les données absentes ne sont pas inventées pour remplir l'écran.
- [ ] Focus clavier, contraste et aides techniques vérifiés.
- [ ] Responsive vérifié à 320, 375, 768, 1024 et 1440 px.
- [ ] Aucun débordement horizontal ni contenu masqué par un élément sticky.
- [ ] `prefers-reduced-motion` respecté.
- [ ] Tokens « Papier & Lumière » utilisés.
