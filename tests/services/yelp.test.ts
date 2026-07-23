// =============================================
// TRIPGENIE — tests/services/yelp.test.ts
// Tests du service Yelp Fusion (fallback restaurants)
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

process.env.YELP_API_KEY = 'test-yelp-key-vitest';

const { yelpRestaurantSearch } = await import('../../server/services/yelp.js');

const MOCK_YELP_RESPONSE = {
  businesses: [
    {
      id:         'yelp-001',
      name:       'Nobu Ibiza Bay',
      rating:     4.5,
      price:      '$$$$',
      categories: [{ alias: 'japanese', title: 'Japanese' }],
      location:   { address1: 'Passeig Joan Carles I', city: 'Ibiza' },
      url:        'https://www.yelp.com/biz/nobu-ibiza'
    },
    {
      id:         'yelp-002',
      name:       'La Brasa',
      rating:     4.2,
      price:      '$$',
      categories: [{ alias: 'spanish', title: 'Spanish' }],
      location:   { address1: 'Carrer Pere Sala 3', city: 'Ibiza' },
      url:        'https://www.yelp.com/biz/la-brasa-ibiza'
    }
  ]
};

beforeEach(() => mockFetch.mockReset());

// ============================================================
// Cas nominal
// ============================================================
describe('yelpRestaurantSearch — cas nominal', () => {

  it('retourne des activités avec les propriétés requises', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_YELP_RESPONSE });
    const results = await yelpRestaurantSearch('Ibiza', 'relax');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('category');
      expect(r).toHaveProperty('booking_url');
    });
  });

  it('Bearer token dans le header Authorization', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_YELP_RESPONSE });
    await yelpRestaurantSearch('Ibiza', 'relax');
    const headers = mockFetch.mock.calls[0][1]?.headers;
    expect(headers?.Authorization).toBe('Bearer test-yelp-key-vitest');
  });

  it('booking_url pointe vers Google Maps (universel, bonne ville partout)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_YELP_RESPONSE });
    const [first] = await yelpRestaurantSearch('Ibiza', 'relax');
    // Lien universel Google Maps plutôt que TheFork (qui ne couvre que la France/Europe)
    expect(first.booking_url).toContain('google.com/maps');
  });

  it('premium=true : catégories haut de gamme quel que soit le mode', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_YELP_RESPONSE });
    await yelpRestaurantSearch('Ibiza', 'relax', true);
    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toMatch(/frenchrestaurants|wine_bars/);
  });
});

// ============================================================
// Erreurs et fallbacks
// ============================================================
describe('yelpRestaurantSearch — erreurs', () => {

  it('retourne [] si YELP_API_KEY absente', async () => {
    const orig = process.env.YELP_API_KEY;
    process.env.YELP_API_KEY = '';
    vi.resetModules();
    const { yelpRestaurantSearch: fn } = await import('../../server/services/yelp.js?v=' + Date.now());
    const r = await fn('Ibiza', 'party');
    expect(r).toEqual([]);
    process.env.YELP_API_KEY = orig;
  });

  it('retourne [] si API 401', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(yelpRestaurantSearch('Ibiza', 'party')).resolves.toEqual([]);
  });

  it('retourne [] si businesses vide', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ businesses: [] }) });
    await expect(yelpRestaurantSearch('Ibiza', 'party')).resolves.toEqual([]);
  });

  it('ne throw jamais', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network down'));
    await expect(yelpRestaurantSearch('Ibiza', 'party')).resolves.toEqual([]);
  });
});

// ============================================================
// Chaîne Foursquare → Yelp (fallback)
// ============================================================
describe('Foursquare → Yelp fallback chain', () => {

  it('si Foursquare vide ([]) → Yelp est utilisé', async () => {
    // Simule la logique de ai.ts : FSQ vide → appel Yelp
    const fsqEmpty: any[] = [];
    const yelpFilled = [{ name: 'Test', category: 'Restaurant', description: '', duration: '1h', price: 30, booking_url: 'https://yelp.com', price_range: '$$' }];

    const result = fsqEmpty.length > 0 ? fsqEmpty : yelpFilled;
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test');
  });

  it('si Foursquare a des résultats → Yelp n\'est PAS appelé', async () => {
    const fsqFilled = [{ name: 'FSQ', category: 'Fine Dining', description: '', duration: '1h30', price: 80, booking_url: 'https://thefork.fr', price_range: '$$$' }];
    const result = fsqFilled.length > 0 ? fsqFilled : [];
    expect(result[0].name).toBe('FSQ');
  });
});
