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
        brief(
          'Voir un match, assister à un concert, aller à un festival et voir un spectacle'
        )
      )
    ).toEqual(['sport', 'concert', 'festival', 'arts_de_la_scene']);
  });

  it('ne duplique pas une nature prouvée plusieurs fois', () => {
    expect(
      naturesEvenementiellesCityFirst(
        brief('Voir un match puis assister à un match')
      )
    ).toEqual(['sport']);
  });

  it.each([
    'ambiance de festival',
    'festival de saveurs',
    'découvrir Paris sans concert',
    'visiter le théâtre antique',
    'visiter l’Opéra Garnier',
    'visiter une salle de concert',
    'visiter un stade',
    'pas de festival',
    'aucun match',
    'je ne veux pas de spectacle',
    'culture locale',
    'communauté sportive',
    'soirée sportive',
    'expérience surprise',
    'Je veux une expérience culturelle à Paris pendant quatre jours',
    'Je veux découvrir Lyon ce week-end',
    'Je veux dîner à Paris à une date précise',
  ])('ne déduit aucun événement sans construction positive : %s', (intention) => {
    expect(naturesEvenementiellesCityFirst(brief(intention))).toEqual([]);
  });

  it.each([
    ['assister à un stand-up', ['arts_de_la_scene']],
    ['assister au stand-up', ['arts_de_la_scene']],
    ['assister à une pièce au théâtre', ['arts_de_la_scene']],
    ['assister à l’opéra', ['arts_de_la_scene']],
    ['voir un ballet', ['arts_de_la_scene']],
    ['assister au spectacle', ['arts_de_la_scene']],
    ['assister à ce spectacle', ['arts_de_la_scene']],
    ['assister à cette comédie musicale', ['arts_de_la_scene']],
    ['voir un match au stade', ['sport']],
    ['assister à un match de basket', ['sport']],
    ['assister au match', ['sport']],
    ['assister à ce match', ['sport']],
    ['aller voir ce match', ['sport']],
    ['aller voir le match', ['sport']],
    ['aller voir ces matchs', ['sport']],
    ['assister à un concert', ['concert']],
    ['assister au concert', ['concert']],
    ['assister aux concerts', ['concert']],
    ['assister à ce concert', ['concert']],
    ['bar avec concert', ['concert']],
    ['aller à un festival techno', ['festival']],
    ['aller au festival', ['festival']],
    ['aller à ce festival', ['festival']],
    ['participer au festival', ['festival']],
    ['participer à ce festival', ['festival']],
    ['aller au Festival des saveurs', ['festival']],
    ['participer à un événement communautaire', ['communautaire']],
    ['participer à cet événement communautaire', ['communautaire']],
  ] as const)('reconnaît la construction positive « %s »', (intention, attendu) => {
    expect(naturesEvenementiellesCityFirst(brief(intention))).toEqual(attendu);
  });

  it.each([
    ['je ne veux pas de concert, mais je veux voir un match', ['sport']],
    ['pas de festival, mais un concert me plairait', ['concert']],
    ['je ne veux pas assister à un concert, mais je veux voir un match', ['sport']],
    ['sans assister à un concert, je souhaite participer au festival', ['festival']],
    ['je ne peux pas aller au festival, mais je peux assister au concert', ['concert']],
    ['je préfère ne pas voir le match, mais assister à un spectacle', ['arts_de_la_scene']],
    ['je ne veux surtout pas aller au festival, mais un concert m’intéresse', []],
    ['je ne souhaite pas assister au match ni au concert', []],
    ['visiter l’Opéra Garnier puis assister à un stand-up', ['arts_de_la_scene']],
    ['assister à un stand-up puis visiter l’Opéra Garnier', ['arts_de_la_scene']],
    ['visiter un stade puis voir un match', ['sport']],
  ] as const)('conserve uniquement les preuves positives de « %s »', (intention, attendu) => {
    expect(naturesEvenementiellesCityFirst(brief(intention))).toEqual(attendu);
  });

  it.each([
    'sans concert',
    'pas de concert',
    'aucun concert',
    'je ne veux pas de concert',
    'je ne souhaite pas assister à un concert',
    'je ne souhaite pas de festival',
    'ne pas assister à un concert',
    'sans assister à un concert',
    'je préfère ne pas aller à un concert',
    'je ne peux pas assister à un concert',
    'je ne veux surtout pas aller à un festival',
    'je ne souhaite pas assister au match',
    'je préfère ne pas participer au festival',
    'impossible d’assister au concert',
    "impossible d'assister au concert",
    'pas envie d’aller au festival',
    'n’assister à aucun concert',
    'sans festival',
    'pas de match',
    'aucun spectacle',
  ])('neutralise la nature concernée par la négation « %s »', (intention) => {
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
