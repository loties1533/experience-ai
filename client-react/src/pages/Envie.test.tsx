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

  it('affiche le hero immersif et les suggestions au premier contact', () => {
    rendreEnvie()
    expect(screen.getByText('Vivre la NBA pendant 3 semaines')).toBeInTheDocument()
    // Le hero rend une vraie photographie : la première ambiance porte l'alt d'émotion.
    expect(screen.getByRole('img', { name: /énergie d'une salle comble/i })).toBeInTheDocument()
    // Le titre reste centré sur l'intention, jamais sur une destination.
    expect(screen.getByRole('heading', { name: /qu'as-tu envie de vivre/i })).toBeInTheDocument()
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

  it('offre un champ de réponse dans la zone dialogue une fois l’échange commencé, avec la même logique d’envoi', async () => {
    // Dialogue déjà commencé : le champ ne doit pas rester coincé dans le hero.
    useDialogueStore.setState({
      messages: [{ id: 'm1', de: 'produit', texte: 'Tu pars quand ?' }],
      brief: { intention: 'Vivre la NBA' },
    })
    vi.mocked(avancerDialogue).mockResolvedValue({
      brief: { intention: 'Vivre la NBA' }, estComplet: false, reponse: 'Noté.',
    })
    rendreEnvie()

    // Un seul champ « Décris ton envie » (pas de doublon hero + dialogue).
    const champs = screen.getAllByRole('textbox', { name: 'Décris ton envie' })
    expect(champs).toHaveLength(1)

    fireEvent.change(champs[0], { target: { value: 'En mars' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
    await waitFor(() => {
      expect(avancerDialogue).toHaveBeenCalledWith({ intention: 'Vivre la NBA' }, 'En mars', undefined)
    })
  })
})
