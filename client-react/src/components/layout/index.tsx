import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore, useDialogueStore } from '../../store'
import { logout } from '../../lib/api'
import Logo from '../ui/Logo'

const LIENS = [
  { vers: '/', libelle: 'Créer' },
  { vers: '/parcours', libelle: 'Mes parcours' },
  { vers: '/preferences', libelle: 'Préférences', authRequise: true },
]

export function Header() {
  const { user, clearAuth } = useAuthStore()
  const { reinitialiser } = useDialogueStore()
  const [menuOuvert, setMenuOuvert] = useState(false)
  const queryClient = useQueryClient()
  const emplacement = useLocation()

  const gererDeconnexion = async () => {
    try { await logout() } catch { /* on déconnecte en local même si l'appel serveur échoue */ }
    clearAuth()
    reinitialiser()
    queryClient.clear() // le compte suivant ne voit jamais les données du précédent
    setMenuOuvert(false)
  }

  const classeLien = (vers: string, mobile = false) =>
    `${mobile ? 'px-4 py-3' : 'px-4 py-1.5'} rounded-xl text-sm font-medium transition-colors ${
      emplacement.pathname === vers
        ? 'text-white bg-soleil'
        : 'text-brume hover:text-encre hover:bg-sable-dark'
    }`

  return (
    <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-md border-b border-encre/10">
      <div className="conteneur h-16 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2.5" onClick={() => setMenuOuvert(false)}>
          <Logo size={40} className="text-soleil" />
          <div className="flex flex-col">
            <span className="font-heading font-bold text-encre text-xl leading-none tracking-tight">Experience AI</span>
            <span className="hidden sm:block text-[10px] text-lagon-dark font-bold uppercase tracking-widest mt-1">Qu'as-tu envie de vivre ?</span>
          </div>
        </Link>

        {/* Navigation — bureau */}
        <nav className="hidden sm:flex items-center gap-1 bg-sable-dark/60 p-1 rounded-xl">
          {LIENS.filter((l) => !l.authRequise || user).map((l) => (
            <Link key={l.vers} to={l.vers} className={classeLien(l.vers)}>
              {l.libelle}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {user ? (
            <div className="hidden sm:flex items-center gap-3 pl-3 border-l border-encre/10">
              <span className="text-xs font-semibold text-encre">{user.name ?? user.email}</span>
              <button
                onClick={gererDeconnexion}
                aria-label="Déconnexion"
                className="w-9 h-9 rounded-xl bg-corail/10 text-corail border border-corail/20
                           hover:bg-corail hover:text-white transition-colors flex items-center justify-center cursor-pointer"
              >
                <IconeDeconnexion />
              </button>
            </div>
          ) : (
            <Link to="/login" className="hidden sm:inline-flex btn-primaire text-sm px-5 py-2">
              Connexion
            </Link>
          )}

          <button
            onClick={() => setMenuOuvert((o) => !o)}
            className="sm:hidden w-9 h-9 rounded-xl bg-sable-dark border border-encre/10
                       flex items-center justify-center text-brume hover:text-encre transition-colors cursor-pointer"
            aria-label="Menu"
          >
            <IconeMenu ouvert={menuOuvert} />
          </button>
        </div>
      </div>

      {/* Menu mobile */}
      {menuOuvert && (
        <div className="sm:hidden bg-white/95 backdrop-blur-md border-t border-encre/10">
          <nav className="flex flex-col gap-1 p-4">
            {LIENS.filter((l) => !l.authRequise || user).map((l) => (
              <Link key={l.vers} to={l.vers} onClick={() => setMenuOuvert(false)} className={classeLien(l.vers, true)}>
                {l.libelle}
              </Link>
            ))}
            <div className="h-px bg-encre/10 my-1" />
            {user ? (
              <button
                onClick={gererDeconnexion}
                className="px-4 py-3 rounded-xl text-sm font-medium text-corail hover:bg-corail/10 transition-colors text-left cursor-pointer"
              >
                Déconnexion
              </button>
            ) : (
              <Link to="/login" onClick={() => setMenuOuvert(false)}
                className="px-4 py-3 rounded-xl text-sm font-bold bg-soleil text-white text-center">
                Connexion
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}

function IconeDeconnexion() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function IconeMenu({ ouvert }: { ouvert: boolean }) {
  return ouvert ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

export function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen aurora">
      <Header />
      <main className="conteneur py-6 relative z-10">{children}</main>
      <footer className="mt-24 border-t border-encre/10 bg-sable-dark/60">
        <div className="conteneur py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Logo size={28} className="text-soleil" />
            <span className="font-heading font-bold text-encre">Experience AI</span>
          </div>
          <p className="text-brume text-sm text-center sm:text-left max-w-md">
            Une envie, un contexte — et un parcours cohérent de moments, modifiable élément par élément.
          </p>
          <p className="text-brume text-xs">© 2026 Experience AI</p>
        </div>
      </footer>
    </div>
  )
}
