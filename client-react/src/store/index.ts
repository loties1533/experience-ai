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

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

/**
 * Une ancienne chaîne ne porte aucune sémantique fiable. La reprise locale la
 * transforme donc en localisation inconnue et exige une nouvelle confirmation.
 */
export function migrerEtatDialoguePersiste(etat: unknown): unknown {
  if (!estObjet(etat) || !estObjet(etat.brief)) return etat
  const lieux = Array.isArray(etat.brief.lieux) ? etat.brief.lieux : undefined
  if (!lieux) return etat

  let reconfirmationNecessaire = false
  const lieuxMigres = lieux.map((lieu) => {
    if (typeof lieu === 'string') {
      reconfirmationNecessaire = true
      return { nom: lieu, type: 'inconnue' as const }
    }
    if (estObjet(lieu) && lieu.type === 'inconnue') {
      reconfirmationNecessaire = true
    }
    return lieu
  })
  return {
    ...etat,
    brief: { ...etat.brief, lieux: lieuxMigres },
    ...(reconfirmationNecessaire ? { estComplet: false } : {}),
  }
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
    {
      name: 'xp_dialogue',
      version: 1,
      migrate: (etatPersiste) => migrerEtatDialoguePersiste(etatPersiste) as DialogueState,
    }
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
