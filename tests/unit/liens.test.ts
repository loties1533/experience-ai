import { describe, it, expect, vi, beforeEach } from 'vitest';

// Le résolveur (services/liens.ts) repris de TripGenie : jamais d'URL sans
// qu'elle existe littéralement dans un résultat de recherche réel. On mocke
// la recherche web et l'appel LLM — ce qu'on teste, c'est le filet
// anti-hallucination et la dégradation propre, pas Tavily ni le modèle.

vi.mock('../../server/services/tools/webSearch.js', () => ({ searchWeb: vi.fn() }));
vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn() };
});

const { searchWeb } = await import('../../server/services/tools/webSearch.js');
const { callAI } = await import('../../server/services/claude/core.js');
const { extraireUrlsContexte, validerUrlReelle, resoudreLiensReels } = await import(
  '../../server/services/liens.js'
);

beforeEach(() => {
  vi.mocked(searchWeb).mockReset();
  vi.mocked(callAI).mockReset();
});

describe('extraireUrlsContexte', () => {
  it('extrait toutes les URLs présentes dans un texte', () => {
    const contexte =
      '[Source 1: Le Point Rouge] (URL: https://lepointrouge.fr/) : bar à cocktails\n' +
      '[Source 2: Booking] (URL: https://www.booking.com/hotel/fr/exemple.html) : hôtel';
    expect(extraireUrlsContexte(contexte)).toEqual([
      'https://lepointrouge.fr/',
      'https://www.booking.com/hotel/fr/exemple.html',
    ]);
  });

  it('déduplique les URLs identiques', () => {
    const contexte = 'https://exemple.fr https://exemple.fr';
    expect(extraireUrlsContexte(contexte)).toEqual(['https://exemple.fr']);
  });

  it('rend un tableau vide sans URL', () => {
    expect(extraireUrlsContexte('Pas de résultats récents.')).toEqual([]);
  });
});

describe('validerUrlReelle — le filet anti-hallucination', () => {
  const urlsContexte = ['https://lepointrouge.fr/', 'https://www.booking.com/hotel/fr/exemple.html'];

  it('accepte une URL présente telle quelle', () => {
    expect(validerUrlReelle('https://lepointrouge.fr/', urlsContexte)).toBe('https://lepointrouge.fr/');
  });

  it('accepte après normalisation (http vs https, slash final, casse)', () => {
    expect(validerUrlReelle('HTTP://LePointRouge.fr', urlsContexte)).toBe('https://lepointrouge.fr/');
  });

  it('refuse une URL inventée par le LLM, absente du contexte', () => {
    expect(validerUrlReelle('https://autre-site-invente.fr', urlsContexte)).toBeNull();
  });

  it('refuse null, undefined ou une valeur non-string', () => {
    expect(validerUrlReelle(null, urlsContexte)).toBeNull();
    expect(validerUrlReelle(undefined, urlsContexte)).toBeNull();
  });
});

describe('resoudreLiensReels', () => {
  it('rend une Map vide sans noms à résoudre, sans chercher ni appeler le LLM', async () => {
    const liens = await resoudreLiensReels([], 'Bordeaux');
    expect(liens.size).toBe(0);
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it('associe le vrai lien trouvé, validé contre le contexte web', async () => {
    vi.mocked(searchWeb).mockResolvedValue(
      '[Source 1: Le Point Rouge] (URL: https://lepointrouge.fr/) : bar à cocktails à Bordeaux'
    );
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ 'Le Point Rouge': 'https://lepointrouge.fr/' }));

    const liens = await resoudreLiensReels(['Le Point Rouge'], 'Bordeaux');

    expect(liens.get('Le Point Rouge')).toBe('https://lepointrouge.fr/');
  });

  it('rejette une URL inventée par le LLM qui ne figure pas dans le contexte', async () => {
    vi.mocked(searchWeb).mockResolvedValue(
      '[Source 1: Le Point Rouge] (URL: https://lepointrouge.fr/) : bar à cocktails'
    );
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ 'Le Point Rouge': 'https://site-invente.fr' }));

    const liens = await resoudreLiensReels(['Le Point Rouge'], 'Bordeaux');

    expect(liens.get('Le Point Rouge')).toBeNull();
  });

  it('dégrade proprement à null quand la recherche web échoue', async () => {
    vi.mocked(searchWeb).mockRejectedValue(new Error('Tavily indisponible'));

    const liens = await resoudreLiensReels(['Le Point Rouge'], 'Bordeaux');

    expect(liens.get('Le Point Rouge')).toBeNull();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('dégrade proprement à null quand la recherche ne rend rien', async () => {
    vi.mocked(searchWeb).mockResolvedValue('');

    const liens = await resoudreLiensReels(['Le Point Rouge'], 'Bordeaux');

    expect(liens.get('Le Point Rouge')).toBeNull();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('dégrade proprement à null quand le LLM échoue ou rend un JSON invalide', async () => {
    vi.mocked(searchWeb).mockResolvedValue(
      '[Source 1: Le Point Rouge] (URL: https://lepointrouge.fr/) : bar à cocktails'
    );
    vi.mocked(callAI).mockResolvedValue('Je ne sais pas.');

    const liens = await resoudreLiensReels(['Le Point Rouge'], 'Bordeaux');

    expect(liens.get('Le Point Rouge')).toBeNull();
  });

  it('groupe les noms par 6 et ne perd aucun nom sur un grand lot', async () => {
    const noms = Array.from({ length: 8 }, (_, i) => `Lieu ${i + 1}`);
    vi.mocked(searchWeb).mockResolvedValue('https://exemple.fr/lieu');
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({}));

    const liens = await resoudreLiensReels(noms, 'Bordeaux');

    expect(searchWeb).toHaveBeenCalledTimes(2); // 6 + 2 → deux groupes
    expect(liens.size).toBe(8);
    noms.forEach((nom) => expect(liens.has(nom)).toBe(true));
  });
});
