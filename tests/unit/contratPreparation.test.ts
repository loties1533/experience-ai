import { describe, expect, it, vi } from 'vitest';
import { BriefSchema, EtatDialogueSchema } from '../../server/agents/brief.js';
import {
  ResultatCadrageGenerationSchema,
} from '../../server/agents/generation/contratPreparation.js';
import { preparerGeneration } from '../../server/agents/generation/preparation.js';

const BRIEF = BriefSchema.parse({
  intention: 'découvrir les Alpes',
  avecQui: 'solo',
  duree: { valeur: 3, unite: 'semaines' },
  dates: { debut: '2026-10-01T00:00:00.000Z', fin: '2026-10-21T23:59:59.999Z' },
});

describe('PR1/PR2 — contrat de cadrage et contexte planifiable', () => {
  it('accepte un brief planifiable avec une destination préparée sans muter le brief', async () => {
    const preparer = () =>
      preparerGeneration(BRIEF, {
        decouvrirDestinations: async () => ({
          type: 'planifiable',
          contexte: {
            strategie: 'decouverte_destinations',
            etapes: [
              {
                ville: { nom: 'Chamonix', origine: 'selection_moteur' },
                ancres: [],
              },
            ],
            contraintesConservees: { dates: BRIEF.dates },
          },
        }),
      });

    expect(await preparer()).toEqual({
      type: 'planifiable',
      contexte: {
        strategie: 'decouverte_destinations',
        etapes: [
          {
            ville: { nom: 'Chamonix', origine: 'selection_moteur' },
            ancres: [],
          },
        ],
        contraintesConservees: {
          dates: BRIEF.dates,
        },
      },
    });
    expect(
      ResultatCadrageGenerationSchema.safeParse({
        type: 'planifiable',
        contexte: (await preparer() as Extract<
          Awaited<ReturnType<typeof preparerGeneration>>,
          { type: 'planifiable' }
        >).contexte,
      }).success
    ).toBe(true);
    expect(BRIEF.lieux).toEqual([]);
  });

  it('accepte une clarification structurée et son état de dialogue frère du brief', () => {
    const resultat = {
      type: 'clarification_requise',
      clarification: {
        code: 'zone_geographique_requise',
        question: 'Tu préfères rester en Europe ou aller plus loin ?',
        champCible: 'lieux',
      },
      etatDialogue: {
        champ: 'preparation_generation',
        code: 'zone_geographique_requise',
        champCible: 'lieux',
      },
    };
    expect(ResultatCadrageGenerationSchema.safeParse(resultat).success).toBe(true);
    expect(EtatDialogueSchema.safeParse(resultat.etatDialogue).success).toBe(true);
  });

  it.each([
    ['periode_requise', 'dates'],
    ['intention_a_preciser', 'intention'],
  ] as const)(
    'accepte la clarification %s uniquement sur %s',
    (code, champCible) => {
      const resultat = {
        type: 'clarification_requise',
        clarification: { code, question: 'Question ciblée ?', champCible },
        etatDialogue: {
          champ: 'preparation_generation',
          code,
          champCible,
        },
      };
      expect(ResultatCadrageGenerationSchema.safeParse(resultat).success).toBe(
        true
      );
      expect(EtatDialogueSchema.safeParse(resultat.etatDialogue).success).toBe(
        true
      );
    }
  );

  it('verrouille les invariants des destinations sélectionnées par le moteur', () => {
    const contexte = {
      strategie: 'decouverte_destinations',
      etapes: [
        {
          ville: { nom: 'Chamonix', origine: 'selection_moteur' },
          ancres: [],
        },
        {
          ville: { nom: 'Innsbruck', origine: 'selection_moteur' },
          ancres: [],
        },
      ],
      contraintesConservees: {},
    };
    expect(
      ResultatCadrageGenerationSchema.safeParse({
        type: 'planifiable',
        contexte,
      }).success
    ).toBe(true);
    expect(
      ResultatCadrageGenerationSchema.safeParse({
        type: 'planifiable',
        contexte: {
          ...contexte,
          etapes: [
            ...contexte.etapes,
            contexte.etapes[0],
            {
              ville: { nom: 'Zermatt', origine: 'selection_moteur' },
              ancres: [],
            },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      ResultatCadrageGenerationSchema.safeParse({
        type: 'planifiable',
        contexte: {
          ...contexte,
          etapes: [
            {
              ville: { nom: 'Chamonix', origine: 'utilisateur' },
              ancres: [],
            },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      ResultatCadrageGenerationSchema.safeParse({
        type: 'planifiable',
        contexte: {
          ...contexte,
          etapes: [
            {
              ville: {
                nom: 'Aix-en-Provence',
                origine: 'selection_moteur',
              },
              ancres: [],
            },
            {
              ville: {
                nom: 'aix en provence',
                origine: 'selection_moteur',
              },
              ancres: [],
            },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      ResultatCadrageGenerationSchema.safeParse({
        type: 'planifiable',
        contexte: {
          ...contexte,
          etapes: [
            {
              ville: { nom: '   ', origine: 'selection_moteur' },
              ancres: [],
            },
          ],
        },
      }).success
    ).toBe(false);
  });

  it('accepte les refus qui réutilisent les deux codes métier existants', () => {
    expect(
      ResultatCadrageGenerationSchema.safeParse({
        type: 'refus',
        refus: {
          code: 'donnees_essentielles_insuffisantes',
          message: 'Une donnée essentielle manque.',
        },
      }).success
    ).toBe(true);
  });

  it.each([
    ['discriminant inconnu', { type: 'autre' }],
    ['planifiable sans contexte', { type: 'planifiable' }],
    [
      'propriété inconnue à la racine',
      {
        type: 'planifiable',
        contexte: {
          strategie: 'compatibilite_sans_localisation',
          etapes: [{ ancres: [] }],
          contraintesConservees: {},
        },
        surprise: true,
      },
    ],
    [
      'stratégie inconnue',
      {
        type: 'planifiable',
        contexte: {
          strategie: 'decouverte_evenementielle',
          etapes: [],
          contraintesConservees: {},
        },
      },
    ],
    [
      'propriété inconnue dans une étape',
      {
        type: 'planifiable',
        contexte: {
          strategie: 'villes_du_brief',
          etapes: [
            {
              ville: { nom: 'Paris', origine: 'utilisateur' },
              ancres: [],
              surprise: true,
            },
          ],
          contraintesConservees: {},
        },
      },
    ],
    [
      'compatibilité qui prétend porter une ville',
      {
        type: 'planifiable',
        contexte: {
          strategie: 'compatibilite_sans_localisation',
          etapes: [{ ville: { nom: 'Paris', origine: 'utilisateur' }, ancres: [] }],
          contraintesConservees: {},
        },
      },
    ],
    [
      'ancre invalide',
      {
        type: 'planifiable',
        contexte: {
          strategie: 'villes_du_brief',
          etapes: [
            {
              ville: { nom: 'Paris', origine: 'utilisateur' },
              ancres: [1],
            },
          ],
          contraintesConservees: {},
        },
      },
    ],
    [
      'ville du brief sans origine utilisateur',
      {
        type: 'planifiable',
        contexte: {
          strategie: 'villes_du_brief',
          etapes: [{ ville: { nom: 'Paris', origine: 'fournisseur' }, ancres: [] }],
          contraintesConservees: {},
        },
      },
    ],
    [
      'code de clarification invalide',
      {
        type: 'clarification_requise',
        clarification: { code: 'ville_obligatoire', question: 'Où ?', champCible: 'lieux' },
        etatDialogue: { champ: 'preparation_generation', code: 'ville_obligatoire', champCible: 'lieux' },
      },
    ],
    [
      'champ cible incohérent avec la clarification',
      {
        type: 'clarification_requise',
        clarification: {
          code: 'periode_requise',
          question: 'Quand ?',
          champCible: 'lieux',
        },
        etatDialogue: {
          champ: 'preparation_generation',
          code: 'periode_requise',
          champCible: 'lieux',
        },
      },
    ],
  ])('rejette %s', (_cas, resultat) => {
    expect(ResultatCadrageGenerationSchema.safeParse(resultat).success).toBe(false);
  });

  it('projette les villes déclarées sans les modifier dans le Brief', async () => {
    const avecVilles = BriefSchema.parse({
      ...BRIEF,
      lieux: [
        { nom: 'Bordeaux', type: 'ville' },
        { nom: 'Paris', type: 'ville' },
      ],
    });

    expect(await preparerGeneration(avecVilles)).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'villes_du_brief',
        etapes: [
          { ville: { nom: 'Bordeaux', origine: 'utilisateur' } },
          { ville: { nom: 'Paris', origine: 'utilisateur' } },
        ],
      },
    });
    expect(avecVilles.lieux).toEqual([
      { nom: 'Bordeaux', type: 'ville' },
      { nom: 'Paris', type: 'ville' },
    ]);
  });

  it('projette un brief mono-ville en une étape utilisateur', async () => {
    const monoVille = BriefSchema.parse({
      ...BRIEF,
      lieux: [{ nom: 'Chamonix', type: 'ville' }],
      budgetTotal: 1_200,
    });

    expect(await preparerGeneration(monoVille)).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'villes_du_brief',
        etapes: [
          { ville: { nom: 'Chamonix', origine: 'utilisateur' }, ancres: [] },
        ],
        contraintesConservees: { budgetTotal: 1_200 },
      },
    });
  });

  it('conserve Paris explicite sur le chemin ville historique', async () => {
    const demande = BriefSchema.parse({
      ...BRIEF,
      lieux: [{ nom: 'Paris', type: 'ville' }],
    });
    const decouvrirDestinations = vi.fn(async () =>
      ResultatCadrageGenerationSchema.parse({
        type: 'refus',
        refus: {
          code: 'donnees_essentielles_insuffisantes',
          message: 'ne doit pas être appelé',
        },
      })
    );

    const resultat = await preparerGeneration(demande, {
      decouvrirDestinations,
    });

    expect(resultat).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'villes_du_brief',
        etapes: [
          { ville: { nom: 'Paris', origine: 'utilisateur' } },
        ],
      },
    });
    expect(decouvrirDestinations).not.toHaveBeenCalled();
  });

  it('conserve Springfield déclarée comme ville sans choisir un homonyme fournisseur', async () => {
    const demande = BriefSchema.parse({
      ...BRIEF,
      lieux: [{ nom: 'Springfield', type: 'ville' }],
    });
    const decouvrirDestinations = vi.fn();

    const resultat = await preparerGeneration(demande, {
      decouvrirDestinations,
    });

    expect(resultat).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'villes_du_brief',
        etapes: [
          { ville: { nom: 'Springfield', origine: 'utilisateur' } },
        ],
      },
    });
    expect(decouvrirDestinations).not.toHaveBeenCalled();
  });

  it('utilise un pays comme contrainte de découverte, jamais comme ville', async () => {
    const demande = BriefSchema.parse({
      ...BRIEF,
      lieux: [{ nom: 'France', type: 'pays', codePays: 'FR' }],
    });
    const decouvrirDestinations = vi.fn(async () =>
      ResultatCadrageGenerationSchema.parse({
        type: 'clarification_requise',
        clarification: {
          code: 'intention_a_preciser',
          question: 'Quel critère doit être indispensable ?',
          champCible: 'intention',
        },
        etatDialogue: {
          champ: 'preparation_generation',
          code: 'intention_a_preciser',
          champCible: 'intention',
        },
      })
    );

    const resultat = await preparerGeneration(demande, {
      decouvrirDestinations,
    });

    expect(decouvrirDestinations).toHaveBeenCalledWith(demande);
    expect(resultat).toMatchObject({ type: 'clarification_requise' });
    expect(JSON.stringify(resultat)).not.toContain('VillePlanifiee');
    expect(demande.lieux).toEqual([
      { nom: 'France', type: 'pays', codePays: 'FR' },
    ]);
  });

  it.each([
    ['Alpes', 'Grenoble'],
    ['Toscane', 'Florence'],
  ])(
    'ne transforme jamais la zone %s en VillePlanifiee',
    async (zone, villeResolue) => {
      const demande = BriefSchema.parse({
        ...BRIEF,
        lieux: [{ nom: zone, type: 'zone' }],
      });
      const decouvrirDestinations = vi.fn(async () =>
        ResultatCadrageGenerationSchema.parse({
          type: 'planifiable',
          contexte: {
            strategie: 'decouverte_destinations',
            etapes: [
              {
                ville: {
                  nom: villeResolue,
                  origine: 'selection_moteur',
                },
                ancres: [],
              },
            ],
            contraintesConservees: { dates: demande.dates },
          },
        })
      );

      const resultat = await preparerGeneration(demande, {
        decouvrirDestinations,
      });

      expect(decouvrirDestinations).toHaveBeenCalledWith(demande);
      expect(resultat).toMatchObject({
        type: 'planifiable',
        contexte: {
          strategie: 'decouverte_destinations',
          etapes: [{ ville: { nom: villeResolue } }],
        },
      });
      if (resultat.type === 'planifiable') {
        expect(resultat.contexte.etapes.map((etape) => etape.ville?.nom)).not.toContain(
          zone
        );
      }
      expect(demande.lieux).toEqual([{ nom: zone, type: 'zone' }]);
    }
  );
  it('conserve l’état dates, rejette un état de préparation invalide et ne laisse aucun état entrer dans le Brief', () => {
    expect(
      EtatDialogueSchema.safeParse({
        champ: 'dates',
        valeurCandidate: { debut: '2026-10-01T00:00:00.000Z', fin: '2026-10-21T23:59:59.999Z' },
      }).success
    ).toBe(true);
    expect(
      EtatDialogueSchema.safeParse({
        champ: 'preparation_generation',
        code: 'zone_geographique_requise',
        champCible: 'dates',
      }).success
    ).toBe(false);
    expect(
      BriefSchema.safeParse({
        ...BRIEF,
        etatDialogue: {
          champ: 'preparation_generation',
          code: 'zone_geographique_requise',
          champCible: 'lieux',
        },
      }).success
    ).toBe(false);
  });
});
