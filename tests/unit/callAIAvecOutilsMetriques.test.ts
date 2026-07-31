import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BlocReponse } from '../../server/services/providers.js';
import type { BoiteAOutilsLLM, MetriquesAppelOutils } from '../../server/services/claude/core.js';

// F6-A — instrumentation de callAIAvecOutils : modèle injectable, métriques
// remontées sans jamais exposer prompt, réponse ou contenu. Le transport
// Anthropic est mocké au niveau providers.js, comme dans generationOutillee.
process.env.ANTHROPIC_API_KEY = 'cle-de-test-vitest';

vi.mock('../../server/services/providers.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/providers.js')>();
  return { ...reel, callClaudeOutils: vi.fn() };
});

const { callClaudeOutils, MODELE_CLAUDE } = await import('../../server/services/providers.js');
const { callAIAvecOutils } = await import('../../server/services/claude/core.js');

function boiteVide(): BoiteAOutilsLLM {
  return { definitions: [], executer: vi.fn() };
}

function tourOutil(): BlocReponse[] {
  return [{ type: 'tool_use', id: 'outil-1', name: 'chercher', input: {} }];
}

function tourReponse(texte = '{"ok":true}'): BlocReponse[] {
  return [{ type: 'text', text: texte }];
}

function capter(): { metriques?: MetriquesAppelOutils; onMetriques: (m: MetriquesAppelOutils) => void } {
  const boite = { metriques: undefined as MetriquesAppelOutils | undefined } as {
    metriques?: MetriquesAppelOutils;
    onMetriques: (m: MetriquesAppelOutils) => void;
  };
  boite.onMetriques = (m) => { boite.metriques = m; };
  return boite;
}

beforeEach(() => {
  vi.mocked(callClaudeOutils).mockReset();
});

describe('callAIAvecOutils — modèle injectable et métriques (F6-A)', () => {
  it('conserve le modèle par défaut quand aucune option n’est fournie', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValueOnce(tourReponse());
    const capture = capter();

    await callAIAvecOutils('demande', 'system', boiteVide(), 'pack', {
      onMetriques: capture.onMetriques,
    });

    expect(capture.metriques?.modele).toBe(MODELE_CLAUDE);
    const optionsTransmises = vi.mocked(callClaudeOutils).mock.calls[0][3];
    expect(optionsTransmises?.modele).toBeUndefined();
  });

  it('transmet un modèle explicite au provider et dans les métriques', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValueOnce(tourReponse());
    const capture = capter();

    await callAIAvecOutils('demande', 'system', boiteVide(), 'pack', {
      modele: 'claude-sonnet-banc-essai',
      onMetriques: capture.onMetriques,
    });

    expect(capture.metriques?.modele).toBe('claude-sonnet-banc-essai');
    const optionsTransmises = vi.mocked(callClaudeOutils).mock.calls[0][3];
    expect(optionsTransmises?.modele).toBe('claude-sonnet-banc-essai');
  });

  it('agrège les tokens et compte les tours sur un aller-retour outillé', async () => {
    vi.mocked(callClaudeOutils)
      .mockImplementationOnce(async (_systeme, _messages, _outils, options) => {
        options?.onUsage?.({ modele: MODELE_CLAUDE, tokensEntree: 100, tokensSortie: 20 });
        return tourOutil();
      })
      .mockImplementationOnce(async (_systeme, _messages, _outils, options) => {
        options?.onUsage?.({ modele: MODELE_CLAUDE, tokensEntree: 50, tokensSortie: 80 });
        return tourReponse();
      });
    const boite: BoiteAOutilsLLM = { definitions: [], executer: vi.fn().mockResolvedValue('résultat') };
    const capture = capter();

    await callAIAvecOutils('demande', 'system', boite, 'pack', { onMetriques: capture.onMetriques });

    expect(capture.metriques).toMatchObject({
      tokensEntree: 150,
      tokensSortie: 100,
      tours: 2,
      succes: true,
    });
    expect(capture.metriques?.dureeMs).toBeGreaterThanOrEqual(0);
  });

  it('classe un échec technique en boucle_interrompue sans exposer prompt ni contenu', async () => {
    vi.mocked(callClaudeOutils).mockRejectedValue(
      new Error('quota dépassé — extrait de réponse ne devant jamais fuiter')
    );
    const capture = capter();

    const sortie = await callAIAvecOutils(
      'information confidentielle du visiteur',
      'system',
      boiteVide(),
      'pack',
      { onMetriques: capture.onMetriques }
    );

    expect(capture.metriques).toMatchObject({ succes: false, typeEchec: 'boucle_interrompue' });
    expect(JSON.stringify(capture.metriques)).not.toContain('information confidentielle');
    expect(JSON.stringify(capture.metriques)).not.toContain('ne devant jamais fuiter');
    expect(sortie).toContain('indisponibles');
  });

  it('reste compatible avec l’appel historique sans options', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValueOnce(tourReponse('{"parcours":true}'));

    const sortie = await callAIAvecOutils('demande', 'system', boiteVide());

    expect(sortie).toBe('{"parcours":true}');
  });

  it('conserve le résultat IA quand onMetriques lève en cas de succès', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValueOnce(tourReponse('{"parcours":true}'));
    const onMetriques = vi.fn(() => { throw new Error('callback en échec'); });

    const sortie = await callAIAvecOutils('demande', 'system', boiteVide(), 'pack', { onMetriques });

    expect(sortie).toBe('{"parcours":true}');
    expect(onMetriques).toHaveBeenCalledTimes(1);
    expect(onMetriques).toHaveBeenCalledWith(expect.objectContaining({ succes: true }));
  });

  it('conserve le résultat d’erreur quand onMetriques lève en cas d’échec outils', async () => {
    vi.mocked(callClaudeOutils).mockRejectedValue(new Error('quota dépassé'));
    const onMetriques = vi.fn(() => { throw new Error('callback en échec'); });

    const sortie = await callAIAvecOutils('demande', 'system', boiteVide(), 'pack', { onMetriques });

    expect(sortie).toContain('indisponibles');
    expect(onMetriques).toHaveBeenCalledTimes(1);
    expect(onMetriques).toHaveBeenCalledWith(
      expect.objectContaining({ succes: false, typeEchec: 'boucle_interrompue' })
    );
  });
});
