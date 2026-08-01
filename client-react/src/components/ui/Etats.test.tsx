// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EtatChargement, EtatErreur, EtatVide } from './Etats'

afterEach(cleanup)

describe('EtatChargement', () => {
  it('annonce le chargement au lecteur d’écran au lieu de le masquer', () => {
    render(<EtatChargement nombre={2} />)
    expect(screen.getByRole('status')).toHaveTextContent('Chargement en cours')
  })
})

describe('EtatVide', () => {
  it('ne porte pas role="alert" (ce n’est pas une erreur)', () => {
    render(<EtatVide titre="Aucun parcours pour l'instant" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText("Aucun parcours pour l'instant")).toBeInTheDocument()
  })
})

describe('EtatErreur', () => {
  it('affiche un titre générique par défaut, sans détail technique imposé', () => {
    render(<EtatErreur />)
    expect(screen.getByText('Une erreur est survenue')).toBeInTheDocument()
  })
})
