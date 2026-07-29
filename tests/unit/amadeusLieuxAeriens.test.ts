import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  CandidatLieuAerienSchema,
  LieuTransportConfirmeSchema,
  RechercheLieuAerienSchema,
  SOURCE_LIEUX_AMADEUS,
  type CandidatLieuAerien,
} from '../../server/domaine/transport/index.js';
import { viderCacheMemoire } from '../../server/lib/cacheMemoire.js';
import {
  evaluerResolutionLieuAerien,
  rechercherLieuxAeriens,
  RechercheLieuAerienInvalide,
  type ResultatRechercheLieuAerien,
} from '../../server/services/amadeus/index.js';
import { reinitialiserAuthentificationAmadeusPourTests } from '../../server/services/amadeus/auth.js';

const requeteFetch = vi.fn();
const cleInitiale = process.env.AMADEUS_API_KEY;
const secretInitial = process.env.AMADEUS_API_SECRET;
const DATE_CONTROLE = '2026-07-29T12:00:00.000Z';

function reponseJson(contenu: unknown, statut = 200): Response {
  return new Response(JSON.stringify(contenu), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}

function reponseJeton(
  jeton = 'jeton-amadeus-recherche',
  expiration = 7_200
): Response {
  return reponseJson({
    token_type: 'Bearer',
    access_token: jeton,
    expires_in: expiration,
  });
}

function lieuAmadeus(
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'location',
    subType: 'AIRPORT',
    name: 'AEROPORT ALPHA',
    detailedName: 'ALPHA/FR:AEROPORT ALPHA',
    id: 'AALPHA',
    iataCode: 'AAA',
    timeZoneOffset: '+02:00',
    geoCode: {
      latitude: 44.84,
      longitude: -0.58,
    },
    address: {
      cityName: 'ALPHA',
      countryCode: 'FR',
    },
    ...complement,
  };
}

function candidat(
  complement: Partial<CandidatLieuAerien> = {}
): CandidatLieuAerien {
  return {
    type: 'aeroport',
    identifiantExterne: 'AALPHA',
    nom: 'AEROPORT ALPHA',
    ville: 'ALPHA',
    codePays: 'FR',
    codeIata: 'AAA',
    coordonnees: {
      latitude: 44.84,
      longitude: -0.58,
    },
    decalageHoraire: '+02:00',
    fournisseur: 'Amadeus',
    source: SOURCE_LIEUX_AMADEUS,
    recupereLe: DATE_CONTROLE,
    ...complement,
  };
}

function preparerRecherche(
  contenu: unknown,
  statut = 200,
  jeton = 'jeton-amadeus-recherche'
): void {
  requeteFetch
    .mockResolvedValueOnce(reponseJeton(jeton))
    .mockResolvedValueOnce(reponseJson(contenu, statut));
}

beforeEach(() => {
  process.env.AMADEUS_API_KEY = 'cle-amadeus-test';
  process.env.AMADEUS_API_SECRET = 'secret-amadeus-test';
  requeteFetch.mockReset();
  vi.stubGlobal('fetch', requeteFetch);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATE_CONTROLE));
  reinitialiserAuthentificationAmadeusPourTests();
  viderCacheMemoire();
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

describe('RechercheLieuAerienSchema — frontière d’entrée', () => {
  it('nettoie une ville valide et conserve un pays et une préférence explicites', () => {
    expect(
      RechercheLieuAerienSchema.parse({
        ville: '  Bordeaux  ',
        codePays: 'FR',
        preference: 'aeroport',
      })
    ).toEqual({
      ville: 'Bordeaux',
      codePays: 'FR',
      preference: 'aeroport',
    });
  });

  it.each([
    ['chaîne vide', { ville: '' }],
    ['espaces seuls', { ville: '   ' }],
    ['chaîne trop courte', { ville: 'A' }],
    ['chaîne trop longue', { ville: 'A'.repeat(81) }],
    ['caractère de contrôle', { ville: 'Bor\u0000deaux' }],
    ['balise HTML', { ville: '<b>Bordeaux</b>' }],
    ['URL HTTP', { ville: 'https://example.test/Bordeaux' }],
    ['URL FTP', { ville: 'ftp://example.test/Bordeaux' }],
    ['schéma JavaScript', { ville: 'javascript:alert(1)' }],
    ['URL Web', { ville: 'www.example.test' }],
    ['paramètre injecté', { ville: 'Bordeaux&countryCode=US' }],
    ['identifiant injecté dans l’objet', { ville: 'Bordeaux', identifiantExterne: 'ABOD' }],
    ['fournisseur injecté dans l’objet', { ville: 'Bordeaux', fournisseur: 'Amadeus' }],
    ['fuseau injecté', { ville: 'Bordeaux', fuseauIana: 'Europe/Paris' }],
    ['code pays minuscule', { ville: 'Bordeaux', codePays: 'fr' }],
    ['code pays trop long', { ville: 'Bordeaux', codePays: 'FRA' }],
    ['préférence inconnue', { ville: 'Bordeaux', preference: 'gare' }],
    ['paramètre inconnu', { ville: 'Bordeaux', tri: 'score' }],
  ])('refuse %s', (_libelle, valeur) => {
    expect(RechercheLieuAerienSchema.safeParse(valeur).success).toBe(false);
  });

  it('fait échouer la recherche avant tout appel réseau lorsque la demande est invalide', async () => {
    await expect(
      rechercherLieuxAeriens({ ville: 'https://evil.test' })
    ).rejects.toBeInstanceOf(RechercheLieuAerienInvalide);
    expect(requeteFetch).not.toHaveBeenCalled();
  });
});

describe('Airport & City Search — requête et candidat', () => {
  it('convertit une réponse structurée en candidat Amadeus traçable', async () => {
    preparerRecherche({ data: [lieuAmadeus()] });

    await expect(
      rechercherLieuxAeriens({
        ville: 'Alpha',
        codePays: 'FR',
        preference: 'aeroport',
      })
    ).resolves.toEqual({
      statut: 'ok',
      recupereLe: DATE_CONTROLE,
      resultats: [candidat()],
    });
  });

  it('construit uniquement les paramètres autorisés sur le domaine fixe', async () => {
    preparerRecherche({ data: [] });

    await rechercherLieuxAeriens({
      ville: 'Alpha Ville',
      codePays: 'FR',
      preference: 'aeroport',
    });

    const [entree, options] = requeteFetch.mock.calls[1] as [
      URL,
      RequestInit,
    ];
    expect(entree.origin).toBe('https://test.api.amadeus.com');
    expect(entree.pathname).toBe('/v1/reference-data/locations');
    expect([...entree.searchParams.keys()].sort()).toEqual(
      ['countryCode', 'keyword', 'subType', 'view'].sort()
    );
    expect(entree.searchParams.getAll('keyword')).toEqual(['Alpha Ville']);
    expect(entree.searchParams.getAll('countryCode')).toEqual(['FR']);
    expect(entree.searchParams.getAll('subType')).toEqual(['AIRPORT']);
    expect(entree.searchParams.getAll('view')).toEqual(['FULL']);
    expect(entree.hash).toBe('');
    expect(options.redirect).toBe('error');
    expect(options.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer jeton-amadeus-recherche',
    });
  });

  it.each([
    [undefined, 'CITY,AIRPORT'],
    ['aeroport', 'AIRPORT'],
    ['ville', 'CITY'],
  ] as const)(
    'traduit la préférence %s en sous-types %s',
    async (preference, sousTypes) => {
      preparerRecherche({ data: [] });

      await rechercherLieuxAeriens({
        ville: 'Alpha',
        ...(preference ? { preference } : {}),
      });

      const [entree] = requeteFetch.mock.calls[1] as [URL, RequestInit];
      expect(entree.searchParams.get('subType')).toBe(sousTypes);
    }
  );

  it('ne fabrique aucun champ absent', async () => {
    preparerRecherche({
      data: [
        lieuAmadeus({
          iataCode: undefined,
          geoCode: undefined,
          timeZoneOffset: undefined,
        }),
      ],
    });

    const resultat = await rechercherLieuxAeriens({
      ville: 'Alpha',
      preference: 'aeroport',
    });

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(resultat.resultats[0]).not.toHaveProperty('codeIata');
    expect(resultat.resultats[0]).not.toHaveProperty('coordonnees');
    expect(resultat.resultats[0]).not.toHaveProperty('decalageHoraire');
    expect(resultat.resultats[0]).not.toHaveProperty('fuseauIana');
  });

  it('ignore les champs externes non consommés sans les recopier', async () => {
    preparerRecherche({
      meta: { count: 1 },
      data: [
        lieuAmadeus({
          analytics: { travelers: { score: 99 } },
          self: { href: 'https://test.api.amadeus.com/interne' },
          champInconnu: 'ne doit pas sortir',
        }),
      ],
      autreChamp: 'ignoré',
    });

    const resultat = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(resultat.resultats[0]).not.toHaveProperty('analytics');
    expect(resultat.resultats[0]).not.toHaveProperty('self');
    expect(resultat.resultats[0]).not.toHaveProperty('champInconnu');
  });

  it('filtre réellement le pays fourni', async () => {
    preparerRecherche({
      data: [
        lieuAmadeus(),
        lieuAmadeus({
          id: 'AALPHA-US',
          address: { cityName: 'ALPHA', countryCode: 'US' },
        }),
      ],
    });

    const resultat = await rechercherLieuxAeriens({
      ville: 'Alpha',
      codePays: 'FR',
    });

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(resultat.resultats.map((valeur) => valeur.identifiantExterne)).toEqual([
      'AALPHA',
    ]);
  });

  it('filtre réellement le sous-type fourni', async () => {
    preparerRecherche({
      data: [
        lieuAmadeus(),
        lieuAmadeus({
          id: 'CALPHA',
          subType: 'CITY',
          name: 'ALPHA',
          iataCode: 'ALP',
        }),
      ],
    });

    const resultat = await rechercherLieuxAeriens({
      ville: 'Alpha',
      preference: 'ville',
    });

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(resultat.resultats).toHaveLength(1);
    expect(resultat.resultats[0]).toMatchObject({
      type: 'ville',
      identifiantExterne: 'CALPHA',
    });
  });
});

describe('Airport & City Search — validation de réponse', () => {
  it('distingue un tableau réellement vide', async () => {
    preparerRecherche({ data: [] });

    await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
      statut: 'vide',
      resultats: [],
      recupereLe: DATE_CONTROLE,
    });
  });

  it.each([
    ['champ data absent', {}],
    ['data non tableau', { data: {} }],
    ['entrée sans identifiant', { data: [lieuAmadeus({ id: undefined })] }],
    ['entrée sans ville', { data: [lieuAmadeus({ address: { countryCode: 'FR' } })] }],
    ['entrée sans pays', { data: [lieuAmadeus({ address: { cityName: 'ALPHA' } })] }],
    ['pays invalide', { data: [lieuAmadeus({ address: { cityName: 'ALPHA', countryCode: 'FRA' } })] }],
    ['IATA invalide', { data: [lieuAmadeus({ iataCode: 'AAAA' })] }],
    ['latitude hors bornes', { data: [lieuAmadeus({ geoCode: { latitude: 91, longitude: 0 } })] }],
    ['longitude hors bornes', { data: [lieuAmadeus({ geoCode: { latitude: 0, longitude: 181 } })] }],
    ['offset invalide', { data: [lieuAmadeus({ timeZoneOffset: '+15:00' })] }],
    ['sous-type inconnu', { data: [lieuAmadeus({ subType: 'RAILWAY' })] }],
    ['type inconnu', { data: [lieuAmadeus({ type: 'airport' })] }],
  ])('classe %s comme réponse invalide', async (_libelle, contenu) => {
    preparerRecherche(contenu);

    await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'reponse_invalide',
    });
  });

  it('classe un JSON mal formé comme réponse invalide', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(
        new Response('{invalide', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'reponse_invalide',
    });
  });

  it('ne transforme pas un résultat individuel invalide en vide', async () => {
    preparerRecherche({
      data: [lieuAmadeus(), lieuAmadeus({ id: '' })],
    });

    await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'reponse_invalide',
    });
  });

  it('déduplique deux entrées fournisseur strictement identiques', async () => {
    preparerRecherche({ data: [lieuAmadeus(), lieuAmadeus()] });

    const resultat = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(resultat.resultats).toHaveLength(1);
  });

  it('ne fusionne jamais deux aéroports distincts partageant le même IATA', async () => {
    preparerRecherche({
      data: [
        lieuAmadeus({ id: 'AALPHA-1', iataCode: 'AAA' }),
        lieuAmadeus({ id: 'AALPHA-2', iataCode: 'AAA' }),
      ],
    });

    const resultat = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(resultat.resultats).toHaveLength(2);
    expect(
      resultat.resultats.map((valeur) => valeur.identifiantExterne)
    ).toEqual(['AALPHA-1', 'AALPHA-2']);
  });

  it('refuse deux entrées contradictoires portant le même identifiant', async () => {
    preparerRecherche({
      data: [
        lieuAmadeus(),
        lieuAmadeus({
          name: 'AUTRE AEROPORT',
          iataCode: 'AAB',
        }),
      ],
    });

    await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'reponse_invalide',
    });
  });
});

describe('Airport & City Search — indisponibilités', () => {
  it('propage une configuration absente sans appel réseau', async () => {
    delete process.env.AMADEUS_API_SECRET;

    await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'configuration_absente',
    });
    expect(requeteFetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'authentification'],
    [403, 'authentification'],
    [429, 'quota'],
    [500, 'fournisseur'],
  ] as const)(
    'normalise une recherche HTTP %s en %s',
    async (statut, raison) => {
      preparerRecherche(
        { errors: [{ detail: 'corps fournisseur interne' }] },
        statut
      );

      await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
        statut: 'indisponible',
        fournisseur: 'Amadeus',
        raison,
      });
    }
  );

  it('propage l’échec OAuth2 sans lancer Airport & City Search', async () => {
    requeteFetch.mockResolvedValueOnce(reponseJson({ erreur: 'auth' }, 401));

    await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'authentification',
    });
    expect(requeteFetch).toHaveBeenCalledTimes(1);
  });

  it('distingue un timeout de recherche', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockRejectedValueOnce(new DOMException('délai', 'AbortError'));

    await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'timeout',
    });
  });

  it('distingue une panne réseau de recherche', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(rechercherLieuxAeriens({ ville: 'Alpha' })).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'reseau',
    });
  });

  it('invalide le jeton après un 401 afin que l’appel suivant se réauthentifie', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton('jeton-revoque'))
      .mockResolvedValueOnce(reponseJson({ errors: [] }, 401))
      .mockResolvedValueOnce(reponseJeton('jeton-renouvele'))
      .mockResolvedValueOnce(reponseJson({ data: [] }));

    await rechercherLieuxAeriens({ ville: 'Alpha' });
    await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(requeteFetch).toHaveBeenCalledTimes(4);
    const [, options] = requeteFetch.mock.calls[3] as [URL, RequestInit];
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer jeton-renouvele',
    });
  });
});

describe('CandidatLieuAerien — IATA, offset et absence de promotion', () => {
  it('distingue une ville IATA de deux aéroports dans des fixtures fictives', async () => {
    preparerRecherche({
      data: [
        lieuAmadeus({
          subType: 'CITY',
          id: 'C-PAR-FICTIF',
          name: 'VILLE PAR FICTIVE',
          iataCode: 'PAR',
        }),
        lieuAmadeus({
          id: 'A-CDG-FICTIF',
          name: 'AEROPORT CDG FICTIF',
          iataCode: 'CDG',
        }),
        lieuAmadeus({
          id: 'A-ORY-FICTIF',
          name: 'AEROPORT ORY FICTIF',
          iataCode: 'ORY',
        }),
      ],
    });

    const resultat = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(
      resultat.resultats.map(({ type, codeIata }) => ({ type, codeIata }))
    ).toEqual([
      { type: 'aeroport', codeIata: 'CDG' },
      { type: 'aeroport', codeIata: 'ORY' },
      { type: 'ville', codeIata: 'PAR' },
    ]);
  });

  it('conserve le décalage comme offset sans fabriquer de fuseau IANA', () => {
    const validation = CandidatLieuAerienSchema.parse(candidat());
    expect(validation.decalageHoraire).toBe('+02:00');
    expect(validation).not.toHaveProperty('fuseauIana');
  });

  it('ne permet pas de promouvoir un candidat en lieu confirmé', () => {
    expect(LieuTransportConfirmeSchema.safeParse(candidat()).success).toBe(
      false
    );
  });

  it.each([
    ['offset', { decalageHoraire: 'Europe/Paris' }],
    ['fuseau inventé', { fuseauIana: 'Europe/Paris' }],
    ['IATA minuscule', { codeIata: 'cdg' }],
    ['IATA absent remplacé par identifiant', { codeIata: 'AALPHA' }],
  ])('refuse un candidat dont %s est invalide', (_libelle, complement) => {
    expect(
      CandidatLieuAerienSchema.safeParse({
        ...candidat(),
        ...complement,
      }).success
    ).toBe(false);
  });
});

describe('RésolutionLieuAerien — pluralité et déterminisme', () => {
  it('transforme zéro candidat en vide', () => {
    expect(
      evaluerResolutionLieuAerien({
        statut: 'vide',
        resultats: [],
        recupereLe: DATE_CONTROLE,
      })
    ).toEqual({ statut: 'vide', recupereLe: DATE_CONTROLE });
  });

  it('transforme un seul candidat fournisseur en unique sans le confirmer', () => {
    expect(
      evaluerResolutionLieuAerien({
        statut: 'ok',
        resultats: [candidat()],
        recupereLe: DATE_CONTROLE,
      })
    ).toEqual({
      statut: 'unique',
      candidat: candidat(),
      recupereLe: DATE_CONTROLE,
    });
  });

  it('conserve plusieurs candidats comme ambiguïté sans choisir le premier', () => {
    const ville = candidat({
      type: 'ville',
      identifiantExterne: 'CALPHA',
      nom: 'ALPHA',
      codeIata: 'ALP',
    });
    const aeroport = candidat();
    const resolution = evaluerResolutionLieuAerien({
      statut: 'ok',
      resultats: [ville, aeroport],
      recupereLe: DATE_CONTROLE,
    });

    expect(resolution).toEqual({
      statut: 'ambigue',
      candidats: [aeroport, ville],
      recupereLe: DATE_CONTROLE,
    });
  });

  it('produit le même ordre quel que soit l’ordre fournisseur', () => {
    const premier = candidat();
    const second = candidat({
      identifiantExterne: 'ABETA',
      nom: 'AEROPORT BETA',
      codeIata: 'BBB',
    });
    const resolutionA = evaluerResolutionLieuAerien({
      statut: 'ok',
      resultats: [second, premier],
      recupereLe: DATE_CONTROLE,
    });
    const resolutionB = evaluerResolutionLieuAerien({
      statut: 'ok',
      resultats: [premier, second],
      recupereLe: DATE_CONTROLE,
    });
    expect(resolutionA).toEqual(resolutionB);
  });

  it('propage une indisponibilité sans la transformer en vide', () => {
    expect(
      evaluerResolutionLieuAerien({
        statut: 'indisponible',
        fournisseur: 'Amadeus',
        raison: 'quota',
      })
    ).toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'quota',
    });
  });
});

describe('Airport & City Search — cache', () => {
  it('met un succès en cache en conservant son recupereLe initial', async () => {
    preparerRecherche({ data: [lieuAmadeus()] });

    const premier = await rechercherLieuxAeriens({ ville: 'Alpha' });
    vi.setSystemTime(new Date('2026-07-29T12:20:00.000Z'));
    const second = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(second).toEqual(premier);
    expect(second).toMatchObject({ recupereLe: DATE_CONTROLE });
    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('met une vraie recherche vide en cache pendant cinq minutes', async () => {
    preparerRecherche({ data: [] });

    const premier = await rechercherLieuxAeriens({ ville: 'Alpha' });
    vi.setSystemTime(new Date('2026-07-29T12:04:59.000Z'));
    const second = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(second).toEqual(premier);
    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('expire une recherche vide après cinq minutes', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(reponseJson({ data: [] }))
      .mockResolvedValueOnce(reponseJson({ data: [] }));

    const premier = await rechercherLieuxAeriens({ ville: 'Alpha' });
    vi.setSystemTime(new Date('2026-07-29T12:05:00.001Z'));
    const second = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(premier).not.toBe(second);
    expect(requeteFetch).toHaveBeenCalledTimes(3);
  });

  it('expire un résultat positif après trente minutes', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(reponseJson({ data: [lieuAmadeus()] }))
      .mockResolvedValueOnce(
        reponseJson({
          data: [lieuAmadeus({ name: 'AEROPORT ALPHA ACTUALISE' })],
        })
      );

    const premier = await rechercherLieuxAeriens({ ville: 'Alpha' });
    vi.setSystemTime(new Date('2026-07-29T12:30:00.001Z'));
    const second = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(second).not.toEqual(premier);
    expect(requeteFetch).toHaveBeenCalledTimes(3);
  });

  it('ne met jamais une indisponibilité en cache', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(reponseJson({ erreur: true }, 500))
      .mockResolvedValueOnce(reponseJson({ data: [] }));

    const premier = await rechercherLieuxAeriens({ ville: 'Alpha' });
    const second = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(premier).toMatchObject({ statut: 'indisponible' });
    expect(second).toMatchObject({ statut: 'vide' });
    expect(requeteFetch).toHaveBeenCalledTimes(3);
  });

  it('normalise la ville dans la clé de cache', async () => {
    preparerRecherche({ data: [] });

    await rechercherLieuxAeriens({ ville: '  Álpha  ' });
    await rechercherLieuxAeriens({ ville: 'alpha' });

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'pays',
      { ville: 'Alpha', codePays: 'FR' },
      { ville: 'Alpha', codePays: 'US' },
    ],
    [
      'préférence',
      { ville: 'Alpha', preference: 'ville' },
      { ville: 'Alpha', preference: 'aeroport' },
    ],
  ] as const)('différencie la clé selon le %s', async (_libelle, a, b) => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(reponseJson({ data: [] }))
      .mockResolvedValueOnce(reponseJson({ data: [] }));

    await rechercherLieuxAeriens(a);
    await rechercherLieuxAeriens(b);

    expect(requeteFetch).toHaveBeenCalledTimes(3);
  });

  it('mutualise deux recherches identiques concurrentes', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(reponseJson({ data: [] }));

    const premiere = rechercherLieuxAeriens({ ville: 'Alpha' });
    const seconde = rechercherLieuxAeriens({ ville: 'Alpha' });

    await expect(Promise.all([premiere, seconde])).resolves.toEqual([
      {
        statut: 'vide',
        resultats: [],
        recupereLe: DATE_CONTROLE,
      },
      {
        statut: 'vide',
        resultats: [],
        recupereLe: DATE_CONTROLE,
      },
    ]);
    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('respecte la borne déterministe de 300 entrées du cache mémoire', async () => {
    requeteFetch.mockImplementation(async (entree: URL | string) => {
      const url = new URL(String(entree));
      if (url.pathname.endsWith('/oauth2/token')) return reponseJeton();
      return reponseJson({ data: [] });
    });

    for (let index = 0; index <= 300; index += 1) {
      await rechercherLieuxAeriens({ ville: `Ville ${index}` });
    }
    await rechercherLieuxAeriens({ ville: 'Ville 0' });

    expect(requeteFetch).toHaveBeenCalledTimes(303);
  });
});

describe('Airport & City Search — confidentialité et sécurité', () => {
  it('ne renvoie ni clé, ni secret, ni jeton', async () => {
    preparerRecherche({ data: [lieuAmadeus()] }, 200, 'jeton-confidentiel');

    const resultat = await rechercherLieuxAeriens({ ville: 'Alpha' });
    const sortie = JSON.stringify(resultat);

    expect(sortie).not.toContain('cle-amadeus-test');
    expect(sortie).not.toContain('secret-amadeus-test');
    expect(sortie).not.toContain('jeton-confidentiel');
  });

  it('ne renvoie jamais le corps brut d’une erreur fournisseur', async () => {
    preparerRecherche(
      {
        errors: [
          {
            detail:
              'secret-amadeus-test jeton-interne information fournisseur',
          },
        ],
      },
      500
    );

    const resultat = await rechercherLieuxAeriens({ ville: 'Alpha' });
    const sortie = JSON.stringify(resultat);

    expect(sortie).not.toContain('secret-amadeus-test');
    expect(sortie).not.toContain('jeton-interne');
    expect(sortie).not.toContain('information fournisseur');
  });

  it('utilise toujours la source HTTPS officielle fixée côté serveur', async () => {
    preparerRecherche({
      data: [
        lieuAmadeus({
          source: 'https://evil.test/fausse-source',
          self: { href: 'https://evil.test/redirection' },
        }),
      ],
    });

    const resultat = await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(resultat.resultats[0].source).toBe(SOURCE_LIEUX_AMADEUS);
  });

  it('ne journalise aucune donnée secrète', async () => {
    const journal = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const avertissement = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const erreur = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    preparerRecherche({ data: [lieuAmadeus()] }, 200, 'jeton-confidentiel');

    await rechercherLieuxAeriens({ ville: 'Alpha' });

    const sortie = JSON.stringify([
      journal.mock.calls,
      avertissement.mock.calls,
      erreur.mock.calls,
    ]);
    expect(sortie).not.toContain('cle-amadeus-test');
    expect(sortie).not.toContain('secret-amadeus-test');
    expect(sortie).not.toContain('jeton-confidentiel');
  });

  it('n’effectue aucun autre appel réseau que OAuth2 puis la recherche fixée', async () => {
    preparerRecherche({ data: [] });

    await rechercherLieuxAeriens({ ville: 'Alpha' });

    expect(requeteFetch).toHaveBeenCalledTimes(2);
    expect(
      requeteFetch.mock.calls.map(([entree]) => new URL(String(entree)).origin)
    ).toEqual([
      'https://test.api.amadeus.com',
      'https://test.api.amadeus.com',
    ]);
  });
});
