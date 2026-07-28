import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requeteFetch = vi.fn();
global.fetch = requeteFetch as typeof fetch;

process.env.FOURSQUARE_API_KEY = 'cle-foursquare-test';

const { foursquareRechercheLieux, rechercherLieuxFoursquare } = await import(
  '../../server/services/foursquare.js'
);

const REPONSE_FOURSQUARE = {
  results: [
    {
      fsq_place_id: 'fsq-001',
      name: 'Le Point Rouge',
      categories: [{ fsq_category_id: '13065', name: 'Cocktail Bar' }],
      location: { locality: 'Bordeaux', address: '3 rue Sainte-Colombe' },
    },
  ],
};

beforeEach(() => {
  process.env.FOURSQUARE_API_KEY = 'cle-foursquare-test';
  requeteFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rechercherLieuxFoursquare — identité et provenance', () => {
  it('valide et transforme la réponse externe en candidat structuré', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T08:15:00.000Z'));
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => REPONSE_FOURSQUARE,
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'bar à cocktails',
      'sortie',
      4
    );

    expect(recherche).toEqual({
      statut: 'ok',
      recupereLe: '2026-07-28T08:15:00.000Z',
      resultats: [
        {
          identifiantExterne: 'fsq-001',
          nom: 'Le Point Rouge',
          villeDemandee: 'Bordeaux',
          categorieFournisseur: 'Cocktail Bar',
          typeMetierRecherche: 'sortie',
          adresse: '3 rue Sainte-Colombe, Bordeaux',
          lienCarte:
            'https://www.google.com/maps/search/?api=1&query=Le%20Point%20Rouge%20Bordeaux',
          fournisseur: 'Foursquare',
          source: 'https://places-api.foursquare.com/places/search',
          recupereLe: '2026-07-28T08:15:00.000Z',
        },
      ],
    });
  });

  it.each([
    ['restaurant', 'restaurant bistronomique', 'French Restaurant'],
    ['activite', 'escape game', 'Escape Room'],
    ['sortie', 'bar à cocktails', 'Cocktail Bar'],
  ] as const)('porte le type métier %s sur le chemin réellement utilisé', async (type, requete, categorie) => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            categories: [{ fsq_category_id: 'categorie-test', name: categorie }],
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare('Bordeaux', requete, type);

    expect(recherche.statut).toBe('ok');
    if (recherche.statut !== 'ok') throw new Error('résultat attendu');
    expect(recherche.resultats[0].typeMetierRecherche).toBe(type);
    expect(recherche.resultats[0]).not.toHaveProperty('prix');
    expect(String(requeteFetch.mock.calls[0][0])).toContain('places-api.foursquare.com');
  });

  it('écarte une catégorie fournisseur incompatible avec le type métier', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => REPONSE_FOURSQUARE,
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'restaurant',
      'restaurant'
    );

    expect(recherche.statut).toBe('vide');
  });

  it('conserve la catégorie qui prouve le type métier quand elle n’est pas la première', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            categories: [
              { fsq_category_id: 'hotel', name: 'Hotel' },
              { fsq_category_id: 'restaurant', name: 'French Restaurant' },
            ],
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'restaurant français',
      'restaurant'
    );

    expect(recherche).toMatchObject({
      statut: 'ok',
      resultats: [{ categorieFournisseur: 'French Restaurant' }],
    });
  });

  it('envoie les en-têtes officiels imposés par Foursquare', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => REPONSE_FOURSQUARE,
    });

    await rechercherLieuxFoursquare('Bordeaux', 'restaurant', 'restaurant');

    const options = requeteFetch.mock.calls[0][1] as RequestInit;
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer cle-foursquare-test',
      'X-Places-Api-Version': '2025-06-17',
      Accept: 'application/json',
    });
  });
});

describe('rechercherLieuxFoursquare — états de recherche', () => {
  it('distingue une vraie recherche vide', async () => {
    requeteFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });

    const recherche = await rechercherLieuxFoursquare('Bordeaux', 'aquarium', 'activite');

    expect(recherche.statut).toBe('vide');
    if (recherche.statut !== 'vide') throw new Error('vide attendu');
    expect(recherche.resultats).toEqual([]);
    expect(Number.isNaN(Date.parse(recherche.recupereLe))).toBe(false);
  });

  it('distingue une configuration absente', async () => {
    process.env.FOURSQUARE_API_KEY = '';

    await expect(
      rechercherLieuxFoursquare('Bordeaux', 'restaurant', 'restaurant')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'configuration_absente',
    });
    expect(requeteFetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'authentification'],
    [403, 'authentification'],
    [429, 'quota'],
    [500, 'fournisseur'],
  ] as const)('convertit HTTP %s en %s', async (statut, raison) => {
    requeteFetch.mockResolvedValueOnce({ ok: false, status: statut });

    await expect(
      rechercherLieuxFoursquare('Bordeaux', 'restaurant', 'restaurant')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison,
    });
  });

  it('distingue un timeout', async () => {
    const erreur = new Error('The operation timed out');
    erreur.name = 'TimeoutError';
    requeteFetch.mockRejectedValueOnce(erreur);

    await expect(
      rechercherLieuxFoursquare('Bordeaux', 'restaurant', 'restaurant')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'timeout',
    });
  });

  it('distingue une panne réseau', async () => {
    requeteFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      rechercherLieuxFoursquare('Bordeaux', 'restaurant', 'restaurant')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'reseau',
    });
  });

  it('refuse une réponse externe invalide au lieu de promouvoir ses données', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ fsq_place_id: '', name: 42 }] }),
    });

    await expect(
      rechercherLieuxFoursquare('Bordeaux', 'restaurant', 'restaurant')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'reponse_invalide',
    });
  });

  it('classe un JSON illisible comme réponse invalide', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('JSON incomplet');
      },
    });

    await expect(
      rechercherLieuxFoursquare('Bordeaux', 'restaurant', 'restaurant')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'reponse_invalide',
    });
  });
});

describe('foursquareRechercheLieux — compatibilité historique', () => {
  it.each([
    ['restaurant', 'French Restaurant'],
    ['bar', 'Cocktail Bar'],
    ['activité', 'Escape Room'],
  ])('reste générique et retourne un %s', async (_typeLieu, categorie) => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            categories: [{ fsq_category_id: 'categorie-test', name: categorie }],
          },
        ],
      }),
    });

    const lieux = await foursquareRechercheLieux('Bordeaux', _typeLieu);

    expect(lieux).toEqual([
      {
        identifiantExterne: 'fsq-001',
        nom: 'Le Point Rouge',
        categorie,
        adresse: '3 rue Sainte-Colombe, Bordeaux',
        lienCarte:
          'https://www.google.com/maps/search/?api=1&query=Le%20Point%20Rouge%20Bordeaux',
      },
    ]);
    expect(lieux[0]).not.toHaveProperty('prix');
  });
});
