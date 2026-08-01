// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BlocBudget } from './ParcoursDetail'
import type { Parcours } from '../lib/api'

afterEach(cleanup)

function parcoursDeBase(overrides: Partial<Parcours['budget']> = {}, prixElement?: { prix?: number; prixEstime?: boolean }): Parcours {
  return {
    id: 'p1',
    intention: { texte: 'Un week-end au vert', motsCles: [] },
    contexte: { avecQui: 'couple', duree: { valeur: 2, unite: 'jours' }, lieux: [] },
    budget: { mode: 'individuel', devise: 'EUR', ...overrides },
    ambiance: undefined,
    visibilite: 'prive',
    participants: [],
    timeline: prixElement
      ? [{
          id: 'm1',
          titre: 'Jour 1',
          elements: [{
            id: 'e1', type: 'activite', nom: 'Randonnée', justification: 'ça correspond à l’envie',
            prixEstime: true, confiance: { niveau: 'suggestion' }, statut: 'propose', estAncre: false,
            dependDe: [], alternatives: [], contraintes: [], reactions: [], ...prixElement,
          }],
        }]
      : [],
    historique: [],
  } as Parcours
}

describe('BlocBudget', () => {
  it('affiche « Non précisé » sans jamais inventer un montant quand le budget visé est absent', () => {
    render(<BlocBudget parcours={parcoursDeBase()} />)
    expect(screen.getByText('Non précisé')).toBeInTheDocument()
  })

  it('affiche le budget visé quand il est renseigné', () => {
    render(<BlocBudget parcours={parcoursDeBase({ montantTotal: 600 })} />)
    expect(screen.getByText('600 EUR · par personne')).toBeInTheDocument()
  })

  it('n’affiche jamais 0 € comme estimation quand aucun élément n’est chiffré', () => {
    render(<BlocBudget parcours={parcoursDeBase()} />)
    expect(screen.getByText("Aucune estimation disponible pour l'instant.")).toBeInTheDocument()
    expect(screen.queryByText(/0 EUR/)).not.toBeInTheDocument()
  })

  it('signale les éléments estimés distinctement des éléments connus', () => {
    render(<BlocBudget parcours={parcoursDeBase({}, { prix: 45, prixEstime: true })} />)
    expect(screen.getByText(/1\/1 élément\(s\) chiffré\(s\), dont 1 estimé\(s\)/)).toBeInTheDocument()
  })
})
