// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Bouton } from './Bouton'

afterEach(cleanup)

describe('Bouton', () => {
  it('est désactivé quand disabled est posé', () => {
    render(<Bouton disabled>Envoyer</Bouton>)
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled()
  })

  it('se désactive pendant le chargement et affiche le texte dédié', () => {
    render(<Bouton chargement texteChargement="Modification…">Modifier</Bouton>)
    const bouton = screen.getByRole('button', { name: 'Modification…' })
    expect(bouton).toBeDisabled()
    expect(bouton).toHaveAttribute('aria-busy', 'true')
  })

  it('reste focusable au clavier quand actif', () => {
    render(<Bouton>Envoyer</Bouton>)
    const bouton = screen.getByRole('button', { name: 'Envoyer' })
    expect(bouton).not.toBeDisabled()
    bouton.focus()
    expect(bouton).toHaveFocus()
  })
})
