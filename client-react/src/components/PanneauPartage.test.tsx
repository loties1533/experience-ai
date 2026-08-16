// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PanneauPartage from './PanneauPartage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...reel, chargerPartage: vi.fn(), retirerParticipant: vi.fn() }
})
import { chargerPartage, retirerParticipant } from '../lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function rendrePanneau() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PanneauPartage parcoursId="p1" />
    </QueryClientProvider>
  )
}

describe('PanneauPartage — honnêteté des états', () => {
  it('affiche un état d’erreur explicite, pas un squelette permanent, quand le chargement échoue', async () => {
    vi.mocked(chargerPartage).mockRejectedValue(new Error('panne réseau'))
    rendrePanneau()
    expect(await screen.findByText('Impossible de charger le partage')).toBeInTheDocument()
  })

  it('« Réessayer » relance le chargement', async () => {
    vi.mocked(chargerPartage).mockRejectedValue(new Error('panne'))
    rendrePanneau()
    await screen.findByText('Impossible de charger le partage')
    expect(chargerPartage).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(chargerPartage).toHaveBeenCalledTimes(2))
  })

  it('conserve la confirmation avant de retirer un participant (aucun retrait sans accord)', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(chargerPartage).mockResolvedValue({
      visibilite: 'partage',
      liens: [
        { participantId: 'o1', nom: 'Ines', role: 'organisateur', chemin: null },
        { participantId: 'p2', nom: 'Marc', role: 'participant', chemin: '/partage/jeton-marc' },
      ],
    })
    rendrePanneau()

    await screen.findByText('Marc')
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }))
    expect(confirmer).toHaveBeenCalled()
    expect(retirerParticipant).not.toHaveBeenCalled()
    confirmer.mockRestore()
  })

  it('n’invente aucun lien : seul le chemin fourni par le serveur est proposé à la copie', async () => {
    vi.mocked(chargerPartage).mockResolvedValue({
      visibilite: 'prive',
      liens: [{ participantId: 'o1', nom: 'Ines', role: 'organisateur', chemin: null }],
    })
    rendrePanneau()
    await screen.findByText('Ines')
    // chemin null → aucun bouton « Copier le lien » n'est proposé.
    expect(screen.queryByRole('button', { name: 'Copier le lien' })).not.toBeInTheDocument()
  })
})
