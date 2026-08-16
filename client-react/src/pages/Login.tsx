// Page connexion / inscription : un seul formulaire, le mode actif décide de l'action.
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import Logo from '../components/ui/Logo'
import { useAuthStore } from '../store'
import { login, signup, ErreurApi } from '../lib/api'

type ModeAuth = 'connexion' | 'inscription'

// Messages fixes et humains selon l'action et le statut — jamais le message
// technique brut. En connexion, aucune distinction possible entre « email
// inconnu » et « mot de passe erroné » (anti-énumération).
function messageErreurAuth(mode: ModeAuth, erreur: unknown): string {
  const statut = erreur instanceof ErreurApi ? erreur.statutHttp : 0
  if (mode === 'connexion') {
    if (statut === 400 || statut === 401) return 'Connexion impossible. Vérifie ton email et ton mot de passe.'
    return 'Connexion momentanément impossible. Réessaie dans un instant.'
  }
  if (statut === 409) return 'Un compte existe déjà avec cet email.'
  if (statut === 400) return 'Inscription impossible. Vérifie les informations saisies.'
  return 'Inscription momentanément impossible. Réessaie dans un instant.'
}

export default function Login() {
  const [mode, setMode] = useState<ModeAuth>('connexion')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [prenom, setPrenom] = useState('')
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const changerMode = (nouveau: ModeAuth) => { setMode(nouveau); setErreur('') }

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault()
    setErreur('')
    if (!email || !motDePasse) {
      setErreur('Remplis tous les champs.')
      return
    }
    setChargement(true)
    try {
      const reponse = mode === 'connexion'
        ? await login(email, motDePasse)
        : await signup(email, motDePasse, prenom)
      setAuth(reponse.user)
      navigate('/')
    } catch (e) {
      setErreur(messageErreurAuth(mode, e))
    } finally {
      setChargement(false)
    }
  }

  return (
    <PageLayout>
      <Seo title="Connexion" description="Connecte-toi pour construire, retrouver et ajuster tes parcours." path="/login" noindex />
      <div className="max-w-sm mx-auto py-12 sm:py-16">
        <form onSubmit={envoyer} className="carte p-8 shadow-card-lg">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-laiton/10 border border-laiton/20 flex items-center justify-center mx-auto mb-3">
              <Logo size={24} className="text-laiton" />
            </div>
            <h1 className="font-heading font-semibold text-2xl text-encre">Experience AI</h1>
            <p className="text-sm text-brume mt-1">Transforme une envie en parcours</p>
          </div>

          {/* Choix du mode : deux boutons à état, jamais un pattern d'onglets incomplet */}
          <div className="flex gap-2 mb-6" role="group" aria-label="Se connecter ou créer un compte">
            {(['connexion', 'inscription'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => changerMode(m)}
                className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium border transition-colors cursor-pointer ${
                  mode === m
                    ? 'bg-terracotta-dark text-white border-terracotta-dark'
                    : 'bg-white text-encre border-sable hover:border-laiton'
                }`}
              >
                {m === 'connexion' ? 'Connexion' : 'Inscription'}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {mode === 'inscription' && (
              <div>
                <label htmlFor="prenom" className="block text-xs font-semibold text-encre-light mb-1">Prénom</label>
                <input id="prenom" value={prenom} onChange={(e) => setPrenom(e.target.value)}
                  autoComplete="given-name" className="champ" />
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-encre-light mb-1">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" required className="champ" />
            </div>
            <div>
              <label htmlFor="motdepasse" className="block text-xs font-semibold text-encre-light mb-1">Mot de passe</label>
              <input id="motdepasse" type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
                autoComplete={mode === 'connexion' ? 'current-password' : 'new-password'}
                required className="champ" />
            </div>
          </div>

          {erreur && (
            <p role="alert" className="mt-3 text-sm text-corail bg-corail/5 rounded-xl px-3 py-2">
              {erreur}
            </p>
          )}

          <button type="submit" disabled={chargement}
            className="btn-primaire w-full mt-5 flex items-center justify-center gap-2">
            {chargement
              ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-label="Chargement" />
              : mode === 'connexion' ? 'Se connecter' : 'Créer mon compte'}
          </button>

          <p className="text-center text-xs text-brume mt-4">
            <Link to="/" className="hover:text-encre transition-colors">← Retour à l'accueil</Link>
          </p>
        </form>
      </div>
    </PageLayout>
  )
}
