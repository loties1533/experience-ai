
// TRIPGENIE — ESLint (flat config, non-bloquant)
// Objectif : filet de sécurité léger (imports inutilisés, hooks React,
// anti-patterns) SANS casser le build. Tout est en "warn", jamais "error".
// Les console.* sont volontairement tolérés (logging assumé côté serveur).
// Lancer : npm run lint

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // Fichiers/dossiers ignorés
  {
    ignores: [
      'dist-server/**',
      'client-react/dist/**',
      'node_modules/**',
      'client-react/node_modules/**',
      'prisma/migrations/**',
      '**/*.js', // on ne lint que le TS/TSX (ce fichier de config inclus est ignoré)
    ],
  },

  // Base JS + TS recommandé (sans analyse de types  rapide, pas de tsconfig requis)
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Règles globales : on rétrograde tout en "warn" pour rester non-bloquant
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off', // logging assumé (dette consciente documentée)
      'no-empty': 'warn',
      'prefer-const': 'warn',
      // Rétrogradées en warn pour rester non-bloquant (choix démo/dossier)
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
    },
  },

  // Serveur (Node / Express, ESM) 
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Client (React + Vite, navigateur)
  {
    files: ['client-react/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Nouvelles règles react-hooks v7 warn, pas bloquant
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
);
