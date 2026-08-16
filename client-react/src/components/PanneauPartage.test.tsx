// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PanneauPartage from './PanneauPartage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...reel,
    chargerPartage: vi.fn(),
    changerVisibilite: vi.fn(),
    ajouterParticipant: vi.fn(),
    retirerParticipant: vi.fn(),
  }
})
import { toast } from 'sonner'
import { ajouterParticipant, changerVisibilite, chargerPartage, retirerParticipant } from '../lib/api'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

function rendrePanneau() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PanneauPartage parcoursId="p1" />
    </QueryClientProvider>
  )
}

const PARTAGE_AVEC_PARTICIPANT = {
  visibilite: 'partage' as const,
  liens: [
    { participantId: 'o1', nom: 'Ines', role: 'organisateur' as const, chemin: null },
    { participantId: 'p2', nom: 'Marc', role: 'participant' as const, chemin: '/partage/jeton-marc' },
  ],
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
    vi.mocked(chargerPartage).mockResolvedValue(PARTAGE_AVEC_PARTICIPANT)
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

  it('humanise l’échec d’un changement de visibilité, sans faux succès', async () => {
    vi.mocked(chargerPartage).mockResolvedValue({ ...PARTAGE_AVEC_PARTICIPANT, visibilite: 'prive' })
    vi.mocked(changerVisibilite).mockRejectedValue(new Error('SQL 500 visibility'))
    rendrePanneau()

    fireEvent.click(await screen.findByRole('radio', { name: /^Partagé/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Impossible de changer la visibilité. Réessaie dans un instant.'
    ))
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('SQL 500'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('humanise l’échec d’un ajout de participant, sans faux succès', async () => {
    vi.mocked(chargerPartage).mockResolvedValue(PARTAGE_AVEC_PARTICIPANT)
    vi.mocked(ajouterParticipant).mockRejectedValue(new Error('API 503 participant'))
    rendrePanneau()

    fireEvent.change(await screen.findByLabelText("Ajouter quelqu'un"), { target: { value: 'Lea' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Impossible d’ajouter ce participant. Réessaie dans un instant.'
    ))
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('API 503'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('humanise l’échec d’un retrait de participant, sans faux succès', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(chargerPartage).mockResolvedValue(PARTAGE_AVEC_PARTICIPANT)
    vi.mocked(retirerParticipant).mockRejectedValue(new Error('DB down retrait'))
    rendrePanneau()

    fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Impossible de retirer ce participant. Réessaie dans un instant.'
    ))
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('DB down'))
    expect(toast.success).not.toHaveBeenCalled()
    confirmer.mockRestore()
  })
})
