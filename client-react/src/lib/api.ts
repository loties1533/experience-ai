// =============================================
// EXPERIENCE AI — src/lib/api.ts
// Toutes les requêtes HTTP vers l'API Express.
// Les types du domaine viennent du serveur (import type : effacé au build).
// =============================================

import type {
  Parcours,
  Element,
  DemandeSurElement,
  Participant,
  Role,
  Visibilite,
  Avis,
} from '../../../server/domaine/parcours/index'
import type { Brief, BriefPartiel } from '../../../server/agents/brief'
import type { EtapeDialogue } from '../../../server/agents/intake'
import type { ResumeParcours } from '../../../server/depots/depotParcours'
import type { PreferencesParcours } from '../../../server/domaine/preferences'

export type {
  Parcours, Element, DemandeSurElement, Participant, Role, Visibilite, Avis,
  Brief, BriefPartiel, EtapeDialogue, ResumeParcours, PreferencesParcours,
}

// En développement : Vite proxifie /api → localhost:3000
// En production : VITE_API_URL pointe vers l'API distante
const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api'

async function request<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // cookie httpOnly envoyé automatiquement
    ...opts,
  })

  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('Session expirée, veuillez vous reconnecter.')
  }
  if (res.status === 204) return undefined as T

  const data = (await res.json()) as T
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`)
  return data
}

// ---- Auth ----
export interface Utilisateur {
  id: string
  email: string
  name?: string
}
export const logout = () => request<{ message: string }>('/auth/logout', { method: 'POST' })
export const login = (email: string, password: string) =>
  request<{ user: Utilisateur }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
export const signup = (email: string, password: string, name: string) =>
  request<{ user: Utilisateur }>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) })

// ---- Dialogue de cadrage (doc 05, étapes 1→4) ----
export const avancerDialogue = (brief: BriefPartiel, message: string) =>
  request<EtapeDialogue>('/parcours/dialogue', { method: 'POST', body: JSON.stringify({ brief, message }) })

// ---- Parcours ----
export const genererParcours = (brief: Brief) =>
  request<{ parcours: Parcours }>('/parcours', { method: 'POST', body: JSON.stringify({ brief }) })

export const listerParcours = () => request<{ parcours: ResumeParcours[] }>('/parcours')

export const chargerParcours = (id: string) => request<{ parcours: Parcours }>(`/parcours/${id}`)

export const supprimerParcours = (id: string) =>
  request<void>(`/parcours/${id}`, { method: 'DELETE' })

export interface ReponseModification {
  parcours: Parcours
  elementsARegenerer: string[]
  description: string
}
export const modifierParcours = (id: string, corps: { demande: DemandeSurElement } | { phrase: string }) =>
  request<ReponseModification>(`/parcours/${id}/modifications`, { method: 'POST', body: JSON.stringify(corps) })

// ---- Partage au groupe (côté organisateur — compte requis) ----
export interface LienParticipant {
  participantId: string
  nom: string
  role: Role
  /** Chemin du lien personnel, ou null quand le domaine refuse d'en remettre un. */
  chemin: string | null
}
export interface EtatPartage {
  visibilite: Visibilite
  liens: LienParticipant[]
}
export interface ReponsePartage {
  parcours: Parcours
  partage: EtatPartage
}

export const chargerPartage = (id: string) => request<EtatPartage>(`/parcours/${id}/partage`)

export const changerVisibilite = (id: string, visibilite: Visibilite) =>
  request<ReponsePartage>(`/parcours/${id}/partage`, { method: 'PUT', body: JSON.stringify({ visibilite }) })

export const ajouterParticipant = (id: string, participant: { nom: string; role: Role }) =>
  request<ReponsePartage>(`/parcours/${id}/participants`, { method: 'POST', body: JSON.stringify(participant) })

export const retirerParticipant = (id: string, participantId: string) =>
  request<ReponsePartage>(`/parcours/${id}/participants/${participantId}`, { method: 'DELETE' })

// ---- Parcours partagé (accès par lien, sans compte) ----
export const chargerParcoursPartage = (jeton: string) =>
  request<{ parcours: Parcours; participant: Participant }>(`/partage/${jeton}`)

export const reagirSurElement = (jeton: string, elementId: string, avis: Avis) =>
  request<{ parcours: Parcours; description: string }>(`/partage/${jeton}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ elementId, avis }),
  })

// ---- Préférences (mémoire simple) ----
export const chargerPreferences = () =>
  request<{ preferences: PreferencesParcours | null }>('/parcours/preferences')
export const sauvegarderPreferences = (preferences: PreferencesParcours) =>
  request<{ preferences: PreferencesParcours }>('/parcours/preferences', { method: 'PUT', body: JSON.stringify(preferences) })
