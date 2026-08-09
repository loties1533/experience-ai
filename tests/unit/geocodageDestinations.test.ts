import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requeteFetch = vi.fn();
global.fetch = requeteFetch as typeof fetch;

const {
  CODES_GEONAMES_LOCALITES_PEUPLEES,
  resoudreDestinationOpenMeteo,
} = await import('../../server/services/destinations/index.js');

function resultatGeocodage(
  changements: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 3027301,
    name: 'Chamonix-Mont-Blanc',
    latitude: 45.92375,
    longitude: 6.86933,
    feature_code: 'PPL',
    country_code: 'FR',
    timezone: 'Europe/Paris',
    population: 8648,
    ...changements,
  };
}

function reponseOk(results: unknown[]) {
  return {
    ok: true,
    json: async () => ({ results }),
  };
}

beforeEach(() => {
  requeteFetch.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-09T10:15:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('résolution stricte Open-Meteo / GeoNames', () => {
  it('rend un résultat unique exact avec les champs de preuve attendus', async () => {
    requeteFetch.mockResolvedValueOnce(reponseOk([resultatGeocodage()]));

    const resolution = await resoudreDestinationOpenMeteo({
      nom: 'Chamonix-Mont-Blanc',
    });

    expect(resolution).toEqual({
      statut: 'unique',
      recupereLe: '2026-08-09T10:15:00.000Z',
      destination: {
        identifiantGeoNames: 3027301,
        nomCanonique: 'Chamonix-Mont-Blanc',
        codePays: 'FR',
        coordonnees: { latitude: 45.92375, longitude: 6.86933 },
        featureCode: 'PPL',
        fournisseur: 'Open-Meteo/GeoNames',
        source: 'https://geocoding-api.open-meteo.com/v1/search',
        recupereLe: '2026-08-09T10:15:00.000Z',
      },
    });

    const url = new URL(String(requeteFetch.mock.calls[0][0]));
    expect(url.searchParams.get('count')).toBe('10');
    expect(url.searchParams.get('name')).toBe('Chamonix-Mont-Blanc');
  });

  it('normalise seulement casse, accents, ponctuation et espaces', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([
        resultatGeocodage({
          id: 3448439,
          name: 'São Paulo',
          latitude: -23.5475,
          longitude: -46.63611,
          country_code: 'BR',
        }),
      ])
    );

    await expect(
      resoudreDestinationOpenMeteo({ nom: '  sao-paulo  ' })
    ).resolves.toMatchObject({
      statut: 'unique',
      destination: { nomCanonique: 'São Paulo', codePays: 'BR' },
    });
  });

  it('applique le pays dans la requête et localement pour lever une ambiguïté', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([
        resultatGeocodage({ id: 2988507, name: 'Paris', country_code: 'FR' }),
        resultatGeocodage({ id: 4717560, name: 'Paris', country_code: 'US' }),
      ])
    );

    const resolution = await resoudreDestinationOpenMeteo({
      nom: 'Paris',
      codePays: 'FR',
    });

    expect(resolution).toMatchObject({
      statut: 'unique',
      destination: { identifiantGeoNames: 2988507, codePays: 'FR' },
    });
    const url = new URL(String(requeteFetch.mock.calls[0][0]));
    expect(url.searchParams.get('countryCode')).toBe('FR');
  });

  it('conserve explicitement une ambiguïté restante sans choisir par population', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([
        resultatGeocodage({
          id: 4409896,
          name: 'Springfield',
          country_code: 'US',
          population: 170188,
        }),
        resultatGeocodage({
          id: 4250542,
          name: 'Springfield',
          country_code: 'US',
          population: 114394,
        }),
      ])
    );

    const resolution = await resoudreDestinationOpenMeteo({
      nom: 'Springfield',
      codePays: 'US',
    });

    expect(resolution).toMatchObject({
      statut: 'ambigue',
      destinations: [
        { identifiantGeoNames: 4250542 },
        { identifiantGeoNames: 4409896 },
      ],
    });
  });

  it('rejette un meilleur résultat fuzzy dont le nom canonique diffère', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([resultatGeocodage({ name: 'Bordeaux' })])
    );

    await expect(
      resoudreDestinationOpenMeteo({ nom: 'Bordeau' })
    ).resolves.toMatchObject({ statut: 'vide', destinations: [] });
  });

  it.each(CODES_GEONAMES_LOCALITES_PEUPLEES)(
    'accepte explicitement le code de localité habitée %s',
    async (featureCode) => {
      requeteFetch.mockResolvedValueOnce(
        reponseOk([resultatGeocodage({ feature_code: featureCode })])
      );

      await expect(
        resoudreDestinationOpenMeteo({ nom: 'Chamonix-Mont-Blanc' })
      ).resolves.toMatchObject({
        statut: 'unique',
        destination: { featureCode },
      });
    }
  );

  it.each([
    ['région', 'ADM1'],
    ['pays', 'PCLI'],
    ['massif', 'MTS'],
    ['lieu non peuplé', 'LCTY'],
    ['ancienne capitale', 'PPLCH'],
    ['lieu historique', 'PPLH'],
    ['lieu abandonné', 'PPLQ'],
    ['groupe de localités', 'PPLS'],
    ['lieu détruit', 'PPLW'],
    ['section de ville', 'PPLX'],
  ])('rejette un résultat %s portant le code %s', async (_libelle, featureCode) => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([resultatGeocodage({ feature_code: featureCode })])
    );

    await expect(
      resoudreDestinationOpenMeteo({ nom: 'Chamonix-Mont-Blanc' })
    ).resolves.toMatchObject({ statut: 'vide', destinations: [] });
  });

  it.each([
    ['coordonnées invalides', { latitude: 91 }],
    ['pays absent', { country_code: undefined }],
    ['identifiant GeoNames absent', { id: undefined }],
  ])('signale une réponse aux %s comme invalide', async (_libelle, changements) => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([resultatGeocodage(changements)])
    );

    await expect(
      resoudreDestinationOpenMeteo({ nom: 'Chamonix-Mont-Blanc' })
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Open-Meteo/GeoNames',
      raison: 'reponse_invalide',
    });
  });

  it('déduplique les résultats par identifiant GeoNames', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseOk([resultatGeocodage(), resultatGeocodage()])
    );

    await expect(
      resoudreDestinationOpenMeteo({ nom: 'Chamonix-Mont-Blanc' })
    ).resolves.toMatchObject({
      statut: 'unique',
      destination: { identifiantGeoNames: 3027301 },
    });
  });

  it('rend vide quand Open-Meteo ne fournit aucun résultat', async () => {
    requeteFetch.mockResolvedValueOnce(reponseOk([]));

    await expect(
      resoudreDestinationOpenMeteo({ nom: 'Ville introuvable' })
    ).resolves.toEqual({
      statut: 'vide',
      destinations: [],
      recupereLe: '2026-08-09T10:15:00.000Z',
    });
  });
});

describe('indisponibilités du géocodage', () => {
  it.each([
    [401, 'authentification'],
    [429, 'quota'],
    [500, 'fournisseur'],
  ] as const)('distingue HTTP %s en %s', async (statut, raison) => {
    requeteFetch.mockResolvedValueOnce({ ok: false, status: statut });

    await expect(
      resoudreDestinationOpenMeteo({ nom: 'Chamonix-Mont-Blanc' })
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Open-Meteo/GeoNames',
      raison,
    });
  });

  it('distingue un timeout', async () => {
    const erreur = new Error('signal aborted');
    erreur.name = 'AbortError';
    requeteFetch.mockRejectedValueOnce(erreur);

    await expect(
      resoudreDestinationOpenMeteo({ nom: 'Chamonix-Mont-Blanc' })
    ).resolves.toMatchObject({ statut: 'indisponible', raison: 'timeout' });
  });

  it('distingue une panne réseau', async () => {
    requeteFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      resoudreDestinationOpenMeteo({ nom: 'Chamonix-Mont-Blanc' })
    ).resolves.toMatchObject({ statut: 'indisponible', raison: 'reseau' });
  });

  it.each([
    ['JSON illisible', { ok: true, json: async () => Promise.reject(new Error()) }],
    ['enveloppe invalide', { ok: true, json: async () => ({ results: 'non' }) }],
  ])('rejette une réponse %s', async (_libelle, reponse) => {
    requeteFetch.mockResolvedValueOnce(reponse);

    await expect(
      resoudreDestinationOpenMeteo({ nom: 'Chamonix-Mont-Blanc' })
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Open-Meteo/GeoNames',
      raison: 'reponse_invalide',
    });
  });
});
