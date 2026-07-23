// =============================================
// TRIPGENIE — src/lib/api.ts
// Toutes les requêtes HTTP vers l'API Express
// =============================================

import type {
  Pack, EnregistrementVoyage, User, ResultatOnboarding, ResultatScore, ElementDestination
} from '../../../server/lib/types'

export type { ElementDestination }

// En développement : Vite proxifie /api → localhost:3000
// En production : VITE_API_URL pointe vers l'API distante
const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api'

async function request<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // cookie httpOnly envoyé automatiquement
    ...opts
  })

  const isAuthRoute = path.startsWith('/auth/login') || path.startsWith('/auth/signup')
  
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('Session expirée, veuillez vous reconnecter.')
  }

  const data = await res.json() as T
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`)
  return data
}

// ---- Auth ----
export const logout = () => request<{ message: string }>('/auth/logout', { method: 'POST' })

export const login  = (email: string, password: string) =>
  request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })

export const signup = (email: string, password: string, name: string) =>
  request<{ user: User }>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) })

// ---- IA ----
export const chatOnboarding = (userMessage: string, currentData: Record<string, unknown>) =>
  request<ResultatOnboarding>('/ai/onboarding', { method: 'POST', body: JSON.stringify({ userMessage, currentData }) })

export const getDestinations = (params: Record<string, unknown>) =>
  request<{ destinations: ElementDestination[] }>('/ai/destinations', { method: 'POST', body: JSON.stringify(params) })

export interface ReponseGenerationPack {
  pack: Pack;
  trip_id: string | null;
  pack_id: string | null;
  score: ResultatScore;
  flights_found: boolean;
  events_found: boolean;
}
export const generatePack = (params: Record<string, unknown>) =>
  request<ReponseGenerationPack>('/ai/generate', { method: 'POST', body: JSON.stringify(params) })

export interface ReponseModificationChat {
  response: string;
  needs_full_regen?: boolean;
  modifications?: Partial<Pack>;
  chips?: string[];
}
export const chatModify = (message: string, currentPack: Pack, mode: string, tripId: string | null) =>
  request<ReponseModificationChat>('/ai/chat', { method: 'POST', body: JSON.stringify({ message, current_pack: currentPack, mode, trip_id: tripId }) })

// ---- Voyages (CRUD) ----
export const getTrips      = (filters: Record<string, string> = {}) =>
  request<{ trips: EnregistrementVoyage[]; count: number }>(`/trips?${new URLSearchParams(filters)}`)

export const getPublicTrip = (id: string) => request<{ trip: EnregistrementVoyage & { pack_id: string | null } }>(`/trips/share/${id}`)
export const deleteTrip    = (id: string) => request<{ message: string }>(`/trips/${id}`, { method: 'DELETE' })
export const updateTrip    = (id: string, fields: { status?: string; travelers?: number; budget?: string }) =>
  request<{ trip: EnregistrementVoyage }>(`/trips/${id}`, { method: 'PUT', body: JSON.stringify(fields) })

// ---- Photos — proxy backend (clé Unsplash jamais exposée côté client) ----
export const getCityPhoto = (city: string) => request<{ url: string }>(`/photos/${encodeURIComponent(city)}`)

// ---- Préférences utilisateur (relation 1-1) ----
export interface PreferencesUtilisateur {
  default_mode?: string;
  default_premium?: boolean;
  preferred_prefs?: string[];
  home_city?: string;
  currency?: string;
}
export const getPreferences  = () => request<{ preferences: PreferencesUtilisateur | null }>('/preferences')
export const savePreferences = (fields: PreferencesUtilisateur) =>
  request<{ preferences: PreferencesUtilisateur }>('/preferences', { method: 'PUT', body: JSON.stringify(fields) })

// ---- Votes ----
export const saveVote = (pack_id: string, item_id: string, vote_type: boolean, voter_name = '') =>
  request<{ vote: unknown }>('/votes', { method: 'POST', body: JSON.stringify({ pack_id, item_id, vote_type, voter_name }) })

export const getVotes = (pack_id: string) => request<{ votes: unknown[] }>(`/votes/${pack_id}`)
