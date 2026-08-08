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

describe('PR1 — contrat de cadrage de génération', () => {
  it('accepte un brief planifiable, y compris sans ville imposée', () => {
    expect(preparerGeneration(BRIEF)).toEqual({ type: 'planifiable' });
    expect(ResultatCadrageGenerationSchema.safeParse({ type: 'planifiable' }).success).toBe(true);
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
    ['propriété inattendue', { type: 'planifiable', surprise: true }],
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
