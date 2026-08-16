import { afterEach, describe, expect, it, vi } from 'vitest'
import { chargerPreferences, ErreurApi, login } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function reponseErreur(statut: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: statut,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('adaptateur API — traitement des 401', () => {
  it('remonte le 401 du login au formulaire sans rediriger', async () => {
    const fausseFenetre = { location: { href: '/avant-connexion' } }
    const fetchSimule = vi.fn().mockResolvedValue(
      reponseErreur(401, 'Email ou mot de passe incorrect')
    )
    vi.stubGlobal('window', fausseFenetre)
    vi.stubGlobal('fetch', fetchSimule)

    const erreur = await login('a@b.fr', 'secret42').catch((cause: unknown) => cause)

    expect(erreur).toBeInstanceOf(ErreurApi)
    expect(erreur).toMatchObject({ statutHttp: 401 })
    expect(fausseFenetre.location.href).toBe('/avant-connexion')
    expect(fetchSimule).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
  })

  it('conserve la redirection 401 pour une route protégée', async () => {
    const fausseFenetre = { location: { href: '/preferences' } }
    vi.stubGlobal('window', fausseFenetre)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseErreur(401, 'détail serveur privé')))

    const erreur = await chargerPreferences().catch((cause: unknown) => cause)

    expect(erreur).toBeInstanceOf(ErreurApi)
    expect(erreur).toMatchObject({ statutHttp: 401 })
    expect(fausseFenetre.location.href).toBe('/login')
  })
})
