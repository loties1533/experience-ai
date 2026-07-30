import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { viderCacheMemoire } from '../../server/lib/cacheMemoire.js';
import {
  evaluerResolutionGareNavitia,
  rechercherGaresNavitia,
  RechercheGareNavitiaInvalide,
  type ResultatRechercheGareNavitia,
} from '../../server/services/navitia/index.js';

const requeteFetch = vi.fn();
const jetonInitial = process.env.NAVITIA_API_TOKEN;
const JETON = 'jeton-navitia-test';
const DATE_CONTROLE = '2026-07-30T09:15:00.000Z';

function reponseJson(contenu: unknown, statut = 200): Response {
  return new Response(JSON.stringify(contenu), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}

function stopArea(
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'stop_area:SNCF:87581009',
    name: 'Bordeaux Saint-Jean',
    coord: { lat: '44.825873', lon: '-0.556347' },
    timezone: 'Europe/Paris',
    ...complement,
  };
}

function place(
  complement: Record<string, unknown> = {},
  embeddedType = 'stop_area'
): Record<string, unknown> {
  return {
    embedded_type: embeddedType,
    id: 'stop_area:SNCF:87581009',
    name: 'Bordeaux Saint-Jean',
    stop_area: stopArea(complement),
  };
}

function reponsePlaces(places: unknown[]): Response {
  return reponseJson({ places });
}

async function rechercher(
  recherche: unknown = { requete: 'Bordeaux Saint-Jean' }
): Promise<ResultatRechercheGareNavitia> {
  return rechercherGaresNavitia(recherche);
}

function derniereUrl(): URL {
  return new URL(String(requeteFetch.mock.calls.at(-1)?.[0]));
}

function dernieresOptions(): RequestInit {
  return requeteFetch.mock.calls.at(-1)?.[1] as RequestInit;
}

beforeEach(() => {
  process.env.NAVITIA_API_TOKEN = JETON;
  requeteFetch.mockReset();
  vi.stubGlobal('fetch', requeteFetch);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATE_CONTROLE));
  viderCacheMemoire();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (jetonInitial === undefined) delete process.env.NAVITIA_API_TOKEN;
  else process.env.NAVITIA_API_TOKEN = jetonInitial;
});

describe('rechercherGaresNavitia — requête envoyée', () => {
  it('interroge /v1/places avec la requête et le filtre stop_area', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher({ requete: 'Bordeaux Saint-Jean' });
    const url = derniereUrl();

    expect(url.origin).toBe('https://api.navitia.io');
    expect(url.pathname).toBe('/v1/places');
    expect(url.searchParams.get('q')).toBe('Bordeaux Saint-Jean');
    expect(url.searchParams.getAll('type[]')).toEqual(['stop_area']);
  });

  it('restreint la recherche à la couverture demandée', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher({ requete: 'Gare de Lyon', couverture: 'fr-idf' });

    expect(derniereUrl().pathname).toBe('/v1/coverage/fr-idf/places');
  });

  it('authentifie en Basic sans jamais mettre le jeton dans l’URL', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher();
    const enTetes = dernieresOptions().headers as Record<string, string>;

    expect(enTetes.Authorization).toBe(
      `Basic ${Buffer.from(`${JETON}:`, 'utf8').toString('base64')}`
    );
    expect(enTetes.Accept).toBe('application/json');
    expect(derniereUrl().toString()).not.toContain(JETON);
  });

  it('refuse de suivre une redirection', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher();

    expect(dernieresOptions().redirect).toBe('error');
  });

  it.each([
    ['une requête absente', {}],
    ['une requête vide', { requete: '' }],
    ['une requête trop courte', { requete: 'a' }],
    ['une requête avec caractère de contrôle', { requete: 'Gare\u0000' }],
    ['une couverture au format interdit', { requete: 'Gare', couverture: '../fr' }],
    ['une couverture avec barre oblique', { requete: 'Gare', couverture: 'fr/idf' }],
    ['un champ inconnu', { requete: 'Gare', region: 'fr-idf' }],
  ])('rejette %s sans appeler le réseau', async (_libelle, recherche) => {
    await expect(rechercher(recherche)).rejects.toBeInstanceOf(
      RechercheGareNavitiaInvalide
    );
    expect(requeteFetch).not.toHaveBeenCalled();
  });
});

describe('rechercherGaresNavitia — indisponibilités', () => {
  it('signale une configuration absente sans appeler le réseau', async () => {
    delete process.env.NAVITIA_API_TOKEN;

    const resultat = await rechercher();

    expect(resultat).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison: 'configuration_absente',
    });
    expect(requeteFetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'authentification'],
    [403, 'authentification'],
    [429, 'quota'],
    [404, 'fournisseur'],
    [500, 'fournisseur'],
    [503, 'fournisseur'],
  ])('traduit le statut HTTP %s en %s', async (statutHttp, raison) => {
    requeteFetch.mockResolvedValue(reponseJson({ error: 'x' }, statutHttp));

    const resultat = await rechercher();

    expect(resultat).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison,
    });
  });

  it('traduit un dépassement de délai en timeout', async () => {
    const erreur = new Error('The operation was aborted');
    erreur.name = 'TimeoutError';
    requeteFetch.mockRejectedValue(erreur);

    expect(await rechercher()).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison: 'timeout',
    });
  });

  it('traduit une interruption en timeout', async () => {
    const erreur = new Error('aborted');
    erreur.name = 'AbortError';
    requeteFetch.mockRejectedValue(erreur);

    expect((await rechercher()).statut).toBe('indisponible');
  });

  it('traduit une panne réseau en reseau', async () => {
    requeteFetch.mockRejectedValue(new Error('connexion refusée'));

    expect(await rechercher()).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison: 'reseau',
    });
  });

  it.each([
    [
      'un contenu non JSON',
      new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ],
    [
      'un JSON illisible',
      new Response('{ceci n’est pas du JSON', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
    [
      'une réponse vide',
      new Response('', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
  ])('refuse %s', async (_libelle, reponse) => {
    requeteFetch.mockResolvedValue(reponse);

    expect(await rechercher()).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison: 'reponse_invalide',
    });
  });

  it.each([
    ['une enveloppe sans places', { resultats: [] }],
    ['des places non listées', { places: {} }],
    ['un place sans embedded_type', { places: [{ id: 'x' }] }],
  ])('refuse %s', async (_libelle, contenu) => {
    requeteFetch.mockResolvedValue(reponseJson(contenu));

    expect((await rechercher()).statut).toBe('indisponible');
  });

  it('n’expose jamais le jeton dans le résultat d’une panne', async () => {
    requeteFetch.mockResolvedValue(reponseJson({ error: 'x' }, 401));

    expect(JSON.stringify(await rechercher())).not.toContain(JETON);
  });

  it('refuse toute la réponse quand un stop_area est inconvertible', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([
        place(),
        place({ id: 'stop_area:SNCF:87581991', timezone: 'Zone/Inconnue' }),
      ])
    );

    expect(await rechercher()).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison: 'reponse_invalide',
    });
  });
});

describe('rechercherGaresNavitia — candidats rendus', () => {
  it('rend un candidat unique avec sa provenance exacte', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([place({ codes: [{ type: 'UIC', value: '87581009' }] })])
    );

    const resultat = await rechercher();

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') return;
    expect(resultat.resultats).toHaveLength(1);
    expect(resultat.resultats[0]).toEqual({
      fournisseur: 'Navitia',
      identifiantExterne: 'stop_area:SNCF:87581009',
      nom: 'Bordeaux Saint-Jean',
      coordonnees: { latitude: 44.825873, longitude: -0.556347 },
      fuseauIana: 'Europe/Paris',
      code: { systeme: 'UIC', valeur: '87581009' },
      source:
        'https://api.navitia.io/v1/places?q=Bordeaux+Saint-Jean&type%5B%5D=stop_area',
      recupereLe: DATE_CONTROLE,
    });
  });

  it('conserve la source de couverture réellement interrogée', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    const resultat = await rechercher({
      requete: 'Gare de Lyon',
      couverture: 'fr-idf',
    });

    expect(resultat.statut === 'ok' && resultat.resultats[0].source).toContain(
      '/v1/coverage/fr-idf/places'
    );
  });

  it('n’écrit jamais le jeton dans la source', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    const resultat = await rechercher();

    expect(
      resultat.statut === 'ok' && resultat.resultats[0].source
    ).not.toContain(JETON);
  });

  it('date tous les candidats d’un même appel à l’identique', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([
        place(),
        place({ id: 'stop_area:SNCF:87581991', name: 'Bordeaux Bègles' }),
      ])
    );

    const resultat = await rechercher();

    expect(resultat.statut === 'ok' && resultat.recupereLe).toBe(
      DATE_CONTROLE
    );
    expect(
      resultat.statut === 'ok' &&
        new Set(resultat.resultats.map((gare) => gare.recupereLe)).size
    ).toBe(1);
  });

  it('n’invente ni ville, ni code pays, ni niveau de confiance', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([
        place({
          administrative_regions: [
            { id: 'admin:fr:33063', name: 'Bordeaux', zip_code: '33000' },
          ],
        }),
      ])
    );

    const resultat = await rechercher();
    const candidat =
      resultat.statut === 'ok' ? resultat.resultats[0] : undefined;

    expect(candidat && 'ville' in candidat).toBe(false);
    expect(candidat && 'codePays' in candidat).toBe(false);
    expect(candidat && 'niveau' in candidat).toBe(false);
  });

  it.each([
    ['aucun code', undefined, { systeme: 'NAVITIA', valeur: 'stop_area:SNCF:87581009' }],
    [
      'un UIC valide',
      [{ type: 'UIC', value: '87581009' }],
      { systeme: 'UIC', valeur: '87581009' },
    ],
    [
      'un UIC illisible',
      [{ type: 'UIC', value: '87-581-009' }],
      { systeme: 'NAVITIA', valeur: 'stop_area:SNCF:87581009' },
    ],
    [
      'un UIC illisible et un UIC valide',
      [
        { type: 'UIC', value: '87-581-009' },
        { type: 'uic', value: '87581009' },
      ],
      { systeme: 'UIC', valeur: '87581009' },
    ],
  ])('rend le code métier attendu avec %s', async (_libelle, codes, attendu) => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([place(codes === undefined ? {} : { codes })])
    );

    const resultat = await rechercher();

    expect(resultat.statut === 'ok' && resultat.resultats[0].code).toEqual(
      attendu
    );
  });

  it('refuse la réponse quand une gare porte des UIC contradictoires', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([
        place({
          codes: [
            { type: 'UIC', value: '87581009' },
            { type: 'UIC', value: '87581991' },
          ],
        }),
      ])
    );

    expect((await rechercher()).statut).toBe('indisponible');
  });
});

describe('rechercherGaresNavitia — résultats vides', () => {
  it.each([
    ['aucun place', []],
    [
      'uniquement des régions administratives',
      [{ embedded_type: 'administrative_region', id: 'admin:fr:33063' }],
    ],
    [
      'uniquement des arrêts',
      [{ embedded_type: 'stop_point', id: 'stop_point:SNCF:87581009' }],
    ],
    [
      'uniquement des adresses et points d’intérêt',
      [
        { embedded_type: 'address', id: 'addr:1' },
        { embedded_type: 'poi', id: 'poi:1' },
      ],
    ],
  ])('rend vide avec %s', async (_libelle, places) => {
    requeteFetch.mockResolvedValue(reponsePlaces(places));

    const resultat = await rechercher();

    expect(resultat.statut).toBe('vide');
    expect(resultat.statut === 'vide' && resultat.resultats).toEqual([]);
  });

  it('ignore les objets hors cible sans perdre la gare trouvée', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([
        { embedded_type: 'administrative_region', id: 'admin:fr:33063' },
        place(),
        { embedded_type: 'poi', id: 'poi:1' },
      ])
    );

    const resultat = await rechercher();

    expect(resultat.statut === 'ok' && resultat.resultats).toHaveLength(1);
  });
});

describe('rechercherGaresNavitia — déduplication par identité fournisseur', () => {
  it('fusionne deux entrées de même identifiant externe', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place(), place()]));

    const resultat = await rechercher();

    expect(resultat.statut === 'ok' && resultat.resultats).toHaveLength(1);
  });

  it('ne fusionne jamais deux identifiants distincts de même nom', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([
        place(),
        place({ id: 'stop_area:OTHER:87581009' }),
      ])
    );

    const resultat = await rechercher();

    expect(resultat.statut === 'ok' && resultat.resultats).toHaveLength(2);
  });

  it('ne fusionne jamais deux gares proches de noms différents', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([
        place(),
        place({
          id: 'stop_area:SNCF:87581991',
          name: 'Bordeaux Bègles',
          coord: { lat: '44.825874', lon: '-0.556348' },
        }),
      ])
    );

    const resultat = await rechercher();

    expect(resultat.statut === 'ok' && resultat.resultats).toHaveLength(2);
  });
});

describe('evaluerResolutionGareNavitia', () => {
  it('rend unique pour une seule gare compatible', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    const resolution = evaluerResolutionGareNavitia(await rechercher());

    expect(resolution.statut).toBe('unique');
    expect(
      resolution.statut === 'unique' && resolution.candidat.identifiantExterne
    ).toBe('stop_area:SNCF:87581009');
  });

  it('rend ambigu sans choisir pour l’utilisateur', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([
        place(),
        place({ id: 'stop_area:SNCF:87581991', name: 'Bordeaux Bègles' }),
      ])
    );

    const resolution = evaluerResolutionGareNavitia(await rechercher());

    expect(resolution.statut).toBe('ambigu');
    expect(resolution.statut === 'ambigu' && resolution.candidats).toHaveLength(
      2
    );
  });

  it('rend vide sans transformer une panne en absence', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([]));

    expect(evaluerResolutionGareNavitia(await rechercher())).toEqual({
      statut: 'vide',
      recupereLe: DATE_CONTROLE,
    });
  });

  it('rend indisponible pour une panne fournisseur', async () => {
    requeteFetch.mockResolvedValue(reponseJson({}, 500));

    expect(evaluerResolutionGareNavitia(await rechercher())).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison: 'fournisseur',
    });
  });
});

describe('rechercherGaresNavitia — cache', () => {
  it('ne rappelle pas Navitia pour une recherche identique', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher();
    await rechercher();

    expect(requeteFetch).toHaveBeenCalledTimes(1);
  });

  it('normalise la casse et les espaces de la clé de cache', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher({ requete: 'Bordeaux Saint-Jean' });
    await rechercher({ requete: '  bordeaux   saint-jean  ' });

    expect(requeteFetch).toHaveBeenCalledTimes(1);
  });

  it('envoie la requête telle qu’elle a été saisie', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher({ requete: 'Bordeaux SAINT-Jean' });

    expect(derniereUrl().searchParams.get('q')).toBe('Bordeaux SAINT-Jean');
  });

  it('ne mélange jamais deux couvertures', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher({ requete: 'Gare de Lyon', couverture: 'fr-idf' });
    await rechercher({ requete: 'Gare de Lyon', couverture: 'fr-se' });

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('ne mélange jamais deux requêtes distinctes', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher({ requete: 'Bordeaux Saint-Jean' });
    await rechercher({ requete: 'Paris Montparnasse' });

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('mémorise un résultat ambigu', async () => {
    requeteFetch.mockResolvedValue(
      reponsePlaces([
        place(),
        place({ id: 'stop_area:SNCF:87581991', name: 'Bordeaux Bègles' }),
      ])
    );

    await rechercher();
    await rechercher();

    expect(requeteFetch).toHaveBeenCalledTimes(1);
  });

  it('garde un résultat vide moins longtemps qu’un résultat positif', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([]));

    await rechercher();
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1_000));
    await rechercher();

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('conserve un résultat positif au-delà du délai des résultats vides', async () => {
    requeteFetch.mockResolvedValue(reponsePlaces([place()]));

    await rechercher();
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1_000));
    await rechercher();

    expect(requeteFetch).toHaveBeenCalledTimes(1);
  });

  it('ne mémorise jamais une indisponibilité', async () => {
    requeteFetch.mockResolvedValue(reponseJson({}, 503));

    await rechercher();
    await rechercher();

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });
});
