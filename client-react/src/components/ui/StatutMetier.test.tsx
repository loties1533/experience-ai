// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BadgeStatutMetier, BanniereStatutMetier, PRESENTATION_STATUT } from './StatutMetier'

afterEach(cleanup)

describe('BadgeStatutMetier', () => {
  it.each([
    ['verifie', 'Vérifié'],
    ['estime', 'Estimé'],
    ['suggestion', 'Suggestion'],
    ['indisponible', 'Indisponible'],
    ['refus', 'Refus'],
  ] as const)('affiche le libellé du statut %s', (statut, libelle) => {
    render(<BadgeStatutMetier statut={statut} />)
    expect(screen.getByText(libelle)).toBeInTheDocument()
  })

  it('ne rend jamais suggestion avec la même classe que vérifié (ADR-0008)', () => {
    expect(PRESENTATION_STATUT.suggestion.classeBadge).not.toBe(PRESENTATION_STATUT.verifie.classeBadge)
  })

  it('accepte un libellé et un détail personnalisés', () => {
    render(<BadgeStatutMetier statut="estime" texte="Prix estimé" detail="~120€, à confirmer" />)
    const badge = screen.getByText('Prix estimé')
    expect(badge).toHaveAttribute('title', '~120€, à confirmer')
  })
})

describe('BanniereStatutMetier', () => {
  it('rend le refus avec role="alert" (assertif — décision produit)', () => {
    render(<BanniereStatutMetier statut="refus">Impossible de construire ce parcours.</BanniereStatutMetier>)
    const banniere = screen.getByRole('alert')
    expect(banniere).toHaveTextContent('Impossible de construire ce parcours.')
  })

  it('rend l’indisponibilité avec role="status" (transitoire — réessai possible)', () => {
    render(<BanniereStatutMetier statut="indisponible">Réessaie dans un instant.</BanniereStatutMetier>)
    expect(screen.getByRole('status')).toHaveTextContent('Réessaie dans un instant.')
  })

  it('affiche l’action fournie', () => {
    render(
      <BanniereStatutMetier statut="refus" action={<button>Reformuler</button>}>
        Détail du refus
      </BanniereStatutMetier>
    )
    expect(screen.getByRole('button', { name: 'Reformuler' })).toBeInTheDocument()
  })
})
