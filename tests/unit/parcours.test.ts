import { describe, it, expect } from 'vitest';
import {
  ParcoursSchema,
  ElementSchema,
  elementsDependants,
  detecterConflits,
  validerParcours,
  type Parcours,
} from '../../server/domaine/parcours/index.js';

function element(id: string, surcharge: Partial<Parameters<typeof ElementSchema.parse>[0]> = {}) {
  return ElementSchema.parse({
    id,
    type: 'activite',
    nom: `Élément ${id}`,
    justification: 'cohérent avec l’intention',
    ...surcharge,
  });
}

function parcoursMinimal(surcharge: Partial<Parcours> = {}): Parcours {
  return ParcoursSchema.parse({
    id: 'p1',
    intention: { texte: 'vivre la NBA' },
    contexte: { avecQui: 'solo', duree: { valeur: 21, unite: 'jours' } },
    participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
    budget: { mode: 'individuel', montantTotal: 5000 },
    ...surcharge,
  });
}

describe('ParcoursSchema — invariants portés par le schéma', () => {
  it('accepte un parcours minimal valide et applique les défauts', () => {
    const parcours = parcoursMinimal();
    expect(parcours.visibilite).toBe('prive');
    expect(parcours.timeline).toEqual([]);
    expect(parcours.budget.devise).toBe('EUR');
  });

  it('refuse un parcours sans intention (invariant 1)', () => {
    const resultat = ParcoursSchema.safeParse({
      ...parcoursMinimal(),
      intention: { texte: '' },
    });
    expect(resultat.success).toBe(false);
  });

  it('refuse un élément sans justification (invariant 2)', () => {
    const resultat = ElementSchema.safeParse({
      id: 'e1',
      type: 'restaurant',
      nom: 'Chez Rose',
      justification: '',
    });
    expect(resultat.success).toBe(false);
  });

  it('refuse une plage horaire dont le début suit la fin', () => {
    const resultat = ElementSchema.safeParse({
      ...element('e1'),
      plage: { debut: '2026-08-02T20:00:00Z', fin: '2026-08-02T18:00:00Z' },
    });
    expect(resultat.success).toBe(false);
  });
});

describe('elementsDependants — invariant 3 (recalcul ciblé)', () => {
  const parcours = parcoursMinimal({
    timeline: [
      {
        id: 'm1',
        titre: 'Soirée',
        elements: [
          element('hotel'),
          element('resto', { dependDe: ['hotel'] }),
          element('bar', { dependDe: ['resto'] }),
          element('musee'),
        ],
      },
    ],
  });

  it('remonte les dépendants directs et transitifs', () => {
    expect(elementsDependants(parcours, 'hotel').sort()).toEqual(['bar', 'resto']);
  });

  it('ne touche pas les éléments indépendants', () => {
    expect(elementsDependants(parcours, 'musee')).toEqual([]);
  });
});

describe('detecterConflits — contraintes dures qui se chevauchent', () => {
  it('signale deux ancres datées au même horaire (histoire d’Inès)', () => {
    const parcours = parcoursMinimal({
      timeline: [
        {
          id: 'm1',
          titre: 'Jour 2 du festival',
          elements: [
            element('setA', {
              type: 'evenement',
              estAncre: true,
              plage: { debut: '2026-08-02T20:00:00Z', fin: '2026-08-02T21:30:00Z' },
            }),
            element('setB', {
              type: 'evenement',
              estAncre: true,
              plage: { debut: '2026-08-02T21:00:00Z', fin: '2026-08-02T22:30:00Z' },
            }),
          ],
        },
      ],
    });
    const conflits = detecterConflits(parcours);
    expect(conflits).toHaveLength(1);
    expect(conflits[0]).toMatchObject({ elementA: 'setA', elementB: 'setB' });
  });

  it('ignore les horaires simplement successifs ou souples', () => {
    const parcours = parcoursMinimal({
      timeline: [
        {
          id: 'm1',
          titre: 'Soirée',
          elements: [
            element('setA', {
              type: 'evenement',
              plage: { debut: '2026-08-02T20:00:00Z', fin: '2026-08-02T21:00:00Z' },
            }),
            element('setB', {
              type: 'evenement',
              plage: { debut: '2026-08-02T21:00:00Z', fin: '2026-08-02T22:00:00Z' },
            }),
            element('flanerie', {
              plage: { debut: '2026-08-02T20:00:00Z', fin: '2026-08-02T22:00:00Z' },
            }),
          ],
        },
      ],
    });
    expect(detecterConflits(parcours)).toEqual([]);
  });
});

describe('validerParcours — cohérence structurelle', () => {
  it('valide un parcours cohérent', () => {
    expect(validerParcours(parcoursMinimal())).toEqual([]);
  });

  it('signale une dépendance vers un élément inconnu', () => {
    const parcours = parcoursMinimal({
      timeline: [
        { id: 'm1', titre: 'Soirée', elements: [element('resto', { dependDe: ['fantome'] })] },
      ],
    });
    expect(validerParcours(parcours)).toHaveLength(1);
  });

  it('refuse une réservation sur un temps libre', () => {
    const parcours = parcoursMinimal({
      timeline: [
        {
          id: 'm1',
          titre: 'Après-midi',
          elements: [
            element('pause', {
              type: 'temps_libre',
              reservation: { lienExterne: 'https://exemple.fr/resa' },
            }),
          ],
        },
      ],
    });
    expect(validerParcours(parcours)).toHaveLength(1);
  });

  it('exige deux participants et un organisateur pour une surprise (Sam & Léa)', () => {
    const parcours = parcoursMinimal({ visibilite: 'surprise' });
    const erreurs = validerParcours(parcours);
    expect(erreurs.some((e) => e.includes('deux participants'))).toBe(true);
  });
});
