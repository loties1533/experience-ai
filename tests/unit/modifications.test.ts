import { describe, it, expect } from 'vitest';
import {
  ParcoursSchema,
  ElementSchema,
  DemandeModificationSchema,
  appliquerModification,
  type Parcours,
} from '../../server/domaine/parcours/index.js';

const HORODATAGE = '2026-07-23T18:00:00Z';

function element(id: string, surcharge: Partial<Parameters<typeof ElementSchema.parse>[0]> = {}) {
  return ElementSchema.parse({
    id,
    type: 'activite',
    nom: `Élément ${id}`,
    justification: 'cohérent avec l’intention',
    ...surcharge,
  });
}

// Timeline de référence : resto dépend de l'hôtel, bar dépend du resto
// (l'histoire de Thomas : « change juste le resto » ne touche pas l'hôtel).
function parcoursDeTest(): Parcours {
  return ParcoursSchema.parse({
    id: 'p1',
    intention: { texte: 'vivre la NBA' },
    contexte: { avecQui: 'solo', duree: { valeur: 21, unite: 'jours' } },
    participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'm1',
        titre: 'Soirée à Boston',
        elements: [
          element('hotel', { type: 'hebergement' }),
          element('resto', { type: 'restaurant', dependDe: ['hotel'] }),
          element('bar', { dependDe: ['resto'] }),
        ],
      },
    ],
  });
}

describe('remplacer_element — invariant 3, le recalcul reste ciblé', () => {
  const demande = DemandeModificationSchema.parse({
    type: 'remplacer_element',
    elementId: 'resto',
    remplacement: {
      type: 'restaurant',
      nom: 'Chez Rose',
      justification: 'plus proche de l’hôtel',
    },
  });

  it('remplace en gardant l’id (adressage stable pour le front)', () => {
    const resultat = appliquerModification(parcoursDeTest(), demande, HORODATAGE);
    if (!resultat.ok) throw new Error(resultat.erreur);
    const resto = resultat.parcours.timeline[0].elements.find((e) => e.id === 'resto');
    expect(resto?.nom).toBe('Chez Rose');
  });

  it('ne demande de régénérer que les dépendants, jamais l’amont', () => {
    const resultat = appliquerModification(parcoursDeTest(), demande, HORODATAGE);
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(resultat.elementsARegenerer).toEqual(['bar']);
  });

  it('ne mute jamais le parcours d’origine', () => {
    const origine = parcoursDeTest();
    appliquerModification(origine, demande, HORODATAGE);
    expect(origine.timeline[0].elements.find((e) => e.id === 'resto')?.nom).toBe('Élément resto');
    expect(origine.historique).toEqual([]);
  });

  it('journalise la modification avec une description affichable', () => {
    const resultat = appliquerModification(parcoursDeTest(), demande, HORODATAGE);
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(resultat.parcours.historique).toHaveLength(1);
    expect(resultat.parcours.historique[0]).toMatchObject({
      date: HORODATAGE,
      elementId: 'resto',
    });
    expect(resultat.description).toContain('Chez Rose');
  });

  it('rend une erreur affichable si l’élément est introuvable', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { ...demande, elementId: 'fantome' },
      HORODATAGE
    );
    expect(resultat).toMatchObject({ ok: false });
  });
});

describe('supprimer_element', () => {
  it('supprime, détache les dépendants et les signale à régénérer', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { type: 'supprimer_element', elementId: 'hotel' },
      HORODATAGE
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    const ids = resultat.parcours.timeline[0].elements.map((e) => e.id);
    expect(ids).toEqual(['resto', 'bar']);
    expect(resultat.parcours.timeline[0].elements[0].dependDe).toEqual([]);
    expect(resultat.elementsARegenerer.sort()).toEqual(['bar', 'resto']);
  });
});

describe('ajouter_element', () => {
  it('ajoute au bon moment, rien à régénérer', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { type: 'ajouter_element', momentId: 'm1', element: element('musee') },
      HORODATAGE
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(resultat.parcours.timeline[0].elements).toHaveLength(4);
    expect(resultat.elementsARegenerer).toEqual([]);
  });

  it('refuse un id déjà pris', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { type: 'ajouter_element', momentId: 'm1', element: element('resto') },
      HORODATAGE
    );
    expect(resultat).toMatchObject({ ok: false });
  });

  it('refuse un élément qui rendrait le parcours incohérent (dépendance inconnue)', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { type: 'ajouter_element', momentId: 'm1', element: element('spa', { dependDe: ['fantome'] }) },
      HORODATAGE
    );
    expect(resultat).toMatchObject({ ok: false });
    if (!resultat.ok) expect(resultat.erreur).toContain('incohérent');
  });
});

describe('changer_statut — l’utilisateur garde le dernier mot (invariant 6)', () => {
  it('accepte un élément sans rien régénérer', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { type: 'changer_statut', elementId: 'bar', statut: 'accepte' },
      HORODATAGE
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(resultat.parcours.timeline[0].elements.find((e) => e.id === 'bar')?.statut).toBe('accepte');
    expect(resultat.elementsARegenerer).toEqual([]);
    expect(resultat.description).toContain('accepté');
  });
});
