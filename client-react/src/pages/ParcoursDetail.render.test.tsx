// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import ParcoursDetail from './ParcoursDetail'
import type { Parcours } from '../lib/api'
import type { TypeLienExterne } from '../../../server/domaine/parcours'

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...reel, chargerParcours: vi.fn(), modifierParcours: vi.fn(), chargerPartage: vi.fn() }
})
import { chargerParcours, modifierParcours, chargerPartage } from '../lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function parcoursFixture(typeLien: TypeLienExterne | null = 'reservation'): Parcours {
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
        prixEstime: true, confiance: {
          niveau: 'verifie',
          source: 'https://api.foursquare.com/v3/places/fsq-1',
          fournisseur: 'Foursquare',
          recupereLe: '2026-08-14T10:00:00.000Z',
        }, statut: 'propose', estAncre: false,
        dependDe: [], alternatives: [], contraintes: [], reactions: [],
        ...(typeLien === null ? {} : {
          lienExterne: { url: 'https://exemple.fr/action', fournisseur: 'Exemple', typeLien },
        }),
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
  it.each<[TypeLienExterne, string]>([
    ['officiel', 'Voir le site officiel'],
    ['billetterie', 'Ouvrir la billetterie'],
    ['reservation', 'Ouvrir la page de réservation'],
    ['carte', 'Voir sur la carte'],
  ])('affiche le CTA explicite « %s » sans promesse de disponibilité', async (typeLien, libelle) => {
    vi.mocked(chargerParcours).mockResolvedValue({ parcours: parcoursFixture(typeLien) })
    rendreParcoursDetail()

    expect(await screen.findByText('Randonnée')).toBeInTheDocument()
    const lien = screen.getByRole('link', { name: new RegExp(`${libelle} pour Randonnée`) })
    expect(lien).toHaveAttribute('href', 'https://exemple.fr/action')
    expect(lien).toHaveAttribute('target', '_blank')
    expect(lien).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByText(/réserver maintenant/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/billets disponibles|réservation confirmée|disponibilité/i)).not.toBeInTheDocument()
  })

  it('n’affiche ni CTA ni URL technique lorsqu’aucun lien utilisateur n’est prouvé', async () => {
    vi.mocked(chargerParcours).mockResolvedValue({ parcours: parcoursFixture(null) })
    rendreParcoursDetail()

    expect(await screen.findByText('Randonnée')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Randonnée/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /foursquare/i })).not.toBeInTheDocument()
    expect(screen.queryByText('https://api.foursquare.com/v3/places/fsq-1')).not.toBeInTheDocument()
  })

  it('affiche le raccourci Booking comme une recherche, sans promesse de réservation', async () => {
    const parcours = parcoursFixture(null)
    const hotel = parcours.timeline[0].elements[0]
    hotel.type = 'hebergement'
    hotel.lienRechercheHebergement = {
      type: 'recherche',
      fournisseur: 'Booking',
      url: 'https://www.booking.com/searchresults.html?ss=Chamonix&checkin=2026-09-10&checkout=2026-09-12&group_adults=2&group_children=0&no_rooms=1',
      libelle: 'Rechercher des hébergements sur Booking',
      genereLe: '2026-08-14T10:00:00.000Z',
    }
    vi.mocked(chargerParcours).mockResolvedValue({ parcours })
    rendreParcoursDetail()

    const lien = await screen.findByRole('link', { name: /Rechercher des hébergements sur Booking/ })
    expect(lien).toHaveAttribute('target', '_blank')
    expect(lien).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByText(/réserver maintenant|chambre disponible/i)).not.toBeInTheDocument()
  })

  it('affiche le raccourci transport comme une recherche, jamais comme un billet', async () => {
    const parcours = parcoursFixture(null)
    const transport = parcours.timeline[0].elements[0]
    transport.type = 'transport'
    transport.lienRechercheTransport = {
      type: 'recherche_vol',
      fournisseur: 'Google Flights',
      url: 'https://www.google.com/travel/flights',
      libelle: 'Rechercher des vols sur Google Flights',
      genereLe: '2026-08-14T10:00:00.000Z',
    }
    vi.mocked(chargerParcours).mockResolvedValue({ parcours })
    rendreParcoursDetail()

    const lien = await screen.findByRole('link', { name: /Rechercher des vols sur Google Flights/ })
    expect(lien).toHaveAttribute('target', '_blank')
    expect(lien).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByText(/acheter|billet disponible/i)).not.toBeInTheDocument()
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
