import { describe, expect, it } from 'vitest';
import {
  BriefPartielSchema,
  BriefSchema,
  nomsLocalisationsDeclarees,
  paysDeclares,
  reformulerBrief,
  villesDeclarees,
  zonesDeclarees,
} from '../../server/agents/brief.js';
import {
  extraireLocalisationsDeclarees,
  nomPresentDansMessage,
} from '../../server/agents/localisationDeclaree.js';

const BASE = {
  intention: 'prendre le temps de voyager',
  avecQui: 'solo' as const,
  duree: { valeur: 4, unite: 'jours' as const },
};

describe('localisations declarees — contrat canonique', () => {
  it('accepte inconnue uniquement dans un brief en cours', () => {
    expect(
      BriefPartielSchema.parse({ lieux: [{ nom: 'Springfield', type: 'inconnue' }] })
    ).toMatchObject({ lieux: [{ nom: 'Springfield', type: 'inconnue' }] });
    expect(() =>
      BriefSchema.parse({
        ...BASE,
        lieux: [{ nom: 'Springfield', type: 'inconnue' }],
      })
    ).toThrow();
  });

  it('exige un code ISO pour un pays confirme', () => {
    expect(() =>
      BriefSchema.parse({
        ...BASE,
        lieux: [{ nom: 'France', type: 'pays' }],
      })
    ).toThrow();
    expect(
      BriefSchema.parse({
        ...BASE,
        lieux: [{ nom: 'France', type: 'pays', codePays: 'FR' }],
      }).lieux
    ).toEqual([{ nom: 'France', type: 'pays', codePays: 'FR' }]);
  });

  it('reprend une ancienne chaine en inconnue, jamais en ville', () => {
    const repris = BriefPartielSchema.parse({ lieux: ['Paris'] });
    expect(repris.lieux).toEqual([{ nom: 'Paris', type: 'inconnue' }]);
    expect(villesDeclarees(repris)).toEqual([]);
  });

  it('expose des helpers purs qui ne confondent pas ville, zone et pays', () => {
    const brief = BriefPartielSchema.parse({
      lieux: [
        { nom: 'Paris', type: 'ville' },
        { nom: 'Alpes', type: 'zone', codePays: 'FR' },
        { nom: 'France', type: 'pays', codePays: 'FR' },
      ],
    });
    expect(villesDeclarees(brief).map(({ nom }) => nom)).toEqual(['Paris']);
    expect(zonesDeclarees(brief).map(({ nom }) => nom)).toEqual(['Alpes']);
    expect(paysDeclares(brief).map(({ nom }) => nom)).toEqual(['France']);
    expect(nomsLocalisationsDeclarees(brief)).toEqual(['Paris', 'Alpes', 'France']);
  });

  it('rend chaque type comprehensible dans la confirmation utilisateur', () => {
    const confirmation = reformulerBrief(
      BriefSchema.parse({
        ...BASE,
        lieux: [
          { nom: 'Paris', type: 'ville' },
          { nom: 'Alpes', type: 'zone' },
          { nom: 'France', type: 'pays', codePays: 'FR' },
        ],
      })
    );
    expect(confirmation).toContain('dans la ville de Paris');
    expect(confirmation).toContain('dans la zone Alpes');
    expect(confirmation).toContain('en France');
  });

  it.each([
    [
      { nom: 'Paris', type: 'ville' as const, codePays: 'FR' },
      'dans la ville de Paris (France)',
    ],
    [
      { nom: 'Alpes', type: 'zone' as const, codePays: 'FR' },
      'dans la zone Alpes (France)',
    ],
  ])('rend visible le pays de $nom dans la confirmation', (lieu, attendu) => {
    const confirmation = reformulerBrief(
      BriefSchema.parse({ ...BASE, lieux: [lieu] })
    );

    expect(confirmation).toContain(attendu);
  });
});

describe('localisations declarees — frontiere intake', () => {
  it.each([
    ['Je veux passer 4 jours a Paris', { nom: 'Paris', type: 'ville' }],
    ['Je veux skier dans les Alpes', { nom: 'Alpes', type: 'zone' }],
    ['Une semaine en Toscane', { nom: 'Toscane', type: 'zone' }],
    [
      'Je veux voyager en France',
      { nom: 'France', type: 'pays', codePays: 'FR' },
    ],
    ['Je veux partir dans les Pyrenees', { nom: 'Pyrenees', type: 'zone' }],
    ['Je veux aller a Springfield', { nom: 'Springfield', type: 'ville' }],
  ])('conserve la semantique declaree de %s', (message, attendu) => {
    expect(extraireLocalisationsDeclarees([attendu], message)).toEqual([attendu]);
  });

  it('ne deduit pas le pays de Paris et retire un code LLM non declare', () => {
    expect(
      extraireLocalisationsDeclarees(
        [{ nom: 'Paris', type: 'ville', codePays: 'FR' }],
        'Je veux passer 4 jours a Paris'
      )
    ).toEqual([{ nom: 'Paris', type: 'ville' }]);
  });

  it('porte un pays seulement quand le message le declare explicitement', () => {
    expect(
      extraireLocalisationsDeclarees(
        [{ nom: 'Paris', type: 'ville', codePays: 'FR' }],
        'Je veux aller à Paris en France'
      )
    ).toEqual([{ nom: 'Paris', type: 'ville', codePays: 'FR' }]);
    expect(
      extraireLocalisationsDeclarees(
        [{ nom: 'Alpes', type: 'zone', codePays: 'FR' }],
        'Je veux skier dans les Alpes françaises'
      )
    ).toEqual([{ nom: 'Alpes', type: 'zone', codePays: 'FR' }]);
  });

  it('ne propage pas France de Paris vers Rome', () => {
    expect(
      extraireLocalisationsDeclarees(
        [
          { nom: 'Paris', type: 'ville', codePays: 'FR' },
          { nom: 'Rome', type: 'ville', codePays: 'FR' },
        ],
        'Paris en France puis Rome'
      )
    ).toEqual([
      { nom: 'Paris', type: 'ville', codePays: 'FR' },
      { nom: 'Rome', type: 'ville' },
    ]);
  });

  it('ne propage pas Italie de Rome vers Paris', () => {
    expect(
      extraireLocalisationsDeclarees(
        [
          { nom: 'Paris', type: 'ville', codePays: 'IT' },
          { nom: 'Rome', type: 'ville', codePays: 'IT' },
        ],
        'Paris puis Rome en Italie'
      )
    ).toEqual([
      { nom: 'Paris', type: 'ville' },
      { nom: 'Rome', type: 'ville', codePays: 'IT' },
    ]);
  });

  it('ne croise aucun code entre deux associations explicites', () => {
    expect(
      extraireLocalisationsDeclarees(
        [
          { nom: 'Paris', type: 'ville', codePays: 'FR' },
          { nom: 'Rome', type: 'ville', codePays: 'IT' },
        ],
        'Paris en France puis Rome en Italie'
      )
    ).toEqual([
      { nom: 'Paris', type: 'ville', codePays: 'FR' },
      { nom: 'Rome', type: 'ville', codePays: 'IT' },
    ]);
  });

  it.each(['CH', 'FR'])(
    'omet le code %s quand le segment de Paris declare plusieurs pays',
    (codePays) => {
      expect(
        extraireLocalisationsDeclarees(
          [{ nom: 'Paris', type: 'ville', codePays }],
          'Je pars de Suisse pour Paris en France'
        )
      ).toEqual([{ nom: 'Paris', type: 'ville' }]);
    }
  );

  it('derive le code du pays declare au lieu de faire confiance au LLM', () => {
    expect(
      extraireLocalisationsDeclarees(
        [{ nom: 'France', type: 'pays', codePays: 'US' }],
        'Je veux voyager en France'
      )
    ).toEqual([{ nom: 'France', type: 'pays', codePays: 'FR' }]);
  });

  it('refuse un nom invente et ne signale pas une extraction vide', () => {
    expect(nomPresentDansMessage('Je veux aller a Paris', 'Lyon')).toBe(false);
    expect(
      extraireLocalisationsDeclarees(
        [{ nom: 'Lyon', type: 'ville' }],
        'Je veux aller a Paris'
      )
    ).toBeUndefined();
  });

  it('conserve inconnue comme etat transitoire explicite', () => {
    expect(
      extraireLocalisationsDeclarees(
        [{ nom: 'Springfield', type: 'inconnue', codePays: 'US' }],
        'Je veux aller a Springfield'
      )
    ).toEqual([{ nom: 'Springfield', type: 'inconnue' }]);
  });
});
