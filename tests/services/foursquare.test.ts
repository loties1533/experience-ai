import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requeteFetch = vi.fn();
global.fetch = requeteFetch as typeof fetch;

process.env.FOURSQUARE_API_KEY = 'cle-foursquare-test';

const { rechercherLieuxFoursquare } = await import(
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
    ['restaurant', 'restaurant bistronomique', 'French Restaurant', 'categorie-test'],
    ['activite', 'escape game', 'Escape Room', 'categorie-test'],
    ['sortie', 'bar à cocktails', 'Cocktail Bar', 'categorie-test'],
    ['hebergement', 'hôtel', 'Hotel', '19014'],
  ] as const)('porte le type métier %s sur le chemin réellement utilisé', async (type, requete, categorie, identifiantCategorie) => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            categories: [
              {
                fsq_category_id: identifiantCategorie,
                name: categorie,
              },
            ],
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

  it('conserve un hôtel Foursquare avec son identité, sa ville et sa provenance', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T08:15:00.000Z'));
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            fsq_place_id: 'fsq-hotel-001',
            name: 'Hôtel Burdigala',
            categories: [{ fsq_category_id: '19014', name: 'Hotel' }],
            location: {
              locality: 'Bordeaux',
              address: '115 rue Georges Bonnac',
            },
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'hôtel de charme',
      'hebergement',
    );

    expect(recherche).toEqual({
      statut: 'ok',
      recupereLe: '2026-07-28T08:15:00.000Z',
      resultats: [
        expect.objectContaining({
          identifiantExterne: 'fsq-hotel-001',
          nom: 'Hôtel Burdigala',
          villeDemandee: 'Bordeaux',
          villeConfirmee: 'Bordeaux',
          adresse: '115 rue Georges Bonnac, Bordeaux',
          categorieFournisseur: 'Hotel',
          typeMetierRecherche: 'hebergement',
          fournisseur: 'Foursquare',
          source: 'https://places-api.foursquare.com/places/search',
          recupereLe: '2026-07-28T08:15:00.000Z',
        }),
      ],
    });
    if (recherche.statut !== 'ok') throw new Error('résultat attendu');
    expect(recherche.resultats[0]).not.toHaveProperty('lienCarte');
    const url = new URL(String(requeteFetch.mock.calls[0][0]));
    expect(url.searchParams.get('fsq_category_ids')).toBe('19009');
  });

  it.each([
    ['Bed and Breakfast', '19010'],
    ['Boarding House', '19011'],
    ['Cabin', '19012'],
    ['Hostel', '19013'],
    ['Hotel', '19014'],
    ['Inn', '19015'],
    ['Lodge', '19016'],
    ['Motel', '19017'],
    ['Resort', '19018'],
    ['Vacation Rental', '19019'],
    ['Bed and Breakfast', undefined],
    ['HÔTEL', undefined],
  ])('conserve une catégorie d’hébergement compatible : %s', async (categorie, identifiantCategorie) => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            name: 'Maison du voyageur',
            categories: [
              {
                ...(identifiantCategorie
                  ? { fsq_category_id: identifiantCategorie }
                  : {}),
                name: categorie,
              },
            ],
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'auberge',
      'hebergement',
    );

    expect(recherche).toMatchObject({
      statut: 'ok',
      resultats: [
        {
          categorieFournisseur: categorie,
          typeMetierRecherche: 'hebergement',
        },
      ],
    });
  });

  it('refuse un libellé hôtelier quand Foursquare fournit un identifiant inconnu', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            name: 'Hôtel au mauvais identifiant',
            categories: [
              {
                fsq_category_id: 'categorie-inconnue',
                name: 'Hotel',
              },
            ],
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'hôtel',
      'hebergement',
    );

    expect(recherche.statut).toBe('vide');
  });

  it('préfère une sous-catégorie hôtelière identifiée même si elle n’est pas la première', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            name: 'Auberge du Centre',
            categories: [
              {
                fsq_category_id: 'categorie-inconnue',
                name: 'Hotel',
              },
              {
                fsq_category_id: '19013',
                name: 'Hostel',
              },
            ],
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'auberge',
      'hebergement',
    );

    expect(recherche).toMatchObject({
      statut: 'ok',
      resultats: [
        {
          categorieFournisseur: 'Hostel',
          identifiantCategorieFournisseur: '19013',
        },
      ],
    });
  });

  it.each([
    ['Hôtel Restaurant du Port', 'French Restaurant'],
    ['Hôtel California', 'Cocktail Bar'],
    ['Piscine du Grand Hôtel', 'Hotel Pool'],
    ['Hôtel des Curiosités', 'Tourist Attraction'],
  ])('rejette %s quand sa catégorie réelle est %s', async (nom, categorie) => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            name: nom,
            categories: [
              {
                fsq_category_id: 'categorie-incompatible',
                name: categorie,
              },
            ],
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'hôtel',
      'hebergement',
    );

    expect(recherche.statut).toBe('vide');
  });

  it('rejette un hôtel dont la localité Foursquare contredit la ville demandée', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            name: 'Hôtel du Centre',
            categories: [{ fsq_category_id: '19014', name: 'Hotel' }],
            location: {
              locality: 'Paris',
              address: '1 rue du Centre',
            },
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'hôtel',
      'hebergement',
    );

    expect(recherche.statut).toBe('vide');
  });

  it('compare la ville sans dépendre de la casse ni des accents', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            ...REPONSE_FOURSQUARE.results[0],
            name: 'Hôtel des Lumières',
            categories: [{ fsq_category_id: '19014', name: 'Hotel' }],
            location: {
              locality: 'ÉVRY',
              address: '1 rue des Lumières',
            },
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare(
      'evry',
      'hôtel',
      'hebergement',
    );

    expect(recherche).toMatchObject({
      statut: 'ok',
      resultats: [{ villeConfirmee: 'ÉVRY' }],
    });
  });

  it('ne fabrique aucune ville confirmée lorsque Foursquare ne la fournit pas', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            fsq_place_id: 'fsq-hotel-sans-ville',
            name: 'Hôtel sans localité',
            categories: [{ fsq_category_id: '19014', name: 'Hotel' }],
            location: { address: '1 rue du Port' },
          },
        ],
      }),
    });

    const recherche = await rechercherLieuxFoursquare(
      'Bordeaux',
      'hôtel',
      'hebergement',
    );

    expect(recherche).toMatchObject({
      statut: 'ok',
      resultats: [
        {
          villeDemandee: 'Bordeaux',
          adresse: '1 rue du Port',
        },
      ],
    });
    if (recherche.statut !== 'ok') throw new Error('résultat attendu');
    expect(recherche.resultats[0]).not.toHaveProperty('villeConfirmee');
  });

  it.each(['Mérignac', 'Paris 8e Arrondissement'])(
    'rejette une localité explicitement différente : %s',
    async (localite) => {
      requeteFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              ...REPONSE_FOURSQUARE.results[0],
              name: 'Hôtel du Centre',
              categories: [{ fsq_category_id: '19014', name: 'Hotel' }],
              location: {
                locality: localite,
                address: '1 rue du Centre',
              },
            },
          ],
        }),
      });

      const recherche = await rechercherLieuxFoursquare(
        'Bordeaux',
        'hôtel',
        'hebergement',
      );

      expect(recherche.statut).toBe('vide');
    }
  );

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

  it('refuse une catégorie hôtelière externe mal formée', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            fsq_place_id: 'fsq-hotel-invalide',
            name: 'Hôtel invalide',
            categories: [{ fsq_category_id: 19014, name: 'Hotel' }],
          },
        ],
      }),
    });

    await expect(
      rechercherLieuxFoursquare('Bordeaux', 'hôtel', 'hebergement')
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
