// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { migrerEtatDialoguePersiste } from './index'

describe('migration du dialogue persiste — localisations typees', () => {
  it('convertit les anciennes chaines en inconnues et invalide le brief', () => {
    expect(
      migrerEtatDialoguePersiste({
        brief: { lieux: ['Paris', 'Alpes'] },
        estComplet: true,
        messages: [],
      })
    ).toMatchObject({
      brief: {
        lieux: [
          { nom: 'Paris', type: 'inconnue' },
          { nom: 'Alpes', type: 'inconnue' },
        ],
      },
      estComplet: false,
    })
  })

  it('ne degrade pas des localisations deja typees', () => {
    const etat = {
      brief: { lieux: [{ nom: 'Paris', type: 'ville' }] },
      estComplet: true,
      messages: [],
    }
    expect(migrerEtatDialoguePersiste(etat)).toEqual(etat)
  })
})
