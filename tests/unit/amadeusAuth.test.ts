import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const requeteFetch = vi.fn();
const cleInitiale = process.env.AMADEUS_API_KEY;
const secretInitial = process.env.AMADEUS_API_SECRET;
const DATE_CONTROLE = '2026-07-29T10:00:00.000Z';

const {
  obtenirJetonAmadeus,
  reinitialiserAuthentificationAmadeusPourTests,
} = await import('../../server/services/amadeus/auth.js');

function reponseJson(contenu: unknown, statut = 200): Response {
  return new Response(JSON.stringify(contenu), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}

function reponseJeton(
  jeton = 'jeton-amadeus-test',
  expiration = 1_800
): Response {
  return reponseJson({
    type: 'amadeusOAuth2Token',
    token_type: 'Bearer',
    access_token: jeton,
    expires_in: expiration,
    state: 'approved',
  });
}

beforeEach(() => {
  process.env.AMADEUS_API_KEY = 'cle-amadeus-test';
  process.env.AMADEUS_API_SECRET = 'secret-amadeus-test';
  requeteFetch.mockReset();
  vi.stubGlobal('fetch', requeteFetch);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATE_CONTROLE));
  reinitialiserAuthentificationAmadeusPourTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (cleInitiale === undefined) delete process.env.AMADEUS_API_KEY;
  else process.env.AMADEUS_API_KEY = cleInitiale;
  if (secretInitial === undefined) delete process.env.AMADEUS_API_SECRET;
  else process.env.AMADEUS_API_SECRET = secretInitial;
});

describe('OAuth2 Amadeus — configuration et requête', () => {
  it.each([
    ['clé absente', undefined, 'secret-amadeus-test'],
    ['secret absent', 'cle-amadeus-test', undefined],
    ['clé et secret absents', undefined, undefined],
  ])(
    'rend la configuration indisponible quand %s',
    async (_libelle, cle, secret) => {
      if (cle === undefined) delete process.env.AMADEUS_API_KEY;
      else process.env.AMADEUS_API_KEY = cle;
      if (secret === undefined) delete process.env.AMADEUS_API_SECRET;
      else process.env.AMADEUS_API_SECRET = secret;

      await expect(obtenirJetonAmadeus()).resolves.toEqual({
        statut: 'indisponible',
        raison: 'configuration_absente',
      });
      expect(requeteFetch).not.toHaveBeenCalled();
    }
  );

  it('envoie le grant Client Credentials officiel sans secret dans l’URL', async () => {
    requeteFetch.mockResolvedValueOnce(reponseJeton());

    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'ok',
      jeton: 'jeton-amadeus-test',
    });

    expect(requeteFetch).toHaveBeenCalledTimes(1);
    const [entree, options] = requeteFetch.mock.calls[0] as [
      URL,
      RequestInit,
    ];
    expect(entree.toString()).toBe(
      'https://test.api.amadeus.com/v1/security/oauth2/token'
    );
    expect(entree.toString()).not.toContain('cle-amadeus-test');
    expect(entree.toString()).not.toContain('secret-amadeus-test');
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error');
    expect(options.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(new URLSearchParams(String(options.body))).toEqual(
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'cle-amadeus-test',
        client_secret: 'secret-amadeus-test',
      })
    );
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('OAuth2 Amadeus — validation et erreurs', () => {
  it.each([
    ['jeton vide', { token_type: 'Bearer', access_token: ' ', expires_in: 1_800 }],
    ['type absent', { access_token: 'jeton', expires_in: 1_800 }],
    ['type invalide', { token_type: 'Basic', access_token: 'jeton', expires_in: 1_800 }],
    ['expiration absente', { token_type: 'Bearer', access_token: 'jeton' }],
    ['expiration nulle', { token_type: 'Bearer', access_token: 'jeton', expires_in: 0 }],
    ['expiration négative', { token_type: 'Bearer', access_token: 'jeton', expires_in: -1 }],
    ['expiration décimale', { token_type: 'Bearer', access_token: 'jeton', expires_in: 1.5 }],
    ['expiration texte', { token_type: 'Bearer', access_token: 'jeton', expires_in: '1800' }],
  ])('refuse une réponse dont %s', async (_libelle, contenu) => {
    requeteFetch.mockResolvedValueOnce(reponseJson(contenu));

    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'indisponible',
      raison: 'reponse_invalide',
    });
  });

  it('refuse un JSON illisible', async () => {
    requeteFetch.mockResolvedValueOnce(
      new Response('{invalide', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'indisponible',
      raison: 'reponse_invalide',
    });
  });

  it('refuse une réponse qui n’est pas du JSON', async () => {
    requeteFetch.mockResolvedValueOnce(
      new Response('<html>erreur</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'indisponible',
      raison: 'reponse_invalide',
    });
  });

  it.each([
    [400, 'fournisseur'],
    [401, 'authentification'],
    [403, 'authentification'],
    [429, 'quota'],
    [500, 'fournisseur'],
  ] as const)('normalise HTTP %s en %s', async (statut, raison) => {
    requeteFetch.mockResolvedValueOnce(
      reponseJson(
        {
          error_description:
            'corps fournisseur qui ne doit pas être exposé',
        },
        statut
      )
    );

    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'indisponible',
      raison,
    });
  });

  it('distingue un timeout', async () => {
    requeteFetch.mockRejectedValueOnce(
      new DOMException('délai dépassé', 'TimeoutError')
    );

    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'indisponible',
      raison: 'timeout',
    });
  });

  it('distingue une panne réseau', async () => {
    requeteFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'indisponible',
      raison: 'reseau',
    });
  });
});

describe('OAuth2 Amadeus — mémoire et concurrence', () => {
  it('réutilise un jeton encore valide', async () => {
    requeteFetch.mockResolvedValueOnce(reponseJeton('jeton-stable'));

    const premier = await obtenirJetonAmadeus();
    vi.setSystemTime(new Date('2026-07-29T10:10:00.000Z'));
    const second = await obtenirJetonAmadeus();

    expect(premier).toEqual({ statut: 'ok', jeton: 'jeton-stable' });
    expect(second).toEqual(premier);
    expect(requeteFetch).toHaveBeenCalledTimes(1);
  });

  it('rafraîchit le jeton avant son expiration', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton('jeton-initial', 1_800))
      .mockResolvedValueOnce(reponseJeton('jeton-renouvele', 1_800));

    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'ok',
      jeton: 'jeton-initial',
    });
    vi.setSystemTime(new Date('2026-07-29T10:29:00.000Z'));
    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'ok',
      jeton: 'jeton-renouvele',
    });
    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('mutualise deux authentifications concurrentes', async () => {
    let terminer!: (reponse: Response) => void;
    requeteFetch.mockReturnValueOnce(
      new Promise<Response>((resolution) => {
        terminer = resolution;
      })
    );

    const premiere = obtenirJetonAmadeus();
    const seconde = obtenirJetonAmadeus();
    expect(requeteFetch).toHaveBeenCalledTimes(1);

    terminer(reponseJeton('jeton-partage'));
    await expect(Promise.all([premiere, seconde])).resolves.toEqual([
      { statut: 'ok', jeton: 'jeton-partage' },
      { statut: 'ok', jeton: 'jeton-partage' },
    ]);
  });

  it('retire un échec concurrent et autorise la tentative suivante', async () => {
    let terminer!: (reponse: Response) => void;
    requeteFetch
      .mockReturnValueOnce(
        new Promise<Response>((resolution) => {
          terminer = resolution;
        })
      )
      .mockResolvedValueOnce(reponseJeton('jeton-rattrapage'));

    const premiere = obtenirJetonAmadeus();
    const seconde = obtenirJetonAmadeus();
    terminer(reponseJson({ erreur: 'temporaire' }, 500));

    await expect(Promise.all([premiere, seconde])).resolves.toEqual([
      { statut: 'indisponible', raison: 'fournisseur' },
      { statut: 'indisponible', raison: 'fournisseur' },
    ]);
    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'ok',
      jeton: 'jeton-rattrapage',
    });
    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('ne réutilise pas un jeton après rotation de la configuration', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton('jeton-premiere-cle'))
      .mockResolvedValueOnce(reponseJeton('jeton-seconde-cle'));

    await obtenirJetonAmadeus();
    process.env.AMADEUS_API_KEY = 'nouvelle-cle-amadeus';
    await expect(obtenirJetonAmadeus()).resolves.toEqual({
      statut: 'ok',
      jeton: 'jeton-seconde-cle',
    });
    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });
});

describe('OAuth2 Amadeus — confidentialité', () => {
  it('ne journalise jamais la clé, le secret ou le jeton', async () => {
    const journal = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const avertissement = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const erreur = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    requeteFetch.mockResolvedValueOnce(reponseJeton('jeton-ultra-secret'));

    await obtenirJetonAmadeus();

    const sortie = JSON.stringify([
      journal.mock.calls,
      avertissement.mock.calls,
      erreur.mock.calls,
    ]);
    expect(sortie).not.toContain('cle-amadeus-test');
    expect(sortie).not.toContain('secret-amadeus-test');
    expect(sortie).not.toContain('jeton-ultra-secret');
  });

  it('n’expose jamais le corps brut d’une erreur fournisseur', async () => {
    requeteFetch.mockResolvedValueOnce(
      reponseJson(
        {
          error_description:
            'secret-amadeus-test jeton-fournisseur-interne',
        },
        500
      )
    );

    const resultat = await obtenirJetonAmadeus();
    expect(JSON.stringify(resultat)).not.toContain('secret-amadeus-test');
    expect(JSON.stringify(resultat)).not.toContain(
      'jeton-fournisseur-interne'
    );
  });
});
