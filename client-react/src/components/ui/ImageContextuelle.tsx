import { clsx } from 'clsx'

// Composant unique pour toute photographie du produit (doc 15 §8). Aucune
// vraie photo n'est encore disponible dans le dépôt à ce stade (UI-C) : tant
// qu'un fichier n'est pas déposé dans `public/assets/`, `src` reste undefined
// et le repli graphique s'affiche — jamais une image cassée, jamais un
// rectangle gris.

type RatioImage = 'hero' | 'carte' | 'vignette'

const CLASSES_RATIO: Record<RatioImage, string> = {
  hero: 'aspect-[21/9]',
  carte: 'aspect-[4/3]',
  vignette: 'aspect-square',
}

interface ProprietesImageContextuelle {
  src?: string
  alt: string
  ratio: RatioImage
  prioritaire?: boolean
  className?: string
  objectPosition?: string
}

export function ImageContextuelle({
  src, alt, ratio, prioritaire = false, className, objectPosition,
}: ProprietesImageContextuelle) {
  return (
    <div className={clsx('relative overflow-hidden rounded-xl', CLASSES_RATIO[ratio], className)}>
      {src ? (
        <img
          src={src}
          alt={alt}
          loading={prioritaire ? 'eager' : 'lazy'}
          style={objectPosition ? { objectPosition } : undefined}
          className="w-full h-full object-cover"
        />
      ) : (
        <RepliGraphique />
      )}
    </div>
  )
}

/** Repli sobre : dégradé de surface, jamais une photo générée ni un placeholder gris. */
function RepliGraphique() {
  return (
    <div
      className="w-full h-full bg-gradient-to-br from-terracotta/15 via-sable-dark to-laiton/10"
      aria-hidden="true"
    >
      <svg className="w-full h-full opacity-[0.15]" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M0 70 Q 25 40 50 60 T 100 45" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-encre" />
        <path d="M0 85 Q 30 60 55 78 T 100 65" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-encre" />
      </svg>
    </div>
  )
}
