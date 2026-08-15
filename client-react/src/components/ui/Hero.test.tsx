// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hero, type AmbianceHero } from './Hero'

const AMBIANCES: AmbianceHero[] = [
  { nom: 'a-un',    alt: 'Première ambiance', focusDesktop: 'center', focusMobile: 'center', largeur: 1280, hauteur: 853 },
  { nom: 'a-deux',  alt: 'Deuxième ambiance', focusDesktop: 'center', focusMobile: 'center', largeur: 1280, hauteur: 853 },
  { nom: 'a-trois', alt: 'Troisième ambiance', focusDesktop: 'center', focusMobile: 'center', largeur: 1280, hauteur: 853 },
]

// matchMedia est absent de jsdom : on le simule pour piloter prefers-reduced-motion.
function simulerMouvement({ reduit }: { reduit: boolean }) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? reduit : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

const indicateurs = () => within(screen.getByRole('group', { name: /choisir l'ambiance/i })).getAllByRole('button')

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

describe('Hero', () => {
  beforeEach(() => simulerMouvement({ reduit: false }))

  it('rend le contenu stable fourni en children', () => {
    render(<Hero ambiances={AMBIANCES}><h1>Qu'as-tu envie de vivre&nbsp;?</h1></Hero>)
    expect(screen.getByRole('heading', { name: /qu'as-tu envie de vivre/i })).toBeInTheDocument()
  })

  it('affiche la première ambiance avec son alt d’émotion', () => {
    render(<Hero ambiances={AMBIANCES}><span>contenu</span></Hero>)
    expect(screen.getByRole('img', { name: 'Première ambiance' })).toBeInTheDocument()
  })

  it('expose un indicateur cliquable par ambiance, le premier étant actif', () => {
    render(<Hero ambiances={AMBIANCES}><span>contenu</span></Hero>)
    const points = indicateurs()
    expect(points).toHaveLength(AMBIANCES.length)
    expect(points[0]).toHaveAttribute('aria-current', 'true')
    expect(points[1]).not.toHaveAttribute('aria-current')
  })

  it('change d’ambiance au clic sur un indicateur', () => {
    render(<Hero ambiances={AMBIANCES}><span>contenu</span></Hero>)
    fireEvent.click(indicateurs()[2])
    const points = indicateurs()
    expect(points[2]).toHaveAttribute('aria-current', 'true')
    expect(points[0]).not.toHaveAttribute('aria-current')
  })

  it('fait défiler automatiquement les ambiances au fil du temps', () => {
    vi.useFakeTimers()
    render(<Hero ambiances={AMBIANCES}><span>contenu</span></Hero>)
    expect(indicateurs()[0]).toHaveAttribute('aria-current', 'true')
    act(() => { vi.advanceTimersByTime(7000) })
    expect(indicateurs()[1]).toHaveAttribute('aria-current', 'true')
  })

  it('ne défile pas automatiquement quand le mouvement réduit est demandé', () => {
    simulerMouvement({ reduit: true })
    vi.useFakeTimers()
    render(<Hero ambiances={AMBIANCES}><span>contenu</span></Hero>)
    act(() => { vi.advanceTimersByTime(14000) })
    // Première ambiance toujours affichée : aucune rotation.
    expect(indicateurs()[0]).toHaveAttribute('aria-current', 'true')
  })
})
