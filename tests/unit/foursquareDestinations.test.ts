import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requeteFetch = vi.fn();
global.fetch = requeteFetch as typeof fetch;
process.env.FOURSQUARE_API_KEY = 'cle-foursquare-destinations-test';

const {
  CATEGORIES_FOURSQUARE_PAR_FACETTE,
  rechercherPoiDestinationFoursquare,
} = await import('../../server/services/destinations/index.js');

const COORDONNEES_CHAMONIX = {
  latitude: 45.92375,
  longitude: 6.86933,
};

function poiFoursquare(changements: Record<string, unknown> = {}) {
  return {
    fsq_place_id: 'fsq-ski-001',
    name: 'Domaine skiable des Grands Montets',
    categories: [
      {
        fsq_category_id: '18061',
        name: 'Ski Resort and Area',
      },
    ],
    location: {
      locality: 'Chamonix-Mont-Blanc',
      address: 'Les Grands Montets',
    },
    latitude: 45.9773,
    longitude: 6.9261,
    ...changements,
  };
}

function reponseOk(results: unknown[]) {
  return { ok: true, json: async () => ({ results }) };
}

beforeEach(() => {
  process.env.FOURSQUARE_API_KEY = 'cle-foursquare-destinations-test';
  requeteFetch.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-09T11:30:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('preuve Foursquare par coordonnées', () => {
  it('recherche par ll sans near ni requête textuelle et conserve les vrais IDs', async () => {
    requeteFetch.mockResolvedValueOnce(reponseOk([poiFoursquare()]));

    const recherche = await rechercherPoiDestinationFoursquare({
      coordonnees: COORDONNEES_CHAMONIX,
      facette: 'sports_hiver',
    });

    const url = new URL(String(requeteFetch.mock.calls[0][0]));
    expect(url.searchParams.get('ll')).toBe('45.92375,6.86933');
    expect(url.searchParams.has('near')).toBe(false);
    expect(url.searchParams.has('query')).toBe(false);
    expect(url.searchParams.get('radius')).toBe('15000');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('fsq_category_ids')).toBe(
      CATEGORIES_FOURSQUARE_PAR_FACETTE.sports_hiver.join(',')
    );
    expect(recherche).toEqual({
      statut: 'ok',
      recupereLe: '2026-08-09T11:30:00.000Z',
      resultats: [
        {
          identifiantExterne: 'fsq-ski-001',
          nom: 'Domaine skiable des Grands Montets',
          categories: [
            { identifiant: '18061', nom: 'Ski Resort and Area' },
          ],
          adresse: 'Les Grands Montets',
          localite: 'Chamonix-Mont-Blanc',
          coordonnees: { latitude: 45.9773, longitude: 6.9261 },
          fournisseur: 'Foursquare',
          source: 'https://places-api.foursquare.com/places/search',
          recupereLe: '2026-08-09T11:30:00.000Z',
        },
      ],
    });
    expect(requeteFetch.mock.calls[0][1]).toMatchObject({
      headers: {
        Authorization: 'Bearer cle-foursquare-destinations-test',
        'X-Places-Api-Version': '2025-06-17',
      },
    });
  });

  it.each(
    Object.entries(CATEGORIES_FOURSQUARE_PAR_FACETTE) as Array<
      [keyof typeof CATEGORIES_FOURSQUARE_PAR_FACETTE, readonly string[]]
    >
  )('borne la facette %s à ses seules catégories officielles', async (facette, ids) => {
    requeteFetch.mockResolvedValueOnce(reponseOk([]));

    await rechercherPoiDestinationFoursquare({
      coordonnees: COORDONNEES_CHAMONIX,
      facette,
    });

    const url = new URL(String(requeteFetch.mock.calls[0][0]));
    expect(url.searchParams.get('fsq_category_ids')).toBe(ids.join(','));
  });

  it('interdit une catégorie ou requête libre supplémentaire', async () => {
    await expect(
      rechercherPoiDestinationFoursquare({
        coordonnees: COORDONNEES_CHAMONIX,
        facette: 'nature',
        categorie: 'catégorie inventée par le LLM',
      })
    ).rejects.toBeTruthy();
    expect(requeteFetch).not.toHaveBeenCalled();
  });

  it('déduplique les POI par identifiant Foursquare', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([poiFoursquare(), poiFoursquare()])
    );

    const recherche = await rechercherPoiDestinationFoursquare({
      coordonnees: COORDONNEES_CHAMONIX,
      facette: 'sports_hiver',
    });

    expect(recherche).toMatchObject({
      statut: 'ok',
      resultats: [{ identifiantExterne: 'fsq-ski-001' }],
    });
  });

  it('signale comme invalide un résultat sans identifiant réel', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([poiFoursquare({ fsq_place_id: undefined })])
    );

    await expect(
      rechercherPoiDestinationFoursquare({
        coordonnees: COORDONNEES_CHAMONIX,
        facette: 'sports_hiver',
      })
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'reponse_invalide',
    });
  });

  it('rejette un POI dont aucune catégorie ne correspond à la facette', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([
        poiFoursquare({
          categories: [
            { fsq_category_id: '13065', name: 'Restaurant' },
          ],
        }),
      ])
    );

    await expect(
      rechercherPoiDestinationFoursquare({
        coordonnees: COORDONNEES_CHAMONIX,
        facette: 'sports_hiver',
      })
    ).resolves.toMatchObject({ statut: 'vide', resultats: [] });
  });

  it('ne conserve pas une catégorie hors facette sur un POI par ailleurs valide', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([
        poiFoursquare({
          categories: [
            { fsq_category_id: '18061', name: 'Ski Resort and Area' },
            { fsq_category_id: '13065', name: 'Restaurant' },
          ],
        }),
      ])
    );

    const recherche = await rechercherPoiDestinationFoursquare({
      coordonnees: COORDONNEES_CHAMONIX,
      facette: 'sports_hiver',
    });

    expect(recherche).toMatchObject({
      statut: 'ok',
      resultats: [
        {
          categories: [
            { identifiant: '18061', nom: 'Ski Resort and Area' },
          ],
        },
      ],
    });
  });

  it('borne le rayon et la limite côté serveur', async () => {
    requeteFetch.mockResolvedValueOnce(reponseOk([]));

    await rechercherPoiDestinationFoursquare({
      coordonnees: COORDONNEES_CHAMONIX,
      facette: 'nature',
      rayonMetres: 999_999,
      limite: 999,
    });

    const url = new URL(String(requeteFetch.mock.calls[0][0]));
    expect(url.searchParams.get('radius')).toBe('25000');
    expect(url.searchParams.get('limit')).toBe('20');

    requeteFetch.mockResolvedValueOnce(reponseOk([]));
    await rechercherPoiDestinationFoursquare({
      coordonnees: COORDONNEES_CHAMONIX,
      facette: 'nature',
      rayonMetres: 1,
      limite: 1,
    });
    const secondeUrl = new URL(String(requeteFetch.mock.calls[1][0]));
    expect(secondeUrl.searchParams.get('radius')).toBe('1000');
    expect(secondeUrl.searchParams.get('limit')).toBe('1');
  });

  it('distingue une vraie recherche vide', async () => {
    requeteFetch.mockResolvedValueOnce(reponseOk([]));

    await expect(
      rechercherPoiDestinationFoursquare({
        coordonnees: COORDONNEES_CHAMONIX,
        facette: 'nature',
      })
    ).resolves.toEqual({
      statut: 'vide',
      resultats: [],
      recupereLe: '2026-08-09T11:30:00.000Z',
    });
  });
});

describe('indisponibilités Foursquare destinations', () => {
  it('distingue une clé absente sans appeler le réseau', async () => {
    process.env.FOURSQUARE_API_KEY = '';

    await expect(
      rechercherPoiDestinationFoursquare({
        coordonnees: COORDONNEES_CHAMONIX,
        facette: 'nature',
      })
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'configuration_absente',
    });
    expect(requeteFetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'authentification'],
    [429, 'quota'],
    [500, 'fournisseur'],
  ] as const)('distingue HTTP %s en %s', async (statut, raison) => {
    requeteFetch.mockResolvedValueOnce({ ok: false, status: statut });

    await expect(
      rechercherPoiDestinationFoursquare({
        coordonnees: COORDONNEES_CHAMONIX,
        facette: 'nature',
      })
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison,
    });
  });

  it('distingue un timeout', async () => {
    const erreur = new Error('request timeout');
    erreur.name = 'TimeoutError';
    requeteFetch.mockRejectedValueOnce(erreur);

    await expect(
      rechercherPoiDestinationFoursquare({
        coordonnees: COORDONNEES_CHAMONIX,
        facette: 'nature',
      })
    ).resolves.toMatchObject({ statut: 'indisponible', raison: 'timeout' });
  });

  it('distingue une panne réseau', async () => {
    requeteFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      rechercherPoiDestinationFoursquare({
        coordonnees: COORDONNEES_CHAMONIX,
        facette: 'nature',
      })
    ).resolves.toMatchObject({ statut: 'indisponible', raison: 'reseau' });
  });

  it.each([
    ['JSON illisible', { ok: true, json: async () => Promise.reject(new Error()) }],
    ['enveloppe invalide', { ok: true, json: async () => ({ results: null }) }],
  ])('rejette une réponse %s', async (_libelle, reponse) => {
    requeteFetch.mockResolvedValueOnce(reponse);

    await expect(
      rechercherPoiDestinationFoursquare({
        coordonnees: COORDONNEES_CHAMONIX,
        facette: 'nature',
      })
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'reponse_invalide',
    });
  });
});
