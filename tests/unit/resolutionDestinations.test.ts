import { describe, expect, it, vi } from 'vitest';
import { BriefSchema, type Brief } from '../../server/agents/brief.js';
import type { PropositionDecouverteDestinations } from '../../server/agents/generation/contratDecouverteDestinations.js';
import {
  NOMBRE_MINIMUM_POI_FACETTE_OBLIGATOIRE,
  analyserContraintesGeographiques,
  destinationsAResoudreApresIntake,
  destinationsResoluesParPreparation,
  nombreDestinationsAutorise,
  resoudreDestinationsProposees,
} from '../../server/agents/generation/resolutionDestinations.js';
import type {
  DestinationGeographique,
  FacetteDestination,
  PoiDestination,
} from '../../server/services/destinations/index.js';

const BRIEF = BriefSchema.parse({
  intention: 'Faire du trek et découvrir la nature',
  avecQui: 'solo',
  duree: { valeur: 3, unite: 'semaines' },
  dates: {
    debut: '2027-01-05T00:00:00.000Z',
    fin: '2027-01-25T23:59:59.999Z',
  },
  lieux: [],
});

function destination(
  nomCanonique: string,
  identifiantGeoNames: number,
  codePays = 'FR'
): DestinationGeographique {
  return {
    identifiantGeoNames,
    nomCanonique,
    codePays,
    coordonnees: {
      latitude: 45 + identifiantGeoNames / 100_000,
      longitude: 6,
    },
    featureCode: 'PPL',
    fournisseur: 'Open-Meteo/GeoNames',
    source: 'https://geocoding-api.open-meteo.com/v1/search',
    recupereLe: '2026-08-09T14:00:00.000Z',
  };
}

function poi(
  index: number,
  facette: FacetteDestination,
  ville: string
): PoiDestination {
  return {
    identifiantExterne: `${ville}-${facette}-${index}`,
    nom: `${facette} ${index}`,
    categories: [{ identifiant: `cat-${facette}`, nom: facette }],
    fournisseur: 'Foursquare',
    source: 'https://places-api.foursquare.com/places/search',
    recupereLe: '2026-08-09T14:00:00.000Z',
  };
}

function proposition(
  changements: Partial<PropositionDecouverteDestinations> = {}
): PropositionDecouverteDestinations {
  return {
    format: 'itineraire',
    facettesObligatoires: ['nature'],
    facettesSouples: [],
    candidats: [{ nom: 'Annecy', codePaysSuggere: 'FR' }],
    ...changements,
  };
}

function dependancesValides(
  destinations: Record<string, DestinationGeographique>,
  nombres: Partial<Record<FacetteDestination, number>> = { nature: 3 }
) {
  return {
    geocoder: vi.fn(async (demande: unknown) => {
      const nom = (demande as { nom: string }).nom;
      const trouve = destinations[nom];
      return trouve
        ? {
            statut: 'unique' as const,
            destination: trouve,
            recupereLe: '2026-08-09T14:00:00.000Z',
          }
        : {
            statut: 'vide' as const,
            destinations: [] as [],
            recupereLe: '2026-08-09T14:00:00.000Z',
          };
    }),
    rechercherPoi: vi.fn(async (demande: unknown) => {
      const facette = (demande as { facette: FacetteDestination }).facette;
      const latitude = (demande as {
        coordonnees: { latitude: number };
      }).coordonnees.latitude;
      const ville = Object.values(destinations).find(
        (item) => item.coordonnees.latitude === latitude
      )?.nomCanonique ?? 'inconnue';
      const nombre = nombres[facette] ?? 0;
      return nombre > 0
        ? {
            statut: 'ok' as const,
            resultats: Array.from({ length: nombre }, (_, index) =>
              poi(index, facette, ville)
            ),
            recupereLe: '2026-08-09T14:00:00.000Z',
          }
        : {
            statut: 'vide' as const,
            resultats: [] as [],
            recupereLe: '2026-08-09T14:00:00.000Z',
          };
    }),
  };
}

describe('contraintes et prédicats de destination', () => {
  it('distingue pays, zone et vraie ville sans muter le Brief', () => {
    const brief = BriefSchema.parse({
      ...BRIEF,
      lieux: ['Europe', 'France', 'Chamonix'],
    });

    const analyse = analyserContraintesGeographiques(brief);

    expect(analyse.villesExplicites).toEqual(['Chamonix']);
    expect(analyse.zonesDeclarees).toEqual(['Europe', 'France']);
    expect(analyse.codesPaysAutorises).toEqual(new Set(['FR']));
    expect(brief.lieux).toEqual(['Europe', 'France', 'Chamonix']);
    expect(destinationsAResoudreApresIntake(brief)).toBe(false);
  });

  it.each([
    ['Europe', 'FR'],
    ['France', 'FR'],
    ['Alpes', 'CH'],
    ['Toscane', 'IT'],
  ])(
    'conserve %s comme contrainte géographique, jamais comme ville',
    (zone, codePresent) => {
      const brief = BriefSchema.parse({ ...BRIEF, lieux: [zone] });

      const analyse = analyserContraintesGeographiques(brief);

      expect(analyse.villesExplicites).toEqual([]);
      expect(analyse.zonesDeclarees).toEqual([zone]);
      expect(analyse.codesPaysAutorises?.has(codePresent)).toBe(true);
      expect(destinationsAResoudreApresIntake(brief)).toBe(true);
      expect(brief.lieux).toEqual([zone]);
    }
  );

  it('reconnaît les deux stratégies génériques résolues après intake', () => {
    expect(
      destinationsResoluesParPreparation({
        strategie: 'decouverte_destinations',
        etapes: [
          {
            ville: { nom: 'Annecy', origine: 'selection_moteur' },
            ancres: [],
          },
        ],
        contraintesConservees: {},
      })
    ).toBe(true);
    expect(
      destinationsResoluesParPreparation({
        strategie: 'villes_du_brief',
        etapes: [
          { ville: { nom: 'Annecy', origine: 'utilisateur' }, ancres: [] },
        ],
        contraintesConservees: {},
      })
    ).toBe(false);
  });
});

describe('résolution et sélection serveur', () => {
  it('exige trois POI distincts par facette obligatoire comme politique produit', async () => {
    expect(NOMBRE_MINIMUM_POI_FACETTE_OBLIGATOIRE).toBe(3);
    const deps = dependancesValides({ Annecy: destination('Annecy', 1) }, {
      nature: 2,
    });

    await expect(
      resoudreDestinationsProposees(BRIEF, proposition(), deps)
    ).resolves.toEqual({
      statut: 'vide',
      rejets: [
        {
          candidat: { nom: 'Annecy', codePaysSuggere: 'FR' },
          raison: 'signaux_obligatoires_insuffisants',
        },
      ],
    });
  });

  it('déduplique les observations fournisseur avant le seuil', async () => {
    const deps = dependancesValides({ Annecy: destination('Annecy', 1) });
    deps.rechercherPoi.mockResolvedValue({
      statut: 'ok',
      resultats: [
        poi(1, 'nature', 'Annecy'),
        poi(1, 'nature', 'Annecy'),
        poi(2, 'nature', 'Annecy'),
      ],
      recupereLe: '2026-08-09T14:00:00.000Z',
    });

    await expect(
      resoudreDestinationsProposees(BRIEF, proposition(), deps)
    ).resolves.toMatchObject({ statut: 'vide' });
  });

  it('ne choisit jamais un résultat géographique ambigu', async () => {
    const rechercherPoi = vi.fn();
    const resultat = await resoudreDestinationsProposees(
      BRIEF,
      proposition({ candidats: [{ nom: 'Springfield' }] }),
      {
        geocoder: vi.fn().mockResolvedValue({
          statut: 'ambigue',
          destinations: [destination('Boston', 1, 'US'), destination('Boston', 2, 'US')],
          recupereLe: '2026-08-09T14:00:00.000Z',
        }),
        rechercherPoi,
      }
    );

    expect(resultat).toMatchObject({
      statut: 'clarification_zone',
      rejets: [{ raison: 'ambigue' }],
    });
    expect(rechercherPoi).not.toHaveBeenCalled();
  });

  it('rejette sans clarification une ambiguïté que la zone proposée ne résout pas', async () => {
    const resultat = await resoudreDestinationsProposees(
      BRIEF,
      proposition({ candidats: [{ nom: 'Boston', codePaysSuggere: 'US' }] }),
      {
        geocoder: vi.fn().mockResolvedValue({
          statut: 'ambigue',
          destinations: [
            destination('Boston', 1, 'US'),
            destination('Boston', 2, 'US'),
          ],
          recupereLe: '2026-08-09T14:00:00.000Z',
        }),
        rechercherPoi: vi.fn(),
      }
    );

    expect(resultat).toMatchObject({
      statut: 'vide',
      rejets: [{ raison: 'ambigue' }],
    });
  });

  it('rejette une suggestion pays incohérente avant tout fournisseur', async () => {
    const deps = dependancesValides({ Boston: destination('Boston', 1, 'US') });
    const briefEurope = BriefSchema.parse({ ...BRIEF, lieux: ['Europe'] });

    const resultat = await resoudreDestinationsProposees(
      briefEurope,
      proposition({ candidats: [{ nom: 'Boston', codePaysSuggere: 'US' }] }),
      deps
    );

    expect(resultat).toMatchObject({
      statut: 'vide',
      rejets: [{ raison: 'pays_incoherent' }],
    });
    expect(deps.geocoder).not.toHaveBeenCalled();
  });

  it('classe sans score : obligatoires, souples, minimum plafonné puis GeoNames', async () => {
    const destinations = {
      Annecy: destination('Annecy', 20),
      Grenoble: destination('Grenoble', 10),
    };
    const deps = dependancesValides(destinations, { nature: 3, detente: 1 });
    const resultat = await resoudreDestinationsProposees(
      BRIEF,
      proposition({
        format: 'sejour',
        facettesSouples: ['detente'],
        candidats: [
          { nom: 'Annecy', codePaysSuggere: 'FR' },
          { nom: 'Grenoble', codePaysSuggere: 'FR' },
        ],
      }),
      deps
    );

    expect(resultat).toMatchObject({
      statut: 'ok',
      destinations: [{ destination: { nomCanonique: 'Grenoble' } }],
    });
  });

  it('ne sélectionne qu’une fois une même localité GeoNames proposée sous deux noms', async () => {
    const memeDestination = destination('Chamonix', 3027301);
    const deps = dependancesValides({
      Chamonix: memeDestination,
      'Chamonix-Mont-Blanc': memeDestination,
    });

    const resultat = await resoudreDestinationsProposees(
      BRIEF,
      proposition({
        candidats: [
          { nom: 'Chamonix', codePaysSuggere: 'FR' },
          { nom: 'Chamonix-Mont-Blanc', codePaysSuggere: 'FR' },
        ],
      }),
      deps
    );

    expect(resultat).toMatchObject({
      statut: 'ok',
      destinations: [{ destination: { identifiantGeoNames: 3027301 } }],
    });
    if (resultat.statut !== 'ok') throw new Error('résolution attendue');
    expect(resultat.destinations).toHaveLength(1);
  });

  it.each([
    ['séjour de trois semaines', { valeur: 3, unite: 'semaines' }, 'sejour', 1],
    ['itinéraire de six jours', { valeur: 6, unite: 'jours' }, 'itineraire', 1],
    ['itinéraire de sept jours', { valeur: 7, unite: 'jours' }, 'itineraire', 2],
    ['itinéraire de deux semaines', { valeur: 2, unite: 'semaines' }, 'itineraire', 3],
  ] as const)('borne %s à %s destination(s)', (_cas, duree, format, attendu) => {
    const brief = BriefSchema.parse({ ...BRIEF, duree });
    expect(nombreDestinationsAutorise(brief, proposition({ format }))).toBe(
      attendu
    );
  });

  it('distingue recherche vide et fournisseur indisponible', async () => {
    const vide = dependancesValides({ Annecy: destination('Annecy', 1) }, {
      nature: 0,
    });
    await expect(
      resoudreDestinationsProposees(BRIEF, proposition(), vide)
    ).resolves.toMatchObject({ statut: 'vide' });

    const indisponible = dependancesValides({
      Annecy: destination('Annecy', 1),
    });
    indisponible.rechercherPoi.mockResolvedValue({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'reseau',
    });
    await expect(
      resoudreDestinationsProposees(BRIEF, proposition(), indisponible)
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('classe aussi le géocodage indisponible en erreur technique 503', async () => {
    await expect(
      resoudreDestinationsProposees(BRIEF, proposition(), {
        geocoder: vi.fn().mockResolvedValue({
          statut: 'indisponible',
          fournisseur: 'Open-Meteo/GeoNames',
          raison: 'timeout',
        }),
        rechercherPoi: vi.fn(),
      })
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
