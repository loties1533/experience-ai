import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  controlerAccessibiliteLien,
  creerLookupEpingle,
  type AdresseDns,
  type DependancesControleLien,
  type FabriquerTransportEpingle,
  type InitialisationRequeteHttp,
  type RequeteHttp,
  type ResoudreDns,
  type TransportEpingle,
} from '../../server/services/liens/controleRedirections.js';
import type { LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import type { Dispatcher } from 'undici';

const DATE_CONTROLE = new Date('2026-07-28T21:00:00.000Z');
const ADRESSE_PUBLIQUE = {
  address: '93.184.216.34',
  family: 4 as const,
};

function reponse(
  statut: number,
  location?: string,
): Response {
  return new Response(null, {
    status: statut,
    headers: location ? { Location: location } : undefined,
  });
}

function creerDependances(
  requeteHttp: RequeteHttp,
  resoudreDns: ResoudreDns = vi
    .fn<ResoudreDns>()
    .mockResolvedValue([ADRESSE_PUBLIQUE]),
  changements: Partial<DependancesControleLien> = {},
): DependancesControleLien {
  return {
    requeteHttp,
    resoudreDns,
    maintenant: () => DATE_CONTROLE,
    delaiMaximumMs: 50,
    ...changements,
  };
}

function appelerLookup(
  lookupEpingle: LookupFunction,
  hote: string,
  options: LookupOptions,
): Promise<{
  adresse: string | Array<{ address: string; family: number }>;
  famille?: number;
}> {
  return new Promise((resoudre, rejeter) => {
    lookupEpingle(
      hote,
      options,
      (erreur, adresse, famille) => {
        if (erreur) {
          rejeter(erreur);
          return;
        }
        resoudre({ adresse, famille });
      },
    );
  });
}

function creerFabriqueTransports(): {
  fabriquerTransportEpingle: FabriquerTransportEpingle;
  transports: Array<
    TransportEpingle & {
      hote: string;
      adressesValidees: readonly AdresseDns[];
      fermer: ReturnType<typeof vi.fn<() => Promise<void>>>;
    }
  >;
} {
  const transports: Array<
    TransportEpingle & {
      hote: string;
      adressesValidees: readonly AdresseDns[];
      fermer: ReturnType<typeof vi.fn<() => Promise<void>>>;
    }
  > = [];
  const fabriquerTransportEpingle = vi.fn<
    FabriquerTransportEpingle
  >((hote, adressesValidees) => {
    const fermer = vi.fn<() => Promise<void>>(
      async () => undefined,
    );
    const transport = {
      hote,
      adressesValidees,
      dispatcher: {} as Dispatcher,
      lookup: creerLookupEpingle(hote, adressesValidees),
      fermer,
    };
    transports.push(transport);
    return transport;
  });
  return { fabriquerTransportEpingle, transports };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('contrôle d’accessibilité', () => {
  it('accepte une URL HTTPS accessible avec HEAD sans GET', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValue(reponse(200));
    const {
      fabriquerTransportEpingle,
      transports,
    } = creerFabriqueTransports();

    const resultat = await controlerAccessibiliteLien(
      'https://example.com/evenement/123',
      creerDependances(requeteHttp, undefined, {
        fabriquerTransportEpingle,
      }),
    );

    expect(resultat).toEqual({
      statut: 'accessible',
      urlInitiale: 'https://example.com/evenement/123',
      urlFinale: 'https://example.com/evenement/123',
      statutHttp: 200,
      redirections: [],
      controleLe: DATE_CONTROLE.toISOString(),
    });
    expect(requeteHttp).toHaveBeenCalledOnce();
    expect(requeteHttp.mock.calls[0]?.[1].method).toBe('HEAD');
    expect(transports[0]?.fermer).toHaveBeenCalledOnce();
  });

  it.each([405, 501])(
    'se replie sur GET après un HEAD %i',
    async (statutHead) => {
      const requeteHttp = vi
        .fn<RequeteHttp>()
        .mockResolvedValueOnce(reponse(statutHead))
        .mockResolvedValueOnce(reponse(204));
      const resoudreDns = vi
        .fn<ResoudreDns>()
        .mockResolvedValue([ADRESSE_PUBLIQUE]);
      const {
        fabriquerTransportEpingle,
        transports,
      } = creerFabriqueTransports();

      const resultat = await controlerAccessibiliteLien(
        'https://example.com/fiche',
        creerDependances(requeteHttp, resoudreDns, {
          fabriquerTransportEpingle,
        }),
      );

      expect(resultat).toMatchObject({
        statut: 'accessible',
        statutHttp: 204,
      });
      expect(requeteHttp.mock.calls.map((appel) => appel[1].method)).toEqual([
        'HEAD',
        'GET',
      ]);
      expect(resoudreDns).toHaveBeenCalledTimes(4);
      expect(transports).toHaveLength(2);
      expect(
        transports.every(
          (transport) =>
            transport.fermer.mock.calls.length === 1,
        ),
      ).toBe(true);
    },
  );

  it('refuse un statut final autre que 2xx', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValue(reponse(404));

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/introuvable',
        creerDependances(requeteHttp),
      ),
    ).resolves.toEqual({
      statut: 'refuse',
      raison: 'statut_http_inacceptable',
      constateLe: DATE_CONTROLE.toISOString(),
    });
  });

  it('n’attribue aucun type métier à une URL accessible', async () => {
    const resultat = await controlerAccessibiliteLien(
      'https://example.com/fiche',
      creerDependances(
        vi.fn<RequeteHttp>().mockResolvedValue(reponse(200)),
      ),
    );

    expect(resultat).not.toHaveProperty('typeLien');
    expect(resultat).not.toHaveProperty('preuves');
  });
});

describe('redirections manuelles', () => {
  it('suit une redirection relative et conserve la chaîne exacte', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(reponse(302, '/billets/123'))
      .mockResolvedValueOnce(reponse(200));
    const {
      fabriquerTransportEpingle,
      transports,
    } = creerFabriqueTransports();

    const resultat = await controlerAccessibiliteLien(
      'https://example.com/evenement/123',
      creerDependances(requeteHttp, undefined, {
        fabriquerTransportEpingle,
      }),
    );

    expect(resultat).toEqual({
      statut: 'accessible',
      urlInitiale: 'https://example.com/evenement/123',
      urlFinale: 'https://example.com/billets/123',
      statutHttp: 200,
      redirections: ['https://example.com/billets/123'],
      controleLe: DATE_CONTROLE.toISOString(),
    });
    expect(transports).toHaveLength(2);
    expect(
      transports.every(
        (transport) =>
          transport.fermer.mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it('suit une redirection absolue sur le même domaine', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(
        reponse(301, 'https://tickets.example.com/e/123'),
      )
      .mockResolvedValueOnce(reponse(200));

    const resultat = await controlerAccessibiliteLien(
      'https://example.com/e/123',
      creerDependances(requeteHttp),
    );

    expect(resultat).toMatchObject({
      statut: 'accessible',
      urlFinale: 'https://tickets.example.com/e/123',
      redirections: ['https://tickets.example.com/e/123'],
    });
  });

  it('accepte techniquement une redirection vers un autre domaine public', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(
        reponse(302, 'https://billets-valide.fr/e/123'),
      )
      .mockResolvedValueOnce(reponse(200));
    const resoudreDns = vi
      .fn<ResoudreDns>()
      .mockResolvedValue([ADRESSE_PUBLIQUE]);
    const {
      fabriquerTransportEpingle,
      transports,
    } = creerFabriqueTransports();

    const resultat = await controlerAccessibiliteLien(
      'https://example.com/e/123',
      creerDependances(requeteHttp, resoudreDns, {
        fabriquerTransportEpingle,
      }),
    );

    expect(resultat).toMatchObject({
      statut: 'accessible',
      urlFinale: 'https://billets-valide.fr/e/123',
    });
    expect(resultat).not.toHaveProperty('typeLien');
    expect(resoudreDns.mock.calls.map(([hote]) => hote)).toEqual([
      'example.com',
      'example.com',
      'billets-valide.fr',
      'billets-valide.fr',
    ]);
    expect(transports.map((transport) => transport.hote)).toEqual([
      'example.com',
      'billets-valide.fr',
    ]);
    expect(
      transports.every(
        (transport) =>
          transport.fermer.mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it('refuse une redirection de HTTPS vers HTTP', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(
        reponse(302, 'http://example.com/e/123'),
      );

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/e/123',
        creerDependances(requeteHttp),
      ),
    ).resolves.toEqual({
      statut: 'refuse',
      raison: 'https_vers_http',
      constateLe: DATE_CONTROLE.toISOString(),
    });
    expect(requeteHttp).toHaveBeenCalledOnce();
  });

  it('détecte une boucle directe avant une seconde requête', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(
        reponse(302, 'https://example.com/depart'),
      );

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/depart',
        creerDependances(requeteHttp),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'boucle_redirection',
    });
    expect(requeteHttp).toHaveBeenCalledOnce();
  });

  it('détecte une boucle indirecte', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(reponse(302, '/deux'))
      .mockResolvedValueOnce(reponse(302, '/depart'));

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/depart',
        creerDependances(requeteHttp),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'boucle_redirection',
    });
    expect(requeteHttp).toHaveBeenCalledTimes(2);
  });

  it('accepte exactement trois redirections', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(reponse(301, '/deux'))
      .mockResolvedValueOnce(reponse(302, '/trois'))
      .mockResolvedValueOnce(reponse(307, '/quatre'))
      .mockResolvedValueOnce(reponse(200));

    const resultat = await controlerAccessibiliteLien(
      'https://example.com/un',
      creerDependances(requeteHttp),
    );

    expect(resultat).toMatchObject({
      statut: 'accessible',
      urlFinale: 'https://example.com/quatre',
      redirections: [
        'https://example.com/deux',
        'https://example.com/trois',
        'https://example.com/quatre',
      ],
    });
    expect(requeteHttp).toHaveBeenCalledTimes(4);
  });

  it('refuse une quatrième redirection sans appeler sa cible', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(reponse(301, '/deux'))
      .mockResolvedValueOnce(reponse(302, '/trois'))
      .mockResolvedValueOnce(reponse(307, '/quatre'))
      .mockResolvedValueOnce(reponse(308, '/cinq'));

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/un',
        creerDependances(requeteHttp),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'trop_de_redirections',
    });
    expect(requeteHttp).toHaveBeenCalledTimes(4);
  });

  it('refuse une redirection sans Location', async () => {
    await expect(
      controlerAccessibiliteLien(
        'https://example.com/depart',
        creerDependances(
          vi.fn<RequeteHttp>().mockResolvedValue(reponse(302)),
        ),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'location_absente',
    });
  });

  it('refuse une Location syntaxiquement invalide', async () => {
    await expect(
      controlerAccessibiliteLien(
        'https://example.com/depart',
        creerDependances(
          vi
            .fn<RequeteHttp>()
            .mockResolvedValue(reponse(302, 'https://[::1')),
        ),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'location_invalide',
    });
  });
});

describe('lookup Undici épinglé', () => {
  const adressesValidees = [
    { address: '1.1.1.1', family: 4 as const },
    {
      address: '2606:4700:4700::1111',
      family: 6 as const,
    },
  ];

  it('retourne uniquement l’adresse IPv4 validée demandée', async () => {
    const lookupEpingle = creerLookupEpingle(
      'example.com',
      adressesValidees,
    );

    await expect(
      appelerLookup(lookupEpingle, 'example.com', {
        family: 4,
      }),
    ).resolves.toEqual({
      adresse: '1.1.1.1',
      famille: 4,
    });
  });

  it('retourne uniquement l’adresse IPv6 validée demandée', async () => {
    const lookupEpingle = creerLookupEpingle(
      'example.com',
      adressesValidees,
    );

    await expect(
      appelerLookup(lookupEpingle, 'example.com', {
        family: 6,
      }),
    ).resolves.toEqual({
      adresse: '2606:4700:4700::1111',
      famille: 6,
    });
  });

  it('gère l’option all sans consulter un autre DNS', async () => {
    const lookupEpingle = creerLookupEpingle(
      'example.com',
      adressesValidees,
    );

    await expect(
      appelerLookup(lookupEpingle, 'example.com', {
        all: true,
      }),
    ).resolves.toEqual({
      adresse: adressesValidees,
      famille: undefined,
    });
  });

  it('refuse un hostname différent de celui validé', async () => {
    const lookupEpingle = creerLookupEpingle(
      'example.com',
      adressesValidees,
    );

    await expect(
      appelerLookup(lookupEpingle, 'evil.example', {
        family: 4,
      }),
    ).rejects.toMatchObject({
      name: 'ErreurLookupEpingle',
      code: 'ERR_HOTE_NON_VALIDE',
    });
  });

  it('refuse une famille sans adresse validée compatible', async () => {
    const lookupEpingle = creerLookupEpingle(
      'example.com',
      [{ address: '1.1.1.1', family: 4 }],
    );

    await expect(
      appelerLookup(lookupEpingle, 'example.com', {
        family: 6,
      }),
    ).rejects.toMatchObject({
      name: 'ErreurLookupEpingle',
      code: 'EAI_ADDRFAMILY',
    });
  });
});

describe('protection SSRF et résolution DNS', () => {
  it('épingle la connexion HTTP sur une adresse DNS validée', async () => {
    let initialisationObservee:
      | InitialisationRequeteHttp
      | undefined;
    const resolutionDnsSysteme = vi.fn(() => '10.0.0.8');
    const {
      fabriquerTransportEpingle,
      transports,
    } = creerFabriqueTransports();
    const requeteHttp = vi.fn<RequeteHttp>(
      async (_url, initialisation) => {
        initialisationObservee = initialisation;
        return reponse(200);
      },
    );
    const resoudreDns = vi
      .fn<ResoudreDns>()
      .mockResolvedValueOnce([ADRESSE_PUBLIQUE])
      .mockResolvedValueOnce([
        { address: '1.1.1.1', family: 4 },
      ]);

    const resultat = await controlerAccessibiliteLien(
      'https://example.com/',
      creerDependances(requeteHttp, resoudreDns, {
        fabriquerTransportEpingle,
      }),
    );

    expect(resultat.statut).toBe('accessible');
    expect(transports).toHaveLength(1);
    expect(transports[0]?.adressesValidees).toEqual([
      { address: '1.1.1.1', family: 4 },
    ]);
    expect(initialisationObservee?.dispatcher).toBe(
      transports[0]?.dispatcher,
    );
    await expect(
      appelerLookup(
        transports[0]!.lookup,
        'example.com',
        { family: 4 },
      ),
    ).resolves.toEqual({
      adresse: '1.1.1.1',
      famille: 4,
    });
    expect(resolutionDnsSysteme).not.toHaveBeenCalled();
  });

  it.each([
    'https://localhost/',
    'https://localhost.localdomain/',
    'https://service.local/',
    'https://127.0.0.1/',
    'https://10.0.0.1/',
    'https://172.16.0.1/',
    'https://192.168.1.1/',
    'https://169.254.169.254/',
    'https://100.64.0.1/',
    'https://8.8.8.8/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://017700000001/',
    'https://[::1]/',
    'https://[fe80::1]/',
    'https://[fd00::1]/',
    'https://[::ffff:192.168.1.1]/',
  ])('refuse la destination interdite %s avant HTTP', async (url) => {
    const requeteHttp = vi.fn<RequeteHttp>();
    const resultat = await controlerAccessibiliteLien(
      url,
      creerDependances(requeteHttp),
    );

    expect(resultat).toMatchObject({
      statut: 'refuse',
      raison: 'destination_interdite',
    });
    expect(requeteHttp).not.toHaveBeenCalled();
  });

  it.each([
    'https://service.invalid/',
    'https://service.interne/',
  ])('refuse un hôte sans suffixe public reconnu : %s', async (url) => {
    const requeteHttp = vi.fn<RequeteHttp>();

    await expect(
      controlerAccessibiliteLien(
        url,
        creerDependances(requeteHttp),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'destination_interdite',
    });
    expect(requeteHttp).not.toHaveBeenCalled();
  });

  it('refuse un domaine si une seule adresse DNS est privée', async () => {
    const requeteHttp = vi.fn<RequeteHttp>();
    const resoudreDns = vi
      .fn<ResoudreDns>()
      .mockResolvedValue([
        ADRESSE_PUBLIQUE,
        { address: '10.0.0.8', family: 4 },
      ]);

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(requeteHttp, resoudreDns),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'destination_interdite',
    });
    expect(requeteHttp).not.toHaveBeenCalled();
  });

  it('refuse un rebinding DNS vers une adresse privée', async () => {
    const requeteHttp = vi.fn<RequeteHttp>();
    const resoudreDns = vi
      .fn<ResoudreDns>()
      .mockResolvedValueOnce([ADRESSE_PUBLIQUE])
      .mockResolvedValueOnce([
        { address: '192.168.1.10', family: 4 },
      ]);

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(requeteHttp, resoudreDns),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'destination_interdite',
    });
    expect(requeteHttp).not.toHaveBeenCalled();
  });

  it('utilise uniquement le second ensemble DNS public après contrôle', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValue(reponse(200));
    const resoudreDns = vi
      .fn<ResoudreDns>()
      .mockResolvedValueOnce([ADRESSE_PUBLIQUE])
      .mockResolvedValueOnce([
        { address: '1.1.1.1', family: 4 },
      ]);
    const {
      fabriquerTransportEpingle,
      transports,
    } = creerFabriqueTransports();

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(requeteHttp, resoudreDns, {
          fabriquerTransportEpingle,
        }),
      ),
    ).resolves.toMatchObject({
      statut: 'accessible',
    });
    expect(transports[0]?.adressesValidees).toEqual([
      { address: '1.1.1.1', family: 4 },
    ]);
    expect(transports[0]?.adressesValidees).not.toContainEqual(
      ADRESSE_PUBLIQUE,
    );
  });

  it('accepte le même ensemble DNS public dans un ordre différent', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValue(reponse(200));
    const resoudreDns = vi
      .fn<ResoudreDns>()
      .mockResolvedValueOnce([
        ADRESSE_PUBLIQUE,
        { address: '1.1.1.1', family: 4 },
      ])
      .mockResolvedValueOnce([
        { address: '1.1.1.1', family: 4 },
        ADRESSE_PUBLIQUE,
      ]);

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(requeteHttp, resoudreDns),
      ),
    ).resolves.toMatchObject({
      statut: 'accessible',
    });
    expect(requeteHttp).toHaveBeenCalledOnce();
  });

  it('accepte deux ensembles DNS CDN différents mais entièrement publics', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValue(reponse(200));
    const resoudreDns = vi
      .fn<ResoudreDns>()
      .mockResolvedValueOnce([ADRESSE_PUBLIQUE])
      .mockResolvedValueOnce([
        { address: '1.1.1.1', family: 4 },
      ]);

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(requeteHttp, resoudreDns),
      ),
    ).resolves.toMatchObject({
      statut: 'accessible',
    });
    expect(requeteHttp).toHaveBeenCalledOnce();
  });

  it('refuse une IPv4 privée mappée en IPv6 reçue par DNS', async () => {
    const requeteHttp = vi.fn<RequeteHttp>();
    const resoudreDns = vi
      .fn<ResoudreDns>()
      .mockResolvedValue([
        {
          address: '::ffff:192.168.1.1',
          family: 6,
        },
      ]);

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(requeteHttp, resoudreDns),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'destination_interdite',
    });
    expect(requeteHttp).not.toHaveBeenCalled();
  });

  it('distingue une erreur DNS comme indisponibilité', async () => {
    const requeteHttp = vi.fn<RequeteHttp>();
    const resoudreDns = vi
      .fn<ResoudreDns>()
      .mockRejectedValue(new Error('échec DNS simulé'));

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(requeteHttp, resoudreDns),
      ),
    ).resolves.toEqual({
      statut: 'indisponible',
      raison: 'erreur_dns',
      constateLe: DATE_CONTROLE.toISOString(),
    });
    expect(requeteHttp).not.toHaveBeenCalled();
  });

  it('distingue une résolution DNS vide comme invalide', async () => {
    const requeteHttp = vi.fn<RequeteHttp>();

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(
          requeteHttp,
          vi.fn<ResoudreDns>().mockResolvedValue([]),
        ),
      ),
    ).resolves.toMatchObject({
      statut: 'indisponible',
      raison: 'resolution_dns_invalide',
    });
    expect(requeteHttp).not.toHaveBeenCalled();
  });

  it('refuse d’utiliser une adresse DNS dont la famille est incohérente', async () => {
    const requeteHttp = vi.fn<RequeteHttp>();

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(
          requeteHttp,
          vi.fn<ResoudreDns>().mockResolvedValue([
            {
              address: '93.184.216.34',
              family: 6,
            },
          ]),
        ),
      ),
    ).resolves.toMatchObject({
      statut: 'indisponible',
      raison: 'resolution_dns_invalide',
    });
    expect(requeteHttp).not.toHaveBeenCalled();
  });

  it('borne aussi la résolution DNS par le timeout', async () => {
    vi.useFakeTimers();
    const requeteHttp = vi.fn<RequeteHttp>();
    const resoudreDns = vi.fn<ResoudreDns>(
      () => new Promise(() => undefined),
    );

    const promesse = controlerAccessibiliteLien(
      'https://example.com/',
      creerDependances(requeteHttp, resoudreDns),
    );
    await vi.advanceTimersByTimeAsync(50);

    await expect(promesse).resolves.toMatchObject({
      statut: 'indisponible',
      raison: 'timeout',
    });
    expect(requeteHttp).not.toHaveBeenCalled();
  });

  it('refuse une redirection privée avant le second appel HTTP', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(
        reponse(302, 'https://169.254.169.254/latest/meta-data'),
      );

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/depart',
        creerDependances(requeteHttp),
      ),
    ).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'destination_interdite',
    });
    expect(requeteHttp).toHaveBeenCalledOnce();
  });
});

describe('timeout, réseau et confidentialité', () => {
  it('déclenche l’abandon au timeout et le classe comme indisponible', async () => {
    vi.useFakeTimers();
    let signalObserve: AbortSignal | undefined;
    const {
      fabriquerTransportEpingle,
      transports,
    } = creerFabriqueTransports();
    const requeteHttp = vi.fn<RequeteHttp>(
      (_url, initialisation) =>
        new Promise((_resoudre, rejeter) => {
          signalObserve = initialisation.signal ?? undefined;
          signalObserve?.addEventListener('abort', () => {
            rejeter(
              new DOMException('requête abandonnée', 'AbortError'),
            );
          });
        }),
    );

    const promesse = controlerAccessibiliteLien(
      'https://example.com/lent',
      creerDependances(requeteHttp, undefined, {
        fabriquerTransportEpingle,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);

    await expect(promesse).resolves.toEqual({
      statut: 'indisponible',
      raison: 'timeout',
      constateLe: DATE_CONTROLE.toISOString(),
    });
    expect(signalObserve?.aborted).toBe(true);
    expect(transports[0]?.fermer).toHaveBeenCalledOnce();
  });

  it('classe une erreur réseau sans la transformer en refus', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockRejectedValue(new TypeError('réseau simulé'));
    const {
      fabriquerTransportEpingle,
      transports,
    } = creerFabriqueTransports();

    await expect(
      controlerAccessibiliteLien(
        'https://example.com/',
        creerDependances(requeteHttp, undefined, {
          fabriquerTransportEpingle,
        }),
      ),
    ).resolves.toEqual({
      statut: 'indisponible',
      raison: 'erreur_reseau',
      constateLe: DATE_CONTROLE.toISOString(),
    });
    expect(transports[0]?.fermer).toHaveBeenCalledOnce();
  });

  it('envoie uniquement les options et en-têtes techniques autorisés', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValue(reponse(200));

    await controlerAccessibiliteLien(
      'https://example.com/',
      creerDependances(requeteHttp),
    );

    expect(requeteHttp).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({
        method: 'HEAD',
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: '*/*',
          'User-Agent': 'ExperienceAI-Link-Checker/1.0',
        },
      }),
    );
    const initialisation = requeteHttp.mock.calls[0]?.[1];
    expect(initialisation?.headers).not.toHaveProperty('Cookie');
    expect(initialisation?.headers).not.toHaveProperty('Authorization');
    expect(initialisation?.headers).not.toHaveProperty(
      'Proxy-Authorization',
    );
    expect(initialisation?.headers).not.toHaveProperty('X-Api-Key');
  });

  it('annule le corps du GET dès réception des en-têtes', async () => {
    const annuler = vi.fn();
    const corps = new ReadableStream({
      cancel: annuler,
    });
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(reponse(405))
      .mockResolvedValueOnce(new Response(corps, { status: 200 }));

    await controlerAccessibiliteLien(
      'https://example.com/',
      creerDependances(requeteHttp),
    );

    expect(annuler).toHaveBeenCalledOnce();
  });

  it('impose redirect manual à chaque requête', async () => {
    const requeteHttp = vi
      .fn<RequeteHttp>()
      .mockResolvedValueOnce(reponse(302, '/final'))
      .mockResolvedValueOnce(reponse(200));

    await controlerAccessibiliteLien(
      'https://example.com/depart',
      creerDependances(requeteHttp),
    );

    expect(
      requeteHttp.mock.calls.map((appel) => appel[1].redirect),
    ).toEqual(['manual', 'manual']);
  });
});
