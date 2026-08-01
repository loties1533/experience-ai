// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import ParcoursPartage from './ParcoursPartage'
import type { Parcours } from '../lib/api'

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...reel, chargerParcoursPartage: vi.fn() }
})
import { chargerParcoursPartage } from '../lib/api'

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
        prixEstime: true, confiance: { niveau: 'suggestion' }, statut: 'propose', estAncre: false,
        dependDe: [], alternatives: [], contraintes: [], reactions: [],
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
})
