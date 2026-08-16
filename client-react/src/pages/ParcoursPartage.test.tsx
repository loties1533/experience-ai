// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import ParcoursPartage from './ParcoursPartage'
import type { Parcours } from '../lib/api'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from 'sonner'

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...reel, chargerParcoursPartage: vi.fn(), reagirSurElement: vi.fn() }
})
import { chargerParcoursPartage, reagirSurElement } from '../lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function parcoursFixture(): Parcours {
  return {
    id: 'p1',
    intention: { texte: 'Un week-end au vert', motsCles: [] },
    contexte: { avecQui: 'couple', duree: { valeur: 2, unite: 'jours' }, lieux: [] },
    budget: { mode: 'individuel', devise: 'EUR' },
    ambiance: undefined,
    visibilite: 'partage',
    participants: [{ id: 'part1', nom: 'Ines', role: 'organisateur' }],
    timeline: [{
      id: 'm1',
      titre: 'Jour 1',
      elements: [{
        id: 'e1', type: 'activite', nom: 'Randonnée', lieu: 'Chamonix', justification: 'ça correspond à l’envie',
        prixEstime: true, confiance: {
          niveau: 'verifie',
          source: 'https://places-api.foursquare.com/places/search',
          fournisseur: 'Foursquare',
          recupereLe: '2026-08-14T10:00:00.000Z',
        }, statut: 'propose', estAncre: false,
        dependDe: [], alternatives: [], contraintes: [], reactions: [],
        lienExterne: {
          url: 'https://www.google.com/maps/search/?api=1&query=Chamonix',
          fournisseur: 'Google Maps',
          typeLien: 'carte',
        },
      }],
    }],
    historique: [],
  } as Parcours
}

function rendreParcoursPartage() {
  const queryClient = new QueryClient()
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/partage/jeton1']}>
          <Routes><Route path="/partage/:jeton" element={<ParcoursPartage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

describe('ParcoursPartage (rendu complet)', () => {
  it('empile le nom de l’élément au-dessus des boutons pour/contre sur mobile', async () => {
    vi.mocked(chargerParcoursPartage).mockResolvedValue({
      parcours: parcoursFixture(),
      participant: { id: 'part1', nom: 'Ines', role: 'organisateur' },
    })
    rendreParcoursPartage()

    const nom = await screen.findByText('Randonnée')
    const carteElement = nom.closest('li')
    const ligne = carteElement?.querySelector(':scope > div')
    expect(ligne?.className).toContain('flex-col')
    expect(ligne?.className).toContain('sm:flex-row')

    const blocContenu = nom.closest('div.w-full')
    expect(blocContenu).not.toBeNull()
    expect(blocContenu?.className).toContain('sm:w-auto')
  })

  it('rend aussi le lien actionnable dans la vue partagée', async () => {
    vi.mocked(chargerParcoursPartage).mockResolvedValue({
      parcours: parcoursFixture(),
      participant: { id: 'part1', nom: 'Ines', role: 'organisateur' },
    })
    rendreParcoursPartage()

    const lien = await screen.findByRole('link', { name: /Voir sur la carte pour Randonnée/ })
    expect(lien).toHaveAttribute('target', '_blank')
    expect(lien).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('ParcoursPartage (UI-5 — carnet partagé, sécurité)', () => {
  function rendreAvecParcours(over: Partial<Parcours> = {}) {
    vi.mocked(chargerParcoursPartage).mockResolvedValue({
      parcours: { ...parcoursFixture(), ...over },
      participant: { id: 'part1', nom: 'Ines', role: 'organisateur' },
    })
    return rendreParcoursPartage()
  }

  it('affiche le même message générique pour tout lien inutilisable (anti-énumération)', async () => {
    vi.mocked(chargerParcoursPartage).mockRejectedValue(new Error("peu importe la cause interne"))
    rendreParcoursPartage()
    expect(await screen.findByText("Ce lien n'est plus valide")).toBeInTheDocument()
    // Aucun détail sur l'existence ou l'état réel du parcours.
    expect(screen.queryByText(/privé|révoqué|introuvable|surprise/i)).not.toBeInTheDocument()
  })

  it('demande noindex/nofollow et n’expose aucun jeton dans les métadonnées', async () => {
    rendreAvecParcours()
    await screen.findByText('Un week-end au vert')
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
    )
    expect(document.title).not.toContain('jeton1')
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
  })

  it('reste noindex même quand le lien est invalide', async () => {
    vi.mocked(chargerParcoursPartage).mockRejectedValue(new Error('x'))
    rendreParcoursPartage()
    await screen.findByText("Ce lien n'est plus valide")
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
    )
  })

  it('francise le contexte et accorde la durée, sans enum brut', async () => {
    rendreAvecParcours({ contexte: { avecQui: 'amis', duree: { valeur: 1, unite: 'semaines' }, lieux: [] } })
    expect(await screen.findByText(/Entre amis · 1 semaine/)).toBeInTheDocument()
  })

  it('rend la provenance vérifiée lisible dans les détails, sans URL technique', async () => {
    rendreAvecParcours()
    await screen.findByText('Randonnée')
    expect(screen.getByText(/Source vérifiée : Foursquare · consultée le 14\/08\/2026/)).toBeInTheDocument()
    expect(screen.queryByText('https://places-api.foursquare.com/places/search')).not.toBeInTheDocument()
  })

  it('traite honnêtement une timeline vide et un moment sans élément', async () => {
    const { unmount } = rendreAvecParcours({ timeline: [] })
    expect(await screen.findByText("Ce parcours n'a pas encore de moment.")).toBeInTheDocument()
    unmount()

    rendreAvecParcours({ timeline: [{ id: 'm1', titre: 'Jour 1', elements: [] }] } as Partial<Parcours>)
    expect(await screen.findByText("Ce moment n'a pas encore d'élément.")).toBeInTheDocument()
  })

  it('garde Pour/Contre accessibles et humanise l’échec d’une réaction (pas de faux avis)', async () => {
    vi.mocked(reagirSurElement).mockRejectedValue(new Error('DB down 500'))
    rendreAvecParcours()
    await screen.findByText('Randonnée')

    const pour = screen.getByRole('button', { name: 'Pour' })
    expect(pour).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pour)
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Impossible d’enregistrer ton avis. Réessaie dans un instant.')
    })
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('DB down'))
  })
})
