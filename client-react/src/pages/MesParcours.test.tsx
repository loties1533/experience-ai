// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import MesParcours from './MesParcours'

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...reel, listerParcours: vi.fn() }
})
import { listerParcours } from '../lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function rendreMesParcours() {
  // Pas de retry en test : l'état d'erreur doit être atteint immédiatement.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><MesParcours /></MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

describe('MesParcours', () => {
  it('affiche l’intention, la visibilité explicite et le lien Ouvrir, sans champ inventé', async () => {
    vi.mocked(listerParcours).mockResolvedValue({
      parcours: [{ id: 'p1', intention: 'Un week-end au vert', visibilite: 'prive', misAJourLe: new Date('2026-07-20') }],
    })
    rendreMesParcours()

    expect(await screen.findByText('Un week-end au vert')).toBeInTheDocument()
    expect(screen.getByText('Privé')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ouvrir' })).toHaveAttribute('href', '/parcours/p1')
  })

  it('affiche une intention longue en entier, jamais tronquée du DOM', async () => {
    const longue = 'Un week-end romantique quelque part au bord de l’eau, sans trop savoir où l’on ira exactement'
    vi.mocked(listerParcours).mockResolvedValue({
      parcours: [{ id: 'p2', intention: longue, visibilite: 'partage', misAJourLe: new Date('2026-07-20') }],
    })
    rendreMesParcours()
    expect(await screen.findByText(longue)).toBeInTheDocument()
  })

  it('distingue textuellement privé / partagé / surprise', async () => {
    vi.mocked(listerParcours).mockResolvedValue({
      parcours: [
        { id: 'p1', intention: 'A', visibilite: 'prive', misAJourLe: new Date('2026-07-20') },
        { id: 'p2', intention: 'B', visibilite: 'partage', misAJourLe: new Date('2026-07-20') },
        { id: 'p3', intention: 'C', visibilite: 'surprise', misAJourLe: new Date('2026-07-20') },
      ],
    })
    rendreMesParcours()
    expect(await screen.findByText('Privé')).toBeInTheDocument()
    expect(screen.getByText('Partagé')).toBeInTheDocument()
    expect(screen.getByText('Surprise')).toBeInTheDocument()
  })

  it("affiche l'état vide sans halluciner de parcours", async () => {
    vi.mocked(listerParcours).mockResolvedValue({ parcours: [] })
    rendreMesParcours()

    expect(await screen.findByText('Aucun parcours pour l\'instant')).toBeInTheDocument()
  })

  it('n’affiche jamais « Privé » pour une visibilité inconnue', async () => {
    vi.mocked(listerParcours).mockResolvedValue({
      parcours: [{ id: 'p1', intention: 'Un parcours', visibilite: 'archivee', misAJourLe: new Date('2026-07-20') }],
    } as unknown as { parcours: Awaited<ReturnType<typeof listerParcours>>['parcours'] })
    rendreMesParcours()

    expect(await screen.findByText('Visibilité inconnue')).toBeInTheDocument()
    expect(screen.queryByText('Privé')).not.toBeInTheDocument()
  })

  it('affiche un état d’erreur, jamais une fausse liste vide, quand le chargement échoue', async () => {
    vi.mocked(listerParcours).mockRejectedValue(new Error('panne réseau'))
    rendreMesParcours()

    expect(await screen.findByText('Impossible de charger tes parcours')).toBeInTheDocument()
    expect(screen.queryByText("Aucun parcours pour l'instant")).not.toBeInTheDocument()
  })

  it('demande aux moteurs de ne pas indexer cette route privée', async () => {
    vi.mocked(listerParcours).mockResolvedValue({ parcours: [] })
    rendreMesParcours()
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
    )
  })
})
