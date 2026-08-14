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
import { avancerDialogue, genererParcours } from '../lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  useDialogueStore.setState({ messages: [], brief: {}, estComplet: false, etatDialogue: undefined })
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
  it('restaure une envie mise en attente sans envoi automatique', () => {
    sessionStorage.setItem('experience-ai:envie-en-attente', 'Un festival entre amis')

    rendreEnvie()

    expect(screen.getByRole('textbox', { name: 'Décris ton envie' })).toHaveValue(
      'Un festival entre amis'
    )
    expect(sessionStorage.getItem('experience-ai:envie-en-attente')).toBeNull()
    expect(avancerDialogue).not.toHaveBeenCalled()
  })

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

  it('reçoit une clarification structurée dans le dialogue et transmet son état à la réponse suivante', async () => {
    const brief = {
      intention: 'Vivre la NBA',
      avecQui: 'solo' as const,
      duree: { valeur: 3, unite: 'semaines' as const },
    }
    const etatDialogue = {
      champ: 'preparation_generation' as const,
      code: 'zone_geographique_requise' as const,
      champCible: 'lieux' as const,
    }
    useDialogueStore.setState({ brief, estComplet: true })
    vi.mocked(genererParcours).mockResolvedValue({
      type: 'clarification_requise',
      clarification: {
        code: 'zone_geographique_requise',
        question: 'Tu préfères rester en Europe ou aller plus loin ?',
        champCible: 'lieux',
      },
      etatDialogue,
    })
    vi.mocked(avancerDialogue).mockResolvedValue({
      brief: { ...brief, lieux: [{ nom: 'Paris', type: 'ville' }] },
      estComplet: true,
      reponse: 'Parfait, Paris est noté.',
    })
    rendreEnvie()

    fireEvent.click(screen.getByRole('button', { name: 'Construire mon parcours' }))
    expect(await screen.findByText('Tu préfères rester en Europe ou aller plus loin ?')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Décris ton envie' })).not.toBeDisabled()
    expect(useDialogueStore.getState().etatDialogue).toEqual(etatDialogue)

    fireEvent.change(screen.getByRole('textbox', { name: 'Décris ton envie' }), { target: { value: 'Paris' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
    await waitFor(() => {
      expect(avancerDialogue).toHaveBeenCalledWith(brief, 'Paris', etatDialogue)
    })
  })

  it('n’affiche pas le pied de page — longueur inutile sur mobile alors que le formulaire doit rester la dernière chose atteignable', () => {
    rendreEnvie()
    expect(screen.queryByText('© 2026 Experience AI')).not.toBeInTheDocument()
  })
})
