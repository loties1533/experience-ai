# TripGenie — Frontend React

Interface React pour TripGenie. Stack : **Vite + React 18 + TypeScript + Tailwind CSS + Zustand + React Query**.

## Installation

```bash
# 1. Depuis la racine du projet TripGenie
cd client-react

# 2. Installer les dépendances
npm install

# 3. Lancer en développement (proxifie automatiquement vers localhost:3000)
npm run dev
```

Le frontend tourne sur **http://localhost:3001** et proxifie `/api/*` vers le backend Express sur le port 3000.

## Structure

```
src/
├── components/
│   ├── chat/
│   │   ├── ChatWidget.tsx      ← Chat IA onboarding (Zustand)
│   │   └── ModifyChat.tsx      ← Chat de modification post-génération (agentique)
│   ├── results/
│   │   ├── PackResults.tsx     ← Affichage complet du pack voyage
│   │   ├── PackSkeleton.tsx    ← Skeleton loader pendant la génération
│   │   ├── TripMap.tsx         ← Carte Leaflet (activités + hôtels géolocalisés)
│   │   └── VoteButtons.tsx     ← Boutons vote collectif (mode groupe)
│   ├── layout/
│   │   └── index.tsx           ← Header + PageLayout
│   └── ui/
│       ├── index.tsx           ← Atomes réutilisables (Badge, Stars, Skeleton…)
│       ├── GenerationLoader.tsx ← Loader animé pendant la génération IA
│       └── Logo.tsx            ← Logo TripGenie
├── pages/
│   ├── Home.tsx               ← Hero + Chat onboarding + Résultats
│   ├── Trips.tsx              ← Liste des voyages sauvegardés
│   ├── TripDetail.tsx         ← Voyage partagé (lien public /share/:id)
│   ├── Login.tsx              ← Connexion / Inscription
│   └── Preferences.tsx        ← Préférences utilisateur (mode, ville, devise)
├── store/
│   └── index.ts               ← Zustand stores : useSearchStore · useChatStore · useAuthStore · useThemeStore
├── lib/
│   └── api.ts                 ← Toutes les requêtes vers l'API Express
├── App.tsx                    ← Router + Providers
├── main.tsx                   ← Point d'entrée React
└── index.css                  ← Tailwind + design tokens + composants CSS
```

## Stores Zustand

| Store | Rôle |
|-------|------|
| `useSearchStore` | État du formulaire de recherche + pack généré (persist destination) |
| `useChatStore` | État du chatbot onboarding — messages, données extraites, quiz mode |
| `useAuthStore` | Utilisateur connecté (persist, cookie httpOnly côté serveur) |
| `useThemeStore` | Thème dark/light (persist) |

## Build production

```bash
npm run build
# Les fichiers sont dans dist/
# À servir statiquement ou via nginx
```

## Ajouter une origine au CORS backend

Dans `server/index.ts`, ajouter l'origine de production :
```ts
origin: [
  process.env.CLIENT_URL || 'http://localhost:3001',
  'https://ton-domaine.com'
]
```
