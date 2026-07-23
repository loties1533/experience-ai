import { clsx } from 'clsx'
import React from 'react'

export { default as GenerationLoader } from './GenerationLoader'

// Squelette de chargement
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />
}

export function SkeletonCard() {
  return (
    <div className="glass rounded-sm p-5 space-y-3">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
    </div>
  )
}

// Tab bar
export function TabBar({ tabs, active, onChange }: { tabs: any[], active: string, onChange: (id: string) => void }) {
  return (
    <div className="overflow-x-auto scroll-hide -mx-1">
      <div className="flex gap-1 p-1 bg-parchment-dark rounded-sm min-w-max mx-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => onChange(t.id)}
            className={clsx('tab-btn flex items-center justify-center gap-1.5 whitespace-nowrap', active === t.id && 'active')}>
            {t.icon && <span>{t.icon}</span>}
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden text-[10px] font-bold uppercase tracking-tight">{t.label.slice(0, 4)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// En-tête de section
export function SectionTitle({ children, sub }: { children: React.ReactNode, sub?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-xl font-semibold text-ink">{children}</h3>
      {sub && <p className="text-sm text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

// Libellé lisible pour chaque mode de voyage
const MODE_LABELS: Record<string, string> = {
  party:    'Fête',
  student:  'Étudiant',
  group:    'Groupe',
  relax:    'Détente',
  surprise: 'Surprise',
}

// premium : niveau de prix (axe indépendant du mode) → badge accent en plus.
export function ModeBadge({ mode, premium }: { mode: string; premium?: boolean }) {
  const label = MODE_LABELS[mode] ?? mode
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center px-2.5 py-1 rounded-sm text-xs font-semibold bg-parchment-dark text-ink-light border border-gray-300">
        {label}
      </span>
      {premium && (
        <span className="inline-flex items-center px-2.5 py-1 rounded-sm text-xs font-semibold bg-gold/10 text-gold-dark">
          Premium
        </span>
      )}
    </span>
  )
}
