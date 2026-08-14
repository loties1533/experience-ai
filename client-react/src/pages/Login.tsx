// Page connexion / inscription : un seul formulaire, l'onglet actif décide de l'action.
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import Logo from '../components/ui/Logo'
import { useAuthStore } from '../store'
import { login, signup } from '../lib/api'

export default function Login() {
  const [onglet, setOnglet] = useState<'connexion' | 'inscription'>('connexion')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [prenom, setPrenom] = useState('')
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault()
    setErreur('')
    if (!email || !motDePasse) {
      setErreur('Remplis tous les champs')
      return
    }
    setChargement(true)
    try {
      const reponse = onglet === 'connexion'
        ? await login(email, motDePasse)
        : await signup(email, motDePasse, prenom)
      setAuth(reponse.user)
      navigate('/')
    } catch (e) {
      setErreur((e as Error).message)
    } finally {
      setChargement(false)
    }
  }

  return (
    <PageLayout>
      <Seo
        title="Connexion"
        description="Connecte-toi pour construire, retrouver et ajuster tes parcours."
        path="/login"
      />
      <div className="max-w-sm mx-auto py-12 sm:py-16">
        <form onSubmit={envoyer} className="carte p-8 shadow-card-lg">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-laiton/10 border border-laiton/20 flex items-center justify-center mx-auto mb-3">
              <Logo size={24} className="text-laiton" />
            </div>
            <h1 className="text-2xl font-bold text-encre">Experience AI</h1>
            <p className="text-sm text-brume mt-1">Transforme une envie en parcours</p>
          </div>

          {/* Onglets */}
          <div className="flex gap-1 p-1 bg-sable-dark rounded-xl mb-6" role="tablist">
            {(['connexion', 'inscription'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={onglet === t}
                onClick={() => { setOnglet(t); setErreur('') }}
                className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  onglet === t ? 'bg-white text-encre shadow-sm' : 'text-brume hover:text-encre'
                }`}
              >
                {t === 'connexion' ? 'Connexion' : 'Inscription'}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {onglet === 'inscription' && (
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
                autoComplete={onglet === 'connexion' ? 'current-password' : 'new-password'}
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
              : onglet === 'connexion' ? 'Se connecter' : 'Créer mon compte'}
          </button>

          <p className="text-center text-xs text-brume mt-4">
            <Link to="/" className="hover:text-encre transition-colors">← Retour à l'accueil</Link>
          </p>
        </form>
      </div>
    </PageLayout>
  )
}
