// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import Envie from './Envie'
import { useAuthStore, useDialogueStore } from '../store'
import { ErreurApi } from '../lib/api'

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...reel, genererParcours: vi.fn(), avancerDialogue: vi.fn() }
})
import { genererParcours } from '../lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

beforeEach(() => {
  useDialogueStore.setState({ messages: [], brief: {}, estComplet: false })
  useAuthStore.setState({ user: { id: 'u1', email: 'a@b.fr' } })
})

function rendreEnvie() {
  const queryClient = new QueryClient()
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Envie /></MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

describe('Envie', () => {
  it('affiche les suggestions au premier contact et une bande éditoriale sans photo réelle', () => {
    rendreEnvie()
    expect(screen.getByText('Vivre la NBA pendant 3 semaines')).toBeInTheDocument()
    // Aucune vraie photo disponible dans le dépôt à ce stade : le repli graphique s'affiche
    // (le seul <img> possible serait la bande éditoriale — le logo, lui, est un svg role="img").
    expect(screen.queryByRole('img', { name: /bande éditoriale/i })).not.toBeInTheDocument()
  })

  it('affiche un état de construction honnête pendant la génération, sans inventer d’étapes', async () => {
    useDialogueStore.setState({ brief: { intention: 'Un week-end' }, estComplet: true })
    vi.mocked(genererParcours).mockReturnValue(new Promise(() => {}))
    rendreEnvie()

    fireEvent.click(screen.getByRole('button', { name: 'Construire mon parcours' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Construction du parcours…')
    })
  })

  it('affiche un refus (422) comme un bandeau assertif, pas un toast qui disparaît', async () => {
    useDialogueStore.setState({ brief: { intention: 'Un week-end' }, estComplet: true })
    vi.mocked(genererParcours).mockRejectedValue(new ErreurApi('Impossible de construire ce parcours en l’état.', 422))
    rendreEnvie()

    fireEvent.click(screen.getByRole('button', { name: 'Construire mon parcours' }))

    const banniere = await screen.findByRole('alert')
    expect(banniere).toHaveTextContent('Impossible de construire ce parcours en l’état.')
    expect(screen.getByRole('button', { name: 'Reformuler' })).toBeInTheDocument()
  })
})
