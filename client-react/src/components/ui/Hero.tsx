import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEnteteImmersive } from '../layout'

// Hero photographique immersif de l'accueil. Composant PUREMENT visuel :
// il fait défiler des ambiances derrière un contenu stable (titre, champ, chips
// fournis en `children`). Aucune logique métier ici — la logique produit reste
// dans Envie.tsx.
//
// Plusieurs expériences possibles passent derrière une seule question stable.
// Les images inspirent une envie ; elles ne prouvent aucune disponibilité.

export interface AmbianceHero {
  /** Nom de base du fichier dans public/assets/hero (sans suffixe de taille). */
  nom: string
  /** Description d'émotion — jamais un lieu présenté comme réel. */
  alt: string
  /** object-position desktop et mobile — évite de couper le sujet. */
  focusDesktop: string
  focusMobile: string
  /** Dimensions intrinsèques du repli JPEG (pour l'attribut width/height). */
  largeur: number
  hauteur: number
}

const DUREE = 7000 // ms entre deux ambiances
const FONDU = 700 // ms de crossfade

function prefereMouvementReduit() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function Hero({ ambiances, children }: { ambiances: AmbianceHero[]; children: ReactNode }) {
  const { setPhotoActive } = useEnteteImmersive()
  const [courant, setCourant] = useState(0)
  const [reduit, setReduit] = useState(prefereMouvementReduit)
  // Suivi du chargement réel, par ambiance : ce qui a chargé, ce qui a échoué.
  const [chargees, setChargees] = useState<Set<number>>(() => new Set())
  const [erreurs, setErreurs] = useState<Set<number>>(() => new Set())
  const minuterie = useRef<number | null>(null)

  // On ne monte l'<img> que dans une fenêtre glissante autour de l'ambiance
  // actuelle : la précédente (fondu sortant), l'actuelle et la suivante
  // (préchargée). Jamais les 7 d'un coup ; pas de flash au crossfade.
  const n = ambiances.length
  const estMontee = (i: number) =>
    i === courant || i === (courant + 1) % n || i === (courant - 1 + n) % n

  const marquerChargee = (i: number) =>
    setChargees((s) => (s.has(i) ? s : new Set(s).add(i)))
  const marquerErreur = (i: number) =>
    setErreurs((s) => (s.has(i) ? s : new Set(s).add(i)))

  // Le header n'est immersif que si la photo RÉELLEMENT VISIBLE est chargée.
  // Photo courante en erreur ou pas encore prête → repli honnête (header solide).
  useEffect(() => {
    setPhotoActive(chargees.has(courant))
  }, [courant, chargees, setPhotoActive])

  // Respecte le réglage système, y compris s'il change en cours de session.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const maj = () => setReduit(mq.matches)
    mq.addEventListener('change', maj)
    return () => mq.removeEventListener('change', maj)
  }, [])

  // Rotation automatique — suspendue si mouvement réduit, si une seule image, ou
  // si l'onglet est masqué (pas de diaporama qui tourne dans le vide).
  useEffect(() => {
    if (reduit || ambiances.length <= 1) return

    const demarrer = () => {
      if (minuterie.current !== null) return
      minuterie.current = window.setInterval(
        () => setCourant((c) => (c + 1) % ambiances.length),
        DUREE,
      )
    }
    const arreter = () => {
      if (minuterie.current !== null) {
        clearInterval(minuterie.current)
        minuterie.current = null
      }
    }
    const surVisibilite = () => (document.hidden ? arreter() : demarrer())

    demarrer()
    document.addEventListener('visibilitychange', surVisibilite)
    return () => {
      arreter()
      document.removeEventListener('visibilitychange', surVisibilite)
    }
  }, [reduit, ambiances.length])

  const allerA = (i: number) => {
    setCourant(i)
    // Relance le compte à rebours après une sélection manuelle.
    if (minuterie.current !== null) {
      clearInterval(minuterie.current)
      minuterie.current = null
      if (!reduit && !document.hidden && ambiances.length > 1) {
        minuterie.current = window.setInterval(
          () => setCourant((c) => (c + 1) % ambiances.length),
          DUREE,
        )
      }
    }
  }

  return (
    <section
      className="relative w-full overflow-hidden bg-encre
                 h-[66svh] min-h-[560px] max-h-[860px] md:h-[65vh]"
      aria-label="Accueil"
    >
      {/* Couches photographiques empilées : seule l'actuelle est opaque. */}
      <div className="absolute inset-0">
        {ambiances.map((a, i) => (
          <div
            key={a.nom}
            className="absolute inset-0 transition-opacity ease-out"
            style={{ opacity: i === courant ? 1 : 0, transitionDuration: `${FONDU}ms` }}
            aria-hidden={i === courant ? undefined : true}
          >
            {/* Image montée seulement dans la fenêtre glissante et si elle n'a pas
                échoué — une image cassée n'est jamais laissée visible. */}
            {estMontee(i) && !erreurs.has(i) && (
              <picture>
                <source
                  type="image/webp"
                  srcSet={`/assets/hero/${a.nom}-800.webp 800w, /assets/hero/${a.nom}-1600.webp 1600w`}
                  sizes="100vw"
                />
                <img
                  src={`/assets/hero/${a.nom}-1280.jpg`}
                  alt={i === courant ? a.alt : ''}
                  width={a.largeur}
                  height={a.hauteur}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  onLoad={() => marquerChargee(i)}
                  onError={() => marquerErreur(i)}
                  className={`hero-img w-full h-full object-cover ${!reduit && i === courant ? 'hero-zoom' : ''}`}
                  style={{ ['--focus-desktop' as string]: a.focusDesktop, ['--focus-mobile' as string]: a.focusMobile }}
                />
              </picture>
            )}
          </div>
        ))}
      </div>

      {/* Scrim haut (lisibilité du header) + dégradé bas (lisibilité du contenu). */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-encre/55 to-transparent" aria-hidden="true" />
      <div className="absolute inset-0 bg-gradient-to-t from-encre/85 via-encre/45 to-encre/25" aria-hidden="true" />

      {/* Contenu stable — ne change jamais pendant la rotation. */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center text-center conteneur-etroit pb-14 pt-20">
        {children}
      </div>

      {/* Indicateurs : petits traits, mais chaque bouton offre une cible ≈ 44px. */}
      {ambiances.length > 1 && (
        <div className="absolute bottom-4 inset-x-0 z-10 flex justify-center gap-1" role="group" aria-label="Choisir l'ambiance">
          {ambiances.map((a, i) => (
            <button
              key={a.nom}
              type="button"
              onClick={() => allerA(i)}
              aria-label={`Ambiance ${i + 1} sur ${ambiances.length}`}
              aria-current={i === courant ? 'true' : undefined}
              className="group grid place-items-center w-11 h-11 cursor-pointer"
            >
              <span
                className={`block h-[3px] rounded-full transition-all duration-500 ${
                  i === courant ? 'w-7 bg-laiton' : 'w-3 bg-ivoire/50 group-hover:bg-ivoire/80'
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
