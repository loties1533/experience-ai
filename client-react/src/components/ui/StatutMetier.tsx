import { clsx } from 'clsx'
import type { ReactNode } from 'react'

// Source unique des cinq statuts métier du produit (ADR-0008 + doc 15 §7).
// `verifie`/`estime`/`suggestion` qualifient une donnée ; `indisponible`/`refus`
// qualifient le résultat d'une opération. Les deux familles partagent ici la
// même palette pour rester visuellement cohérentes, mais chaque composant
// consommateur garde sa propre logique (voir ConfianceElement.tsx).
export type StatutMetier = 'verifie' | 'estime' | 'suggestion' | 'indisponible' | 'refus'

interface PresentationStatut {
  libelle: string
  classeBadge: string
  classeBanniere: string
  descriptionParDefaut: string
  icone: (props: { className?: string }) => JSX.Element
}

function IconeCoche({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
function IconeApprox({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" aria-hidden="true" className={className}>
      <path d="M4 12c1.5-3 3.5-3 5 0s3.5 3 5 0 3.5-3 5 0" />
    </svg>
  )
}
function IconeAmpoule({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M9 18h6M10 22h4M12 2a6 6 0 0 0-4 10.5c.7.6 1 1.4 1 2.5h6c0-1.1.3-1.9 1-2.5A6 6 0 0 0 12 2Z" />
    </svg>
  )
}
function IconeHorloge({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}
function IconeRefus({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  )
}

export const PRESENTATION_STATUT: Record<StatutMetier, PresentationStatut> = {
  verifie: {
    libelle: 'Vérifié',
    classeBadge: 'bg-sauge/10 text-sauge-dark',
    classeBanniere: 'border-sauge/30 bg-sauge/5 text-sauge-dark',
    descriptionParDefaut: 'Donnée confirmée par une source vérifiée.',
    icone: IconeCoche,
  },
  estime: {
    libelle: 'Estimé',
    classeBadge: 'bg-laiton/10 text-laiton-dark',
    classeBanniere: 'border-laiton/30 bg-laiton/5 text-laiton-dark',
    descriptionParDefaut: 'Information approximative, à confirmer.',
    icone: IconeApprox,
  },
  suggestion: {
    // Volontairement le moins saillant des cinq : jamais aussi visible que
    // « vérifié » (règle non négociable, doc 15 §7 / ADR-0008).
    libelle: 'Suggestion',
    classeBadge: 'bg-encre/5 text-brume',
    classeBanniere: 'border-encre/10 bg-encre/[0.03] text-brume',
    descriptionParDefaut: 'Idée générique, aucun établissement précis n’est confirmé.',
    icone: IconeAmpoule,
  },
  indisponible: {
    // Panne technique passagère (503) — ton neutre, jamais alarmant : ce n'est
    // pas un refus produit, juste un fournisseur momentanément injoignable.
    libelle: 'Indisponible',
    classeBadge: 'bg-brume/10 text-brume',
    classeBanniere: 'border-brume/30 bg-brume/5 text-encre',
    descriptionParDefaut: 'Service temporairement indisponible. Réessaie dans un instant.',
    icone: IconeHorloge,
  },
  refus: {
    // Refus honnête (422) — résultat métier assumé, pas une erreur technique
    // rouge classique : on explique pourquoi et on invite à reformuler.
    libelle: 'Refus',
    classeBadge: 'bg-corail/10 text-corail',
    classeBanniere: 'border-corail/30 bg-corail/5 text-corail',
    descriptionParDefaut: 'Cette demande ne peut pas être honnêtement construite en l’état.',
    icone: IconeRefus,
  },
}

/** Badge compact : élément de parcours, ligne de statut. */
export function BadgeStatutMetier({
  statut, texte, detail,
}: { statut: StatutMetier; texte?: string; detail?: string }) {
  const presentation = PRESENTATION_STATUT[statut]
  const libelle = texte ?? presentation.libelle
  const description = detail ?? presentation.descriptionParDefaut
  return (
    <span
      className={clsx('badge-statut', presentation.classeBadge)}
      title={description}
      aria-label={`${libelle}. ${description}`}
    >
      <presentation.icone className="shrink-0" />
      {libelle}
    </span>
  )
}

/**
 * Bandeau plein bloc : résultat d'une opération entière (génération, dialogue,
 * modification), pas d'un simple élément. `indisponible` reste discret
 * (aria-live="polite", réessai possible) ; `refus` est plus affirmé
 * (role="alert") car c'est une décision produit définitive tant qu'on ne
 * reformule pas.
 */
export function BanniereStatutMetier({
  statut, titre, children, action,
}: { statut: 'indisponible' | 'refus'; titre?: string; children: ReactNode; action?: ReactNode }) {
  const presentation = PRESENTATION_STATUT[statut]
  return (
    <div
      role={statut === 'refus' ? 'alert' : 'status'}
      aria-live={statut === 'refus' ? 'assertive' : 'polite'}
      className={clsx('rounded-xl border p-4', presentation.classeBanniere)}
    >
      <div className="flex items-start gap-3">
        <presentation.icone className="shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <p className="font-heading font-semibold">{titre ?? presentation.libelle}</p>
          <div className="text-sm mt-1 opacity-90">{children}</div>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  )
}
