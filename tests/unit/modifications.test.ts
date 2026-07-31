import { describe, it, expect } from 'vitest';
import {
  ParcoursSchema,
  ElementSchema,
  DemandeSurElementClientSchema,
  DemandeModificationSchema,
  appliquerModification,
  alternativesProposables,
  preparerDemandeSurElementClient,
  type Parcours,
} from '../../server/domaine/parcours/index.js';

const HORODATAGE = '2026-07-23T18:00:00Z';
// L'organisateur signe les modifications, sauf mention contraire (invariant 8).
const PAR_ORGANISATEUR = { auteurId: 'u1', horodatage: HORODATAGE };

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

describe('contrat client — les preuves restent côté serveur', () => {
  const proposition = {
    type: 'restaurant',
    nom: 'Chez Rose',
    lieu: 'Bordeaux',
    prix: 45,
    justification: 'une table adaptée au parcours',
  };

  it.each([
    ['confiance', { confiance: { niveau: 'verifie' } }],
    [
      'provenance',
      {
        provenance: {
          fournisseur: 'Foursquare',
          source: 'forgée',
        },
      },
    ],
    ['identifiant externe', { identifiantExterne: 'fsq-forge' }],
    ['adresse fournisseur', { adresse: '1 rue inventée' }],
    ['date de récupération', { recupereLe: '2026-07-29T12:00:00Z' }],
    [
      'lien Booking',
      {
        lienRechercheHebergement: {
          type: 'recherche',
          fournisseur: 'Booking',
          url: 'https://www.booking.com/searchresults.html',
          libelle: 'Rechercher des hébergements sur Booking',
          genereLe: '2026-07-29T12:00:00Z',
        },
      },
    ],
    [
      'réservation',
      {
        reservation: {
          lienExterne: 'https://evil.test',
          fournisseur: 'Faux',
          typeLien: 'reservation',
        },
      },
    ],
    ['disponibilité', { disponibilite: true }],
    ['prix observé', { prixObserve: 12 }],
  ])('refuse une proposition portant une fausse %s', (_nom, ajout) => {
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'ajouter_element',
        momentId: 'm1',
        element: { ...proposition, ...ajout },
      }).success
    ).toBe(false);
  });

  it('refuse de créer ou remplacer un hôtel par le chemin générique', () => {
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'ajouter_element',
        momentId: 'm1',
        element: {
          ...proposition,
          type: 'hebergement',
          nom: 'Hôtel forgé',
        },
      }).success
    ).toBe(false);
  });

  // F4-E — le transport suit l'hébergement : il ne passe plus par le chemin
  // générique. Sans cette exclusion, un ajout/remplacement transport pourrait
  // désynchroniser la correspondance positionnelle tronçon ↔ élément sur
  // laquelle `modifier_demande_transport` s'appuie.
  it.each([
    ['ajouter_element', { type: 'ajouter_element', momentId: 'm1' }],
    ['remplacer_element', { type: 'remplacer_element', elementId: 'transport-0' }],
  ])('refuse de créer ou remplacer un transport par %s générique', (_type, enveloppe) => {
    const champ =
      enveloppe.type === 'ajouter_element' ? 'element' : 'remplacement';
    expect(
      DemandeSurElementClientSchema.safeParse({
        ...enveloppe,
        [champ]: {
          type: 'transport',
          nom: 'Vol forgé BOD-CDG',
          justification: 'un trajet inventé par le client',
        },
      }).success
    ).toBe(false);
  });

  it('laisse inchangés les types génériques autorisés', () => {
    for (const type of [
      'activite',
      'restaurant',
      'sortie',
      'evenement',
      'temps_libre',
    ]) {
      expect(
        DemandeSurElementClientSchema.safeParse({
          type: 'ajouter_element',
          momentId: 'm1',
          element: { ...proposition, type },
        }).success
      ).toBe(true);
    }
  });

  it('refuse une preuve injectée dans une intention remplacer_hotel', () => {
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'remplacer_hotel',
        elementId: 'hotel',
        villeDemandee: 'Bordeaux',
        requete: 'Hôtel Burdigala',
        confiance: {
          niveau: 'verifie',
          fournisseur: 'Foursquare',
        },
        identifiantExterne: 'fsq-forge',
      }).success
    ).toBe(false);
  });

  it('refuse les champs inconnus dans les sous-objets client', () => {
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'modifier_occupation_hebergement',
        occupation: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
          provenance: 'Foursquare',
        },
      }).success
    ).toBe(false);
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'ajouter_element',
        momentId: 'm1',
        element: {
          type: 'activite',
          nom: 'Visite',
          justification: 'découvrir la ville',
          plage: {
            debut: '2026-08-10T10:00:00.000Z',
            fin: '2026-08-10T12:00:00.000Z',
            confiance: 'verifie',
          },
        },
      }).success
    ).toBe(false);
  });

  it('refuse un identifiant dans un ajout ou un remplacement client', () => {
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'ajouter_element',
        momentId: 'm1',
        element: {
          id: 'resto',
          type: 'activite',
          nom: 'Visite',
          justification: 'découvrir la ville',
        },
      }).success
    ).toBe(false);
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'remplacer_element',
        elementId: 'resto',
        remplacement: {
          id: 'hotel',
          type: 'restaurant',
          nom: 'Chez Rose',
          justification: 'changer de table',
        },
      }).success
    ).toBe(false);
  });

  it('attribue l’id et la confiance minimale côté serveur', () => {
    const demande = DemandeSurElementClientSchema.parse({
      type: 'ajouter_element',
      momentId: 'm1',
      element: proposition,
    });
    if (
      demande.type === 'modifier_sejour_hebergement' ||
      demande.type === 'modifier_occupation_hebergement' ||
      demande.type === 'remplacer_hotel'
    ) {
      throw new Error('demande pure attendue');
    }
    const interne = preparerDemandeSurElementClient(
      demande,
      () => 'id-serveur'
    );
    if (interne.type !== 'ajouter_element') {
      throw new Error('ajout attendu');
    }
    expect(interne.element).toMatchObject({
      id: 'id-serveur',
      confiance: { niveau: 'suggestion' },
      prixEstime: true,
    });
  });

  it('n’écrase jamais un élément si le générateur d’id produit une collision', () => {
    const demande = DemandeSurElementClientSchema.parse({
      type: 'ajouter_element',
      momentId: 'm1',
      element: proposition,
    });
    if (
      demande.type === 'modifier_sejour_hebergement' ||
      demande.type === 'modifier_occupation_hebergement' ||
      demande.type === 'remplacer_hotel'
    ) {
      throw new Error('demande pure attendue');
    }
    const interne = preparerDemandeSurElementClient(
      demande,
      () => 'resto'
    );
    const resultat = appliquerModification(
      parcoursDeTest(),
      interne,
      PAR_ORGANISATEUR
    );
    expect(resultat).toMatchObject({ ok: false });
    expect(
      parcoursDeTest().timeline[0].elements.find(
        (courant) => courant.id === 'resto'
      )?.nom
    ).toBe('Élément resto');
  });
});

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
    const resultat = appliquerModification(parcoursDeTest(), demande, PAR_ORGANISATEUR);
    if (!resultat.ok) throw new Error(resultat.erreur);
    const resto = resultat.parcours.timeline[0].elements.find((e) => e.id === 'resto');
    expect(resto?.nom).toBe('Chez Rose');
  });

  it('ne demande de régénérer que les dépendants, jamais l’amont', () => {
    const resultat = appliquerModification(parcoursDeTest(), demande, PAR_ORGANISATEUR);
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(resultat.elementsARegenerer).toEqual(['bar']);
  });

  it('ne mute jamais le parcours d’origine', () => {
    const origine = parcoursDeTest();
    appliquerModification(origine, demande, PAR_ORGANISATEUR);
    expect(origine.timeline[0].elements.find((e) => e.id === 'resto')?.nom).toBe('Élément resto');
    expect(origine.historique).toEqual([]);
  });

  it('journalise la modification avec une description affichable', () => {
    const resultat = appliquerModification(parcoursDeTest(), demande, PAR_ORGANISATEUR);
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
      PAR_ORGANISATEUR
    );
    expect(resultat).toMatchObject({ ok: false });
  });
});

describe('supprimer_element', () => {
  it('supprime, détache les dépendants et les signale à régénérer', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { type: 'supprimer_element', elementId: 'hotel' },
      PAR_ORGANISATEUR
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    const ids = resultat.parcours.timeline[0].elements.map((e) => e.id);
    expect(ids).toEqual(['resto', 'bar']);
    expect(resultat.parcours.timeline[0].elements[0].dependDe).toEqual([]);
    expect(resultat.elementsARegenerer.sort()).toEqual(['bar', 'resto']);
  });

  it('retire l’occupation quand le dernier hébergement disparaît', () => {
    const parcours = ParcoursSchema.parse({
      ...parcoursDeTest(),
      contexte: {
        ...parcoursDeTest().contexte,
        occupationHebergement: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
        },
      },
    });
    const resultat = appliquerModification(
      parcours,
      { type: 'supprimer_element', elementId: 'hotel' },
      PAR_ORGANISATEUR
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(
      resultat.parcours.contexte.occupationHebergement
    ).toBeUndefined();
    expect(
      resultat.parcours.timeline
        .flatMap((moment) => moment.elements)
        .some((courant) => courant.type === 'hebergement')
    ).toBe(false);
  });

  it('conserve l’occupation et les autres hôtels lorsqu’un seul est supprimé', () => {
    const deuxHotels = ParcoursSchema.parse({
      ...parcoursDeTest(),
      contexte: {
        ...parcoursDeTest().contexte,
        occupationHebergement: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
        },
      },
      timeline: [
        {
          ...parcoursDeTest().timeline[0],
          elements: [
            ...parcoursDeTest().timeline[0].elements,
            element('hotel-lyon', {
              type: 'hebergement',
              nom: 'Hôtel Lyon',
            }),
          ],
        },
      ],
    });
    const hotelRestantAvant =
      deuxHotels.timeline[0].elements.find(
        (courant) => courant.id === 'hotel-lyon'
      );
    const resultat = appliquerModification(
      deuxHotels,
      { type: 'supprimer_element', elementId: 'hotel' },
      PAR_ORGANISATEUR
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(
      resultat.parcours.contexte.occupationHebergement
    ).toEqual({
      statut: 'declaree',
      adultes: 2,
      enfants: 0,
      chambres: 1,
    });
    expect(
      resultat.parcours.timeline[0].elements.find(
        (courant) => courant.id === 'hotel-lyon'
      )
    ).toEqual(hotelRestantAvant);
  });
});

describe('ajouter_element', () => {
  it('ajoute au bon moment, rien à régénérer', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { type: 'ajouter_element', momentId: 'm1', element: element('musee') },
      PAR_ORGANISATEUR
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(resultat.parcours.timeline[0].elements).toHaveLength(4);
    expect(resultat.elementsARegenerer).toEqual([]);
  });

  it('refuse un id déjà pris', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { type: 'ajouter_element', momentId: 'm1', element: element('resto') },
      PAR_ORGANISATEUR
    );
    expect(resultat).toMatchObject({ ok: false });
  });

  it('refuse un élément qui rendrait le parcours incohérent (dépendance inconnue)', () => {
    const resultat = appliquerModification(
      parcoursDeTest(),
      { type: 'ajouter_element', momentId: 'm1', element: element('spa', { dependDe: ['fantome'] }) },
      PAR_ORGANISATEUR
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
      PAR_ORGANISATEUR
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(resultat.parcours.timeline[0].elements.find((e) => e.id === 'bar')?.statut).toBe('accepte');
    expect(resultat.elementsARegenerer).toEqual([]);
    expect(resultat.description).toContain('accepté');
  });
});

// ---- Invariant 7 : un arbitrage est définitif (histoire d'Inès) ----
// Deux sets au même horaire, elle tranche pour l'artiste A : le set B ne doit
// plus jamais lui être proposé, même trois jours plus tard.
function parcoursFestival(): Parcours {
  return ParcoursSchema.parse({
    id: 'p2',
    intention: { texte: 'vivre le festival sans rater mes artistes' },
    contexte: { avecQui: 'amis', duree: { valeur: 3, unite: 'jours' } },
    participants: [{ id: 'u1', nom: 'Inès', role: 'organisateur' }],
    budget: { mode: 'partage' },
    timeline: [
      {
        id: 'm1',
        titre: 'Vendredi soir',
        elements: [
          element('creneau-22h', {
            type: 'evenement',
            estAncre: true,
            confiance: {
              niveau: 'verifie',
              source: 'PredictHQ API',
              fournisseur: 'PredictHQ',
              recupereLe: '2026-07-23T17:00:00Z',
              identifiantExterne: 'festival-set-22h',
            },
            alternatives: [
              { id: 'artisteA', nom: 'Set de l’artiste A' },
              { id: 'artisteB', nom: 'Set de l’artiste B' },
            ],
          }),
        ],
      },
    ],
  });
}

const ECARTER_B = {
  type: 'ecarter_alternative',
  elementId: 'creneau-22h',
  alternativeId: 'artisteB',
} as const;

describe('ecarter_alternative — invariant 7, une option écartée ne revient pas', () => {
  it('mémorise l’arbitrage et retire l’option des propositions', () => {
    const resultat = appliquerModification(parcoursFestival(), ECARTER_B, PAR_ORGANISATEUR);
    if (!resultat.ok) throw new Error(resultat.erreur);
    const creneau = resultat.parcours.timeline[0].elements[0];
    expect(creneau.alternatives.find((a) => a.id === 'artisteB')?.ecartee).toBe(true);
    expect(alternativesProposables(creneau).map((a) => a.id)).toEqual(['artisteA']);
  });

  it('journalise l’arbitrage dans l’historique', () => {
    const resultat = appliquerModification(parcoursFestival(), ECARTER_B, PAR_ORGANISATEUR);
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(resultat.parcours.historique).toHaveLength(1);
    expect(resultat.description).toContain('écarté');
  });

  it('ne mute jamais le parcours d’origine', () => {
    const origine = parcoursFestival();
    appliquerModification(origine, ECARTER_B, PAR_ORGANISATEUR);
    expect(origine.timeline[0].elements[0].alternatives.every((a) => !a.ecartee)).toBe(true);
  });

  it('refuse d’écarter deux fois la même option', () => {
    const premier = appliquerModification(parcoursFestival(), ECARTER_B, PAR_ORGANISATEUR);
    if (!premier.ok) throw new Error(premier.erreur);
    const second = appliquerModification(premier.parcours, ECARTER_B, PAR_ORGANISATEUR);
    expect(second).toMatchObject({ ok: false });
    if (!second.ok) expect(second.erreur).toContain('déjà été écarté');
  });

  it('refuse une option inconnue', () => {
    const resultat = appliquerModification(
      parcoursFestival(),
      { ...ECARTER_B, alternativeId: 'artisteZ' },
      PAR_ORGANISATEUR
    );
    expect(resultat).toMatchObject({ ok: false });
  });

  it('ne laisse pas un remplacement ressusciter une option écartée', () => {
    const arbitre = appliquerModification(parcoursFestival(), ECARTER_B, PAR_ORGANISATEUR);
    if (!arbitre.ok) throw new Error(arbitre.erreur);

    // Le remplaçant repropose le set B comme si de rien n'était.
    const resultat = appliquerModification(
      arbitre.parcours,
      {
        type: 'remplacer_element',
        elementId: 'creneau-22h',
        remplacement: ElementSchema.omit({ id: true }).parse({
          type: 'evenement',
          nom: 'Créneau de 22 h',
          justification: 'le temps fort de la soirée',
          alternatives: [{ id: 'artisteB', nom: 'Set de l’artiste B' }],
        }),
      },
      PAR_ORGANISATEUR
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    const creneau = resultat.parcours.timeline[0].elements[0];
    expect(creneau.alternatives.find((a) => a.id === 'artisteB')?.ecartee).toBe(true);
    expect(alternativesProposables(creneau)).toEqual([]);
  });
});

describe('les dates du parcours encadrent aussi les modifications', () => {
  function parcoursDate(): Parcours {
    return ParcoursSchema.parse({
      id: 'p4',
      intention: { texte: 'vivre le festival' },
      contexte: {
        avecQui: 'amis',
        duree: { valeur: 3, unite: 'jours' },
        dates: { debut: '2026-07-12T00:00:00Z', fin: '2026-07-14T23:59:59Z' },
      },
      participants: [{ id: 'u1', nom: 'Inès', role: 'organisateur' }],
      budget: { mode: 'partage' },
      timeline: [{ id: 'm1', titre: 'Vendredi', elements: [element('set')] }],
    });
  }

  it('refuse d’ajouter un élément en dehors des dates', () => {
    const resultat = appliquerModification(
      parcoursDate(),
      {
        type: 'ajouter_element',
        momentId: 'm1',
        element: element('after', {
          plage: { debut: '2026-07-20T20:00:00Z', fin: '2026-07-20T23:00:00Z' },
        }),
      },
      PAR_ORGANISATEUR
    );
    expect(resultat).toMatchObject({ ok: false });
    if (!resultat.ok) expect(resultat.erreur).toContain('hors des dates');
  });

  it('accepte un élément qui tombe dans les dates', () => {
    const resultat = appliquerModification(
      parcoursDate(),
      {
        type: 'ajouter_element',
        momentId: 'm1',
        element: element('after', {
          plage: { debut: '2026-07-13T20:00:00Z', fin: '2026-07-13T23:00:00Z' },
        }),
      },
      PAR_ORGANISATEUR
    );
    expect(resultat.ok).toBe(true);
  });
});

// ---- Invariant 8 : chacun modifie dans le cadre de son rôle (EVG de Hugo) ----
function parcoursEVG(): Parcours {
  return ParcoursSchema.parse({
    id: 'p3',
    intention: { texte: 'l’EVG de Max' },
    contexte: { avecQui: 'groupe', duree: { valeur: 2, unite: 'jours' } },
    participants: [
      { id: 'hugo', nom: 'Hugo', role: 'organisateur' },
      { id: 'lea', nom: 'Léa', role: 'participant' },
      { id: 'max', nom: 'Max', role: 'heros' },
    ],
    budget: { mode: 'partage' },
    visibilite: 'surprise',
    timeline: [
      {
        id: 'm1',
        titre: 'Samedi',
        elements: [
          element('karting'),
          element('resto', {
            type: 'restaurant',
            alternatives: [{ id: 'brasserie', nom: 'La brasserie du port' }],
          }),
        ],
      },
    ],
  });
}

const SUPPRESSION = { type: 'supprimer_element', elementId: 'karting' } as const;

describe('invariant 8 — les responsabilités du rôle de l’auteur', () => {
  it('laisse l’organisateur tout faire', () => {
    const resultat = appliquerModification(parcoursEVG(), SUPPRESSION, {
      auteurId: 'hugo',
      horodatage: HORODATAGE,
    });
    expect(resultat.ok).toBe(true);
  });

  it('laisse un participant proposer un élément', () => {
    const resultat = appliquerModification(
      parcoursEVG(),
      { type: 'ajouter_element', momentId: 'm1', element: element('bar') },
      { auteurId: 'lea', horodatage: HORODATAGE }
    );
    expect(resultat.ok).toBe(true);
  });

  it('empêche un participant de supprimer un élément', () => {
    const resultat = appliquerModification(parcoursEVG(), SUPPRESSION, {
      auteurId: 'lea',
      horodatage: HORODATAGE,
    });
    expect(resultat).toMatchObject({ ok: false });
    if (!resultat.ok) expect(resultat.erreur).toContain('Léa');
  });

  it('empêche un participant de trancher un arbitrage', () => {
    const resultat = appliquerModification(
      parcoursEVG(),
      { type: 'ecarter_alternative', elementId: 'resto', alternativeId: 'brasserie' },
      { auteurId: 'lea', horodatage: HORODATAGE }
    );
    expect(resultat).toMatchObject({ ok: false });
  });

  it('interdit toute modification au héros, même sur son propre parcours (Max)', () => {
    const parcours = parcoursEVG();
    const resultat = appliquerModification(
      parcours,
      { type: 'changer_statut', elementId: 'karting', statut: 'a_remplacer' },
      { auteurId: 'max', horodatage: HORODATAGE }
    );
    expect(resultat).toMatchObject({ ok: false });
    if (!resultat.ok) expect(resultat.erreur).toContain('héros');
    // Un refus ne touche à rien.
    expect(parcours.timeline[0].elements[0].statut).toBe('propose');
  });

  it('refuse un auteur inconnu du parcours', () => {
    const resultat = appliquerModification(parcoursEVG(), SUPPRESSION, {
      auteurId: 'inconnu',
      horodatage: HORODATAGE,
    });
    expect(resultat).toMatchObject({ ok: false });
    if (!resultat.ok) expect(resultat.erreur).toContain('ne faites pas partie');
  });
});

// ---------------------------------------------------------------------------
// Le prix survit à un remplacement.
// Observé en recette : le LLM renvoie un remplaçant sans prix, l'élément passe
// à « — » et le budget du parcours devient faux sans que rien ne le signale.
// ---------------------------------------------------------------------------
describe('le prix d’un élément remplacé', () => {
  function parcoursAvecPrix(): Parcours {
    return ParcoursSchema.parse({
      id: 'p-prix',
      intention: { texte: 'un EVG à Bordeaux' },
      contexte: { avecQui: 'amis', duree: { valeur: 3, unite: 'jours' } },
      participants: [{ id: 'u1', nom: 'Hugo', role: 'organisateur' }],
      budget: { mode: 'partage' },
      timeline: [
        {
          id: 'm1',
          titre: 'Samedi',
          elements: [element('paddle', { nom: 'Paddle sur la Garonne', prix: 280 })],
        },
      ],
    });
  }

  const remplacantSansPrix = {
    type: 'remplacer_element',
    elementId: 'paddle',
    remplacement: {
      type: 'activite',
      nom: 'Visite guidée en bateau',
      justification: 'moins physique, demandé par l’utilisateur',
    },
  } as const;

  it('est hérité quand le remplaçant n’en propose pas', () => {
    const r = appliquerModification(
      parcoursAvecPrix(),
      DemandeModificationSchema.parse(remplacantSansPrix),
      PAR_ORGANISATEUR
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const remplace = r.parcours.timeline[0].elements[0];
    expect(remplace.nom).toBe('Visite guidée en bateau');
    expect(remplace.prix).toBe(280);
  });

  it('cède la place au prix proposé quand il y en a un', () => {
    const r = appliquerModification(
      parcoursAvecPrix(),
      DemandeModificationSchema.parse({
        ...remplacantSansPrix,
        remplacement: { ...remplacantSansPrix.remplacement, prix: 150 },
      }),
      PAR_ORGANISATEUR
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parcours.timeline[0].elements[0].prix).toBe(150);
  });

  it('reste absent si l’élément remplacé n’avait pas de prix', () => {
    const sansPrix = ParcoursSchema.parse({
      ...parcoursAvecPrix(),
      timeline: [{ id: 'm1', titre: 'Samedi', elements: [element('paddle', { nom: 'Paddle' })] }],
    });
    const r = appliquerModification(
      sansPrix,
      DemandeModificationSchema.parse(remplacantSansPrix),
      PAR_ORGANISATEUR
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parcours.timeline[0].elements[0].prix).toBeUndefined();
  });
});
