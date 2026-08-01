import type { ReactNode } from 'react'
import { clsx } from 'clsx'

// États réutilisables (loading/empty/error) — évite que chaque écran réinvente
// son propre bloc « aucun résultat » ou son propre squelette. Les statuts
// indisponible/refus vivent dans StatutMetier.tsx (bandeau dédié, pas ce bloc).

function BlocEtat({
  titre, description, action, children,
}: { titre: string; description?: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="carte p-10 text-center">
      <p className="font-heading font-semibold text-encre text-lg">{titre}</p>
      {description && <p className="text-brume text-sm mt-1">{description}</p>}
      {children}
      {action && <div className="mt-4 inline-block">{action}</div>}
    </div>
  )
}

/** Liste ou résultat vide — pas une erreur, juste rien à montrer pour l'instant. */
export function EtatVide({
  titre, description, action,
}: { titre: string; description?: string; action?: ReactNode }) {
  return <BlocEtat titre={titre} description={description} action={action} />
}

/** Échec générique (ressource introuvable, erreur inattendue) — distinct du refus/indisponible métier. */
export function EtatErreur({
  titre = 'Une erreur est survenue', description, action,
}: { titre?: string; description?: string; action?: ReactNode }) {
  return <BlocEtat titre={titre} description={description} action={action} />
}

/** Squelette de chargement pour une liste de blocs (cartes, lignes de résultat). */
export function EtatChargement({ nombre = 3, hauteur = 'h-20' }: { nombre?: number; hauteur?: string }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">Chargement en cours</span>
      {Array.from({ length: nombre }, (_, i) => (
        <div key={i} className={clsx('skeleton', hauteur)} aria-hidden="true" />
      ))}
    </div>
  )
}
