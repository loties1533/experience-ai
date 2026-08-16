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
  it('affiche « Vérifié » avec une provenance humaine (fournisseur + date), sans la source technique', () => {
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
    expect(badge).toHaveAttribute('title', expect.stringContaining('foursquare'))
    expect(badge).toHaveAttribute('title', expect.stringContaining('01/01/2026'))
    expect(badge.getAttribute('title') ?? '').not.toContain('Google Places')
    expect(badge.getAttribute('aria-label') ?? '').not.toContain('Google Places')
  })

  it('n’expose jamais l’URL technique de la source (ni texte, ni title, ni aria-label)', () => {
    const url = 'https://api.foursquare.com/v3/places/fsq-1'
    render(
      <BadgeConfiance
        element={elementAvecConfiance({
          niveau: 'verifie', source: url, fournisseur: 'Foursquare', recupereLe: '2026-01-01T00:00:00.000Z',
        })}
      />
    )
    const badge = screen.getByText('Vérifié')
    expect(screen.queryByText(url)).not.toBeInTheDocument()
    expect(badge.getAttribute('title') ?? '').not.toContain(url)
    expect(badge.getAttribute('aria-label') ?? '').not.toContain(url)
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
