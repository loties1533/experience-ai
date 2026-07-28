import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requeteFetch = vi.fn();
const cleTavilyInitiale = process.env.TAVILY_API_KEY;
const DATE_CONTROLE = '2026-07-28T18:00:00.000Z';

const { rechercherWeb, searchWeb } = await import(
  '../../server/services/tools/webSearch.js'
);

function reponseTavily(
  contenu: unknown,
  statut = 200,
): Pick<Response, 'ok' | 'status' | 'json'> {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: async () => contenu,
  };
}

beforeEach(() => {
  process.env.TAVILY_API_KEY = 'cle-tavily-test';
  requeteFetch.mockReset();
  vi.stubGlobal('fetch', requeteFetch);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATE_CONTROLE));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (cleTavilyInitiale === undefined) {
    delete process.env.TAVILY_API_KEY;
  } else {
    process.env.TAVILY_API_KEY = cleTavilyInitiale;
  }
});

describe('rechercherWeb — résultats structurés', () => {
  it('valide plusieurs résultats et conserve leur rang et leur date', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseTavily({
        results: [
          {
            title: '  Musée des Beaux-Arts  ',
            url: 'https://musee.example/visiter',
            content: '  Informations pratiques  ',
          },
          {
            title: 'Billetterie du festival',
            url: 'https://billets.example/evenement/42',
            content: 'Réserver une place',
          },
        ],
      }),
    );

    await expect(rechercherWeb('sorties Bordeaux', 5)).resolves.toEqual({
      statut: 'ok',
      fournisseur: 'Tavily',
      recupereLe: DATE_CONTROLE,
      resultats: [
        {
          titre: 'Musée des Beaux-Arts',
          url: 'https://musee.example/visiter',
          extrait: 'Informations pratiques',
          rang: 1,
        },
        {
          titre: 'Billetterie du festival',
          url: 'https://billets.example/evenement/42',
          extrait: 'Réserver une place',
          rang: 2,
        },
      ],
    });

    const [, options] = requeteFetch.mock.calls[0];
    const corps = JSON.parse(String((options as RequestInit).body));
    expect(corps).toMatchObject({
      api_key: 'cle-tavily-test',
      query: 'sorties Bordeaux',
      max_results: 5,
    });
    expect((options as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('distingue une vraie recherche sans résultat', async () => {
    requeteFetch.mockResolvedValueOnce(reponseTavily({ results: [] }));

    await expect(rechercherWeb('aucun résultat')).resolves.toEqual({
      statut: 'vide',
      resultats: [],
      fournisseur: 'Tavily',
      recupereLe: DATE_CONTROLE,
    });
  });

  it.each([
    ['  sorties Bordeaux  ', 20, 'sorties Bordeaux', 10],
    ['  sorties Bordeaux  ', 0, 'sorties Bordeaux', 1],
  ] as const)(
    'normalise la requête et borne la limite %s à %s',
    async (requete, limite, requeteAttendue, limiteAttendue) => {
      requeteFetch.mockResolvedValueOnce(reponseTavily({ results: [] }));

      await rechercherWeb(requete, limite);

      const [, options] = requeteFetch.mock.calls[0];
      const corps = JSON.parse(String((options as RequestInit).body));
      expect(corps.query).toBe(requeteAttendue);
      expect(corps.max_results).toBe(limiteAttendue);
    },
  );

  it('ignore un résultat individuel incomplet si un autre résultat est valide', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseTavily({
        results: [
          { title: 'Sans URL', content: 'Résultat incomplet' },
          {
            title: 'Page exploitable',
            url: 'https://example.com/page',
            content: 'Extrait',
          },
        ],
      }),
    );

    const resultat = await rechercherWeb('page exploitable');

    expect(resultat).toMatchObject({
      statut: 'ok',
      resultats: [
        {
          titre: 'Page exploitable',
          url: 'https://example.com/page',
          rang: 2,
        },
      ],
    });
  });

  it('ne transforme pas une liste entièrement invalide en recherche vide', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseTavily({
        results: [{ title: 'Sans URL', content: 'Résultat incomplet' }],
      }),
    );

    await expect(rechercherWeb('réponse invalide')).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Tavily',
      raison: 'reponse_invalide',
      constateLe: DATE_CONTROLE,
    });
  });

  it('ne classe ni ne sélectionne un lien métier', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseTavily({
        results: [
          {
            title: 'Premier candidat',
            url: 'https://premier.example/page',
          },
          {
            title: 'Second candidat',
            url: 'https://second.example/page',
          },
        ],
      }),
    );

    const resultat = await rechercherWeb('candidats');

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') return;
    expect(resultat.resultats.map(({ url }) => url)).toEqual([
      'https://premier.example/page',
      'https://second.example/page',
    ]);
    expect(
      resultat.resultats.every(
        (candidat) =>
          !('typeLien' in candidat) &&
          !('officiel' in candidat) &&
          !('selectionne' in candidat),
      ),
    ).toBe(true);
  });
});

describe('rechercherWeb — indisponibilités', () => {
  it('relit la configuration à chaque appel et distingue une clé absente', async () => {
    delete process.env.TAVILY_API_KEY;

    await expect(rechercherWeb('Bordeaux')).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Tavily',
      raison: 'configuration_absente',
      constateLe: DATE_CONTROLE,
    });
    expect(requeteFetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'authentification'],
    [403, 'authentification'],
    [429, 'quota'],
    [500, 'fournisseur'],
  ] as const)('convertit HTTP %s en %s', async (statut, raison) => {
    requeteFetch.mockResolvedValueOnce(reponseTavily({}, statut));

    await expect(rechercherWeb('Bordeaux')).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Tavily',
      raison,
      constateLe: DATE_CONTROLE,
    });
  });

  it('distingue un timeout', async () => {
    const erreur = new Error('signal aborted');
    erreur.name = 'AbortError';
    requeteFetch.mockRejectedValueOnce(erreur);

    await expect(rechercherWeb('Bordeaux')).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Tavily',
      raison: 'timeout',
      constateLe: DATE_CONTROLE,
    });
  });

  it('distingue une panne réseau', async () => {
    requeteFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(rechercherWeb('Bordeaux')).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Tavily',
      raison: 'reseau',
      constateLe: DATE_CONTROLE,
    });
  });

  it('classe un JSON illisible comme réponse invalide', async () => {
    requeteFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('JSON incomplet');
      },
    });

    await expect(rechercherWeb('Bordeaux')).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Tavily',
      raison: 'reponse_invalide',
      constateLe: DATE_CONTROLE,
    });
  });

  it('refuse une structure JSON inattendue', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseTavily({ answer: 'Réponse sans tableau de résultats' }),
    );

    await expect(rechercherWeb('Bordeaux')).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Tavily',
      raison: 'reponse_invalide',
      constateLe: DATE_CONTROLE,
    });
  });

  it('ne divulgue jamais la clé Tavily dans les journaux ou le résultat', async () => {
    const cleSecrete = 'cle-tavily-ultra-secrete';
    process.env.TAVILY_API_KEY = cleSecrete;
    requeteFetch.mockResolvedValueOnce(reponseTavily({}, 401));

    const resultat = await rechercherWeb('Bordeaux');
    const sortiesJournal = JSON.stringify(vi.mocked(console.warn).mock.calls);

    expect(sortiesJournal).not.toContain(cleSecrete);
    expect(JSON.stringify(resultat)).not.toContain(cleSecrete);
  });
});

describe('searchWeb — adaptateur historique', () => {
  it('reconstruit le contexte texte attendu à partir du résultat structuré', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseTavily({
        results: [
          {
            title: 'Le Point Rouge',
            url: 'https://lepointrouge.example/',
            content: 'Bar à cocktails à Bordeaux',
          },
        ],
      }),
    );

    await expect(searchWeb('Le Point Rouge Bordeaux')).resolves.toBe(
      '==== CONTEXTE WEB RECENT ====\n' +
        '[Source 1: Le Point Rouge] (URL: https://lepointrouge.example/) : ' +
        'Bar à cocktails à Bordeaux\n' +
        '=============================\n',
    );
  });

  it('reconstruit le contexte historique d’une recherche réellement vide', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseTavily({ results: [] }),
    );

    await expect(searchWeb('aucun résultat')).resolves.toBe(
      '==== CONTEXTE WEB RECENT ====\n' +
        'Pas de résultats récents.\n' +
        '=============================\n',
    );
  });

  it('conserve la dégradation historique en chaîne vide si Tavily est indisponible', async () => {
    delete process.env.TAVILY_API_KEY;

    await expect(searchWeb('Bordeaux')).resolves.toBe('');
  });
});
