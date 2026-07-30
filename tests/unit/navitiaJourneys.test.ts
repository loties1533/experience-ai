import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viderCacheMemoire } from '../../server/lib/cacheMemoire.js';
import {
  rechercherTrajetsFerroviairesNavitia,
  RechercheTrajetsNavitiaInvalide,
  type ResultatRechercheTrajetsNavitia,
} from '../../server/services/navitia/index.js';

const requeteFetch = vi.fn();
const jetonInitial = process.env.NAVITIA_API_TOKEN;
const JETON = 'jeton-navitia-test';
const DATE_CONTROLE = '2026-07-30T09:15:00.000Z';

function gare(
  identifiantExterne: string,
  nom: string
): Record<string, unknown> {
  return {
    fournisseur: 'Navitia',
    identifiantExterne,
    nom,
    coordonnees: { latitude: 44.825873, longitude: -0.556347 },
    fuseauIana: 'Europe/Paris',
    code: { systeme: 'NAVITIA', valeur: identifiantExterne },
    source: 'https://api.navitia.io/v1/places?q=gare',
    recupereLe: DATE_CONTROLE,
  };
}

const ORIGINE = gare('stop_area:SNCF:87581009', 'Bordeaux Saint-Jean');
const DESTINATION = gare('stop_area:SNCF:87686006', 'Paris Montparnasse');

function rechercheValide(
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    origine: ORIGINE,
    destination: DESTINATION,
    dateHeureLocale: '2026-08-01T08:00:00',
    ...complement,
  };
}

function reponseJson(contenu: unknown, statut = 200): Response {
  return new Response(JSON.stringify(contenu), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}

function extremite(id: string, nom: string): Record<string, unknown> {
  return {
    embedded_type: 'stop_point',
    stop_point: { stop_area: { id, name: nom, timezone: 'Europe/Paris' } },
  };
}

function sectionTrain(
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'public_transport',
    duration: 7_500,
    from: extremite('stop_area:SNCF:87581009', 'Bordeaux Saint-Jean'),
    to: extremite('stop_area:SNCF:87686006', 'Paris Montparnasse'),
    departure_date_time: '20260801T080000',
    arrival_date_time: '20260801T100500',
    display_informations: {
      network: 'SNCF',
      physical_mode: 'physical_mode:LongDistanceTrain',
      code: '8412',
    },
    ...complement,
  };
}

function journey(
  sections: unknown[] = [sectionTrain()],
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    duration: 7_800,
    nb_transfers: 0,
    departure_date_time: '20260801T080000',
    arrival_date_time: '20260801T101000',
    sections,
    ...complement,
  };
}

function reponseJourneys(journeys: unknown[]): Response {
  return reponseJson({ journeys });
}

async function rechercher(
  recherche: unknown = rechercheValide()
): Promise<ResultatRechercheTrajetsNavitia> {
  return rechercherTrajetsFerroviairesNavitia(recherche);
}

function derniereUrl(): URL {
  return new URL(String(requeteFetch.mock.calls.at(-1)?.[0]));
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

describe('rechercherTrajetsFerroviairesNavitia — requête envoyée', () => {
  it('interroge /v1/journeys avec les identifiants de gares résolues', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    await rechercher();
    const url = derniereUrl();

    expect(url.origin).toBe('https://api.navitia.io');
    expect(url.pathname).toBe('/v1/journeys');
    expect(url.searchParams.get('from')).toBe('stop_area:SNCF:87581009');
    expect(url.searchParams.get('to')).toBe('stop_area:SNCF:87686006');
    expect(url.searchParams.get('datetime')).toBe('20260801T080000');
    expect(url.searchParams.get('datetime_represents')).toBe('departure');
    expect(url.searchParams.get('data_freshness')).toBe('base_schedule');
    expect(url.searchParams.get('count')).toBe('5');
  });

  it('transmet le sens d’arrivée et la fraîcheur temps réel demandés', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    await rechercher(
      rechercheValide({ sensDate: 'arrival', fraicheur: 'realtime' })
    );
    const url = derniereUrl();

    expect(url.searchParams.get('datetime_represents')).toBe('arrival');
    expect(url.searchParams.get('data_freshness')).toBe('realtime');
  });

  it('restreint la recherche à la couverture demandée', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    await rechercher(rechercheValide({ couverture: 'fr-idf' }));

    expect(derniereUrl().pathname).toBe('/v1/coverage/fr-idf/journeys');
  });

  it('authentifie en Basic sans jamais mettre le jeton dans l’URL', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    await rechercher();
    const enTetes = requeteFetch.mock.calls.at(-1)?.[1]
      .headers as Record<string, string>;

    expect(enTetes.Authorization).toBe(
      `Basic ${Buffer.from(`${JETON}:`, 'utf8').toString('base64')}`
    );
    expect(derniereUrl().toString()).not.toContain(JETON);
  });

  it.each([
    ['une origine absente', { origine: undefined }],
    ['une destination absente', { destination: undefined }],
    ['une gare réduite à une chaîne', { origine: 'Bordeaux' }],
    ['une origine identique à la destination', { destination: ORIGINE }],
    ['une date au format compact', { dateHeureLocale: '20260801T080000' }],
    ['une date sans heure', { dateHeureLocale: '2026-08-01' }],
    ['une date inexistante', { dateHeureLocale: '2026-02-30T08:00:00' }],
    ['une date portant un décalage', { dateHeureLocale: '2026-08-01T08:00:00+02:00' }],
    ['un sens inconnu', { sensDate: 'milieu' }],
    ['une fraîcheur inconnue', { fraicheur: 'demain' }],
    ['une couverture au format interdit', { couverture: '../fr' }],
    ['un maximum hors bornes', { maximumResultats: 99 }],
    ['un champ inconnu', { region: 'fr-idf' }],
  ])('rejette %s sans appeler le réseau', async (_libelle, complement) => {
    await expect(rechercher(rechercheValide(complement))).rejects.toBeInstanceOf(
      RechercheTrajetsNavitiaInvalide
    );
    expect(requeteFetch).not.toHaveBeenCalled();
  });
});

describe('rechercherTrajetsFerroviairesNavitia — indisponibilités', () => {
  it('signale une configuration absente sans appeler le réseau', async () => {
    delete process.env.NAVITIA_API_TOKEN;

    expect(await rechercher()).toEqual({
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

    expect(await rechercher()).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison,
    });
  });

  it.each([
    ['un dépassement de délai', 'TimeoutError', 'timeout'],
    ['une interruption', 'AbortError', 'timeout'],
    ['une panne réseau', 'TypeError', 'reseau'],
  ])('traduit %s en %s', async (_libelle, nomErreur, raison) => {
    const erreur = new Error('échec de la requête');
    erreur.name = nomErreur;
    requeteFetch.mockRejectedValue(erreur);

    expect(await rechercher()).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison,
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
  ])('refuse %s', async (_libelle, reponse) => {
    requeteFetch.mockResolvedValue(reponse);

    expect(await rechercher()).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison: 'reponse_invalide',
    });
  });

  it.each([
    ['une enveloppe sans journeys ni erreur', {}],
    ['des journeys non listés', { journeys: {} }],
    ['un journey sans sections', { journeys: [{ ...journey(), sections: [] }] }],
    [
      'une date de départ illisible',
      { journeys: [{ ...journey(), departure_date_time: '2026-08-01' }] },
    ],
  ])('refuse %s', async (_libelle, contenu) => {
    requeteFetch.mockResolvedValue(reponseJson(contenu));

    expect((await rechercher()).statut).toBe('indisponible');
  });

  it('refuse toute la réponse quand un itinéraire est inconvertible', async () => {
    requeteFetch.mockResolvedValue(
      reponseJourneys([
        journey(),
        journey([
          sectionTrain({ display_informations: { network: 'SNCF' } }),
        ]),
      ])
    );

    expect(await rechercher()).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison: 'reponse_invalide',
    });
  });

  it('ne transforme jamais une erreur fournisseur en résultat vide', async () => {
    requeteFetch.mockResolvedValue(
      reponseJson({ error: { id: 'date_out_of_bounds' } })
    );

    expect(await rechercher()).toEqual({
      statut: 'indisponible',
      fournisseur: 'Navitia',
      raison: 'fournisseur',
    });
  });

  it('n’expose jamais le jeton dans le résultat d’une panne', async () => {
    requeteFetch.mockResolvedValue(reponseJson({ error: 'x' }, 401));

    expect(JSON.stringify(await rechercher())).not.toContain(JETON);
  });
});

describe('rechercherTrajetsFerroviairesNavitia — résultats vides', () => {
  it('rend vide quand le fournisseur déclare aucune solution', async () => {
    requeteFetch.mockResolvedValue(
      reponseJson({ error: { id: 'no_solution', message: 'no solution' } })
    );

    const resultat = await rechercher();

    expect(resultat.statut).toBe('vide');
    expect(resultat.statut === 'vide' && resultat.resultats).toEqual([]);
  });

  it('rend vide pour une liste de trajets vide', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([]));

    expect((await rechercher()).statut).toBe('vide');
  });

  it('rend vide quand aucun itinéraire ne comporte de train', async () => {
    requeteFetch.mockResolvedValue(
      reponseJourneys([
        journey([
          sectionTrain({
            display_informations: { physical_mode: 'physical_mode:Bus' },
          }),
        ]),
      ])
    );

    expect((await rechercher()).statut).toBe('vide');
  });
});

describe('rechercherTrajetsFerroviairesNavitia — candidats rendus', () => {
  it('rend un candidat avec sa provenance exacte et sans jeton', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    const resultat = await rechercher();

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') return;
    const candidat = resultat.resultats[0];
    expect(candidat.source).toBe(derniereUrl().toString());
    expect(candidat.source).not.toContain(JETON);
    expect(candidat.recupereLe).toBe(DATE_CONTROLE);
    expect(candidat.fraicheur).toBe('base_schedule');
    expect(candidat.departLocal).toBe('2026-08-01T08:00:00');
  });

  it('conserve l’ordre du fournisseur sans élire de meilleur trajet', async () => {
    requeteFetch.mockResolvedValue(
      reponseJourneys([
        journey([sectionTrain({ display_informations: { network: 'SNCF', physical_mode: 'physical_mode:LongDistanceTrain', code: '8412' } })]),
        journey([sectionTrain({ display_informations: { network: 'SNCF', physical_mode: 'physical_mode:LongDistanceTrain', code: '8420' } })]),
      ])
    );

    const resultat = await rechercher();

    expect(resultat.statut === 'ok' && resultat.resultats).toHaveLength(2);
    expect(
      resultat.statut === 'ok' &&
        resultat.resultats.map((trajet) =>
          trajet.sections[0].nature === 'transport_public'
            ? trajet.sections[0].codeLigne
            : undefined
        )
    ).toEqual(['8412', '8420']);
  });

  it('ignore un itinéraire hors cible sans perdre le trajet ferroviaire', async () => {
    requeteFetch.mockResolvedValue(
      reponseJourneys([
        journey([
          sectionTrain({
            display_informations: { physical_mode: 'physical_mode:Bus' },
          }),
        ]),
        journey(),
      ])
    );

    expect((await rechercher()).statut).toBe('ok');
  });

  it('date tous les candidats d’un même appel à l’identique', async () => {
    requeteFetch.mockResolvedValue(
      reponseJourneys([
        journey(),
        journey([sectionTrain({ departure_date_time: '20260801T090000' })], {
          departure_date_time: '20260801T090000',
        }),
      ])
    );

    const resultat = await rechercher();

    expect(
      resultat.statut === 'ok' &&
        new Set(resultat.resultats.map((trajet) => trajet.recupereLe)).size
    ).toBe(1);
  });

  it('déduplique deux itinéraires de même signature', async () => {
    requeteFetch.mockResolvedValue(
      reponseJourneys([journey(), journey()])
    );

    const resultat = await rechercher();

    expect(resultat.statut === 'ok' && resultat.resultats).toHaveLength(1);
  });

  it('ne porte ni prix, ni disponibilité, ni réservation', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    const resultat = await rechercher();
    const candidat =
      resultat.statut === 'ok' ? resultat.resultats[0] : undefined;

    expect(candidat && 'prix' in candidat).toBe(false);
    expect(candidat && 'disponible' in candidat).toBe(false);
    expect(candidat && 'reservation' in candidat).toBe(false);
  });
});

describe('rechercherTrajetsFerroviairesNavitia — cache', () => {
  it('ne rappelle pas Navitia pour une recherche identique', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    await rechercher();
    await rechercher();

    expect(requeteFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['une date différente', { dateHeureLocale: '2026-08-02T08:00:00' }],
    ['un sens différent', { sensDate: 'arrival' }],
    ['une fraîcheur différente', { fraicheur: 'realtime' }],
    ['une couverture différente', { couverture: 'fr-idf' }],
    ['un maximum différent', { maximumResultats: 3 }],
  ])('ne mélange jamais %s', async (_libelle, complement) => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    await rechercher();
    await rechercher(rechercheValide(complement));

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('ne mélange jamais un aller et son retour', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    await rechercher();
    await rechercher(
      rechercheValide({ origine: DESTINATION, destination: ORIGINE })
    );

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('garde un horaire théorique plus longtemps qu’un résultat vide', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));

    await rechercher();
    vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1_000));
    await rechercher();

    expect(requeteFetch).toHaveBeenCalledTimes(1);
  });

  it('réinterroge un résultat vide après son délai plus court', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([]));

    await rechercher();
    vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1_000));
    await rechercher();

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('garde le temps réel moins longtemps que l’horaire théorique', async () => {
    requeteFetch.mockResolvedValue(reponseJourneys([journey()]));
    const rechercheTempsReel = rechercheValide({ fraicheur: 'realtime' });

    await rechercher(rechercheTempsReel);
    vi.setSystemTime(new Date(Date.now() + 3 * 60 * 1_000));
    await rechercher(rechercheTempsReel);

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('ne mémorise jamais une indisponibilité', async () => {
    requeteFetch.mockResolvedValue(reponseJson({}, 503));

    await rechercher();
    await rechercher();

    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });
});
