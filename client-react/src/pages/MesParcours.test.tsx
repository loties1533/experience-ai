// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
  const queryClient = new QueryClient()
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><MesParcours /></MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

describe('MesParcours', () => {
  it('affiche la carte avec un repli graphique décoratif, sans champ inventé', async () => {
    vi.mocked(listerParcours).mockResolvedValue({
      parcours: [{ id: 'p1', intention: 'Un week-end au vert', visibilite: 'prive', misAJourLe: new Date('2026-07-20') }],
    })
    rendreMesParcours()

    expect(await screen.findByText('Un week-end au vert')).toBeInTheDocument()
    expect(screen.getByText('Privé')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ouvrir' })).toHaveAttribute('href', '/parcours/p1')
    // La vignette n'a aucune vraie photo : le repli est purement décoratif (aria-hidden), pas d'alt trompeur.
    // (le seul role="img" restant est le logo svg du header/footer, pas la vignette.)
    expect(screen.getAllByRole('img')).toHaveLength(2)
  })

  it("affiche l'état vide sans halluciner de parcours", async () => {
    vi.mocked(listerParcours).mockResolvedValue({ parcours: [] })
    rendreMesParcours()

    expect(await screen.findByText('Aucun parcours pour l\'instant')).toBeInTheDocument()
  })
})
