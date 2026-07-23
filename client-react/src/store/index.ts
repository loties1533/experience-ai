import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BriefPartiel } from '../lib/api'

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
  ajouterMessage: (de: MessageDialogue['de'], texte: string) => void
  mettreAJourBrief: (brief: BriefPartiel, estComplet: boolean) => void
  reinitialiser: () => void
}

export const useDialogueStore = create<DialogueState>()(
  persist(
    (set) => ({
      messages: [],
      brief: {},
      estComplet: false,
      ajouterMessage: (de, texte) =>
        set((s) => ({ messages: [...s.messages, { id: crypto.randomUUID(), de, texte }] })),
      mettreAJourBrief: (brief, estComplet) => set({ brief, estComplet }),
      reinitialiser: () => set({ messages: [], brief: {}, estComplet: false }),
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
