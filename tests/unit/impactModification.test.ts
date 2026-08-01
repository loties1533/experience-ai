import { describe, expect, it } from 'vitest';
import {
  ElementSchema,
  ParcoursSchema,
  type Parcours,
  type PlageHoraire,
} from '../../server/domaine/parcours/index.js';
import {
  JUSTIFICATION_TRANSPORT_GENERIQUE,
  LIBELLE_TRANSPORT_GENERIQUE,
} from '../../server/domaine/transport/invariants.js';
import {
  combinerImpacts,
  determinerImpactModification,
  type ChangementParcours,
} from '../../server/agents/impactModification.js';

// F8-A — le contrat de dépendances (invariant 3) précède toute régénération
// ciblée. Ces tests couvrent la matrice demandée : aucune dépendance ne doit
// être devinée, une dépendance certaine doit toujours ressortir, un cas non
// modélisé doit rester prudent et explicite — jamais un recalcul silencieux.

function element(id: string, surcharge: Partial<Parameters<typeof ElementSchema.parse>[0]> = {}) {
  return ElementSchema.parse({
    id,
    type: 'activite',
    nom: `Élément ${id}`,
    justification: 'cohérent avec l’intention',
    ...surcharge,
  });
}

// hotel <- resto <- bar (chaîne de dépendances, comme l'histoire de Thomas) ;
// transport1 est indépendant de cette chaîne.
function parcoursDeTest(dates?: PlageHoraire): Parcours {
  return ParcoursSchema.parse({
    id: 'p1',
    intention: { texte: 'vivre la NBA' },
    contexte: {
      avecQui: 'amis',
      duree: { valeur: 5, unite: 'jours' },
      lieux: ['Boston'],
      ...(dates ? { dates } : {}),
    },
    participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'm1',
        titre: 'Soirée à Boston',
        elements: [
          element('hotel', { type: 'hebergement', prix: 200 }),
          element('resto', { type: 'restaurant', dependDe: ['hotel'], prix: 40 }),
          element('bar', { dependDe: ['resto'] }),
        ],
      },
      {
        id: 'm2',
        titre: 'Transports à organiser',
        elements: [
          element('transport1', {
            type: 'transport',
            nom: LIBELLE_TRANSPORT_GENERIQUE,
            justification: JUSTIFICATION_TRANSPORT_GENERIQUE,
            confiance: { niveau: 'suggestion' },
          }),
        ],
      },
    ],
  });
}

describe('determinerImpactModification — matrice de dépendances', () => {
  it('changement de dates : impact intégral, aucune dépendance ciblée ne couvre les bornes de toutes les plages', () => {
    const impact = determinerImpactModification({ type: 'changer_dates' }, parcoursDeTest());
    expect(impact.regenererIntegralement).toBe(true);
    expect(impact.invaliderHebergement).toBe(true);
    expect(impact.invaliderTransport).toBe(true);
    expect(impact.invaliderBudget).toBe(true);
    expect(impact.elementsARegenerer).toEqual([]);
  });

  it('changement de durée sans dates : dépendance non modélisée, impact prudent explicite', () => {
    const impact = determinerImpactModification({ type: 'changer_duree' }, parcoursDeTest());
    expect(impact.regenererIntegralement).toBe(true);
    expect(impact.motif).toMatch(/prudent/);
  });

  it('changement de durée AVEC dates : les dates font foi, la durée ne pilote plus rien (aucun impact)', () => {
    const dates: PlageHoraire = { debut: '2026-08-01T00:00:00Z', fin: '2026-08-05T23:59:59Z' };
    const impact = determinerImpactModification({ type: 'changer_duree' }, parcoursDeTest(dates));
    expect(impact.regenererIntegralement).toBe(false);
    expect(impact.invaliderHebergement).toBe(false);
    expect(impact.invaliderTransport).toBe(false);
    expect(impact.invaliderBudget).toBe(false);
    expect(impact.elementsARegenerer).toEqual([]);
  });

  it('changement de voyageurs (composition) : impact intégral, aucune dépendance modélisée', () => {
    const impact = determinerImpactModification({ type: 'changer_composition' }, parcoursDeTest());
    expect(impact.regenererIntegralement).toBe(true);
  });

  it('changement de destination : impact intégral, rien ne relie un élément à une ville', () => {
    const impact = determinerImpactModification({ type: 'changer_destination' }, parcoursDeTest());
    expect(impact.regenererIntegralement).toBe(true);
    expect(impact.invaliderHebergement).toBe(true);
    expect(impact.invaliderTransport).toBe(true);
  });

  it("changement d'hébergement (remplacer_hotel) : dépendants ciblés, lien hôtelier invalidé, prix inchangé (aucun champ prix côté client)", () => {
    const impact = determinerImpactModification(
      { type: 'remplacer_hotel', elementId: 'hotel', villeDemandee: 'Boston', requete: 'hôtel' },
      parcoursDeTest()
    );
    expect(impact.regenererIntegralement).toBe(false);
    expect(impact.elementsARegenerer.sort()).toEqual(['bar', 'resto']);
    expect(impact.invaliderHebergement).toBe(true);
    // `elementHotelRemplace` recopie toujours `cible.prix` tel quel : aucun
    // remplacement d'hôtel ne peut changer le prix, donc le budget reste valide.
    expect(impact.invaliderBudget).toBe(false);
    expect(impact.invaliderTransport).toBe(false);
  });

  it("changement d'occupation hôtelière déclarée : hébergement invalidé sans toucher au budget", () => {
    const impact = determinerImpactModification(
      { type: 'modifier_occupation_hebergement', occupation: { statut: 'declaree', adultes: 2, enfants: 0 } },
      parcoursDeTest()
    );
    expect(impact.invaliderHebergement).toBe(true);
    expect(impact.invaliderBudget).toBe(false);
    expect(impact.regenererIntegralement).toBe(false);
  });

  it('changement de transport : élément transport et ses dépendants ciblés, hébergement intact', () => {
    const impact = determinerImpactModification(
      {
        type: 'modifier_demande_transport',
        demandeTransport: {
          troncons: [{ origine: { ville: 'Paris' }, destination: { ville: 'Boston' }, depart: { date: '2026-08-01' } }],
          occupation: { statut: 'declaree', adultes: 2, enfants: 0 },
        },
      },
      parcoursDeTest()
    );
    expect(impact.invaliderTransport).toBe(true);
    expect(impact.invaliderHebergement).toBe(false);
    expect(impact.invaliderBudget).toBe(false);
    expect(impact.regenererIntegralement).toBe(false);
  });

  it('modification d’une activité unique (remplacer_element) : seuls les dépendants réels sont ciblés', () => {
    const impact = determinerImpactModification(
      {
        type: 'remplacer_element',
        elementId: 'resto',
        remplacement: { type: 'restaurant', nom: 'Chez Rose', justification: 'plus proche du stade' },
      },
      parcoursDeTest()
    );
    expect(impact.elementsARegenerer).toEqual(['bar']);
    expect(impact.regenererIntegralement).toBe(false);
    expect(impact.invaliderHebergement).toBe(false);
    expect(impact.invaliderTransport).toBe(false);
    expect(impact.invaliderBudget).toBe(true);
  });

  it('suppression d’un élément qui n’a aucun dépendant : aucun élément marqué, budget invalidé', () => {
    const impact = determinerImpactModification(
      { type: 'supprimer_element', elementId: 'bar' },
      parcoursDeTest()
    );
    expect(impact.elementsARegenerer).toEqual([]);
    expect(impact.invaliderBudget).toBe(true);
  });

  it('modification sans impact (changer_statut) : aucun élément indépendant n’est marqué à régénérer', () => {
    const impact = determinerImpactModification(
      { type: 'changer_statut', elementId: 'bar', statut: 'accepte' },
      parcoursDeTest()
    );
    expect(impact.elementsARegenerer).toEqual([]);
    expect(impact.regenererIntegralement).toBe(false);
    expect(impact.invaliderHebergement).toBe(false);
    expect(impact.invaliderTransport).toBe(false);
    expect(impact.invaliderBudget).toBe(false);
  });

  it('cas ambigu : le motif documente toujours pourquoi la portée a été retenue', () => {
    const impact = determinerImpactModification({ type: 'changer_composition' }, parcoursDeTest());
    expect(impact.motif.length).toBeGreaterThan(0);
  });
});

describe('determinerImpactModification — garanties transverses', () => {
  it('ne mute jamais le parcours reçu', () => {
    const parcours = parcoursDeTest();
    const copie = JSON.parse(JSON.stringify(parcours));
    determinerImpactModification({ type: 'supprimer_element', elementId: 'resto' }, parcours);
    expect(parcours).toEqual(copie);
  });

  it('ne déclenche aucun appel réseau (fonction synchrone, pure)', () => {
    const resultat = determinerImpactModification({ type: 'changer_dates' }, parcoursDeTest());
    expect(resultat).not.toBeInstanceOf(Promise);
  });
});

describe('combinerImpacts — plusieurs changements simultanés', () => {
  it('fusionne les dépendants et OR les invalidations de deux changements', () => {
    const changements: ChangementParcours[] = [
      { type: 'supprimer_element', elementId: 'resto' },
      { type: 'modifier_demande_transport', demandeTransport: { troncons: [], occupation: { statut: 'declaree', adultes: 1, enfants: 0 } } },
    ];
    const parcours = parcoursDeTest();
    const impacts = changements.map((c) => determinerImpactModification(c, parcours));
    const fusion = combinerImpacts(impacts);

    expect(fusion.elementsARegenerer.sort()).toEqual(['bar']);
    expect(fusion.invaliderBudget).toBe(true);
    expect(fusion.invaliderTransport).toBe(true);
    expect(fusion.regenererIntegralement).toBe(false);
  });

  it('un seul changement intégral suffit à rendre la fusion intégrale', () => {
    const parcours = parcoursDeTest();
    const fusion = combinerImpacts([
      determinerImpactModification({ type: 'changer_statut', elementId: 'bar', statut: 'accepte' }, parcours),
      determinerImpactModification({ type: 'changer_destination' }, parcours),
    ]);
    expect(fusion.regenererIntegralement).toBe(true);
  });

  it('un impact intégral vide toujours la liste ciblée de la fusion, même combiné à une liste partielle non vide', () => {
    const parcours = parcoursDeTest();
    const fusion = combinerImpacts([
      determinerImpactModification({ type: 'supprimer_element', elementId: 'hotel' }, parcours),
      determinerImpactModification({ type: 'changer_dates' }, parcours),
    ]);
    expect(fusion.regenererIntegralement).toBe(true);
    expect(fusion.elementsARegenerer).toEqual([]);
  });
});
