import { Link, useLocation } from 'react-router-dom'
import { createContext, useContext, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore, useDialogueStore } from '../../store'
import { logout } from '../../lib/api'
import Logo from '../ui/Logo'

const LIENS = [
  { vers: '/', libelle: 'Créer' },
  { vers: '/parcours', libelle: 'Mes parcours' },
  { vers: '/preferences', libelle: 'Préférences', authRequise: true },
]

// Contexte d'en-tête immersive : coordonne le header (dans le layout) et le hero
// (dans la page). Le mode transparent n'existe QUE si la page est immersive ET
// qu'une vraie photographie est réellement chargée — jamais au-dessus du repli.
interface EnteteImmersive {
  immersif: boolean
  photoActive: boolean
  setPhotoActive: (v: boolean) => void
}
export const EnteteContext = createContext<EnteteImmersive>({
  immersif: false,
  photoActive: false,
  setPhotoActive: () => {},
})
export function useEnteteImmersive() {
  return useContext(EnteteContext)
}

export function Header() {
  const { user, clearAuth } = useAuthStore()
  const { reinitialiser } = useDialogueStore()
  const { immersif, photoActive } = useEnteteImmersive()
  const [menuOuvert, setMenuOuvert] = useState(false)
  const [defile, setDefile] = useState(false)
  const queryClient = useQueryClient()
  const emplacement = useLocation()

  // Le header devient solide dès que le hero est largement dépassé.
  useEffect(() => {
    if (!immersif) return
    let brut = 0
    const surScroll = () => {
      if (brut) return
      brut = requestAnimationFrame(() => {
        setDefile(window.scrollY > window.innerHeight * 0.6)
        brut = 0
      })
    }
    surScroll()
    window.addEventListener('scroll', surScroll, { passive: true })
    return () => window.removeEventListener('scroll', surScroll)
  }, [immersif])

  // Transparent uniquement sur une page immersive, avec photo chargée, en haut.
  const transparent = immersif && photoActive && !defile

  const gererDeconnexion = async () => {
    try { await logout() } catch { /* on déconnecte en local même si l'appel serveur échoue */ }
    clearAuth()
    reinitialiser()
    queryClient.clear() // le compte suivant ne voit jamais les données du précédent
    setMenuOuvert(false)
  }

  const classeLien = (vers: string, mobile = false) => {
    const actif = emplacement.pathname === vers
    if (mobile) {
      return `px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
        actif ? 'text-encre bg-sable/60' : 'text-brume hover:text-encre hover:bg-sable/40'
      }`
    }
    const base = 'px-1 py-1 text-sm font-medium border-b-2 transition-colors'
    if (transparent) {
      return `${base} ${actif ? 'border-laiton text-white' : 'border-transparent text-ivoire/85 hover:text-white'}`
    }
    return `${base} ${actif ? 'border-laiton text-encre' : 'border-transparent text-brume hover:text-encre'}`
  }

  return (
    <header
      className={`fixed top-0 inset-x-0 z-40 transition-colors duration-200 ${
        transparent
          ? 'bg-transparent'
          : 'bg-ivoire/95 backdrop-blur-md border-b border-sable shadow-[0_1px_0_rgba(46,36,27,0.04)]'
      }`}
    >
      <div className="conteneur h-16 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2.5" onClick={() => setMenuOuvert(false)}>
          <Logo size={38} className="text-laiton" />
          <div className="flex flex-col">
            <span className={`font-heading font-semibold text-xl leading-none tracking-tight ${transparent ? 'text-white' : 'text-encre'}`}>
              Experience AI
            </span>
            <span className={`hidden sm:block text-[10px] font-bold uppercase tracking-widest mt-1 whitespace-nowrap ${transparent ? 'text-ivoire/80' : 'text-laiton-dark'}`}>
              Qu'as-tu envie de vivre ?
            </span>
          </div>
        </Link>

        {/* Navigation — bureau : liens sobres, actif souligné laiton (plus de capsule) */}
        <nav className="hidden md:flex items-center gap-6">
          {LIENS.filter((l) => !l.authRequise || user).map((l) => (
            <Link key={l.vers} to={l.vers} className={classeLien(l.vers)}>
              {l.libelle}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <div className={`hidden md:flex items-center gap-3 pl-3 border-l ${transparent ? 'border-ivoire/30' : 'border-sable'}`}>
              <span className={`text-xs font-semibold ${transparent ? 'text-white' : 'text-encre'}`}>{user.name ?? user.email}</span>
              <button
                onClick={gererDeconnexion}
                aria-label="Déconnexion"
                className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
                  transparent
                    ? 'text-white border-ivoire/40 hover:bg-white/10'
                    : 'text-corail border-corail/25 hover:bg-corail hover:text-white'
                }`}
              >
                <IconeDeconnexion />
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className={`hidden md:inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                transparent
                  ? 'text-white border-ivoire/50 hover:bg-white/10'
                  : 'text-encre border-sable hover:border-laiton'
              }`}
            >
              Connexion
            </Link>
          )}

          <button
            onClick={() => setMenuOuvert((o) => !o)}
            className={`md:hidden w-10 h-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
              transparent ? 'text-white border-ivoire/40 hover:bg-white/10' : 'text-encre border-sable hover:bg-sable/50'
            }`}
            aria-label="Menu"
            aria-expanded={menuOuvert}
          >
            <IconeMenu ouvert={menuOuvert} />
          </button>
        </div>
      </div>

      {/* Menu mobile — surface ivoire pleine, jamais transparent sur la photo */}
      {menuOuvert && (
        <div className="md:hidden bg-ivoire border-t border-sable">
          <nav className="flex flex-col gap-1 p-4">
            {LIENS.filter((l) => !l.authRequise || user).map((l) => (
              <Link key={l.vers} to={l.vers} onClick={() => setMenuOuvert(false)} className={classeLien(l.vers, true)}>
                {l.libelle}
              </Link>
            ))}
            <div className="h-px bg-sable my-1" />
            {user ? (
              <button
                onClick={gererDeconnexion}
                className="px-4 py-3 rounded-xl text-sm font-medium text-corail hover:bg-corail/10 transition-colors text-left cursor-pointer"
              >
                Déconnexion
              </button>
            ) : (
              <Link to="/login" onClick={() => setMenuOuvert(false)}
                className="px-4 py-3 rounded-xl text-sm font-bold bg-terracotta-dark text-white text-center">
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

/**
 * `heroImmersif` : la page fournit un hero photographique plein-cadre. Le header
 * peut alors passer en mode transparent (si une vraie photo se charge) et le
 * contenu démarre sous le header. Toute autre page reste en header solide ivoire
 * dès le premier rendu, sans padding négatif ni flash.
 */
export function PageLayout({
  children,
  piedDePage = true,
  heroImmersif = false,
}: {
  children: React.ReactNode
  piedDePage?: boolean
  heroImmersif?: boolean
}) {
  const [photoActive, setPhotoActive] = useState(false)

  return (
    <EnteteContext.Provider value={{ immersif: heroImmersif, photoActive, setPhotoActive }}>
      <div className="min-h-screen aurora">
        <Header />
        {heroImmersif ? (
          <main className="relative z-10">{children}</main>
        ) : (
          <main className="conteneur pt-20 pb-10 relative z-10">{children}</main>
        )}
        {piedDePage && (
          <footer className="mt-24 border-t border-sable bg-creme">
            <div className="conteneur py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Logo size={28} className="text-laiton" />
                <span className="font-heading font-semibold text-encre">Experience AI</span>
              </div>
              <p className="text-brume text-sm text-center sm:text-left max-w-md">
                Une envie, un contexte — et un parcours cohérent de moments, modifiable élément par élément.
              </p>
              <p className="text-brume text-xs">© 2026 Experience AI</p>
            </div>
          </footer>
        )}
      </div>
    </EnteteContext.Provider>
  )
}
