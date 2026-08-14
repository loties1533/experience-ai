import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rechercherLieuxFoursquare } = vi.hoisted(() => ({
  rechercherLieuxFoursquare: vi.fn(),
}));

vi.mock('../../server/services/foursquare.js', () => ({
  rechercherLieuxFoursquare,
}));

import {
  DemandeSurElementClientSchema,
  ParcoursSchema,
  appliquerModification,
  type Parcours,
} from '../../server/domaine/parcours/index.js';
import { creerLienRechercheHebergement } from '../../server/lib/url.js';
import { appliquerModificationHotel } from '../../server/services/modificationHotel.js';
import type { CandidatHotelExterne } from '../../server/services/rechercheExterne.js';

const HORODATAGE = '2026-07-29T14:00:00.000Z';
const CONTEXTE_MODIFICATION = {
  auteurId: 'organisateur',
  horodatage: HORODATAGE,
};
const OCCUPATION = {
  statut: 'declaree' as const,
  adultes: 2,
  enfants: 1,
  chambres: 2,
};
const SEJOUR_BORDEAUX = {
  ville: 'Bordeaux',
  arrivee: '2026-08-10',
  depart: '2026-08-12',
};

function candidatHotel(
  surcharge: Partial<CandidatHotelExterne> = {}
): CandidatHotelExterne {
  return {
    identifiantExterne: 'fsq-burdigala',
    nom: 'Hôtel Burdigala',
    villeDemandee: 'Bordeaux',
    villeConfirmee: 'Bordeaux',
    categorieFournisseur: 'Hotel',
    identifiantCategorieFournisseur: '19014',
    typeMetierRecherche: 'hebergement',
    fournisseur: 'Foursquare',
    source: 'https://places-api.foursquare.com/places/search',
    recupereLe: '2026-07-29T10:00:00.000Z',
    adresse: '115 rue Georges-Bonnac, Bordeaux',
    ...surcharge,
  };
}

function parcoursHotelier(): Parcours {
  const lien = creerLienRechercheHebergement(
    {
      sejour: SEJOUR_BORDEAUX,
      occupation: OCCUPATION,
      nomHotel: 'Hôtel Burdigala',
    },
    '2026-07-29T11:00:00.000Z'
  );
  return ParcoursSchema.parse({
    id: 'parcours-hotel',
    intention: { texte: 'découvrir Bordeaux et Lyon' },
    contexte: {
      avecQui: 'famille',
      duree: { valeur: 5, unite: 'jours' },
      dates: {
        debut: '2026-08-10T08:00:00.000Z',
        fin: '2026-08-14T20:00:00.000Z',
      },
      lieux: ['Bordeaux', 'Lyon'],
      occupationHebergement: OCCUPATION,
    },
    participants: [
      {
        id: 'organisateur',
        nom: 'Alex',
        role: 'organisateur',
      },
    ],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'nuit-bordeaux',
        titre: 'Nuit à Bordeaux',
        elements: [
          {
            id: 'hotel-bordeaux',
            type: 'hebergement',
            nom: 'Hôtel Burdigala',
            lieu: '115 rue Georges-Bonnac, Bordeaux',
            prix: 180,
            prixEstime: true,
            justification: 'dormir près du centre',
            confiance: {
              niveau: 'verifie',
              fournisseur: 'Foursquare',
              source:
                'https://places-api.foursquare.com/places/search',
              recupereLe: '2026-07-29T10:00:00.000Z',
              identifiantExterne: 'fsq-burdigala',
              categorieFournisseur: 'Hotel',
              identifiantCategorieFournisseur: '19014',
              villeConfirmee: 'Bordeaux',
              adresse: '115 rue Georges-Bonnac, Bordeaux',
            },
            sejourHebergement: SEJOUR_BORDEAUX,
            lienRechercheHebergement: lien,
          },
        ],
      },
    ],
  });
}

function hotelDu(parcours: Parcours) {
  const hotel = parcours.timeline[0]?.elements[0];
  if (!hotel) throw new Error('hôtel attendu');
  return hotel;
}

beforeEach(() => {
  vi.clearAllMocks();
  rechercherLieuxFoursquare.mockResolvedValue({
    statut: 'vide',
    resultats: [],
    recupereLe: HORODATAGE,
  });
});

describe('modification éditoriale — aucune preuve hôtelière ne bouge', () => {
  it('modifie seulement la justification', () => {
    const origine = parcoursHotelier();
    const avant = hotelDu(origine);
    const resultat = appliquerModification(
      origine,
      {
        type: 'modifier_justification',
        elementId: avant.id,
        justification: 'plus proche des activités prévues',
      },
      CONTEXTE_MODIFICATION
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    const apres = hotelDu(resultat.parcours);
    expect(apres.justification).toBe(
      'plus proche des activités prévues'
    );
    expect(apres.confiance).toEqual(avant.confiance);
    expect(apres.lieu).toBe(avant.lieu);
    expect(apres.lienRechercheHebergement).toEqual(
      avant.lienRechercheHebergement
    );
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('change le statut sans toucher aux champs serveur dérivés', () => {
    const origine = parcoursHotelier();
    const avant = hotelDu(origine);
    const resultat = appliquerModification(
      origine,
      {
        type: 'changer_statut',
        elementId: avant.id,
        statut: 'accepte',
      },
      CONTEXTE_MODIFICATION
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    const apres = hotelDu(resultat.parcours);
    expect(apres.statut).toBe('accepte');
    expect(apres.confiance).toEqual(avant.confiance);
    expect(apres.lieu).toBe(avant.lieu);
    expect(apres.lienRechercheHebergement).toEqual(
      avant.lienRechercheHebergement
    );
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('écarte une alternative sans reconstruire l’identité ou le lien', () => {
    const origine = ParcoursSchema.parse({
      ...parcoursHotelier(),
      timeline: parcoursHotelier().timeline.map((moment) => ({
        ...moment,
        elements: moment.elements.map((element) => ({
          ...element,
          alternatives: [
            {
              id: 'hotel-alternatif',
              nom: 'Autre option',
            },
          ],
        })),
      })),
    });
    const avant = hotelDu(origine);
    const resultat = appliquerModification(
      origine,
      {
        type: 'ecarter_alternative',
        elementId: avant.id,
        alternativeId: 'hotel-alternatif',
      },
      CONTEXTE_MODIFICATION
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    const apres = hotelDu(resultat.parcours);
    expect(apres.alternatives[0]?.ecartee).toBe(true);
    expect(apres.confiance).toEqual(avant.confiance);
    expect(apres.lieu).toBe(avant.lieu);
    expect(apres.lienRechercheHebergement).toEqual(
      avant.lienRechercheHebergement
    );
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });
});

describe('séjour et occupation — les liens dérivés sont reconstruits', () => {
  it('reconstruit le lien après un changement de dates dans la même ville', async () => {
    const origine = parcoursHotelier();
    const avant = hotelDu(origine);
    const resultat = await appliquerModificationHotel(
      origine,
      {
        type: 'modifier_sejour_hebergement',
        elementId: avant.id,
        sejour: {
          ville: 'Bordeaux',
          arrivee: '2026-08-11',
          depart: '2026-08-13',
        },
      },
      CONTEXTE_MODIFICATION
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    const apres = hotelDu(resultat.parcours);
    expect(apres.confiance).toEqual(avant.confiance);
    expect(apres.lieu).toBe(avant.lieu);
    expect(apres.lienRechercheHebergement?.url).not.toBe(
      avant.lienRechercheHebergement?.url
    );
    const parametres = new URL(
      apres.lienRechercheHebergement?.url ?? ''
    ).searchParams;
    expect(parametres.get('checkin')).toBe('2026-08-11');
    expect(parametres.get('checkout')).toBe('2026-08-13');
    expect(parametres.get('group_adults')).toBe('2');
    expect(parametres.get('group_children')).toBe('1');
    expect(parametres.get('no_rooms')).toBe('2');
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('accepte des dates identiques sans changer l’identité ni appeler Foursquare', async () => {
    const origine = parcoursHotelier();
    const avant = hotelDu(origine);
    const resultat = await appliquerModificationHotel(
      origine,
      {
        type: 'modifier_sejour_hebergement',
        elementId: avant.id,
        sejour: SEJOUR_BORDEAUX,
      },
      CONTEXTE_MODIFICATION
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    const apres = hotelDu(resultat.parcours);
    expect(apres.confiance).toEqual(avant.confiance);
    expect(apres.lieu).toBe(avant.lieu);
    expect(apres.sejourHebergement).toEqual(SEJOUR_BORDEAUX);
    expect(apres.lienRechercheHebergement?.url).toBe(
      avant.lienRechercheHebergement?.url
    );
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('reconstruit le lien avec chaque valeur d’occupation déclarée', async () => {
    const origine = parcoursHotelier();
    const resultat = await appliquerModificationHotel(
      origine,
      {
        type: 'modifier_occupation_hebergement',
        occupation: {
          statut: 'declaree',
          adultes: 4,
          enfants: 0,
          chambres: 3,
        },
      },
      CONTEXTE_MODIFICATION
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    const apres = hotelDu(resultat.parcours);
    expect(resultat.parcours.contexte.occupationHebergement).toEqual({
      statut: 'declaree',
      adultes: 4,
      enfants: 0,
      chambres: 3,
    });
    const parametres = new URL(
      apres.lienRechercheHebergement?.url ?? ''
    ).searchParams;
    expect(parametres.get('group_adults')).toBe('4');
    expect(parametres.get('group_children')).toBe('0');
    expect(parametres.get('no_rooms')).toBe('3');
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('omet le lien lorsque l’occupation n’est pas déclarée', async () => {
    const avecOccupationAConfirmer = ParcoursSchema.parse({
      ...parcoursHotelier(),
      contexte: {
        ...parcoursHotelier().contexte,
        occupationHebergement: { statut: 'a_confirmer' },
      },
      timeline: parcoursHotelier().timeline.map((moment) => ({
        ...moment,
        elements: moment.elements.map(
          ({ lienRechercheHebergement: _lien, ...element }) => element
        ),
      })),
    });
    const resultat = await appliquerModificationHotel(
      avecOccupationAConfirmer,
      {
        type: 'modifier_sejour_hebergement',
        elementId: 'hotel-bordeaux',
        sejour: {
          ville: 'Bordeaux',
          arrivee: '2026-08-11',
          depart: '2026-08-13',
        },
      },
      CONTEXTE_MODIFICATION
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(
      hotelDu(resultat.parcours).lienRechercheHebergement
    ).toBeUndefined();
  });

  it('ne touche qu’à l’hôtel explicitement ciblé quand une ville en contient plusieurs', async () => {
    const origineSimple = parcoursHotelier();
    const secondHotel = {
      ...hotelDu(origineSimple),
      id: 'hotel-bordeaux-deux',
      nom: 'Un hébergement à choisir à Bordeaux',
      lieu: undefined,
      confiance: { niveau: 'suggestion' as const },
      lienRechercheHebergement:
        creerLienRechercheHebergement(
          {
            sejour: SEJOUR_BORDEAUX,
            occupation: OCCUPATION,
          },
          '2026-07-29T11:30:00.000Z'
        ),
    };
    const origine = ParcoursSchema.parse({
      ...origineSimple,
      timeline: origineSimple.timeline.map((moment) => ({
        ...moment,
        elements: [...moment.elements, secondHotel],
      })),
    });
    const secondAvant = origine.timeline[0].elements[1];
    const resultat = await appliquerModificationHotel(
      origine,
      {
        type: 'modifier_sejour_hebergement',
        elementId: 'hotel-bordeaux',
        sejour: {
          ville: 'Bordeaux',
          arrivee: '2026-08-11',
          depart: '2026-08-13',
        },
      },
      CONTEXTE_MODIFICATION
    );
    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(
      resultat.parcours.timeline[0].elements[0]
        .sejourHebergement?.arrivee
    ).toBe('2026-08-11');
    expect(resultat.parcours.timeline[0].elements[1]).toEqual(
      secondAvant
    );
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('refuse les occupations partielles à la frontière client', () => {
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'modifier_occupation_hebergement',
        occupation: {
          statut: 'declaree',
          adultes: 2,
          chambres: 1,
        },
      }).success
    ).toBe(false);
  });
});

describe('remplacement hôtelier — nouvelle preuve ou suggestion', () => {
  it('remplace toutes les anciennes preuves par le candidat Foursquare', async () => {
    const origine = parcoursHotelier();
    rechercherLieuxFoursquare.mockResolvedValueOnce({
      statut: 'ok',
      resultats: [
        candidatHotel({
          identifiantExterne: 'fsq-seeko-o',
          nom: 'Hôtel Seeko’o',
          adresse: '54 quai de Bacalan, Bordeaux',
        }),
      ],
      recupereLe: HORODATAGE,
    });

    const resultat = await appliquerModificationHotel(
      origine,
      {
        type: 'remplacer_hotel',
        elementId: 'hotel-bordeaux',
        villeDemandee: 'Bordeaux',
        requete: 'Hôtel Seeko’o',
      },
      CONTEXTE_MODIFICATION
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    const hotel = hotelDu(resultat.parcours);
    expect(hotel.nom).toBe('Hôtel Seeko’o');
    expect(hotel.lieu).toBe('54 quai de Bacalan, Bordeaux');
    expect(hotel.confiance).toMatchObject({
      niveau: 'verifie',
      fournisseur: 'Foursquare',
      identifiantExterne: 'fsq-seeko-o',
      categorieFournisseur: 'Hotel',
    });
    expect(hotel.lienExterne).toBeUndefined();
    expect(hotel).not.toHaveProperty('disponibilite');
    expect(hotel.lienRechercheHebergement?.url).toContain(
      'ss=H%C3%B4tel+Seeko%E2%80%99o+Bordeaux'
    );
    expect(origine).toEqual(parcoursHotelier());
  });

  it('dégrade en suggestion générique quand aucun candidat n’est fiable', async () => {
    const origine = parcoursHotelier();
    const ancienLien =
      hotelDu(origine).lienRechercheHebergement?.url;
    const resultat = await appliquerModificationHotel(
      origine,
      {
        type: 'remplacer_hotel',
        elementId: 'hotel-bordeaux',
        villeDemandee: 'Bordeaux',
        requete: 'Hôtel inconnu',
      },
      CONTEXTE_MODIFICATION
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    const hotel = hotelDu(resultat.parcours);
    expect(hotel.nom).toBe(
      'Un hébergement à choisir à Bordeaux'
    );
    expect(hotel.confiance).toEqual({ niveau: 'suggestion' });
    expect(hotel.lieu).toBeUndefined();
    expect(hotel.confiance).not.toHaveProperty(
      'identifiantExterne'
    );
    expect(hotel.confiance).not.toHaveProperty('adresse');
    expect(hotel.lienRechercheHebergement?.url).not.toBe(
      ancienLien
    );
    expect(hotel.lienRechercheHebergement?.url).toContain(
      'ss=Bordeaux'
    );
  });

  it('ne choisit jamais le premier de plusieurs candidats ambigus', async () => {
    rechercherLieuxFoursquare.mockResolvedValueOnce({
      statut: 'ok',
      resultats: [
        candidatHotel({
          identifiantExterne: 'fsq-un',
          nom: 'Hôtel Alpha',
        }),
        candidatHotel({
          identifiantExterne: 'fsq-deux',
          nom: 'Hôtel Beta',
        }),
      ],
      recupereLe: HORODATAGE,
    });

    const resultat = await appliquerModificationHotel(
      parcoursHotelier(),
      {
        type: 'remplacer_hotel',
        elementId: 'hotel-bordeaux',
        villeDemandee: 'Bordeaux',
        requete: 'Hôtel central',
      },
      CONTEXTE_MODIFICATION
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(hotelDu(resultat.parcours).confiance).toEqual({
      niveau: 'suggestion',
    });
  });

  it('ne vérifie pas un candidat unique dont le nom diffère de la demande', async () => {
    rechercherLieuxFoursquare.mockResolvedValueOnce({
      statut: 'ok',
      resultats: [
        candidatHotel({
          identifiantExterne: 'fsq-autre',
          nom: 'Hôtel Sans Rapport',
        }),
      ],
      recupereLe: HORODATAGE,
    });

    const resultat = await appliquerModificationHotel(
      parcoursHotelier(),
      {
        type: 'remplacer_hotel',
        elementId: 'hotel-bordeaux',
        villeDemandee: 'Bordeaux',
        requete: 'Hôtel demandé',
      },
      CONTEXTE_MODIFICATION
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(hotelDu(resultat.parcours).confiance).toEqual({
      niveau: 'suggestion',
    });
  });

  it('recherche de nouveau après un changement de ville', async () => {
    rechercherLieuxFoursquare.mockResolvedValueOnce({
      statut: 'ok',
      resultats: [
        candidatHotel({
          identifiantExterne: 'fsq-lyon',
          nom: 'Hôtel Burdigala',
          villeDemandee: 'Lyon',
          villeConfirmee: 'Lyon',
          adresse: '8 rue Gaspard-André, Lyon',
        }),
      ],
      recupereLe: HORODATAGE,
    });

    const resultat = await appliquerModificationHotel(
      parcoursHotelier(),
      {
        type: 'modifier_sejour_hebergement',
        elementId: 'hotel-bordeaux',
        sejour: {
          ville: 'Lyon',
          arrivee: '2026-08-12',
          depart: '2026-08-14',
        },
      },
      CONTEXTE_MODIFICATION
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    const hotel = hotelDu(resultat.parcours);
    expect(rechercherLieuxFoursquare).toHaveBeenCalledWith(
      'Lyon',
      'Hôtel Burdigala',
      'hebergement',
      4
    );
    expect(hotel.nom).toBe('Hôtel Burdigala');
    expect(hotel.confiance).toMatchObject({
      identifiantExterne: 'fsq-lyon',
      villeConfirmee: 'Lyon',
    });
    expect(hotel.lienRechercheHebergement?.url).toContain(
      'ss=H%C3%B4tel+Burdigala+Lyon'
    );
  });
});

describe('échecs — l’ancien parcours reste intact', () => {
  it('propage un 503 lorsque Foursquare est indispensable et indisponible', async () => {
    const origine = parcoursHotelier();
    const avant = JSON.stringify(origine);
    rechercherLieuxFoursquare.mockResolvedValueOnce({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'timeout',
    });

    await expect(
      appliquerModificationHotel(
        origine,
        {
          type: 'remplacer_hotel',
          elementId: 'hotel-bordeaux',
          villeDemandee: 'Bordeaux',
          requete: 'Hôtel Seeko’o',
        },
        CONTEXTE_MODIFICATION
      )
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(JSON.stringify(origine)).toBe(avant);
  });

  it('refuse un séjour hors parcours sans appel externe ni mutation', async () => {
    const origine = parcoursHotelier();
    const avant = JSON.stringify(origine);
    const resultat = await appliquerModificationHotel(
      origine,
      {
        type: 'modifier_sejour_hebergement',
        elementId: 'hotel-bordeaux',
        sejour: {
          ville: 'Bordeaux',
          arrivee: '2026-09-01',
          depart: '2026-09-02',
        },
      },
      CONTEXTE_MODIFICATION
    );

    expect(resultat).toMatchObject({ ok: false });
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
    expect(JSON.stringify(origine)).toBe(avant);
  });

  it('refuse un remplacement sans séjour essentiel avant Foursquare', async () => {
    const sansSejour = ParcoursSchema.parse({
      ...parcoursHotelier(),
      contexte: {
        ...parcoursHotelier().contexte,
        occupationHebergement: undefined,
      },
      timeline: parcoursHotelier().timeline.map((moment) => ({
        ...moment,
        elements: moment.elements.map(
          ({
            sejourHebergement: _sejour,
            lienRechercheHebergement: _lien,
            ...element
          }) => element
        ),
      })),
    });
    const resultat = await appliquerModificationHotel(
      sansSejour,
      {
        type: 'remplacer_hotel',
        elementId: 'hotel-bordeaux',
        villeDemandee: 'Bordeaux',
        requete: 'Hôtel Seeko’o',
      },
      CONTEXTE_MODIFICATION
    );
    expect(resultat).toMatchObject({ ok: false });
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('ne mute rien lorsqu’une preuve échoue à la validation finale', async () => {
    const origine = parcoursHotelier();
    const copieProfonde = structuredClone(origine);
    rechercherLieuxFoursquare.mockResolvedValueOnce({
      statut: 'ok',
      resultats: [
        candidatHotel({
          nom: 'Hôtel Seeko’o',
          categorieFournisseur: 'Restaurant',
          identifiantCategorieFournisseur: undefined,
        }),
      ],
      recupereLe: HORODATAGE,
    });

    const resultat = await appliquerModificationHotel(
      origine,
      {
        type: 'remplacer_hotel',
        elementId: 'hotel-bordeaux',
        villeDemandee: 'Bordeaux',
        requete: 'Hôtel Seeko’o',
      },
      CONTEXTE_MODIFICATION
    );

    expect(resultat).toMatchObject({ ok: false });
    expect(origine).toEqual(copieProfonde);
    expect(hotelDu(origine).confiance).toEqual(
      hotelDu(copieProfonde).confiance
    );
    expect(hotelDu(origine).lienRechercheHebergement).toEqual(
      hotelDu(copieProfonde).lienRechercheHebergement
    );
  });

  it('rend un refus 403 pour un rôle sans droit de modification', async () => {
    const parcours = ParcoursSchema.parse({
      ...parcoursHotelier(),
      participants: [
        { id: 'heros', nom: 'Hugo', role: 'heros' },
      ],
    });
    const resultat = await appliquerModificationHotel(
      parcours,
      {
        type: 'modifier_sejour_hebergement',
        elementId: 'hotel-bordeaux',
        sejour: SEJOUR_BORDEAUX,
      },
      { ...CONTEXTE_MODIFICATION, auteurId: 'heros' }
    );
    expect(resultat).toMatchObject({
      ok: false,
      statutHttp: 403,
    });
  });
});
