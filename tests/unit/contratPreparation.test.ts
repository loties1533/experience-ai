import { describe, expect, it } from 'vitest';
import { BriefSchema, EtatDialogueSchema } from '../../server/agents/brief.js';
import {
  ResultatCadrageGenerationSchema,
} from '../../server/agents/generation/contratPreparation.js';
import { preparerGeneration } from '../../server/agents/generation/preparation.js';

const BRIEF = BriefSchema.parse({
  intention: 'vivre la NBA',
  avecQui: 'solo',
  duree: { valeur: 3, unite: 'semaines' },
  dates: { debut: '2026-10-01T00:00:00.000Z', fin: '2026-10-21T23:59:59.999Z' },
});

describe('PR1/PR2 — contrat de cadrage et contexte planifiable', () => {
  it('accepte un brief planifiable, y compris sans ville imposée', () => {
    expect(preparerGeneration(BRIEF)).toEqual({
      type: 'planifiable',
      contexte: {
        strategie: 'compatibilite_sans_localisation',
        etapes: [{ ancres: [] }],
        contraintesConservees: {
          dates: BRIEF.dates,
        },
      },
    });
    expect(
      ResultatCadrageGenerationSchema.safeParse({
        type: 'planifiable',
        contexte: preparerGeneration(BRIEF).contexte,
      }).success
    ).toBe(true);
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
  ])('rejette %s', (_cas, resultat) => {
    expect(ResultatCadrageGenerationSchema.safeParse(resultat).success).toBe(false);
  });

  it('projette les villes déclarées sans les modifier dans le Brief', () => {
    const avecVilles = BriefSchema.parse({
      ...BRIEF,
      lieux: ['Bordeaux', 'Paris'],
    });

    expect(preparerGeneration(avecVilles)).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'villes_du_brief',
        etapes: [
          { ville: { nom: 'Bordeaux', origine: 'utilisateur' } },
          { ville: { nom: 'Paris', origine: 'utilisateur' } },
        ],
      },
    });
    expect(avecVilles.lieux).toEqual(['Bordeaux', 'Paris']);
  });

  it('projette un brief mono-ville en une étape utilisateur', () => {
    const monoVille = BriefSchema.parse({
      ...BRIEF,
      lieux: ['Chamonix'],
      budgetTotal: 1_200,
    });

    expect(preparerGeneration(monoVille)).toMatchObject({
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
