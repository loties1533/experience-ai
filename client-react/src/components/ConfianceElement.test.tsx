// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Element } from '../../../server/domaine/parcours'
import { BadgeConfiance } from './ConfianceElement'

afterEach(cleanup)

// Fixture volontairement partielle : BadgeConfiance ne lit que `confiance`.
function elementAvecConfiance(confiance: Element['confiance']): Element {
  return { confiance } as unknown as Element
}

describe('BadgeConfiance (régression — mutualisé avec StatutMetier)', () => {
  it('affiche « Vérifié » avec la source et le fournisseur en détail', () => {
    render(
      <BadgeConfiance
        element={elementAvecConfiance({
          niveau: 'verifie',
          source: 'Google Places',
          fournisseur: 'foursquare',
          recupereLe: '2026-01-01T00:00:00.000Z',
        })}
      />
    )
    const badge = screen.getByText('Vérifié')
    expect(badge).toHaveAttribute('title', expect.stringContaining('Google Places'))
    expect(badge).toHaveAttribute('title', expect.stringContaining('foursquare'))
  })

  it('affiche « Estimé » sans détail de source', () => {
    render(<BadgeConfiance element={elementAvecConfiance({ niveau: 'estime' })} />)
    expect(screen.getByText('Estimé')).toBeInTheDocument()
  })

  it('affiche « Suggestion »', () => {
    render(<BadgeConfiance element={elementAvecConfiance({ niveau: 'suggestion' })} />)
    expect(screen.getByText('Suggestion')).toBeInTheDocument()
  })
})
