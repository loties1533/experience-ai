import { clsx } from 'clsx'

// Squelette de chargement — réserve la place du contenu (évite le saut de mise en page).
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />
}
