import { describe, expect, it } from 'vitest';
import { BriefSchema } from '../../server/agents/brief.js';
import { naturesEvenementiellesCityFirst } from '../../server/agents/generation/ciblageEvenementiel.js';

function brief(intention: string) {
  return BriefSchema.parse({
    intention,
    avecQui: 'solo',
    duree: { valeur: 1, unite: 'jours' },
    dates: {
      debut: '2027-06-05T00:00:00.000Z',
      fin: '2027-06-05T23:59:59.999Z',
    },
    lieux: [{ nom: 'Paris', type: 'ville' }],
  });
}

describe('ciblage événementiel city-first depuis l’intention', () => {
  it.each([
    ['Je veux voir un match de basket à Paris', ['sport']],
    ['Je veux assister à un concert à Lyon ce week-end', ['concert']],
    ['Je veux aller à un festival techno à Marseille', ['festival']],
    ['Je veux voir une pièce de théâtre à Paris', ['arts_de_la_scene']],
    [
      'Je veux participer à un événement communautaire à Lille',
      ['communautaire'],
    ],
  ] as const)('reconnaît uniquement le besoin explicite « %s »', (intention, attendu) => {
    expect(naturesEvenementiellesCityFirst(brief(intention))).toEqual(attendu);
  });

  it('conserve un ordre déterministe pour plusieurs preuves explicites', () => {
    expect(
      naturesEvenementiellesCityFirst(
        brief('Voir un match, un concert puis un festival et un spectacle')
      )
    ).toEqual(['sport', 'concert', 'festival', 'arts_de_la_scene']);
  });

  it.each([
    'Je veux une expérience culturelle à Paris pendant quatre jours',
    'Je veux découvrir Lyon ce week-end',
    'Je veux dîner à Paris à une date précise',
  ])('ne déduit aucun événement d’une intention générique : %s', (intention) => {
    expect(naturesEvenementiellesCityFirst(brief(intention))).toEqual([]);
  });

  it('ne transforme pas une contrainte négative en preuve événementielle', () => {
    const source = {
      ...brief('Je veux découvrir Paris'),
      contraintes: ['sans concert ni festival'],
    };
    expect(naturesEvenementiellesCityFirst(source)).toEqual([]);
  });
});
