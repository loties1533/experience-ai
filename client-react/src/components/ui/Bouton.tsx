import { clsx } from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

type VarianteBouton = 'principal' | 'secondaire' | 'discret' | 'danger'

const CLASSES_VARIANTE: Record<VarianteBouton, string> = {
  // Réutilise les classes .btn-primaire/.btn-secondaire déjà posées dans
  // index.css — ce composant standardise seulement le loading/disabled et
  // ajoute les variantes manquantes (discret, danger).
  principal: 'btn-primaire',
  secondaire: 'btn-secondaire',
  discret:
    'text-encre hover:bg-encre/5 font-medium px-4 py-2 rounded-xl transition duration-150 cursor-pointer ' +
    'motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'border border-corail/30 text-corail hover:bg-corail hover:text-white hover:border-corail ' +
    'font-medium px-4 py-2 rounded-xl transition duration-150 cursor-pointer ' +
    'motion-safe:active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed',
}

interface ProprietesBouton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBouton
  chargement?: boolean
  texteChargement?: string
}

export function Bouton({
  variante = 'principal',
  chargement = false,
  texteChargement,
  disabled,
  className,
  children,
  ...reste
}: ProprietesBouton) {
  return (
    <button
      className={clsx(CLASSES_VARIANTE[variante], 'inline-flex items-center justify-center gap-2', className)}
      disabled={disabled || chargement}
      aria-busy={chargement || undefined}
      {...reste}
    >
      {chargement && <SablierChargement />}
      {chargement && texteChargement ? texteChargement : children}
    </button>
  )
}

function SablierChargement() {
  return (
    <svg
      className="motion-safe:animate-spin shrink-0"
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  )
}
