// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ImageContextuelle } from './ImageContextuelle'

afterEach(cleanup)

describe('ImageContextuelle', () => {
  it('affiche le repli graphique quand aucune source n’est fournie', () => {
    render(<ImageContextuelle alt="Vue du parcours" ratio="carte" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('affiche l’image avec son alt quand une source est fournie', () => {
    render(<ImageContextuelle src="/assets/moment-plage.jpg" alt="Coucher de soleil sur la plage" ratio="hero" />)
    const image = screen.getByRole('img', { name: 'Coucher de soleil sur la plage' })
    expect(image).toHaveAttribute('src', '/assets/moment-plage.jpg')
    expect(image).toHaveAttribute('loading', 'lazy')
  })

  it('charge en priorité (eager) quand demandé', () => {
    render(<ImageContextuelle src="/assets/hero-accueil.jpg" alt="Bande éditoriale d’accueil" ratio="hero" prioritaire />)
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'eager')
  })
})
