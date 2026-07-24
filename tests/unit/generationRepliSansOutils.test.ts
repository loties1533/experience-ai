import { describe, it, expect, vi, beforeEach } from 'vitest';

// LE REPLI SANS CLÉ ANTHROPIC.
//
// La boucle d'outils est propre à l'API Anthropic. Sans cette clé, le produit
// ne doit pas s'arrêter : il génère par la voie simple, avec le fournisseur
// disponible, et donc SANS données réelles. Le parcours est plus générique,
// mais il existe — l'utilisateur ne voit jamais une panne parce qu'une clé
// manque. Ce fichier est séparé du reste parce que la présence de la clé se lit
// au chargement des modules.
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

const SORTIE_SANS_DONNEES_REELLES = JSON.stringify({
  ambiance: 'festive',
  moments: [
    {
      titre: 'Le samedi soir',
      elements: [
        {
          ref: 'bar-1',
          type: 'sortie',
          nom: 'Une virée dans les bars du centre',
          justification: 'le temps fort de la soirée',
        },
      ],
    },
  ],
});

beforeEach(() => {
  vi.mocked(callClaudeOutils).mockReset();
  vi.mocked(callGemini).mockReset().mockResolvedValue(SORTIE_SANS_DONNEES_REELLES);
  vi.mocked(foursquareRechercheLieux).mockReset();
});

describe('génération sans clé Anthropic — mode « sans données réelles »', () => {
  it('construit quand même le parcours, par la voie simple', async () => {
    const parcours = await genererParcours(brief);

    expect(parcours.timeline[0].elements[0].nom).toBe('Une virée dans les bars du centre');
    expect(callGemini).toHaveBeenCalledOnce();
  });

  it('n’ouvre aucune boucle d’outils et n’appelle aucun connecteur', async () => {
    await genererParcours(brief);

    expect(callClaudeOutils).not.toHaveBeenCalled();
    expect(foursquareRechercheLieux).not.toHaveBeenCalled();
  });

  it('n’invente aucun lien externe faute de source réelle', async () => {
    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.reservation).toBeUndefined();
  });
});
