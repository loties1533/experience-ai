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

  it('affiche le hero immersif (sous-titre + suggestions) au premier contact', () => {
    rendreEnvie()
    expect(screen.getByText('Vivre la NBA pendant 3 semaines')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /énergie d'une salle comble/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /qu'as-tu envie de vivre/i })).toBeInTheDocument()
    // Hero plein : le sous-titre est présent au premier contact.
    expect(screen.getByText('Décris ton envie — pas une destination.')).toBeInTheDocument()
  })

  it('passe le hero en mode compact dès le premier échange (sous-titre et suggestions retirés)', () => {
    useDialogueStore.setState({ messages: [{ id: 'm1', de: 'produit', texte: 'Tu pars quand ?' }] })
    rendreEnvie()
    expect(screen.getByRole('heading', { name: /qu'as-tu envie de vivre/i })).toBeInTheDocument()
    expect(screen.queryByText('Décris ton envie — pas une destination.')).not.toBeInTheDocument()
    expect(screen.queryByText('Vivre la NBA pendant 3 semaines')).not.toBeInTheDocument()
  })

  it('n’affiche dans le récap que les champs confirmés du brief, jamais une valeur candidate', () => {
    useDialogueStore.setState({
      messages: [{ id: 'm1', de: 'produit', texte: 'On avance.' }],
      brief: { intention: 'Vivre la NBA', avecQui: 'amis', duree: { valeur: 3, unite: 'semaines' } },
      // Une date reste EN ATTENTE de confirmation : elle ne doit pas apparaître comme acquise.
      etatDialogue: { champ: 'dates', valeurCandidate: { debut: '2026-10-02T00:00:00Z', fin: '2026-10-23T00:00:00Z' } },
    })
    rendreEnvie()
    expect(screen.getByText('Entre amis')).toBeInTheDocument()
    expect(screen.getByText('3 semaines')).toBeInTheDocument()
    // Aucune date : ni le libellé « Quand », ni la valeur candidate 02/10/2026.
    expect(screen.queryByText('Quand')).not.toBeInTheDocument()
    expect(screen.queryByText(/02\/10\/2026/)).not.toBeInTheDocument()
  })

  it('affiche un état de construction honnête pendant la génération, sans inventer d’étapes', async () => {
    useDialogueStore.setState({ brief: { intention: 'Un week-end' }, estComplet: true })
    vi.mocked(genererParcours).mockReturnValue(new Promise(() => {}))
    rendreEnvie()

    fireEvent.click(screen.getByRole('button', { name: 'Construire mon parcours' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('On compose ton parcours…')
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

  it('affiche une indisponibilité (503) en status, non alarmant', async () => {
    useDialogueStore.setState({ brief: { intention: 'Un week-end' }, estComplet: true })
    vi.mocked(genererParcours).mockRejectedValue(new ErreurApi('Service momentanément injoignable.', 503))
    rendreEnvie()

    fireEvent.click(screen.getByRole('button', { name: 'Construire mon parcours' }))

    // La carte de génération (role=status) disparaît à l'échec : on attend le
    // message d'indisponibilité, puis on vérifie qu'il est bien porté en status.
    expect(await screen.findByText('Service momentanément injoignable.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Service momentanément injoignable.')
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('défile en instantané (sans animation) quand le mouvement réduit est demandé', () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('reduce'), media: q,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }))
    useDialogueStore.setState({ messages: [{ id: 'm1', de: 'produit', texte: 'Tu pars quand ?' }] })
    rendreEnvie()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' })
  })
})
