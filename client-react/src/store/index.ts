import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BriefPartiel, EtatDialogue } from '../lib/api'

// DIALOGUE STORE — le cadrage en cours (brief + fil de messages).
// Persisté : on peut fermer l'onglet et reprendre son envie où on l'a laissée.
export interface MessageDialogue {
  id: string
  de: 'produit' | 'utilisateur'
  texte: string
}

interface DialogueState {
  messages: MessageDialogue[]
  brief: BriefPartiel
  estComplet: boolean
  // Contexte transitoire de clarification (ex. une date en attente de "oui"/
  // "non") — jamais une information acquise : absent du brief, jamais envoyé
  // à la génération.
  etatDialogue: EtatDialogue | undefined
  ajouterMessage: (de: MessageDialogue['de'], texte: string) => void
  mettreAJourBrief: (brief: BriefPartiel, estComplet: boolean, etatDialogue: EtatDialogue | undefined) => void
  reinitialiser: () => void
}

export const useDialogueStore = create<DialogueState>()(
  persist(
    (set) => ({
      messages: [],
      brief: {},
      estComplet: false,
      etatDialogue: undefined,
      ajouterMessage: (de, texte) =>
        set((s) => ({ messages: [...s.messages, { id: crypto.randomUUID(), de, texte }] })),
      mettreAJourBrief: (brief, estComplet, etatDialogue) => set({ brief, estComplet, etatDialogue }),
      reinitialiser: () => set({ messages: [], brief: {}, estComplet: false, etatDialogue: undefined }),
    }),
    { name: 'xp_dialogue' }
  )
)

// AUTH STORE — utilisateur connecté (le jeton vit dans un cookie httpOnly)
interface Utilisateur {
  id: string
  email: string
  name?: string
}

interface AuthState {
  user: Utilisateur | null
  setAuth: (user: Utilisateur | null) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setAuth: (user) => set({ user }),
      clearAuth: () => set({ user: null }),
    }),
    { name: 'xp_auth', partialize: (s) => ({ user: s.user }) }
  )
)
