# Experience AI — interface React

Interface de cadrage, de génération et de modification des parcours Experience
AI. Stack : **Vite + React 18 + TypeScript + Tailwind CSS + Zustand + React
Query**.

Le produit commence par une envie, jamais par une destination imposée. Le
client accompagne le dialogue jusqu'au brief confirmé, affiche le parcours
construit et permet ensuite de le modifier, de le retrouver et de le partager.

## Démarrage

Depuis la racine du dépôt :

```bash
npm install
npm run dev:all
```

Le client tourne sur **http://localhost:3001** et Vite proxifie `/api/*` vers
l'API Express sur **http://localhost:3000**.

Pour lancer uniquement le client :

```bash
cd client-react
npm install
npm run dev
```

## Écrans

| Route | Écran | Rôle |
|---|---|---|
| `/` | `Envie` | Exprimer une envie, dialoguer, confirmer le brief et lancer la génération |
| `/parcours` | `MesParcours` | Retrouver les parcours enregistrés |
| `/parcours/:id` | `ParcoursDetail` | Lire et modifier un parcours élément par élément |
| `/partage/:jeton` | `ParcoursPartage` | Consulter et commenter un parcours partagé, sans compte |
| `/preferences` | `Preferences` | Gérer la mémoire simple utilisée par les générations suivantes |
| `/login` | `Login` | Se connecter ou créer un compte |

## Structure

```text
src/
├── components/
│   ├── layout/                 # Header et structure de page
│   ├── ui/                     # Boutons, états, hero, statuts métier, logo
│   ├── AvisGroupe.tsx
│   ├── ConfianceElement.tsx    # Confiance et provenance d'un élément
│   ├── PanneauPartage.tsx
│   └── Seo.tsx
├── pages/
│   ├── Envie.tsx
│   ├── MesParcours.tsx
│   ├── ParcoursDetail.tsx
│   ├── ParcoursPartage.tsx
│   ├── Preferences.tsx
│   └── Login.tsx
├── lib/
│   ├── api.ts                  # Adaptateur HTTP et types partagés avec le serveur
│   └── erreurAffichage.ts      # Refus métier, panne et erreurs génériques
├── store/
│   └── index.ts                # Dialogue en cours et utilisateur connecté
├── App.tsx                     # Routes et fournisseurs React Query
├── main.tsx
└── index.css                   # Design « Papier & Lumière »
```

## État local

- `useDialogueStore` conserve le fil, le brief partiel et l'état transitoire de
  clarification. Une valeur candidate n'est jamais présentée comme acquise.
- `useAuthStore` conserve uniquement l'utilisateur affiché. Le jeton
  d'authentification reste dans un cookie `httpOnly`, inaccessible au code du
  navigateur.
- React Query porte les données serveur : parcours, partage et préférences.

## Contrats d'affichage

- `422` = refus métier : le produit ne peut pas construire honnêtement la
  demande avec les preuves disponibles.
- `503` = indisponibilité technique : une source ou la génération outillée ne
  répond pas.
- `verifie`, `estime` et `suggestion` restent visuellement distincts.
- Une panne de chargement ne devient jamais un état vide.
- Aucun message technique brut, jeton ou URL de provenance n'est exposé dans
  l'interface.

## Design

La direction actuelle est **« Papier & Lumière »** : fond ivoire, surfaces
crème, encre brune, terracotta pour l'action et laiton en détail. Le code de
référence vit dans `tailwind.config.js` et `src/index.css`; la documentation
associée est le
[design system « Papier & Lumière »](../design-system/experience-ai/MASTER.md).

## Build de production

```bash
npm run build
```

Les fichiers compilés sont écrits dans `dist/`.
