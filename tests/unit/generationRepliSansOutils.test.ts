import { describe, it, expect, vi, beforeEach } from 'vitest';

// LE REFUS SANS BOUCLE D'OUTILS.
//
// La boucle d'outils est propre à l'API Anthropic. Sans cette clé, le produit
// ne bascule plus vers un fournisseur incapable d'exécuter les recherches.
// Une indisponibilité explicite vaut mieux qu'un faux parcours.
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = 'cle-gemini-de-test-vitest';

vi.mock('../../server/services/providers.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/providers.js')>();
  return { ...reel, callClaude: vi.fn(), callClaudeOutils: vi.fn(), callGemini: vi.fn() };
});
vi.mock('../../server/services/foursquare.js', () => ({ foursquareRechercheLieux: vi.fn() }));
vi.mock('../../server/services/predictHQ.js', () => ({ predictHQEventsSearch: vi.fn() }));
vi.mock('../../server/services/weather.js', () => ({ getRealWeather: vi.fn() }));

const { callClaudeOutils, callGemini } = await import('../../server/services/providers.js');
const { foursquareRechercheLieux } = await import('../../server/services/foursquare.js');
const { genererParcours } = await import('../../server/agents/generation.js');
const { BriefSchema } = await import('../../server/agents/brief.js');

const brief = BriefSchema.parse({
  intention: "organiser l'EVG de Max",
  avecQui: 'groupe',
  duree: { valeur: 2, unite: 'jours' },
  lieux: ['Bordeaux'],
});

beforeEach(() => {
  vi.mocked(callClaudeOutils).mockReset();
  vi.mocked(callGemini).mockReset();
  vi.mocked(foursquareRechercheLieux).mockReset();
});

describe('génération sans clé Anthropic — indisponibilité honnête', () => {
  it('signale un statut 503 explicite', async () => {
    await expect(genererParcours(brief)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('n’appelle ni fournisseur simple ni connecteur', async () => {
    await expect(genererParcours(brief)).rejects.toBeTruthy();

    expect(callClaudeOutils).not.toHaveBeenCalled();
    expect(callGemini).not.toHaveBeenCalled();
    expect(foursquareRechercheLieux).not.toHaveBeenCalled();
  });

  it('explique que les sources de vérification sont indisponibles', async () => {
    await expect(genererParcours(brief)).rejects.toThrow('sources nécessaires');
  });
});
