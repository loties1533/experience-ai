import { describe, it, expect } from 'vitest';
import {
  ParcoursSchema,
  ElementSchema,
  PlageHoraireSchema,
  elementsDependants,
  detecterConflits,
  validerParcours,
  alternativesProposables,
  verifierResponsabilite,
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

  it('signale une boucle de dépendances (directe ou par ricochet)', () => {
    const parcours = parcoursMinimal({
      timeline: [
        {
          id: 'm1',
          titre: 'Soirée',
          elements: [
            element('resto', { dependDe: ['bar'] }),
            element('bar', { dependDe: ['resto'] }),
          ],
        },
      ],
    });
    const erreurs = validerParcours(parcours);
    expect(erreurs.some((e) => e.includes('boucle'))).toBe(true);
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

  it('signale deux alternatives de même id sur un élément', () => {
    const parcours = parcoursMinimal({
      timeline: [
        {
          id: 'm1',
          titre: 'Soirée',
          elements: [
            element('creneau', {
              alternatives: [
                { id: 'setA', nom: 'Set A' },
                { id: 'setA', nom: 'Set A bis' },
              ],
            }),
          ],
        },
      ],
    });
    expect(validerParcours(parcours).some((e) => e.includes('ids distincts'))).toBe(true);
  });
});

// Les dates réelles du parcours : le festival d'Inès a lieu les 12-14 juillet,
// rien de ce parcours ne se passe en dehors.
describe('les dates du parcours', () => {
  const DATES = { debut: '2026-07-12T00:00:00Z', fin: '2026-07-14T23:59:59Z' };

  function parcoursDate(plageElement?: { debut: string; fin: string }): Parcours {
    return parcoursMinimal({
      contexte: {
        avecQui: 'amis',
        duree: { valeur: 3, unite: 'jours' },
        dates: DATES,
        lieux: [],
      },
      timeline: [
        {
          id: 'm1',
          titre: 'Vendredi',
          elements: [element('set', { type: 'evenement', plage: plageElement })],
        },
      ],
    });
  }

  it('accepte un parcours sans dates (Karim sort ce soir)', () => {
    const parcours = parcoursMinimal();
    expect(parcours.contexte.dates).toBeUndefined();
    expect(validerParcours(parcours)).toEqual([]);
  });

  it('refuse des dates dont le début suit la fin', () => {
    const resultat = ParcoursSchema.safeParse({
      ...parcoursMinimal(),
      contexte: {
        avecQui: 'amis',
        duree: { valeur: 3, unite: 'jours' },
        dates: { debut: '2026-07-14T00:00:00Z', fin: '2026-07-12T00:00:00Z' },
      },
    });
    expect(resultat.success).toBe(false);
  });

  it('laisse passer un élément qui tombe dans les dates', () => {
    const parcours = parcoursDate({ debut: '2026-07-12T20:00:00Z', fin: '2026-07-12T21:30:00Z' });
    expect(validerParcours(parcours)).toEqual([]);
  });

  it('signale un élément qui déborde des dates du parcours', () => {
    const parcours = parcoursDate({ debut: '2026-07-15T20:00:00Z', fin: '2026-07-15T21:30:00Z' });
    expect(validerParcours(parcours).some((e) => e.includes('hors des dates'))).toBe(true);
  });

  // Seul le DÉBUT est contrôlé : un club ferme après minuit et un hébergement
  // se rend le lendemain matin. Exiger que la fin tombe aussi dans les bornes
  // rendait ces deux cas impossibles — la génération échouait alors trois fois
  // sur quatre en « parcours incohérent », alors que le parcours était juste.
  it('accepte une soirée qui se termine après minuit', () => {
    const parcours = parcoursDate({ debut: '2026-07-14T22:00:00Z', fin: '2026-07-15T02:00:00Z' });
    expect(validerParcours(parcours)).toEqual([]);
  });

  it('accepte un hébergement rendu le lendemain du dernier jour', () => {
    const parcours = parcoursDate({ debut: '2026-07-12T14:00:00Z', fin: '2026-07-15T11:00:00Z' });
    expect(validerParcours(parcours)).toEqual([]);
  });

  it('refuse un élément qui commence après la fin du parcours', () => {
    const parcours = parcoursDate({ debut: '2026-07-15T09:00:00Z', fin: '2026-07-15T10:00:00Z' });
    expect(validerParcours(parcours).some((e) => e.includes('hors des dates'))).toBe(true);
  });

  it('signale un moment qui sort des dates du parcours', () => {
    const parcours = parcoursMinimal({
      contexte: {
        avecQui: 'amis',
        duree: { valeur: 3, unite: 'jours' },
        dates: DATES,
        lieux: [],
      },
      timeline: [
        {
          id: 'm1',
          titre: 'Le jour d’après',
          plage: { debut: '2026-07-16T10:00:00Z', fin: '2026-07-16T18:00:00Z' },
          elements: [],
        },
      ],
    });
    expect(validerParcours(parcours).some((e) => e.includes('hors des dates'))).toBe(true);
  });

  it('n’examine aucune plage quand le parcours n’a pas de dates', () => {
    const parcours = parcoursMinimal({
      timeline: [
        {
          id: 'm1',
          titre: 'Un jour',
          elements: [
            element('set', {
              type: 'evenement',
              plage: { debut: '2030-01-01T20:00:00Z', fin: '2030-01-01T22:00:00Z' },
            }),
          ],
        },
      ],
    });
    expect(validerParcours(parcours)).toEqual([]);
  });

  it('laisse coexister durée et dates sans les confondre', () => {
    // La durée dit l'envie (« trois jours »), les dates disent le calendrier.
    // Aucune n'est recalculée depuis l'autre : un écart n'est pas une erreur.
    const parcours = parcoursMinimal({
      contexte: {
        avecQui: 'amis',
        duree: { valeur: 21, unite: 'jours' },
        dates: DATES,
        lieux: [],
      },
    });
    expect(parcours.contexte.duree.valeur).toBe(21);
    expect(parcours.contexte.dates).toEqual(DATES);
    expect(validerParcours(parcours)).toEqual([]);
  });

  it('accepte un ISO sans fuseau (le LLM en génération l’omet systématiquement)', () => {
    const plage = PlageHoraireSchema.parse({
      debut: '2025-01-15T08:00:00',
      fin: '2025-01-15T12:00:00',
    });
    expect(plage.debut).toBe('2025-01-15T08:00:00Z');
    expect(plage.fin).toBe('2025-01-15T12:00:00Z');
  });

  it('rejette toujours un format réellement invalide', () => {
    expect(() => PlageHoraireSchema.parse({ debut: 'pas une date', fin: '2025-01-15T12:00:00Z' }))
      .toThrow();
  });
});

describe('alternativesProposables — invariant 7 (un arbitrage est définitif)', () => {
  it('ne rend que les options non écartées', () => {
    const creneau = element('creneau', {
      alternatives: [
        { id: 'setA', nom: 'Set A' },
        { id: 'setB', nom: 'Set B', ecartee: true },
      ],
    });
    expect(alternativesProposables(creneau).map((a) => a.id)).toEqual(['setA']);
  });

  it('considère une option comme proposable par défaut', () => {
    const creneau = element('creneau', { alternatives: [{ id: 'setA', nom: 'Set A' }] });
    expect(creneau.alternatives[0].ecartee).toBe(false);
    expect(alternativesProposables(creneau)).toHaveLength(1);
  });
});

describe('verifierResponsabilite — invariant 8 (les rôles)', () => {
  const parcours = parcoursMinimal({
    participants: [
      { id: 'hugo', nom: 'Hugo', role: 'organisateur' },
      { id: 'lea', nom: 'Léa', role: 'participant' },
      { id: 'max', nom: 'Max', role: 'heros' },
    ],
  });

  it('laisse l’organisateur décider, modifier et supprimer', () => {
    for (const action of ['proposer', 'ajuster', 'supprimer', 'arbitrer'] as const) {
      expect(verifierResponsabilite(parcours, 'hugo', action)).toBeNull();
    }
  });

  it('laisse le participant proposer et ajuster, mais pas supprimer ni arbitrer', () => {
    expect(verifierResponsabilite(parcours, 'lea', 'proposer')).toBeNull();
    expect(verifierResponsabilite(parcours, 'lea', 'ajuster')).toBeNull();
    expect(verifierResponsabilite(parcours, 'lea', 'supprimer')).toContain('organisateur');
    expect(verifierResponsabilite(parcours, 'lea', 'arbitrer')).toContain('organisateur');
  });

  it('n’autorise rien au héros', () => {
    expect(verifierResponsabilite(parcours, 'max', 'proposer')).toContain('héros');
    expect(verifierResponsabilite(parcours, 'max', 'ajuster')).toContain('héros');
  });

  it('refuse un auteur étranger au parcours', () => {
    expect(verifierResponsabilite(parcours, 'inconnu', 'proposer')).toContain(
      'ne faites pas partie'
    );
  });
});
