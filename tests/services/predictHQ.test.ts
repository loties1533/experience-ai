import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requeteFetch = vi.fn();
global.fetch = requeteFetch as typeof fetch;

process.env.PREDICTHQ_API_KEY = 'cle-predicthq-test';

const {
  DemandeRechercheEvenementsEventFirstSchema,
  rechercherEvenementsPredictHQ,
  rechercherEvenementsPredictHQEventFirst,
} = await import(
  '../../server/services/predictHQ.js'
);

const REPONSE_VILLE = {
  results: [{ id: 'place-bordeaux', name: 'Bordeaux', type: 'locality' }],
};

const REPONSE_EVENEMENTS = {
  results: [
    {
      id: 'evt-001',
      title: 'Concert de La Femme',
      category: 'performing-arts',
      start: '2026-09-05T20:00:00Z',
      end: '2026-09-05T22:00:00Z',
      description: 'Concert à Bordeaux',
      entities: [
        {
          type: 'venue',
          name: 'Rock School Barbey',
          formatted_address: '18 cours Barbey, Bordeaux',
        },
      ],
      local_rank: 90,
    },
  ],
};

function evenementEventFirst(changements: Record<string, unknown> = {}) {
  return {
    id: 'evt-nba-boston',
    title: 'Boston Celtics vs New York Knicks',
    category: 'sports',
    start: '2027-01-18T00:30:00Z',
    end: '2027-01-18T03:00:00Z',
    geo: {
      address: {
        locality: 'Boston',
        country_code: 'US',
      },
    },
    entities: [{ type: 'venue', name: 'TD Garden' }],
    ...changements,
  };
}

const DEMANDE_NBA = {
  requete: 'NBA',
  dateDebut: '2027-01-15',
  dateFin: '2027-02-10',
  categorie: 'sports' as const,
  pays: 'US',
};

beforeEach(() => {
  process.env.PREDICTHQ_API_KEY = 'cle-predicthq-test';
  requeteFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rechercherEvenementsPredictHQ — identité et provenance', () => {
  it('valide et transforme les réponses externes en candidat événement', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T09:30:00.000Z'));
    requeteFetch
      .mockResolvedValueOnce({ ok: true, json: async () => REPONSE_VILLE })
      .mockResolvedValueOnce({ ok: true, json: async () => REPONSE_EVENEMENTS });

    const recherche = await rechercherEvenementsPredictHQ(
      'Bordeaux',
      '2026-09-04',
      '2026-09-06',
      'relax'
    );

    expect(recherche).toEqual({
      statut: 'ok',
      recupereLe: '2026-07-28T09:30:00.000Z',
      resultats: [
        {
          identifiantExterne: 'evt-001',
          nom: 'Concert de La Femme',
          villeDemandee: 'Bordeaux',
          villeConfirmee: 'Bordeaux',
          salle: 'Rock School Barbey, 18 cours Barbey, Bordeaux',
          categorieFournisseur: 'performing arts',
          typeMetierRecherche: 'evenement',
          fournisseur: 'PredictHQ',
          source: 'https://api.predicthq.com/v1/events/',
          recupereLe: '2026-07-28T09:30:00.000Z',
          dateDebut: '2026-09-05T20:00:00Z',
          dateFin: '2026-09-05T22:00:00Z',
          description: 'Concert à Bordeaux',
        },
      ],
    });
  });

  it('utilise la recherche textuelle quand la ville PredictHQ est réellement vide', async () => {
    requeteFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => REPONSE_EVENEMENTS });

    const recherche = await rechercherEvenementsPredictHQ(
      'Bordeaux',
      '2026-09-04',
      '2026-09-06',
      'party'
    );

    expect(recherche.statut).toBe('ok');
    expect(String(requeteFetch.mock.calls[1][0])).toContain('q=Bordeaux');
  });

  it('conserve les champs de protocole PredictHQ dans la requête', async () => {
    requeteFetch
      .mockResolvedValueOnce({ ok: true, json: async () => REPONSE_VILLE })
      .mockResolvedValueOnce({ ok: true, json: async () => REPONSE_EVENEMENTS });

    await rechercherEvenementsPredictHQ(
      'Bordeaux',
      '2026-09-04',
      '2026-09-06',
      'party'
    );

    const url = String(requeteFetch.mock.calls[1][0]);
    expect(url).toContain('active.gte=2026-09-04');
    expect(url).toContain('active.lte=2026-09-06');
    expect(url).toContain('place.scope=place-bordeaux');
    expect((requeteFetch.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer cle-predicthq-test',
    });
  });

  it('écarte localement un événement situé hors de la ville demandée', async () => {
    const evenementLyon = {
      results: [
        {
          ...REPONSE_EVENEMENTS.results[0],
          entities: [
            {
              type: 'venue',
              name: 'Transbordeur',
              formatted_address: '3 boulevard Stalingrad, Lyon',
            },
          ],
        },
      ],
    };
    requeteFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => evenementLyon });

    const recherche = await rechercherEvenementsPredictHQ(
      'Bordeaux',
      '2026-09-04',
      '2026-09-06',
      'party'
    );

    expect(recherche.statut).toBe('vide');
  });

  it('écarte localement un événement hors de la période demandée', async () => {
    const evenementHorsPeriode = {
      results: [
        {
          ...REPONSE_EVENEMENTS.results[0],
          start: '2026-09-08T20:00:00Z',
          end: '2026-09-08T22:00:00Z',
        },
      ],
    };
    requeteFetch
      .mockResolvedValueOnce({ ok: true, json: async () => REPONSE_VILLE })
      .mockResolvedValueOnce({ ok: true, json: async () => evenementHorsPeriode });

    const recherche = await rechercherEvenementsPredictHQ(
      'Bordeaux',
      '2026-09-04',
      '2026-09-06',
      'party'
    );

    expect(recherche.statut).toBe('vide');
  });
});

describe('rechercherEvenementsPredictHQ — états de recherche', () => {
  it('distingue une vraie recherche vide', async () => {
    requeteFetch
      .mockResolvedValueOnce({ ok: true, json: async () => REPONSE_VILLE })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });

    const recherche = await rechercherEvenementsPredictHQ(
      'Bordeaux',
      '2026-09-04',
      '2026-09-06',
      'party'
    );

    expect(recherche.statut).toBe('vide');
  });

  it('distingue une configuration absente', async () => {
    process.env.PREDICTHQ_API_KEY = '';

    await expect(
      rechercherEvenementsPredictHQ('Bordeaux', '2026-09-04', '2026-09-06', 'party')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'configuration_absente',
    });
    expect(requeteFetch).not.toHaveBeenCalled();
  });

  it('ne transforme pas une erreur HTTP de recherche de ville en recherche vide', async () => {
    requeteFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(
      rechercherEvenementsPredictHQ('Bordeaux', '2026-09-04', '2026-09-06', 'party')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'authentification',
    });
    expect(requeteFetch).toHaveBeenCalledOnce();
  });

  it.each([
    [429, 'quota'],
    [500, 'fournisseur'],
  ] as const)('convertit HTTP %s de recherche d’événements en %s', async (statut, raison) => {
    requeteFetch
      .mockResolvedValueOnce({ ok: true, json: async () => REPONSE_VILLE })
      .mockResolvedValueOnce({ ok: false, status: statut });

    await expect(
      rechercherEvenementsPredictHQ('Bordeaux', '2026-09-04', '2026-09-06', 'party')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison,
    });
  });

  it('distingue un timeout', async () => {
    const erreur = new Error('signal aborted');
    erreur.name = 'AbortError';
    requeteFetch.mockRejectedValueOnce(erreur);

    await expect(
      rechercherEvenementsPredictHQ('Bordeaux', '2026-09-04', '2026-09-06', 'party')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'timeout',
    });
  });

  it('distingue une panne réseau', async () => {
    requeteFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      rechercherEvenementsPredictHQ('Bordeaux', '2026-09-04', '2026-09-06', 'party')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'reseau',
    });
  });

  it('refuse une réponse externe invalide', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 12 }] }),
    });

    await expect(
      rechercherEvenementsPredictHQ('Bordeaux', '2026-09-04', '2026-09-06', 'party')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'reponse_invalide',
    });
  });

  it('refuse une date événementielle qui n’est pas une date ISO', async () => {
    requeteFetch
      .mockResolvedValueOnce({ ok: true, json: async () => REPONSE_VILLE })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ ...REPONSE_EVENEMENTS.results[0], start: 'demain soir' }],
        }),
      });

    await expect(
      rechercherEvenementsPredictHQ('Bordeaux', '2026-09-04', '2026-09-06', 'party')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
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
      rechercherEvenementsPredictHQ('Bordeaux', '2026-09-04', '2026-09-06', 'party')
    ).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'reponse_invalide',
    });
  });
});

describe('rechercherEvenementsPredictHQEventFirst — événements sans ville préalable', () => {
  it('valide strictement le contrat NBA minimal', () => {
    expect(DemandeRechercheEvenementsEventFirstSchema.safeParse(DEMANDE_NBA).success).toBe(true);
    expect(
      DemandeRechercheEvenementsEventFirstSchema.safeParse({
        ...DEMANDE_NBA,
        pays: 'us',
      }).success
    ).toBe(false);
    expect(
      DemandeRechercheEvenementsEventFirstSchema.safeParse({
        ...DEMANDE_NBA,
        surprise: true,
      }).success
    ).toBe(false);
  });

  it('cherche NBA directement dans Events et conserve les villes prouvées', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T13:00:00.000Z'));
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          evenementEventFirst(),
          evenementEventFirst({
            id: 'evt-nba-new-york',
            title: 'New York Knicks vs Chicago Bulls',
            geo: { address: { locality: 'New York', country_code: 'US' } },
          }),
          evenementEventFirst({
            id: 'evt-nba-chicago',
            title: 'Chicago Bulls vs Boston Celtics',
            geo: { address: { locality: 'Chicago', country_code: 'US' } },
          }),
          evenementEventFirst({
            id: 'evt-hors-periode',
            start: '2027-02-11T00:30:00Z',
            end: '2027-02-11T03:00:00Z',
          }),
          evenementEventFirst({
            id: 'evt-sans-ville',
            geo: { address: { country_code: 'US' } },
            entities: [
              {
                type: 'venue',
                name: 'TD Garden',
                formatted_address: '100 Legends Way, Boston, United States',
              },
            ],
          }),
        ],
      }),
    });

    const recherche = await rechercherEvenementsPredictHQEventFirst(DEMANDE_NBA);

    expect(recherche).toMatchObject({
      statut: 'ok',
      recupereLe: '2026-08-08T13:00:00.000Z',
      resultats: [
        {
          identifiantExterne: 'evt-nba-boston',
          nom: 'Boston Celtics vs New York Knicks',
          ville: 'Boston',
          codePays: 'US',
          dateDebut: '2027-01-18T00:30:00Z',
          dateFin: '2027-01-18T03:00:00Z',
          salle: 'TD Garden',
          fournisseur: 'PredictHQ',
          source: 'https://api.predicthq.com/v1/events/',
        },
        { identifiantExterne: 'evt-nba-new-york', ville: 'New York', codePays: 'US' },
        { identifiantExterne: 'evt-nba-chicago', ville: 'Chicago', codePays: 'US' },
      ],
    });
    expect(recherche.statut === 'ok' && recherche.resultats.map((e) => e.identifiantExterne))
      .toEqual(['evt-nba-boston', 'evt-nba-new-york', 'evt-nba-chicago']);

    expect(requeteFetch).toHaveBeenCalledOnce();
    const url = String(requeteFetch.mock.calls[0][0]);
    expect(url).toContain('/events/?');
    expect(url).toContain('q=NBA');
    expect(url).toContain('active.gte=2027-01-15');
    expect(url).toContain('active.lte=2027-02-10');
    expect(url).toContain('category=sports');
    expect(url).toContain('country=US');
    expect(url).not.toContain('place.scope');
    expect(url).not.toContain('/places/');
  });

  it('rejette les événements hors fenêtre, sans ville ou hors pays', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          evenementEventFirst({
            start: '2027-02-11T00:30:00Z',
            end: '2027-02-11T03:00:00Z',
          }),
          evenementEventFirst({
            geo: { address: { country_code: 'US' } },
            entities: [
              {
                type: 'venue',
                name: 'TD Garden',
                formatted_address: '100 Legends Way, Boston, United States',
              },
            ],
          }),
          evenementEventFirst({ geo: { address: { locality: 'Toronto', country_code: 'CA' } } }),
        ],
      }),
    });

    await expect(rechercherEvenementsPredictHQEventFirst(DEMANDE_NBA)).resolves.toMatchObject({
      statut: 'vide',
      resultats: [],
    });
  });

  it('filtre aussi côté serveur une catégorie différente de celle demandée', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [evenementEventFirst({ category: 'concerts' })],
      }),
    });

    await expect(rechercherEvenementsPredictHQEventFirst(DEMANDE_NBA)).resolves.toMatchObject({
      statut: 'vide',
      resultats: [],
    });
  });

  it('pagine de façon bornée lorsqu’une première page ne fournit aucune ville utilisable', async () => {
    requeteFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [evenementEventFirst({ geo: { address: { country_code: 'US' } } })],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [evenementEventFirst()] }),
      });

    const recherche = await rechercherEvenementsPredictHQEventFirst({
      ...DEMANDE_NBA,
      limite: 1,
    });

    expect(recherche).toMatchObject({
      statut: 'ok',
      resultats: [{ ville: 'Boston' }],
    });
    expect(requeteFetch).toHaveBeenCalledTimes(2);
    expect(String(requeteFetch.mock.calls[0][0])).toContain('offset=0');
    expect(String(requeteFetch.mock.calls[1][0])).toContain('offset=1');
  });

  it('renvoie vide si Events répond 200 sans événement utilisable', async () => {
    requeteFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });

    await expect(rechercherEvenementsPredictHQEventFirst(DEMANDE_NBA)).resolves.toMatchObject({
      statut: 'vide',
      resultats: [],
    });
  });

  it.each([
    [401, 'authentification'],
    [403, 'authentification'],
    [429, 'quota'],
    [500, 'fournisseur'],
  ] as const)('distingue HTTP %s comme indisponibilité %s', async (statut, raison) => {
    requeteFetch.mockResolvedValueOnce({ ok: false, status: statut });

    await expect(rechercherEvenementsPredictHQEventFirst(DEMANDE_NBA)).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison,
    });
  });

  it.each([
    ['JSON invalide', async () => { throw new SyntaxError('JSON incomplet'); }],
    ['schéma invalide', async () => ({ results: [{ id: 12 }] })],
  ])('classe %s comme indisponibilité', async (_cas, json) => {
    requeteFetch.mockResolvedValueOnce({ ok: true, json });

    await expect(rechercherEvenementsPredictHQEventFirst(DEMANDE_NBA)).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'reponse_invalide',
    });
  });

  it('distingue timeout, configuration absente et panne réseau', async () => {
    const timeout = new Error('signal aborted');
    timeout.name = 'AbortError';
    requeteFetch.mockRejectedValueOnce(timeout);
    await expect(rechercherEvenementsPredictHQEventFirst(DEMANDE_NBA)).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'timeout',
    });

    process.env.PREDICTHQ_API_KEY = '';
    await expect(rechercherEvenementsPredictHQEventFirst(DEMANDE_NBA)).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'configuration_absente',
    });
    expect(requeteFetch).toHaveBeenCalledOnce();

    process.env.PREDICTHQ_API_KEY = 'cle-predicthq-test';
    requeteFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(rechercherEvenementsPredictHQEventFirst(DEMANDE_NBA)).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'reseau',
    });
  });
});
