import { describe, expect, it } from 'vitest';
import { PropositionDecouverteDestinationsSchema } from '../../server/agents/generation/contratDecouverteDestinations.js';

function propositionValide() {
  return {
    format: 'itineraire',
    facettesObligatoires: ['sports_hiver', 'nature'],
    facettesSouples: ['detente'],
    candidats: [
      { nom: 'Chamonix', codePaysSuggere: 'FR' },
      { nom: 'Innsbruck', codePaysSuggere: 'AT' },
    ],
  };
}

describe('contrat LLM de découverte des destinations', () => {
  it('accepte uniquement la proposition bornée attendue', () => {
    expect(
      PropositionDecouverteDestinationsSchema.safeParse(
        propositionValide()
      ).success
    ).toBe(true);
  });

  it.each([
    ['score', { score: 83 }],
    ['preuve', { preuve: 'Destination réputée' }],
    ['prix', { prix: 1200 }],
    ['disponibilité', { disponibilite: true }],
    ['justification libre', { justification: 'Très adaptée' }],
  ])('refuse un champ libre de %s', (_libelle, ajout) => {
    expect(
      PropositionDecouverteDestinationsSchema.safeParse({
        ...propositionValide(),
        candidats: [
          { nom: 'Chamonix', codePaysSuggere: 'FR', ...ajout },
        ],
      }).success
    ).toBe(false);
  });

  it('refuse les doublons de noms normalisés', () => {
    expect(
      PropositionDecouverteDestinationsSchema.safeParse({
        ...propositionValide(),
        candidats: [{ nom: 'São Paulo' }, { nom: 'sao-paulo' }],
      }).success
    ).toBe(false);
  });

  it('refuse plus de cinq candidats et une facette climat non supportée', () => {
    expect(
      PropositionDecouverteDestinationsSchema.safeParse({
        ...propositionValide(),
        candidats: Array.from({ length: 6 }, (_, index) => ({
          nom: `Ville ${index}`,
        })),
      }).success
    ).toBe(false);
    expect(
      PropositionDecouverteDestinationsSchema.safeParse({
        ...propositionValide(),
        facettesObligatoires: ['climat_ensoleille'],
      }).success
    ).toBe(false);
  });

  it('refuse une facette dupliquée ou à la fois obligatoire et souple', () => {
    expect(
      PropositionDecouverteDestinationsSchema.safeParse({
        ...propositionValide(),
        facettesObligatoires: ['nature', 'nature'],
      }).success
    ).toBe(false);
    expect(
      PropositionDecouverteDestinationsSchema.safeParse({
        ...propositionValide(),
        facettesSouples: ['nature'],
      }).success
    ).toBe(false);
  });
});
