import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../store'
import { logout } from '../../lib/api'
import Logo from '../ui/Logo'

export function Header() {
  const { user, clearAuth } = useAuthStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const queryClient = useQueryClient()

  const gererDeconnexion = async () => {
    try { await logout() } catch { /* on déconnecte en local même si l'appel serveur échoue */ }
    clearAuth()
    queryClient.clear() // Vide le cache React Query : le compte suivant ne voit jamais les données du précédent
    setMenuOpen(false)
  }
  const emplacement = useLocation()

  return (
    <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-md border-b border-gold/10">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 group" onClick={() => setMenuOpen(false)}>
          <Logo size={40} className="text-gold-dark" />
          <div className="flex flex-col">
            <span className="font-bold text-ink text-xl leading-none tracking-tight">TripGenie</span>
            <span className="hidden sm:block text-[10px] text-gold-dark font-bold uppercase tracking-widest mt-1">Voyages sur-mesure</span>
          </div>
        </Link>

        {/* Navigation — bureau */}
        <nav className="hidden sm:flex items-center bg-parchment-dark/50 p-1 rounded-sm border border-gold/10">
          <Link to="/"
            className={`px-4 py-1.5 rounded-sm text-sm font-medium transition-all
              ${emplacement.pathname === '/'
                ? 'text-ink bg-white shadow-sm'
                : 'text-muted hover:text-ink'
              }`}>
            Accueil
          </Link>
          <Link to="/trips"
            className={`px-4 py-1.5 rounded-sm text-sm font-bold transition-all flex items-center gap-2
              ${emplacement.pathname === '/trips'
                ? 'text-ink bg-gold'
                : 'text-ink hover:bg-gold/10'
              }`}>
            Mes voyages
          </Link>
          {user && (
            <Link to="/preferences"
              className={`px-4 py-1.5 rounded-sm text-sm font-medium transition-all
                ${emplacement.pathname === '/preferences'
                  ? 'text-ink bg-white shadow-sm'
                  : 'text-muted hover:text-ink'
                }`}>
              Préférences
            </Link>
          )}
        </nav>

        {/* Actions à droite */}
        <div className="flex items-center gap-2">
          {/* Actions utilisateur — bureau */}
          {user
            ? <div className="hidden sm:flex items-center gap-3 pl-3 border-l border-gold/20">
                <div className="flex flex-col items-end">
                  <span className="text-xs font-semibold text-ink leading-none">{user.name}</span>
                  <span className="text-[10px] text-muted mt-0.5">Membre</span>
                </div>
                <button onClick={gererDeconnexion}
                  className="w-9 h-9 rounded-sm bg-coral/10 text-coral border border-coral/20 
                             hover:bg-coral hover:text-white transition-all flex items-center justify-center group">
                  <IconeDeconnexion />
                </button>
              </div>
            : <Link to="/login" className="hidden sm:inline-flex btn-primary text-sm px-5 py-2">
                Connexion
              </Link>
          }

          {/* Menu hamburger — mobile uniquement */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="sm:hidden w-9 h-9 rounded-sm bg-parchment-dark border border-gold/10
                       flex items-center justify-center text-muted hover:text-gold-dark transition-colors"
            aria-label="Menu"
          >
            <span className="text-lg">{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>

      {/* Menu déroulant mobile */}
      
        {menuOpen && (
          <div
            className="sm:hidden overflow-hidden bg-white/95 backdrop-blur-md border-t border-gold/10"
          >
            <nav className="flex flex-col gap-1 p-4">
              <Link to="/" onClick={() => setMenuOpen(false)}
                className={`px-4 py-3 rounded-sm text-sm font-medium transition-all ${emplacement.pathname === '/' ? 'bg-gold/10 text-gold-dark' : 'text-muted hover:text-ink'}`}>
                Accueil
              </Link>
              <Link to="/trips" onClick={() => setMenuOpen(false)}
                className={`px-4 py-3 rounded-sm text-sm font-bold transition-all flex items-center gap-2 ${emplacement.pathname === '/trips' ? 'bg-gold text-ink' : 'text-ink hover:bg-gold/10'}`}>
                Mes voyages
              </Link>
              {user && (
                <Link to="/preferences" onClick={() => setMenuOpen(false)}
                  className={`px-4 py-3 rounded-sm text-sm font-medium transition-all flex items-center gap-2 ${emplacement.pathname === '/preferences' ? 'bg-gold/10 text-gold-dark' : 'text-muted hover:text-ink'}`}>
                  Préférences
                </Link>
              )}
              <div className="h-px bg-gold/10 my-1" />
              {user
                ? <>
                    <div className="px-4 py-2 text-xs text-muted">Connecté en tant que <span className="font-semibold text-ink">{user.name}</span></div>
                    <button onClick={gererDeconnexion}
                      className="px-4 py-3 rounded-sm text-sm font-medium text-coral hover:bg-coral/10 transition-all text-left">
                      Déconnexion
                    </button>
                  </>
                : <Link to="/login" onClick={() => setMenuOpen(false)}
                    className="px-4 py-3 rounded-sm text-sm font-bold bg-gold text-ink text-center transition-all">
                    Connexion
                  </Link>
              }
            </nav>
          </div>
        )}
      
    </header>
  )
}

function IconeDeconnexion() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6 relative z-10">
        {children}
      </main>

      {/* Pied de page */}
      <footer className="mt-24 border-t border-gray-200 bg-parchment-dark">
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Logo size={28} className="text-gold-dark" />
            <span className="font-bold text-ink">TripGenie</span>
          </div>
          <p className="text-muted text-sm text-center sm:text-left max-w-md">
            Décrivez votre voyage, on s'occupe des détails : destinations, vols, hébergement et budget.
          </p>
          <p className="text-muted text-xs">© 2026 TripGenie</p>
        </div>
      </footer>
    </div>
  )
}
