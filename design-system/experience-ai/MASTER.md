# Design System — Experience AI

> **Source de vérité : le code.** Ce fichier documente le design **réellement
> implémenté** dans `client-react/tailwind.config.js` (couleurs, ombres, polices)
> et `client-react/src/index.css` (classes composant, animations). En cas de
> doute, le code fait foi — pas ce document. Il est réécrit quand le code change,
> jamais l'inverse.
>
> *Historique : une première version générée le 23/07 décrivait un thème « rose
> fashion + police Caveat » (mauvais cadrage « Road Trip Planner »), jamais
> implémenté. Le vrai front a été construit sur la palette « aventure » ci-dessous.
> Ce fichier a été remis en conformité le 25/07.*

**Projet :** Experience AI — moteur de parcours personnalisés (une envie + un contexte → un parcours de moments)
**Ton :** éditorial, chaleureux, sobre. Variance faible (3/10), mouvement discret (2/10).
**Stack :** React + Vite + Tailwind (pas de framer-motion ni GSAP — animations en CSS).

---

## Palette « aventure »

Définie dans `tailwind.config.js`. Orange coucher de soleil + teal de carte, sur crème, texte navy.

| Rôle | Classe Tailwind | Hex |
|------|-----------------|-----|
| Primaire (CTA, accent) | `soleil` | `#EA580C` |
| Primaire — clair | `soleil-light` | `#FED7AA` |
| Primaire — foncé (hover) | `soleil-dark` | `#C2410C` |
| Secondaire | `lagon` | `#0891B2` |
| Secondaire — clair | `lagon-light` | `#CFFAFE` |
| Secondaire — foncé | `lagon-dark` | `#0E7490` |
| Fond / surfaces claires | `sable` | `#FFF7ED` |
| Surface un ton plus bas | `sable-dark` | `#FDF0E3` |
| Texte principal | `encre` | `#0F172A` |
| Texte — atténué | `encre-light` | `#334155` |
| Texte secondaire | `brume` | `#64748B` |
| Sémantique — succès | `sauge` | `#16A34A` |
| Sémantique — danger | `corail` | `#DC2626` |

**Fond de l'app :** classe `.aurora` — `#FFF7ED` + deux nappes radiales très diluées (soleil 12 %, lagon 10 %), animées très lentement. Coupée si `prefers-reduced-motion`.

---

## Typographie

Importées dans `index.css` depuis Google Fonts.

- **Titres (`font-heading`) :** Poppins — 400 / 500 / 600 / 700
- **Corps (`font-sans`) :** Open Sans — 300 / 400 / 500 / 600 / 700
- Titres en `font-bold` ; l'accent d'un titre se met en `text-soleil` (ex. « Qu'as-tu envie de **vivre** ? »).

```css
@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&family=Poppins:wght@400;500;600;700&display=swap');
```

---

## Rayons & ombres

- **Rayon standard :** `rounded-xl` (0.75rem) pour cartes, champs, boutons. `rounded-full` pour chips et badges.
- **Ombres** (`tailwind.config.js`) :
  - `shadow-card` → `0 4px 24px rgba(15,23,42,0.06)` — cartes au repos
  - `shadow-card-lg` → `0 12px 48px rgba(15,23,42,0.12)` — carte de connexion, survol de liste

---

## Classes composant (dans `index.css`)

Toujours réutiliser ces classes plutôt que de recopier les utilitaires — c'est là que vivent la cohérence et l'accessibilité.

| Classe | Usage |
|--------|-------|
| `.carte` | surface blanche, bordure `encre/10`, `rounded-xl`, `shadow-card` |
| `.champ` | champ de saisie — bordure + **anneau de focus visible** (`focus:ring-2 focus:ring-soleil/25`) |
| `.btn-primaire` | CTA plein `soleil` ; enfoncement à l'appui (`active:scale`, coupé en reduced-motion) |
| `.btn-secondaire` | bouton bordé, hover `lagon` |
| `.chip` | choix rapide arrondi ; micro-élévation au survol, enfoncement à l'appui |
| `.bulle-produit` / `.bulle-utilisateur` | bulles du dialogue (produit à gauche, utilisateur à droite en `soleil`) |
| `.badge-accepte` / `.badge-propose` / `.badge-a-remplacer` | statut d'un élément (sauge / lagon / soleil) |
| `.skeleton` | bloc de chargement (shimmer, coupé en reduced-motion) |

**Champs :** un champ NE fait jamais `focus:outline-none` seul — l'anneau de focus (`.champ`, ou `focus:ring-2 focus:ring-soleil/25` en inline pour les champs `flex-1`) doit rester visible au clavier.

---

## Mouvement

Tout en **CSS**, aucune librairie d'animation. Durées 150–300 ms. Coupé sous `@media (prefers-reduced-motion: reduce)`.

- `.aurora` — nappe de fond lente (12 s)
- `.msg-enter` — apparition d'un message (fondu + 8px, 0.25 s)
- `.typing-dot` — points « en train d'écrire »
- `.skeleton` — shimmer de chargement
- `active:scale-[0.97]` (via `motion-safe:`) — retour d'appui des boutons/chips

---

## Icônes

**SVG inline uniquement** (tracé façon Lucide : `stroke="currentColor"`, `stroke-width` 2–2.5, `stroke-linecap="round"`), `aria-hidden="true"` quand décoratives. **Jamais d'emoji comme icône.**

---

## Anti-patterns (à ne pas faire)

- ❌ Emoji en guise d'icône (→ SVG)
- ❌ `focus:outline-none` sans anneau de focus visible (accessibilité clavier)
- ❌ Recopier les utilitaires d'un composant existant au lieu de sa classe `.carte` / `.champ` / `.btn-*`
- ❌ Couleurs en dur dans le JSX au lieu des tokens (`soleil`, `encre`, `brume`…)
- ❌ Changement d'état instantané sans transition (150–300 ms)
- ❌ Animation non coupée sous `prefers-reduced-motion`
- ❌ Réintroduire un autre thème (le « rose fashion » de la v0) — la palette est « aventure »

---

## Checklist avant livraison d'une UI

- [ ] Icônes en SVG, jamais d'emoji
- [ ] `cursor-pointer` sur tout élément cliquable
- [ ] Focus clavier visible (anneau) sur champs et boutons
- [ ] Contraste texte ≥ 4.5:1
- [ ] Transitions 150–300 ms sur les états
- [ ] `prefers-reduced-motion` respecté
- [ ] Responsive vérifié (375 / 768 / 1024 px), pas de scroll horizontal
- [ ] Cibles tactiles ≥ 44×44px
- [ ] Tokens de la palette utilisés (pas de hex en dur)
