// =============================================
// TRIPGENIE — tests/services/foursquare.test.ts
// Tests du service Foursquare Places API :
//   - mapping vers le format Activite
//   - liens TheFork
//   - gestion des erreurs / clé manquante
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

process.env.FOURSQUARE_API_KEY = 'fsq3-test-key-vitest';

const { foursquareRestaurantSearch } = await import('../../server/services/foursquare.js');

// ---- Réponse Foursquare fictive ----
const MOCK_FSQ_RESPONSE = {
  results: [
    {
      fsq_place_id: 'fsq-001',
      name:       'El Chiringuito',
      rating:     9.1,
      price:      3,
      categories: [{ id: 13065, name: 'Fine Dining' }],
      location:   { locality: 'Ibiza', address: 'Passeig de ses Pitiuses' }
    },
    {
      fsq_place_id: 'fsq-002',
      name:       'Lio Restaurant',
      rating:     8.7,
      price:      4,
      categories: [{ id: 13003, name: 'Spanish Restaurant' }],
      location:   { locality: 'Ibiza', address: 'Marina Ibiza' }
    },
    {
      fsq_place_id: 'fsq-003',
      name:       'Sa Caleta',
      rating:     8.3,
      price:      2,
      categories: [{ id: 13072, name: 'Seafood' }],
      location:   { locality: 'Ibiza', address: 'Sant Josep' }
    }
  ]
};

beforeEach(() => {
  mockFetch.mockReset();
});

// ============================================================
// Cas nominal
// ============================================================
describe('foursquareRestaurantSearch — cas nominal', () => {

  it('retourne des activités avec les propriétés requises', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_FSQ_RESPONSE });

    const results = await foursquareRestaurantSearch('Ibiza', 'party');

    expect(results).toHaveLength(3);
    results.forEach(r => {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('category');
      expect(r).toHaveProperty('price');
      expect(r).toHaveProperty('booking_url');
    });
  });

  it('booking_url pointe vers Google Maps (universel, bonne ville partout)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_FSQ_RESPONSE });
    const results = await foursquareRestaurantSearch('Ibiza', 'party');
    results.forEach(r => {
      expect(r.booking_url).toContain('google.com/maps');
    });
  });

  it('le nom du restaurant est inclus dans la booking_url', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_FSQ_RESPONSE });
    const results = await foursquareRestaurantSearch('Ibiza', 'party');
    // encodeURIComponent produit %20 (pas +)
    const decoded = decodeURIComponent(results[0].booking_url ?? '');
    expect(decoded).toContain('El Chiringuito');
  });

  it('utilise le header Authorization Bearer + la version de l\'API', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_FSQ_RESPONSE });
    await foursquareRestaurantSearch('Ibiza', 'party');
    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(headers?.Authorization).toBe('Bearer fsq3-test-key-vitest');
    expect(headers?.['X-Places-Api-Version']).toBeTruthy();
  });

  it('appelle le nouvel endpoint places-api (pas le legacy v3)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_FSQ_RESPONSE });
    await foursquareRestaurantSearch('Ibiza', 'party');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('places-api.foursquare.com');
    expect(url).not.toContain('api.foursquare.com/v3');
  });

  it('limit=3 dans l\'URL', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_FSQ_RESPONSE });
    await foursquareRestaurantSearch('Ibiza', 'party');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('limit=3');
  });
});

// ============================================================
// Mapping prix
// ============================================================
describe('foursquareRestaurantSearch — mapping des prix', () => {

  it('price=1 ($) correspond à ~15€', async () => {
    const r = { results: [{ ...MOCK_FSQ_RESPONSE.results[0], price: 1, name: 'Budget' }] };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => r });
    const [result] = await foursquareRestaurantSearch('Paris', 'student');
    expect(result.price).toBe(15);
    expect(result.price_range).toBe('$');
  });

  it('price=4 ($$$$) correspond à ~120€', async () => {
    const r = { results: [{ ...MOCK_FSQ_RESPONSE.results[0], price: 4, name: 'Luxe' }] };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => r });
    const [result] = await foursquareRestaurantSearch('Paris', 'relax');
    expect(result.price).toBe(120);
    expect(result.price_range).toBe('$$$$');
  });

  it('price absent → fallback $$ (~35€)', async () => {
    const r = { results: [{ ...MOCK_FSQ_RESPONSE.results[0], price: undefined, name: 'Sans prix' }] };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => r });
    const [result] = await foursquareRestaurantSearch('Paris', 'relax');
    expect(result.price).toBe(35);
    expect(result.price_range).toBe('$$');
  });
});

// ============================================================
// Requêtes par mode
// ============================================================
describe('foursquareRestaurantSearch — queries par mode', () => {

  it('mode party : requête contient "bar" ou "nightclub"', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_FSQ_RESPONSE });
    await foursquareRestaurantSearch('Ibiza', 'party');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toMatch(/bar|nightclub|lounge/i);
  });

  it('premium=true : requête contient "fine dining" quel que soit le mode', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_FSQ_RESPONSE });
    // premium est un axe indépendant du mode (ici relax) → catégories haut de gamme.
    await foursquareRestaurantSearch('Monaco', 'relax', true);
    // URLSearchParams encode les espaces avec +, decodeURIComponent ne les décode pas → replace
    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string).replace(/\+/g, ' ');
    expect(url).toMatch(/fine dining|wine bar/i);
  });
});

// ============================================================
// Gestion des erreurs
// ============================================================
describe('foursquareRestaurantSearch — erreurs', () => {

  it('retourne [] si FOURSQUARE_API_KEY manquante', async () => {
    const orig = process.env.FOURSQUARE_API_KEY;
    process.env.FOURSQUARE_API_KEY = '';
    vi.resetModules();
    const { foursquareRestaurantSearch: fn } = await import('../../server/services/foursquare.js?v=' + Date.now());
    const r = await fn('Ibiza', 'party');
    expect(r).toEqual([]);
    process.env.FOURSQUARE_API_KEY = orig;
  });

  it('retourne [] si API renvoie 401 (clé invalide)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    const results = await foursquareRestaurantSearch('Ibiza', 'party');
    expect(results).toEqual([]);
  });

  it('retourne [] si API renvoie 0 résultats', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    const results = await foursquareRestaurantSearch('Ibiza', 'party');
    expect(results).toEqual([]);
  });

  it('retourne [] si fetch throw (timeout)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('AbortError'));
    const results = await foursquareRestaurantSearch('Ibiza', 'party');
    expect(results).toEqual([]);
  });

  it('ne throw jamais — toujours un tableau même en cas de panne', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));
    await expect(foursquareRestaurantSearch('Ibiza', 'party')).resolves.toEqual([]);
  });
});
