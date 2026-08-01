import { describe, expect, it } from 'vitest'
import { ErreurApi } from './api'
import { statutMetierDepuisErreur } from './erreurAffichage'

describe('statutMetierDepuisErreur', () => {
  it('classe un 422 en refus', () => {
    expect(statutMetierDepuisErreur(new ErreurApi('Donnée essentielle manquante', 422))).toBe('refus')
  })

  it('classe un 503 en indisponible', () => {
    expect(statutMetierDepuisErreur(new ErreurApi('Service IA momentanément indisponible', 503))).toBe('indisponible')
  })

  it('ne classe pas les autres statuts (400, 404, 500…)', () => {
    expect(statutMetierDepuisErreur(new ErreurApi('Parcours introuvable', 404))).toBeNull()
    expect(statutMetierDepuisErreur(new ErreurApi('Erreur serveur', 500))).toBeNull()
  })

  it('ne classe pas une erreur générique non typée', () => {
    expect(statutMetierDepuisErreur(new Error('réseau coupé'))).toBeNull()
  })
})
