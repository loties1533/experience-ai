// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Login from './Login'
import { ErreurApi } from '../lib/api'

vi.mock('../lib/api', async () => {
  const reel = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...reel, login: vi.fn(), signup: vi.fn() }
})
import { login, signup } from '../lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function rendreLogin() {
  const queryClient = new QueryClient()
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Login /></MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

async function soumettre(nomBouton: RegExp) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.fr' } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'secret42' } })
  fireEvent.click(screen.getByRole('button', { name: nomBouton }))
}

describe('Login', () => {
  it('bascule de mode avec un état accessible (aria-pressed), sans faux pattern d’onglets', () => {
    rendreLogin()
    const connexion = screen.getByRole('button', { name: 'Connexion' })
    const inscription = screen.getByRole('button', { name: 'Inscription' })
    expect(connexion).toHaveAttribute('aria-pressed', 'true')
    expect(inscription).toHaveAttribute('aria-pressed', 'false')
    // Aucun rôle d'onglet incomplet.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()

    fireEvent.click(inscription)
    expect(inscription).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Prénom')).toBeInTheDocument()
  })

  it('conserve l’autocomplete des champs', () => {
    rendreLogin()
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Mot de passe')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('humanise une erreur de connexion, sans message technique ni statut brut', async () => {
    vi.mocked(login).mockRejectedValue(new ErreurApi('Email ou mot de passe incorrect', 401))
    rendreLogin()
    await soumettre(/Se connecter/)

    const alerte = await screen.findByRole('alert')
    expect(alerte).toHaveTextContent('Connexion impossible. Vérifie ton email et ton mot de passe.')
    expect(screen.queryByText('Email ou mot de passe incorrect')).not.toBeInTheDocument()
    expect(alerte).not.toHaveTextContent('401')
  })

  it('donne le même message en connexion quel que soit le statut, sans permettre d’énumérer un compte', async () => {
    // 401 (identifiants) et 400 (validation) aboutissent au même message côté connexion.
    vi.mocked(login).mockRejectedValueOnce(new ErreurApi('Email ou mot de passe incorrect', 401))
    rendreLogin()
    await soumettre(/Se connecter/)
    expect(await screen.findByRole('alert')).toHaveTextContent('Connexion impossible. Vérifie ton email et ton mot de passe.')

    vi.mocked(login).mockRejectedValueOnce(new ErreurApi('Requête invalide', 400))
    await soumettre(/Se connecter/)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Connexion impossible. Vérifie ton email et ton mot de passe.')
    )
  })

  it('signale un email déjà utilisé à l’inscription (message dédié)', async () => {
    vi.mocked(signup).mockRejectedValue(new ErreurApi('Cet email est déjà utilisé', 409))
    rendreLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Inscription' }))
    await soumettre(/Créer mon compte/)
    expect(await screen.findByRole('alert')).toHaveTextContent('Un compte existe déjà avec cet email.')
  })

  it('demande aux moteurs de ne pas indexer la page', async () => {
    rendreLogin()
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
    )
  })
})
