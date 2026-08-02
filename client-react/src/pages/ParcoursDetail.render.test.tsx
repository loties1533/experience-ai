// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import ParcoursDetail from './ParcoursDetail'
import type { Parcours } from '../lib/api'

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...reel, chargerParcours: vi.fn(), modifierParcours: vi.fn(), chargerPartage: vi.fn() }
})
import { chargerParcours, modifierParcours, chargerPartage } from '../lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function parcoursFixture(): Parcours {
  return {
    id: 'p1',
    intention: { texte: 'Un week-end au vert', motsCles: [] },
    contexte: { avecQui: 'couple', duree: { valeur: 2, unite: 'jours' }, lieux: [] },
    budget: { mode: 'individuel', devise: 'EUR' },
    ambiance: undefined,
    visibilite: 'prive',
    participants: [],
    timeline: [{
      id: 'm1',
      titre: 'Jour 1',
      elements: [{
        id: 'e1', type: 'activite', nom: 'Randonnée', lieu: 'Chamonix', justification: 'ça correspond à l’envie',
        prixEstime: true, confiance: { niveau: 'suggestion' }, statut: 'propose', estAncre: false,
        dependDe: [], alternatives: [], contraintes: [], reactions: [],
        reservation: { lienExterne: 'https://exemple.fr/resa', fournisseur: 'Exemple', typeLien: 'reservation' },
      }],
    }],
    historique: [],
  } as Parcours
}

function rendreParcoursDetail() {
  const queryClient = new QueryClient()
  vi.mocked(chargerPartage).mockResolvedValue({ visibilite: 'prive', liens: [] })
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/parcours/p1']}>
          <Routes><Route path="/parcours/:id" element={<ParcoursDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

describe('ParcoursDetail (rendu complet)', () => {
  it('ne montre jamais « Réserver » — un lien de recherche n’est pas une réservation', async () => {
    vi.mocked(chargerParcours).mockResolvedValue({ parcours: parcoursFixture() })
    rendreParcoursDetail()

    expect(await screen.findByText('Randonnée')).toBeInTheDocument()
    expect(screen.queryByText(/^Réserver$/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voir la réservation pour Randonnée/ })).toBeInTheDocument()
  })

  it('garde la description de la dernière modification affichée jusqu’à la fermeture explicite', async () => {
    vi.mocked(chargerParcours).mockResolvedValue({ parcours: parcoursFixture() })
    const parcoursModifie = parcoursFixture()
    vi.mocked(modifierParcours).mockResolvedValue({
      parcours: parcoursModifie,
      elementsARegenerer: [],
      description: 'Randonnée remplacée par une visite de musée',
    })
    rendreParcoursDetail()

    await screen.findByText('Randonnée')
    fireEvent.change(screen.getByPlaceholderText(/change le resto/), { target: { value: 'change la rando' } })
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }))

    const banniere = await screen.findByText(/Randonnée remplacée par une visite de musée/)
    expect(banniere).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fermer cette information' }))
    await waitFor(() => {
      expect(screen.queryByText(/Randonnée remplacée par une visite de musée/)).not.toBeInTheDocument()
    })
  })

  it('empile le nom de l’élément au-dessus des actions sur mobile — sans ça, les boutons se plaçaient à côté du contenu et écrasaient le nom sur une colonne d’un mot', async () => {
    vi.mocked(chargerParcours).mockResolvedValue({ parcours: parcoursFixture() })
    rendreParcoursDetail()

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
