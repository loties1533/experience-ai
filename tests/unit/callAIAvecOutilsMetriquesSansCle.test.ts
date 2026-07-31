import { describe, it, expect, vi } from 'vitest';
import type { BoiteAOutilsLLM, MetriquesAppelOutils } from '../../server/services/claude/core.js';

// F6-A — sans clé Anthropic, aucune boucle d'outils ne démarre : la métrique
// doit le dire explicitement (cle_absente), sans jamais appeler le provider.
process.env.ANTHROPIC_API_KEY = '';

vi.mock('../../server/services/providers.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/providers.js')>();
  return { ...reel, callClaudeOutils: vi.fn() };
});

const { callClaudeOutils } = await import('../../server/services/providers.js');
const { callAIAvecOutils } = await import('../../server/services/claude/core.js');

describe('callAIAvecOutils — absence de clé Anthropic (F6-A)', () => {
  it('classe l’échec en cle_absente sans appeler le provider', async () => {
    const boite: BoiteAOutilsLLM = { definitions: [], executer: vi.fn() };
    let recues: MetriquesAppelOutils | undefined;

    await callAIAvecOutils('demande', 'system', boite, 'pack', {
      onMetriques: (m) => { recues = m; },
    });

    expect(recues).toMatchObject({ succes: false, typeEchec: 'cle_absente', tours: 0 });
    expect(callClaudeOutils).not.toHaveBeenCalled();
  });

  it('conserve le comportement principal quand onMetriques lève sans clé', async () => {
    const boite: BoiteAOutilsLLM = { definitions: [], executer: vi.fn() };
    const onMetriques = vi.fn(() => { throw new Error('callback en échec'); });

    const sortie = await callAIAvecOutils('demande', 'system', boite, 'pack', { onMetriques });

    expect(sortie).toContain('indisponibles');
    expect(onMetriques).toHaveBeenCalledTimes(1);
    expect(onMetriques).toHaveBeenCalledWith(
      expect.objectContaining({ succes: false, typeEchec: 'cle_absente' })
    );
  });
});
