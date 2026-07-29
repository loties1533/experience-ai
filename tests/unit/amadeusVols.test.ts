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
  CandidatTrajetExterneSchema,
  CandidatVolAerienSchema,
  DateHeureLocaleVolSchema,
  DateHeureTransportObserveeSchema,
  DureeVolFournisseurSchema,
  NOMBRE_RESULTATS_VOLS_PAR_DEFAUT,
  RechercheVolAerienSchema,
  SegmentTransportExterneSchema,
  SOURCE_LIEUX_AMADEUS,
  SOURCE_VOLS_AMADEUS,
  type CandidatLieuAerien,
} from '../../server/domaine/transport/index.js';
import { viderCacheMemoire } from '../../server/lib/cacheMemoire.js';
import {
  rechercherVolsAeriens,
  RechercheVolAerienInvalide,
} from '../../server/services/amadeus/index.js';
import { reinitialiserAuthentificationAmadeusPourTests } from '../../server/services/amadeus/auth.js';

const requeteFetch = vi.fn();
const cleInitiale = process.env.AMADEUS_API_KEY;
const secretInitial = process.env.AMADEUS_API_SECRET;
const DATE_CONTROLE = '2026-07-29T15:00:00.000Z';
const DATE_DEPART = '2026-09-10';

function reponseJson(contenu: unknown, statut = 200): Response {
  return new Response(JSON.stringify(contenu), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}

function reponseJeton(jeton = 'jeton-amadeus-vols'): Response {
  return reponseJson({
    token_type: 'Bearer',
    access_token: jeton,
    expires_in: 7_200,
  });
}

function lieuAerien(
  codeIata: string,
  identifiantExterne: string,
  complement: Partial<CandidatLieuAerien> = {}
): CandidatLieuAerien {
  return {
    type: 'aeroport',
    identifiantExterne,
    nom: `AEROPORT ${codeIata}`,
    ville: `VILLE ${codeIata}`,
    codePays: 'FR',
    codeIata,
    fournisseur: 'Amadeus',
    source: SOURCE_LIEUX_AMADEUS,
    recupereLe: DATE_CONTROLE,
    ...complement,
  };
}

const ORIGINE = lieuAerien('AAA', 'A-AAA');
const DESTINATION = lieuAerien('BBB', 'A-BBB');

function demandeVol(
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    origine: ORIGINE,
    destination: DESTINATION,
    dateDepart: DATE_DEPART,
    occupation: {
      statut: 'declaree',
      adultes: 1,
      enfants: 0,
    },
    correspondances: 'acceptees',
    maximumResultats: 10,
    ...complement,
  };
}

function segmentVol(
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'segment-1',
    departure: {
      iataCode: 'AAA',
      terminal: '1',
      at: `${DATE_DEPART}T08:00:00`,
    },
    arrival: {
      iataCode: 'BBB',
      terminal: '2',
      at: `${DATE_DEPART}T10:00:00`,
    },
    carrierCode: 'AB',
    number: '123',
    operating: { carrierCode: 'CD' },
    aircraft: { code: '320' },
    duration: 'PT2H',
    numberOfStops: 0,
    ...complement,
  };
}

function offreVol(
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'flight-offer',
    id: 'offre-1',
    source: 'GDS',
    itineraries: [
      {
        duration: 'PT2H',
        segments: [segmentVol()],
      },
    ],
    price: {
      currency: 'EUR',
      total: '999.99',
      grandTotal: '1009.99',
    },
    travelerPricings: [
      {
        travelerId: '1',
        fareDetailsBySegment: [
          {
            segmentId: 'segment-1',
            includedCheckedBags: { quantity: 1 },
          },
        ],
      },
    ],
    lastTicketingDate: '2026-08-01',
    numberOfBookableSeats: 7,
    pricingOptions: {
      fareType: ['PUBLISHED'],
      includedCheckedBagsOnly: true,
    },
    validatingAirlineCodes: ['AB'],
    ...complement,
  };
}

function reponseVols(
  data: unknown[] = [offreVol()],
  complement: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    data,
    dictionaries: {
      carriers: {
        AB: 'Air Marketing',
        CD: 'Air Operating',
      },
      currencies: { EUR: 'EURO' },
    },
    ...complement,
  };
}

function preparerRecherche(
  contenu: unknown,
  statut = 200,
  jeton = 'jeton-amadeus-vols'
): void {
  requeteFetch
    .mockResolvedValueOnce(reponseJeton(jeton))
    .mockResolvedValueOnce(reponseJson(contenu, statut));
}

beforeEach(() => {
  process.env.AMADEUS_API_KEY = 'cle-amadeus-vols';
  process.env.AMADEUS_API_SECRET = 'secret-amadeus-vols';
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

describe('RechercheVolAerienSchema — frontière interne stricte', () => {
  it('accepte deux aéroports IATA et applique un maximum prudent', () => {
    const resultat = RechercheVolAerienSchema.parse(
      demandeVol({ maximumResultats: undefined })
    );
    expect(resultat.maximumResultats).toBe(
      NOMBRE_RESULTATS_VOLS_PAR_DEFAUT
    );
  });

  it('accepte une identité ville IATA explicitement sélectionnée', () => {
    expect(
      RechercheVolAerienSchema.safeParse(
        demandeVol({
          origine: { ...ORIGINE, type: 'ville', codeIata: 'PAR' },
        })
      ).success
    ).toBe(true);
  });

  it.each([
    ['origine sans IATA', { origine: { ...ORIGINE, codeIata: undefined } }],
    [
      'destination sans IATA',
      { destination: { ...DESTINATION, codeIata: undefined } },
    ],
    ['même IATA', { destination: { ...DESTINATION, codeIata: 'AAA' } }],
    [
      'même identité',
      {
        destination: {
          ...DESTINATION,
          identifiantExterne: ORIGINE.identifiantExterne,
        },
      },
    ],
    ['date impossible', { dateDepart: '2026-02-30' }],
    ['adultes absents', { occupation: { statut: 'declaree', enfants: 0 } }],
    [
      'adultes à zéro',
      {
        occupation: { statut: 'declaree', adultes: 0, enfants: 0 },
      },
    ],
    [
      'enfants absents',
      { occupation: { statut: 'declaree', adultes: 1 } },
    ],
    [
      'trop de voyageurs',
      {
        occupation: { statut: 'declaree', adultes: 6, enfants: 4 },
      },
    ],
    ['occupation à confirmer', { occupation: { statut: 'a_confirmer' } }],
    ['correspondances absentes', { correspondances: undefined }],
    ['correspondances inconnues', { correspondances: 'les_plus_courtes' }],
    ['devise minuscule', { devise: 'eur' }],
    ['devise trop longue', { devise: 'EURO' }],
    ['maximum nul', { maximumResultats: 0 }],
    ['maximum trop grand', { maximumResultats: 21 }],
    ['maximum décimal', { maximumResultats: 2.5 }],
    ['champ inconnu', { tri: 'prix' }],
    ['URL injectée', { url: 'https://evil.test' }],
    ['retour injecté', { returnDate: '2026-09-20' }],
    ['paramètre fournisseur injecté', { maxPrice: 10 }],
    ['classe injectée', { classe: 'BUSINESS' }],
    ['bagage injecté', { bagage: true }],
    ['compagnie injectée', { codeCompagnie: 'AB' }],
    ['lieu libre injecté', { origine: 'Paris' }],
  ])('refuse %s', (_libelle, complement) => {
    expect(
      RechercheVolAerienSchema.safeParse(
        demandeVol(complement as Record<string, unknown>)
      ).success
    ).toBe(false);
  });

  it('conserve enfants zéro uniquement lorsqu’il est déclaré', () => {
    expect(RechercheVolAerienSchema.parse(demandeVol()).occupation).toEqual({
      statut: 'declaree',
      adultes: 1,
      enfants: 0,
    });
  });

  it('accepte exactement neuf voyageurs assis', () => {
    expect(
      RechercheVolAerienSchema.safeParse(
        demandeVol({
          occupation: {
            statut: 'declaree',
            adultes: 5,
            enfants: 4,
          },
        })
      ).success
    ).toBe(true);
  });

  it('échoue avant tout réseau lorsque la recherche est invalide', async () => {
    await expect(
      rechercherVolsAeriens(demandeVol({ dateDepart: '2026-02-30' }))
    ).rejects.toBeInstanceOf(RechercheVolAerienInvalide);
    expect(requeteFetch).not.toHaveBeenCalled();
  });
});

describe('Flight Offers Search — requête GET fermée', () => {
  it('envoie uniquement les paramètres autorisés au chemin fixe', async () => {
    preparerRecherche(reponseVols([]));

    await rechercherVolsAeriens(
      demandeVol({
        devise: 'EUR',
        correspondances: 'direct_uniquement',
        maximumResultats: 7,
      })
    );

    const [url, options] = requeteFetch.mock.calls[1] as [URL, RequestInit];
    expect(url.origin).toBe('https://test.api.amadeus.com');
    expect(url.pathname).toBe('/v2/shopping/flight-offers');
    expect([...url.searchParams.keys()].sort()).toEqual(
      [
        'originLocationCode',
        'destinationLocationCode',
        'departureDate',
        'adults',
        'children',
        'nonStop',
        'max',
        'currencyCode',
      ].sort()
    );
    for (const cle of url.searchParams.keys()) {
      expect(url.searchParams.getAll(cle)).toHaveLength(1);
    }
    expect(Object.fromEntries(url.searchParams)).toEqual({
      originLocationCode: 'AAA',
      destinationLocationCode: 'BBB',
      departureDate: DATE_DEPART,
      adults: '1',
      children: '0',
      nonStop: 'true',
      max: '7',
      currencyCode: 'EUR',
    });
    expect(url.hash).toBe('');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
    expect(options.redirect).toBe('error');
    expect(options.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer jeton-amadeus-vols',
    });
    expect(String(url)).not.toContain('cle-amadeus-vols');
    expect(String(url)).not.toContain('secret-amadeus-vols');
  });

  it('envoie nonStop=false lorsque les correspondances sont acceptées', async () => {
    preparerRecherche(reponseVols([]));
    await rechercherVolsAeriens(demandeVol());
    const [url] = requeteFetch.mock.calls[1] as [URL, RequestInit];
    expect(url.searchParams.getAll('nonStop')).toEqual(['false']);
    expect(url.searchParams.getAll('children')).toEqual(['0']);
    expect(url.searchParams.has('currencyCode')).toBe(false);
  });
});

describe('Flight Offers Search — mapping non commercial', () => {
  it('mappe un vol direct avec provenance, segments et transporteurs', async () => {
    preparerRecherche(reponseVols());

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat).toEqual({
      statut: 'ok',
      recupereLe: DATE_CONTROLE,
      resultats: [
        {
          fournisseur: 'Amadeus',
          source: SOURCE_VOLS_AMADEUS,
          identifiantExterne: 'offre-1',
          recupereLe: DATE_CONTROLE,
          demande: {
            origineIata: 'AAA',
            destinationIata: 'BBB',
            dateDepart: DATE_DEPART,
          },
          dureeFournisseur: 'PT2H',
          segments: [
            {
              identifiantExterne: 'segment-1',
              origine: { codeIata: 'AAA', terminal: '1' },
              destination: { codeIata: 'BBB', terminal: '2' },
              departLocal: `${DATE_DEPART}T08:00:00`,
              arriveeLocale: `${DATE_DEPART}T10:00:00`,
              transporteurMarketing: {
                code: 'AB',
                nom: 'Air Marketing',
              },
              transporteurOperant: {
                code: 'CD',
                nom: 'Air Operating',
              },
              numeroVol: '123',
              appareil: { code: '320' },
              dureeFournisseur: 'PT2H',
              nombreEscales: 0,
            },
          ],
        },
      ],
    });
  });

  it('conserve une correspondance et l’ordre fournisseur des segments', async () => {
    const premier = segmentVol({
      id: 'segment-a',
      arrival: {
        iataCode: 'CCC',
        at: `${DATE_DEPART}T09:00:00`,
      },
      duration: 'PT1H',
    });
    const second = segmentVol({
      id: 'segment-b',
      departure: {
        iataCode: 'CCC',
        at: `${DATE_DEPART}T11:00:00`,
      },
      number: '456',
      duration: 'PT1H30M',
    });
    preparerRecherche(
      reponseVols([
        offreVol({
          itineraries: [
            {
              duration: 'PT4H30M',
              segments: [premier, second],
            },
          ],
        }),
      ])
    );

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(
      resultat.resultats[0].segments.map(
        (segment) => segment.identifiantExterne
      )
    ).toEqual(['segment-a', 'segment-b']);
  });

  it('conserve l’ordre des offres sans choisir ni trier par prix', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({
          id: 'offre-chere',
          price: { total: '900.00' },
        }),
        offreVol({
          id: 'offre-bon-marche',
          price: { total: '10.00' },
          itineraries: [
            {
              duration: 'PT1H',
              segments: [
                segmentVol({ id: 'segment-2', number: '456' }),
              ],
            },
          ],
        }),
      ])
    );

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(
      resultat.resultats.map((candidat) => candidat.identifiantExterne)
    ).toEqual(['offre-chere', 'offre-bon-marche']);
  });

  it('ignore tous les champs commerciaux de l’offre', async () => {
    preparerRecherche(reponseVols());

    const resultat = await rechercherVolsAeriens(demandeVol());
    const serie = JSON.stringify(resultat);

    for (const champ of [
      'price',
      'travelerPricings',
      'fareDetailsBySegment',
      'includedCheckedBags',
      'lastTicketingDate',
      'numberOfBookableSeats',
      'pricingOptions',
      'validatingAirlineCodes',
      '999.99',
    ]) {
      expect(serie).not.toContain(champ);
    }
    expect(serie).not.toContain('disponibil');
    expect(serie).not.toContain('reservation');
  });

  it('n’invente aucun nom absent du dictionnaire', async () => {
    preparerRecherche(
      reponseVols([offreVol()], { dictionaries: undefined })
    );

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(
      resultat.resultats[0].segments[0].transporteurMarketing
    ).toEqual({ code: 'AB' });
    expect(
      resultat.resultats[0].segments[0].transporteurOperant
    ).toEqual({ code: 'CD' });
  });

  it('distingue marketing et opérant même lorsqu’ils sont identiques', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({
          itineraries: [
            {
              segments: [
                segmentVol({ operating: { carrierCode: 'AB' } }),
              ],
            },
          ],
        }),
      ])
    );

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(
      resultat.resultats[0].segments[0].transporteurMarketing.code
    ).toBe('AB');
    expect(
      resultat.resultats[0].segments[0].transporteurOperant?.code
    ).toBe('AB');
  });

  it('accepte un transporteur marketing sans opérant', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({
          itineraries: [
            {
              segments: [segmentVol({ operating: undefined })],
            },
          ],
        }),
      ])
    );

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(
      resultat.resultats[0].segments[0]
    ).not.toHaveProperty('transporteurOperant');
  });
});

describe('Horaires locaux — aucune promotion en instant observé', () => {
  it('accepte une date-heure locale réelle sans la modifier', () => {
    expect(
      DateHeureLocaleVolSchema.parse('2026-09-10T08:05:09')
    ).toBe('2026-09-10T08:05:09');
  });

  it.each([
    '2026-02-30T08:00:00',
    '2026-09-10',
    '2026-09-10T24:00:00',
    '2026-09-10T08:60:00',
    '2026-09-10T08:00:60',
    '2026-09-10T08:00:00Z',
    '2026-09-10T08:00:00+02:00',
  ])('refuse la date-heure locale invalide ou enrichie %s', (valeur) => {
    expect(DateHeureLocaleVolSchema.safeParse(valeur).success).toBe(false);
  });

  it('ne fabrique ni Z, ni offset, ni fuseau IANA', async () => {
    preparerRecherche(reponseVols());

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    const segment = resultat.resultats[0].segments[0];
    expect(segment.departLocal).toBe(`${DATE_DEPART}T08:00:00`);
    expect(segment.arriveeLocale).toBe(`${DATE_DEPART}T10:00:00`);
    expect(segment).not.toHaveProperty('fuseauIana');
    expect(segment).not.toHaveProperty('depart');
    expect(segment).not.toHaveProperty('arrivee');
    expect(
      DateHeureTransportObserveeSchema.safeParse({
        horodatage: segment.departLocal,
        fuseauIana: 'Europe/Paris',
      }).success
    ).toBe(false);
    expect(SegmentTransportExterneSchema.safeParse(segment).success).toBe(
      false
    );
    expect(
      CandidatTrajetExterneSchema.safeParse(resultat.resultats[0]).success
    ).toBe(false);
  });

  it('ne compare pas deux heures locales comme des instants absolus', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({
          itineraries: [
            {
              duration: 'PT6H',
              segments: [
                segmentVol({
                  departure: {
                    iataCode: 'AAA',
                    at: `${DATE_DEPART}T23:00:00`,
                  },
                  arrival: {
                    iataCode: 'BBB',
                    at: `${DATE_DEPART}T05:00:00`,
                  },
                  duration: 'PT6H',
                }),
              ],
            },
          ],
        }),
      ])
    );

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat).toMatchObject({ statut: 'ok' });
  });
});

describe('Durées fournisseur — format ISO 8601 positif', () => {
  it.each(['PT1M', 'PT2H5M', 'P1DT2H'])(
    'accepte la durée positive %s sans la convertir',
    (valeur) => {
      expect(DureeVolFournisseurSchema.parse(valeur)).toBe(valeur);
    }
  );

  it.each([
    'PT0S',
    'PT0M',
    'PT0H',
    'P0D',
    '',
    '-PT1H',
    'deux heures',
  ])('refuse la durée nulle ou invalide %s', (valeur) => {
    expect(DureeVolFournisseurSchema.safeParse(valeur).success).toBe(
      false
    );
  });
});

describe('Flight Offers Search — validation fournisseur', () => {
  it('rend vide uniquement pour un tableau data réellement vide', async () => {
    preparerRecherche(reponseVols([]));
    await expect(rechercherVolsAeriens(demandeVol())).resolves.toEqual({
      statut: 'vide',
      resultats: [],
      recupereLe: DATE_CONTROLE,
    });
  });

  it.each([
    ['data absent', {}],
    ['data objet', { data: {} }],
    ['offre sans identifiant', reponseVols([{ ...offreVol(), id: undefined }])],
    [
      'offre sans itinéraire',
      reponseVols([{ ...offreVol(), itineraries: undefined }]),
    ],
    [
      'itinéraire sans segment',
      reponseVols([
        offreVol({ itineraries: [{ duration: 'PT2H', segments: [] }] }),
      ]),
    ],
    [
      'segment sans identifiant',
      reponseVols([
        offreVol({
          itineraries: [
            { segments: [segmentVol({ id: undefined })] },
          ],
        }),
      ]),
    ],
    [
      'départ absent',
      reponseVols([
        offreVol({
          itineraries: [
            { segments: [segmentVol({ departure: undefined })] },
          ],
        }),
      ]),
    ],
    [
      'arrivée absente',
      reponseVols([
        offreVol({
          itineraries: [
            { segments: [segmentVol({ arrival: undefined })] },
          ],
        }),
      ]),
    ],
    [
      'code IATA invalide',
      reponseVols([
        offreVol({
          itineraries: [
            {
              segments: [
                segmentVol({
                  departure: {
                    iataCode: 'aa',
                    at: `${DATE_DEPART}T08:00:00`,
                  },
                }),
              ],
            },
          ],
        }),
      ]),
    ],
    [
      'transporteur invalide',
      reponseVols([
        offreVol({
          itineraries: [
            { segments: [segmentVol({ carrierCode: 'AIR' })] },
          ],
        }),
      ]),
    ],
    [
      'numéro absent',
      reponseVols([
        offreVol({
          itineraries: [
            { segments: [segmentVol({ number: undefined })] },
          ],
        }),
      ]),
    ],
    [
      'numéro invalide',
      reponseVols([
        offreVol({
          itineraries: [{ segments: [segmentVol({ number: '12 3' })] }],
        }),
      ]),
    ],
    [
      'date locale impossible',
      reponseVols([
        offreVol({
          itineraries: [
            {
              segments: [
                segmentVol({
                  departure: {
                    iataCode: 'AAA',
                    at: '2026-02-30T08:00:00',
                  },
                }),
              ],
            },
          ],
        }),
      ]),
    ],
    [
      'durée invalide',
      reponseVols([
        offreVol({
          itineraries: [
            {
              duration: 'deux heures',
              segments: [segmentVol()],
            },
          ],
        }),
      ]),
    ],
    [
      'durée d’itinéraire nulle',
      reponseVols([
        offreVol({
          itineraries: [
            {
              duration: 'PT0S',
              segments: [segmentVol()],
            },
          ],
        }),
      ]),
    ],
    [
      'durée de segment nulle',
      reponseVols([
        offreVol({
          itineraries: [
            {
              duration: 'PT2H',
              segments: [segmentVol({ duration: 'P0D' })],
            },
          ],
        }),
      ]),
    ],
    [
      'plus de résultats que demandé',
      reponseVols(
        Array.from({ length: 11 }, (_, index) =>
          offreVol({
            id: `offre-${index}`,
            itineraries: [
              {
                segments: [
                  segmentVol({ id: `segment-${index}` }),
                ],
              },
            ],
          })
        )
      ),
    ],
  ])('classe %s en réponse invalide, jamais vide', async (_libelle, contenu) => {
    preparerRecherche(contenu);
    await expect(rechercherVolsAeriens(demandeVol())).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'reponse_invalide',
    });
  });

  it('refuse une réponse dont le corps dépasse la borne du client', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(
        new Response(`{"data":[],"tropLong":"${'x'.repeat(1_000_001)}"}`, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'reponse_invalide',
    });
  });
});

describe('Flight Offers Search — compatibilité demande/résultat', () => {
  it.each([
    [
      'mauvaise origine',
      {
        departure: {
          iataCode: 'CCC',
          at: `${DATE_DEPART}T08:00:00`,
        },
      },
    ],
    [
      'mauvaise destination',
      {
        arrival: {
          iataCode: 'CCC',
          at: `${DATE_DEPART}T10:00:00`,
        },
      },
    ],
    [
      'mauvaise date',
      {
        departure: {
          iataCode: 'AAA',
          at: '2026-09-11T08:00:00',
        },
      },
    ],
  ])('filtre une offre avec %s', async (_libelle, complementSegment) => {
    preparerRecherche(
      reponseVols([
        offreVol({
          itineraries: [
            { segments: [segmentVol(complementSegment)] },
          ],
        }),
      ])
    );

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toEqual({
      statut: 'vide',
      resultats: [],
      recupereLe: DATE_CONTROLE,
    });
  });

  it('refuse une rupture de correspondance comme réponse contradictoire', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({
          itineraries: [
            {
              segments: [
                segmentVol({
                  id: 's1',
                  arrival: {
                    iataCode: 'CCC',
                    at: `${DATE_DEPART}T09:00:00`,
                  },
                }),
                segmentVol({
                  id: 's2',
                  departure: {
                    iataCode: 'DDD',
                    at: `${DATE_DEPART}T11:00:00`,
                  },
                }),
              ],
            },
          ],
        }),
      ])
    );

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toMatchObject({
      statut: 'indisponible',
      raison: 'reponse_invalide',
    });
  });

  it('refuse deux segments portant le même identifiant', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({
          itineraries: [
            {
              segments: [
                segmentVol({
                  arrival: {
                    iataCode: 'CCC',
                    at: `${DATE_DEPART}T09:00:00`,
                  },
                }),
                segmentVol({
                  departure: {
                    iataCode: 'CCC',
                    at: `${DATE_DEPART}T11:00:00`,
                  },
                }),
              ],
            },
          ],
        }),
      ])
    );

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toMatchObject({
      statut: 'indisponible',
      raison: 'reponse_invalide',
    });
  });

  it('filtre une correspondance lorsque direct uniquement est demandé', async () => {
    const segments = [
      segmentVol({
        id: 's1',
        arrival: {
          iataCode: 'CCC',
          at: `${DATE_DEPART}T09:00:00`,
        },
      }),
      segmentVol({
        id: 's2',
        departure: {
          iataCode: 'CCC',
          at: `${DATE_DEPART}T11:00:00`,
        },
      }),
    ];
    preparerRecherche(
      reponseVols([offreVol({ itineraries: [{ segments }] })])
    );

    await expect(
      rechercherVolsAeriens(
        demandeVol({ correspondances: 'direct_uniquement' })
      )
    ).resolves.toMatchObject({ statut: 'vide' });
  });

  it('filtre un segment direct contenant une escale technique', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({
          itineraries: [
            { segments: [segmentVol({ numberOfStops: 1 })] },
          ],
        }),
      ])
    );

    await expect(
      rechercherVolsAeriens(
        demandeVol({ correspondances: 'direct_uniquement' })
      )
    ).resolves.toMatchObject({ statut: 'vide' });
  });

  it('filtre un itinéraire retour inattendu sans comparer les horaires', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({
          itineraries: [
            { segments: [segmentVol()] },
            {
              segments: [
                segmentVol({
                  id: 'retour',
                  departure: {
                    iataCode: 'BBB',
                    at: '2026-09-20T08:00:00',
                  },
                  arrival: {
                    iataCode: 'AAA',
                    at: '2026-09-20T10:00:00',
                  },
                }),
              ],
            },
          ],
        }),
      ])
    );

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toMatchObject({
      statut: 'vide',
    });
  });
});

describe('Flight Offers Search — déduplication conservatrice', () => {
  it('garde une seule occurrence d’une offre identique répétée', async () => {
    preparerRecherche(reponseVols([offreVol(), offreVol()]));

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(resultat.resultats).toHaveLength(1);
  });

  it('refuse un même identifiant avec un contenu contradictoire', async () => {
    preparerRecherche(
      reponseVols([
        offreVol(),
        offreVol({
          itineraries: [
            {
              segments: [
                segmentVol({ id: 'segment-2', number: '456' }),
              ],
            },
          ],
        }),
      ])
    );

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison: 'reponse_invalide',
    });
  });

  it('ne fusionne pas deux offres différentes partageant les mêmes segments', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({ id: 'offre-a' }),
        offreVol({ id: 'offre-b' }),
      ])
    );

    const resultat = await rechercherVolsAeriens(demandeVol());

    expect(resultat.statut).toBe('ok');
    if (resultat.statut !== 'ok') throw new Error('résultat attendu');
    expect(
      resultat.resultats.map((candidat) => candidat.identifiantExterne)
    ).toEqual(['offre-a', 'offre-b']);
  });
});

describe('Flight Offers Search — indisponibilités techniques', () => {
  it('rend la configuration absente sans appel réseau', async () => {
    delete process.env.AMADEUS_API_KEY;

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toEqual({
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
  ] as const)('normalise HTTP %s en %s', async (statut, raison) => {
    preparerRecherche(
      {
        errors: [{ detail: 'corps fournisseur confidentiel' }],
      },
      statut
    );

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toEqual({
      statut: 'indisponible',
      fournisseur: 'Amadeus',
      raison,
    });
  });

  it('distingue un timeout', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockRejectedValueOnce(
        new DOMException('délai dépassé', 'TimeoutError')
      );

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toMatchObject({
      statut: 'indisponible',
      raison: 'timeout',
    });
  });

  it('distingue une panne réseau', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toMatchObject({
      statut: 'indisponible',
      raison: 'reseau',
    });
  });

  it('classe un JSON illisible en réponse invalide', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(
        new Response('{invalide', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    await expect(rechercherVolsAeriens(demandeVol())).resolves.toMatchObject({
      statut: 'indisponible',
      raison: 'reponse_invalide',
    });
  });
});

describe('Flight Offers Search — cache volatil', () => {
  it('conserve un succès trois minutes avec son recupereLe initial', async () => {
    preparerRecherche(reponseVols());

    const premier = await rechercherVolsAeriens(demandeVol());
    vi.setSystemTime(new Date('2026-07-29T15:02:59.000Z'));
    const second = await rechercherVolsAeriens(demandeVol());

    expect(second).toEqual(premier);
    expect(second).toMatchObject({ recupereLe: DATE_CONTROLE });
    expect(requeteFetch).toHaveBeenCalledTimes(2);
  });

  it('expire un succès après trois minutes', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(reponseJson(reponseVols()))
      .mockResolvedValueOnce(
        reponseJson(
          reponseVols([
            offreVol({
              id: 'offre-actualisee',
              itineraries: [
                {
                  segments: [
                    segmentVol({ id: 'segment-actualise' }),
                  ],
                },
              ],
            }),
          ])
        )
      );

    await rechercherVolsAeriens(demandeVol());
    vi.setSystemTime(new Date('2026-07-29T15:03:00.001Z'));
    const second = await rechercherVolsAeriens(demandeVol());

    expect(second).toMatchObject({
      statut: 'ok',
      resultats: [{ identifiantExterne: 'offre-actualisee' }],
    });
    expect(requeteFetch).toHaveBeenCalledTimes(3);
  });

  it('conserve une vraie recherche vide une minute seulement', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(reponseJson(reponseVols([])))
      .mockResolvedValueOnce(reponseJson(reponseVols([])));

    const premier = await rechercherVolsAeriens(demandeVol());
    vi.setSystemTime(new Date('2026-07-29T15:00:59.000Z'));
    const encoreEnCache = await rechercherVolsAeriens(demandeVol());
    expect(encoreEnCache).toBe(premier);
    expect(requeteFetch).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date('2026-07-29T15:01:00.001Z'));
    await rechercherVolsAeriens(demandeVol());
    expect(requeteFetch).toHaveBeenCalledTimes(3);
  });

  it('ne conserve jamais une indisponibilité', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(reponseJson({ errors: [] }, 500))
      .mockResolvedValueOnce(reponseJson(reponseVols([])));

    const premier = await rechercherVolsAeriens(demandeVol());
    const second = await rechercherVolsAeriens(demandeVol());

    expect(premier).toMatchObject({ statut: 'indisponible' });
    expect(second).toMatchObject({ statut: 'vide' });
    expect(requeteFetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['origine', { origine: lieuAerien('AAC', 'A-AAC') }],
    ['destination', { destination: lieuAerien('BBC', 'A-BBC') }],
    ['date', { dateDepart: '2026-09-11' }],
    [
      'adultes',
      { occupation: { statut: 'declaree', adultes: 2, enfants: 0 } },
    ],
    [
      'enfants',
      { occupation: { statut: 'declaree', adultes: 1, enfants: 1 } },
    ],
    ['correspondances', { correspondances: 'direct_uniquement' }],
    ['devise', { devise: 'EUR' }],
    ['maximum', { maximumResultats: 9 }],
  ])('différencie la clé selon %s', async (_libelle, complement) => {
    requeteFetch.mockImplementation(async (entree: URL | string) => {
      const url = new URL(String(entree));
      if (url.pathname.endsWith('/oauth2/token')) return reponseJeton();
      return reponseJson(reponseVols([]));
    });

    await rechercherVolsAeriens(demandeVol());
    await rechercherVolsAeriens(demandeVol(complement));

    expect(requeteFetch).toHaveBeenCalledTimes(3);
  });

  it('mutualise deux recherches identiques concurrentes', async () => {
    requeteFetch
      .mockResolvedValueOnce(reponseJeton())
      .mockResolvedValueOnce(reponseJson(reponseVols([])));

    const premiere = rechercherVolsAeriens(demandeVol());
    const seconde = rechercherVolsAeriens(demandeVol());

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
});

describe('Flight Offers Search — confidentialité et absence d’effet actif', () => {
  it('ne renvoie jamais clé, secret, jeton, URL fournisseur libre ou erreur brute', async () => {
    preparerRecherche(
      reponseVols([
        offreVol({
          self: 'https://evil.test/offre',
          erreurs: ['secret-amadeus-vols', 'jeton-amadeus-vols'],
        }),
      ]),
      200,
      'jeton-amadeus-vols'
    );

    const resultat = await rechercherVolsAeriens(demandeVol());
    const serie = JSON.stringify(resultat);

    expect(serie).not.toContain('cle-amadeus-vols');
    expect(serie).not.toContain('secret-amadeus-vols');
    expect(serie).not.toContain('jeton-amadeus-vols');
    expect(serie).not.toContain('evil.test');
    expect(serie).toContain(SOURCE_VOLS_AMADEUS);
  });

  it('ne journalise aucun secret', async () => {
    const journal = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const avertissement = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const erreur = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    preparerRecherche(reponseVols(), 200, 'jeton-amadeus-vols');

    await rechercherVolsAeriens(demandeVol());

    const sortie = JSON.stringify([
      journal.mock.calls,
      avertissement.mock.calls,
      erreur.mock.calls,
    ]);
    expect(sortie).not.toContain('cle-amadeus-vols');
    expect(sortie).not.toContain('secret-amadeus-vols');
    expect(sortie).not.toContain('jeton-amadeus-vols');
  });

  it('le candidat strict refuse prix, disponibilité, lien et réservation', () => {
    const candidat = {
      fournisseur: 'Amadeus',
      source: SOURCE_VOLS_AMADEUS,
      identifiantExterne: 'offre-1',
      recupereLe: DATE_CONTROLE,
      demande: {
        origineIata: 'AAA',
        destinationIata: 'BBB',
        dateDepart: DATE_DEPART,
      },
      segments: [
        {
          identifiantExterne: 'segment-1',
          origine: { codeIata: 'AAA' },
          destination: { codeIata: 'BBB' },
          departLocal: `${DATE_DEPART}T08:00:00`,
          arriveeLocale: `${DATE_DEPART}T10:00:00`,
          transporteurMarketing: { code: 'AB' },
          numeroVol: '123',
          nombreEscales: 0,
        },
      ],
    };
    expect(CandidatVolAerienSchema.safeParse(candidat).success).toBe(true);
    for (const complement of [
      { prix: 100 },
      { disponibilite: 7 },
      { lien: 'https://example.test' },
      { reservation: { statut: 'confirmee' } },
      { billet: 'ABC' },
      { taxe: 20 },
      { tarif: 'FLEX' },
      { classe: 'BUSINESS' },
      { bagage: { quantite: 1 } },
      { nombrePlaces: 7 },
      { numberOfBookableSeats: 7 },
      { lastTicketingDate: '2026-08-01' },
      { pricingOptions: { fareType: ['PUBLISHED'] } },
      { validatingAirlineCodes: ['AB'] },
    ]) {
      expect(
        CandidatVolAerienSchema.safeParse({
          ...candidat,
          ...complement,
        }).success
      ).toBe(false);
    }
  });

  it('le candidat strict lie ses segments au résumé de la demande', () => {
    const candidat = {
      fournisseur: 'Amadeus',
      source: SOURCE_VOLS_AMADEUS,
      identifiantExterne: 'offre-1',
      recupereLe: DATE_CONTROLE,
      demande: {
        origineIata: 'AAA',
        destinationIata: 'BBB',
        dateDepart: DATE_DEPART,
      },
      segments: [
        {
          identifiantExterne: 'segment-1',
          origine: { codeIata: 'AAA' },
          destination: { codeIata: 'BBB' },
          departLocal: `${DATE_DEPART}T08:00:00`,
          arriveeLocale: `${DATE_DEPART}T10:00:00`,
          transporteurMarketing: { code: 'AB' },
          numeroVol: '123',
          nombreEscales: 0,
        },
      ],
    };
    expect(CandidatVolAerienSchema.safeParse(candidat).success).toBe(true);
    expect(
      CandidatVolAerienSchema.safeParse({
        ...candidat,
        demande: { ...candidat.demande, origineIata: 'CCC' },
      }).success
    ).toBe(false);
    expect(
      CandidatVolAerienSchema.safeParse({
        ...candidat,
        demande: { ...candidat.demande, destinationIata: 'CCC' },
      }).success
    ).toBe(false);
    expect(
      CandidatVolAerienSchema.safeParse({
        ...candidat,
        demande: { ...candidat.demande, dateDepart: '2026-09-11' },
      }).success
    ).toBe(false);
  });
});
