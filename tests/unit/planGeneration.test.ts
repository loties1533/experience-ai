import { describe, expect, it } from 'vitest';
import { deriverPlan } from '../../server/agents/generation.js';
import { BriefSchema, type Brief } from '../../server/agents/brief.js';

const BASE = {
  intention: 'un séjour à préparer',
  avecQui: 'amis' as const,
  duree: { valeur: 1, unite: 'semaines' as const },
};

function brief(options: {
  lieux?: string[];
  debut?: string;
  fin?: string;
}): Brief {
  return BriefSchema.parse({
    ...BASE,
    lieux: options.lieux ?? [],
    ...(options.debut && options.fin
      ? { dates: { debut: options.debut, fin: options.fin } }
      : {}),
  });
}

// Numéro de jour civil, réplique locale de la logique interne pour vérifier la
// couverture et la taille des blocs sans dépendre de l'heure ni d'un fuseau.
function numeroDeJour(dateCivile: string): number {
  const [annee, mois, jour] = dateCivile.split('-').map(Number);
  return Math.floor(Date.UTC(annee, mois - 1, jour) / 86_400_000);
}

function tailleEnJours(plage: { debut: string; fin: string }): number {
  return numeroDeJour(plage.fin) - numeroDeJour(plage.debut) + 1;
}

describe('deriverPlan — découpage pur par ville et par jours', () => {
  it('rend un lot unique et sans ville quand aucune ville n’est connue', () => {
    const plan = deriverPlan(brief({ lieux: [] }));
    expect(plan.lots).toHaveLength(1);
    expect(plan.lots[0].ville).toBeUndefined();
    expect(plan.lots[0].plage).toBeUndefined();
  });

  it('rend un lot par ville et sans plage quand aucune date n’est fournie', () => {
    const plan = deriverPlan(brief({ lieux: ['Bordeaux', 'Paris', 'Lyon'] }));
    expect(plan.lots.map((lot) => lot.ville)).toEqual([
      'Bordeaux',
      'Paris',
      'Lyon',
    ]);
    expect(plan.lots.every((lot) => lot.plage === undefined)).toBe(true);
  });

  it.each([
    [1, [1]],
    [2, [2]],
    [5, [5]],
    [6, [3, 3]],
    [7, [4, 3]],
    [9, [5, 4]],
    [10, [5, 5]],
    [11, [4, 4, 3]],
    [16, [4, 4, 4, 4]],
  ])(
    'découpe une ville de %i jours en blocs équilibrés de 2 à 5 jours',
    (jours, taillesAttendues) => {
      const debut = '2026-09-01T08:00:00Z';
      const fin = `2026-09-${String(jours).padStart(2, '0')}T20:00:00Z`;
      const plan = deriverPlan(brief({ lieux: ['Bordeaux'], debut, fin }));

      expect(
        plan.lots.map((lot) => tailleEnJours(lot.plage!))
      ).toEqual(taillesAttendues);
      expect(plan.lots.every((lot) => lot.ville === 'Bordeaux')).toBe(true);
    }
  );

  it.each(Array.from({ length: 16 }, (_, index) => index + 1))(
    'couvre exactement la plage sans trou, chevauchement ni lot d’un jour (%i jours)',
    (jours) => {
      const debut = '2026-09-01T00:00:00Z';
      const fin = `2026-09-${String(jours).padStart(2, '0')}T23:59:59Z`;
      const plan = deriverPlan(brief({ lieux: ['Bordeaux'], debut, fin }));
      const plages = plan.lots.map((lot) => lot.plage!);

      // Couverture contiguë : premier jour, dernier jour, aucun trou ni recouvrement.
      expect(plages[0].debut).toBe('2026-09-01');
      expect(plages[plages.length - 1].fin).toBe(
        `2026-09-${String(jours).padStart(2, '0')}`
      );
      for (let index = 1; index < plages.length; index += 1) {
        expect(numeroDeJour(plages[index].debut)).toBe(
          numeroDeJour(plages[index - 1].fin) + 1
        );
      }

      // Aucun bloc de plus de 5 jours ; aucun bloc orphelin d’un jour dès que
      // la plage compte au moins deux jours.
      for (const plage of plages) {
        const taille = tailleEnJours(plage);
        expect(taille).toBeLessThanOrEqual(5);
        if (jours >= 2) expect(taille).toBeGreaterThanOrEqual(2);
      }
    }
  );

  it('répartit les jours entre plusieurs villes datées, puis découpe chaque tranche', () => {
    const plan = deriverPlan(
      brief({
        lieux: ['Bordeaux', 'Paris'],
        debut: '2026-09-01T00:00:00Z',
        fin: '2026-09-16T00:00:00Z',
      })
    );

    expect(plan.lots.map((lot) => lot.ville)).toEqual([
      'Bordeaux',
      'Bordeaux',
      'Paris',
      'Paris',
    ]);
    // 16 jours pour 2 villes : 8 jours chacune, découpés en deux blocs de 4.
    expect(plan.lots.map((lot) => tailleEnJours(lot.plage!))).toEqual([
      4, 4, 4, 4,
    ]);
    // Couverture globale contiguë, sans trou ni chevauchement entre les villes.
    const plages = plan.lots.map((lot) => lot.plage!);
    expect(plages[0].debut).toBe('2026-09-01');
    expect(plages[plages.length - 1].fin).toBe('2026-09-16');
    for (let index = 1; index < plages.length; index += 1) {
      expect(numeroDeJour(plages[index].debut)).toBe(
        numeroDeJour(plages[index - 1].fin) + 1
      );
    }
  });

  it('renonce aux plages plutôt que de créer un lot orphelin quand les jours manquent', () => {
    // 4 jours pour 3 villes : impossible de donner deux jours à chacune sans
    // orphelin. On garde un lot par ville, sans plage.
    const plan = deriverPlan(
      brief({
        lieux: ['Bordeaux', 'Paris', 'Lyon'],
        debut: '2026-09-01T00:00:00Z',
        fin: '2026-09-04T00:00:00Z',
      })
    );

    expect(plan.lots.map((lot) => lot.ville)).toEqual([
      'Bordeaux',
      'Paris',
      'Lyon',
    ]);
    expect(plan.lots.every((lot) => lot.plage === undefined)).toBe(true);
  });
});
