// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter } from 'react-router-dom'
import Preferences from './Preferences'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from 'sonner'

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...reel, chargerPreferences: vi.fn(), sauvegarderPreferences: vi.fn() }
})
import { chargerPreferences, sauvegarderPreferences } from '../lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function rendrePreferences() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Preferences /></MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

describe('Preferences — honnêteté des états', () => {
  it('affiche un état d’erreur et JAMAIS un formulaire vide quand le chargement échoue', async () => {
    vi.mocked(chargerPreferences).mockRejectedValue(new Error('panne réseau'))
    rendrePreferences()

    expect(await screen.findByText('Impossible de charger tes préférences')).toBeInTheDocument()
    // Le formulaire ne doit pas être monté : impossible d'enregistrer un faux vide.
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument()
    expect(sauvegarderPreferences).not.toHaveBeenCalled()
  })

  it('« Réessayer » relance le chargement', async () => {
    vi.mocked(chargerPreferences).mockRejectedValue(new Error('panne'))
    rendrePreferences()
    await screen.findByText('Impossible de charger tes préférences')
    expect(chargerPreferences).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(chargerPreferences).toHaveBeenCalledTimes(2))
  })

  it('monte un formulaire vide légitime quand le chargement réussit avec preferences: null', async () => {
    vi.mocked(chargerPreferences).mockResolvedValue({ preferences: null })
    rendrePreferences()
    expect(await screen.findByRole('button', { name: 'Enregistrer' })).toBeInTheDocument()
    expect(screen.queryByText('Impossible de charger tes préférences')).not.toBeInTheDocument()
  })

  it('humanise l’erreur de sauvegarde, sans message technique brut', async () => {
    vi.mocked(chargerPreferences).mockResolvedValue({ preferences: null })
    vi.mocked(sauvegarderPreferences).mockRejectedValue(new Error('DB timeout at 500'))
    rendrePreferences()

    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Impossible d’enregistrer tes préférences. Réessaie dans un instant.')
    })
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('DB timeout'))
  })
})
