// =============================================
// TRIPGENIE — tests/services/predictHQ.test.ts
// Tests du service PredictHQ :
//   - recherche de place ID
//   - recherche d'événements
//   - mapping vers le format Evenement
//   - gestion des erreurs / clé manquante
// =============================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mock fetch avant l'import du service ----
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// ---- Mock env ----
process.env.PREDICTHQ_API_KEY = 'test-phq-key-vitest';

// Import dynamique après mock pour que process.env soit pris en compte
const { predictHQEventsSearch } = await import('../../server/services/predictHQ.js');

// ---- Réponses API fictives ----
const MOCK_PLACE_RESPONSE = {
  results: [{ id: 'place-ibiza-123', name: 'Ibiza', country: 'ES' }]
};

const MOCK_EVENTS_RESPONSE = {
  results: [
    {
      id:           'evt-001',
      title:        'Amnesia Opening Party',
      category:     'concerts',
      start:        '2025-07-15T22:00:00Z',
      end:          '2025-07-16T06:00:00Z',
      local_rank:   95,
      description:  'La fête de l\'année à Ibiza',
      entities:     [{ type: 'venue', name: 'Amnesia Club', formatted_address: 'Carretera Ibiza a San Antonio' }],
      labels:       ['music', 'nightlife'],
      predicted_attendance: 5000
    },
    {
      id:           'evt-002',
      title:        'DC-10 Monday Club',
      category:     'festivals',
      start:        '2025-07-21T23:00:00Z',
      end:          '2025-07-22T07:00:00Z',
      local_rank:   88,
      description:  'Soirée techno légendaire',
      entities:     [{ type: 'venue', name: 'DC-10', formatted_address: 'Carretera Aeropuerto' }],
      labels:       ['music'],
      predicted_attendance: 2000
    }
  ]
};

// ---- Reset fetch mock avant chaque test ----
beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// Cas nominal — recherche réussie
// ============================================================
describe('predictHQEventsSearch — cas nominal', () => {

  it('retourne des événements mappés au format Evenement', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_PLACE_RESPONSE })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_EVENTS_RESPONSE });

    const events = await predictHQEventsSearch('Ibiza', '2025-07-15', '2025-07-22', 'party');

    expect(events).toHaveLength(2);
    expect(events[0]).toHaveProperty('title');
    expect(events[0]).toHaveProperty('start');
    expect(events[0]).toHaveProperty('venue');
    expect(events[0]).toHaveProperty('category');
  });

  it('le premier événement a le local_rank le plus élevé', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_PLACE_RESPONSE })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_EVENTS_RESPONSE });

    const events = await predictHQEventsSearch('Ibiza', '2025-07-15', '2025-07-22', 'party');
    expect(events[0].title).toBe('Amnesia Opening Party');
  });

  it('retourne au maximum 6 événements', async () => {
    const manyEvents = {
      results: Array.from({ length: 20 }, (_, i) => ({
        id: `evt-${i}`, title: `Event ${i}`, category: 'concerts',
        start: '2025-07-15T20:00:00Z', end: '2025-07-15T23:00:00Z',
        local_rank: 80 - i, description: '', entities: [], labels: []
      }))
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_PLACE_RESPONSE })
      .mockResolvedValueOnce({ ok: true, json: async () => manyEvents });

    const events = await predictHQEventsSearch('Ibiza', '2025-07-15', '2025-07-22', 'party');
    expect(events.length).toBeLessThanOrEqual(6);
  });

  it('utilise les bons Authorization header', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_PLACE_RESPONSE })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_EVENTS_RESPONSE });

    await predictHQEventsSearch('Ibiza', '2025-07-15', '2025-07-22', 'party');

    const calls = mockFetch.mock.calls;
    expect(calls[0][1]?.headers?.Authorization).toBe('Bearer test-phq-key-vitest');
    expect(calls[1][1]?.headers?.Authorization).toBe('Bearer test-phq-key-vitest');
  });
});

// ============================================================
// Clé API manquante
// ============================================================
describe('predictHQEventsSearch — clé API absente', () => {

  it('retourne [] sans crasher si PREDICTHQ_API_KEY est vide', async () => {
    const originalKey = process.env.PREDICTHQ_API_KEY;
    process.env.PREDICTHQ_API_KEY = '';

    // Réimporter dynamiquement sans la clé
    vi.resetModules();
    const { predictHQEventsSearch: fn } = await import('../../server/services/predictHQ.js?nocache=' + Date.now());
    const events = await fn('Ibiza', '2025-07-15', '2025-07-22', 'party');
    expect(events).toEqual([]);

    process.env.PREDICTHQ_API_KEY = originalKey;
  });
});

// ============================================================
// Gestion d'erreur — API PredictHQ en panne
// ============================================================
describe('predictHQEventsSearch — erreurs API', () => {

  it('retourne [] si la recherche de place échoue (404)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ detail: 'Not found' }) });
    const events = await predictHQEventsSearch('VilleInexistante', '2025-07-15', '2025-07-22', 'party');
    expect(events).toEqual([]);
  });

  it('retourne [] si la recherche d\'événements échoue (500)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_PLACE_RESPONSE })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ detail: 'Server error' }) });
    const events = await predictHQEventsSearch('Ibiza', '2025-07-15', '2025-07-22', 'party');
    expect(events).toEqual([]);
  });

  it('retourne [] si fetch throw (réseau coupé)', async () => {
    mockFetch.mockRejectedValue(new Error('Network Error'));
    const events = await predictHQEventsSearch('Ibiza', '2025-07-15', '2025-07-22', 'party');
    expect(events).toEqual([]);
  });

  it('retourne [] si aucun résultat de place', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    const events = await predictHQEventsSearch('VilleSansCoordonnées', '2025-07-15', '2025-07-22', 'party');
    expect(events).toEqual([]);
  });
});

// ============================================================
// Catégories par mode
// ============================================================
describe('predictHQEventsSearch — catégories par mode', () => {

  const MODES = ['party', 'student', 'group', 'relax', 'surprise'] as const;

  MODES.forEach(mode => {
    it(`mode ${mode} : fetch appelé avec des catégories`, async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_PLACE_RESPONSE })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_EVENTS_RESPONSE });

      await predictHQEventsSearch('Paris', '2025-08-01', '2025-08-07', mode);

      // Le 2ème appel fetch (events) doit avoir une URL avec "category"
      const eventsUrl = mockFetch.mock.calls[1]?.[0] as string;
      expect(eventsUrl).toContain('category');
    });
  });
});
