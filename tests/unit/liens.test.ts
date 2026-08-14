import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { DemandeResolutionLien } from '../../server/services/liens/contrat.js';
import type { ChampDemandeResolutionLien } from '../../server/services/liens/selection.js';
import type {
  ResultatRechercheWeb,
  ResultatWeb,
} from '../../server/services/tools/webSearch.js';

vi.mock('../../server/services/tools/webSearch.js', () => ({
  rechercherWeb: vi.fn(),
}));
vi.mock(
  '../../server/services/liens/controleRedirections.js',
  () => ({
    controlerAccessibiliteLien: vi.fn(),
  }),
);
const { rechercherWeb } = await import(
  '../../server/services/tools/webSearch.js'
);
const { controlerAccessibiliteLien } = await import(
  '../../server/services/liens/controleRedirections.js'
);
const {
  cleDemandeResolutionLien,
  DemandeResolutionLienInvalide,
  domaineEnregistrableLien,
  estPageGenerique,
  estSourceExclue,
  extraireUrlsContexte,
  nomsCorrespondent,
  normaliserNomLien,
  resoudreLien,
  selectionnerLien,
  validerUrlReelle,
} = await import('../../server/services/liens.js');

const DATE_RECUPERATION = '2026-07-28T20:00:00.000Z';

type DemandeLieu = Extract<
  DemandeResolutionLien,
  { fournisseurMetier: 'Foursquare' }
>;
type DemandeEvenement = Extract<
  DemandeResolutionLien,
  { fournisseurMetier: 'PredictHQ' }
>;

function demandeLieu(
  changements: Partial<DemandeLieu> = {},
): DemandeLieu {
  return {
    identifiantExterne: 'fsq-point-rouge',
    nom: 'Le Point Rouge',
    villeDemandee: 'Bordeaux',
    adresseOuSalle: '12 quai de Paludate, Bordeaux',
    typeMetierRecherche: 'sortie',
    fournisseurMetier: 'Foursquare',
    sourceMetier: 'https://places-api.foursquare.com/places/search',
    ...changements,
  };
}

function demandeEvenement(
  changements: Partial<DemandeEvenement> = {},
): DemandeEvenement {
  return {
    identifiantExterne: 'phq-festival-port',
    nom: 'Festival du Port',
    villeDemandee: 'Bordeaux',
    adresseOuSalle: 'Hangar 14',
    typeMetierRecherche: 'evenement',
    dateDebut: '2026-08-10T20:00:00Z',
    dateFin: '2026-08-10T23:00:00Z',
    fournisseurMetier: 'PredictHQ',
    sourceMetier: 'https://api.predicthq.com/v1/events/',
    ...changements,
  };
}

function candidatWeb(
  changements: Partial<ResultatWeb> = {},
): ResultatWeb {
  return {
    titre: 'Le Point Rouge — bar à Bordeaux',
    url: 'https://lepointrouge.fr/etablissement/le-point-rouge',
    extrait: 'Le Point Rouge, 12 quai de Paludate, Bordeaux.',
    rang: 1,
    ...changements,
  };
}

function candidatReservation(
  changements: Partial<ResultatWeb> = {},
): ResultatWeb {
  return candidatWeb({
    titre: 'Le Point Rouge à Bordeaux — Réserver une table',
    url: 'https://www.thefork.fr/restaurant/le-point-rouge-r12345',
    extrait:
      'Réserver une table au Point Rouge, ' +
      '12 quai de Paludate, Bordeaux.',
    ...changements,
  });
}

function candidatBilletterie(
  changements: Partial<ResultatWeb> = {},
): ResultatWeb {
  return candidatWeb({
    titre: 'Billetterie Festival du Port',
    url:
      'https://www.ticketmaster.fr/fr/manifestation/' +
      'festival-du-port-billet/idmanif/12345',
    extrait:
      'Acheter des billets pour le Festival du Port, ' +
      'le 10 août 2026 au Hangar 14 à Bordeaux.',
    ...changements,
  });
}

function rechercheOk(
  ...resultats: ResultatWeb[]
): Extract<ResultatRechercheWeb, { statut: 'ok' }> {
  return {
    statut: 'ok',
    resultats,
    fournisseur: 'Tavily',
    recupereLe: DATE_RECUPERATION,
  };
}

function naturesPreuves(
  resultat: ReturnType<typeof selectionnerLien>,
): string[] {
  return resultat.statut === 'resolu'
    ? resultat.preuves.map((preuve) => preuve.nature)
    : [];
}

function attendreDemandeInvalide(
  demande: DemandeResolutionLien,
  champ: ChampDemandeResolutionLien,
): void {
  let erreurObservee: unknown;
  try {
    cleDemandeResolutionLien(demande);
  } catch (erreur) {
    erreurObservee = erreur;
  }

  expect(erreurObservee).toBeInstanceOf(
    DemandeResolutionLienInvalide,
  );
  expect(erreurObservee).toMatchObject({
    name: 'DemandeResolutionLienInvalide',
    champ,
    message: `Demande de résolution de lien invalide : ${champ} vide`,
  });
}

beforeEach(() => {
  vi.mocked(rechercherWeb).mockReset();
  vi.mocked(controlerAccessibiliteLien)
    .mockReset()
    .mockImplementation(async (urlInitiale) => ({
      statut: 'accessible',
      urlInitiale,
      urlFinale: urlInitiale,
      statutHttp: 200,
      redirections: [],
      controleLe: DATE_RECUPERATION,
    }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('compatibilité des utilitaires historiques', () => {
  it('extrait et déduplique les URLs présentes dans un contexte', () => {
    const contexte =
      'https://lepointrouge.fr/ https://lepointrouge.fr/ ' +
      'https://www.thefork.fr/restaurant/exemple';
    expect(extraireUrlsContexte(contexte)).toEqual([
      'https://lepointrouge.fr/',
      'https://www.thefork.fr/restaurant/exemple',
    ]);
  });

  it('conserve uniquement une URL réellement présente dans le contexte', () => {
    const urlsContexte = ['https://lepointrouge.fr/'];
    expect(
      validerUrlReelle('HTTP://LePointRouge.fr', urlsContexte),
    ).toBe('https://lepointrouge.fr/');
    expect(
      validerUrlReelle('https://site-invente.fr', urlsContexte),
    ).toBeNull();
  });
});

describe('normalisation et exclusions pures', () => {
  it('normalise sans perdre les mots utiles du nom', () => {
    expect(normaliserNomLien("  L’Atelier & Café Saint-Pierre  ")).toBe(
      'l atelier et cafe saint pierre',
    );
  });

  it('compare le nom par expression complète, pas par fragment arbitraire', () => {
    expect(
      nomsCorrespondent('Le Point Rouge', candidatWeb()),
    ).toBe(true);
    expect(
      nomsCorrespondent('Le Point', {
        titre: 'Le Pointeau',
        url: 'https://example.com/le-pointeau',
      }),
    ).toBe(false);
  });

  it('accepte les variantes d’accents et d’apostrophes sans retirer de mots', () => {
    expect(
      nomsCorrespondent("Café de l'Opéra", {
        titre: 'Cafe de l Opera',
        url: 'https://example.com/cafe-de-l-opera',
      }),
    ).toBe(true);
  });

  it('conserve les articles pour éviter les rapprochements trop larges', () => {
    expect(
      nomsCorrespondent('La Belle Époque', {
        titre: 'Belle Epoque',
        url: 'https://example.com/belle-epoque',
      }),
    ).toBe(false);
    expect(
      nomsCorrespondent("Musée d'Aquitaine", {
        titre: 'Musee Aquitaine Bordeaux',
        url: 'https://example.com/musee-aquitaine-bordeaux',
      }),
    ).toBe(false);
  });

  it('refuse un nom court ou générique même présent comme mot entier', () => {
    expect(
      nomsCorrespondent('Bar', {
        titre: 'Bar à Bordeaux',
        url: 'https://example.com/bar-bordeaux',
      }),
    ).toBe(false);
    expect(
      nomsCorrespondent('Café', {
        titre: 'Café à Bordeaux',
        url: 'https://example.com/cafe-bordeaux',
      }),
    ).toBe(false);
    expect(
      nomsCorrespondent('Restaurant', {
        titre: 'Restaurant à Bordeaux',
        url: 'https://example.com/restaurant-bordeaux',
      }),
    ).toBe(false);
  });

  it('reconnaît une recherche, un réseau social et un article', () => {
    expect(
      estPageGenerique(
        candidatWeb({
          url: 'https://www.google.com/search?q=le+point+rouge',
        }),
      ),
    ).toBe(true);
    expect(
      estSourceExclue(
        candidatWeb({
          url: 'https://www.instagram.com/lepointrouge/',
        }),
      ),
    ).toBe(true);
    expect(
      estSourceExclue(
        candidatWeb({
          url: 'https://www.sudouest.fr/article/le-point-rouge',
        }),
      ),
    ).toBe(true);
  });
});

describe('selectionnerLien — lieux', () => {
  it('refuse un domaine ressemblant au nom sans preuve officielle externe', () => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(candidatWeb()),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('refuse une étiquette de nom placée sous un domaine trompeur', () => {
    const resultat = selectionnerLien(
      demandeLieu({
        nom: 'Musée des Beaux-Arts',
        adresseOuSalle: '20 cours d’Albret, Bordeaux',
      }),
      rechercheOk(
        candidatWeb({
          titre: 'Musée des Beaux-Arts à Bordeaux',
          url:
            'https://museedesbeauxarts.evil.example/' +
            'musee-des-beaux-arts',
          extrait:
            'Musée des Beaux-Arts, 20 cours d’Albret, Bordeaux.',
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('refuse un homonyme situé dans une autre ville', () => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(
        candidatWeb({
          titre: 'Le Point Rouge — bar à Lyon',
          url: 'https://lepointrouge.fr/etablissement/le-point-rouge-lyon',
          extrait: 'Le Point Rouge, 8 rue de Lyon, Lyon.',
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('refuse une mauvaise succursale même si la ville est correcte', () => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(
        candidatWeb({
          url: 'https://lepointrouge.fr/etablissement/le-point-rouge-chartrons',
          extrait: 'Le Point Rouge, 99 rue Notre-Dame, Bordeaux.',
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it.each([
    [
      'un annuaire',
      'https://www.tripadvisor.fr/Restaurant_Review-le-point-rouge',
      'Le Point Rouge à Bordeaux, 12 quai de Paludate.',
    ],
    [
      'un article de presse',
      'https://www.sudouest.fr/article/le-point-rouge-bordeaux',
      'Article sur Le Point Rouge, 12 quai de Paludate, Bordeaux.',
    ],
    [
      'un réseau social',
      'https://www.facebook.com/lepointrougebordeaux/posts/123',
      'Le Point Rouge, 12 quai de Paludate, Bordeaux.',
    ],
  ])('refuse %s malgré le nom et l’adresse', (_cas, url, extrait) => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(candidatWeb({ url, extrait })),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('refuse une page de recherche', () => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(
        candidatWeb({
          url: 'https://www.thefork.fr/search?query=le+point+rouge',
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('refuse une page d’accueil générique', () => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(
        candidatWeb({
          titre: 'TheFork',
          url: 'https://www.thefork.fr/',
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('accepte une plateforme de réservation seulement sur la fiche exacte', () => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(candidatReservation()),
    );

    expect(resultat).toMatchObject({
      statut: 'resolu',
      typeLien: 'reservation',
      rang: 1,
    });
    expect(naturesPreuves(resultat)).not.toContain('domaine_officiel');
  });

  it.each([
    ['aucun signal d’action', 'Informations et tarifs.'],
    ['une réservation indisponible', 'Réservation indisponible.'],
    ['des réservations fermées', 'Réservations fermées.'],
    ['une absence de disponibilité', 'No availability.'],
    ['un établissement complet', 'Restaurant complet.'],
  ])('refuse une fiche de réservation avec %s', (_cas, action) => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(
        candidatReservation({
          titre: 'Le Point Rouge à Bordeaux',
          extrait:
            `Le Point Rouge, 12 quai de Paludate, Bordeaux. ${action}`,
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('reste ambigu quel que soit l’ordre ou le rang Tavily', () => {
    const theFork = candidatReservation({ rang: 7 });
    const openTable = candidatReservation({
      url:
        'https://www.opentable.com/r/' +
        'le-point-rouge-bordeaux',
      rang: 1,
    });

    const ordreDirect = selectionnerLien(
      demandeLieu(),
      rechercheOk(theFork, openTable),
    );
    const ordreInverse = selectionnerLien(
      demandeLieu(),
      rechercheOk(openTable, theFork),
    );

    expect(ordreDirect.statut).toBe('ambigu');
    expect(ordreInverse.statut).toBe('ambigu');
    if (
      ordreDirect.statut !== 'ambigu' ||
      ordreInverse.statut !== 'ambigu'
    ) {
      return;
    }

    expect(
      ordreDirect.candidats.map((candidat) => candidat.url).sort(),
    ).toEqual(
      ordreInverse.candidats.map((candidat) => candidat.url).sort(),
    );
    expect(ordreDirect.candidats.map((candidat) => candidat.rang)).toEqual([
      7,
      1,
    ]);
    expect(ordreInverse.candidats.map((candidat) => candidat.rang)).toEqual([
      1,
      7,
    ]);
    expect(
      ordreDirect.candidats.every(
        (candidat) => candidat.typeLienPossible === 'reservation',
      ),
    ).toBe(true);
  });

  it('retourne introuvable sans candidat admissible', () => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(
        candidatWeb({
          titre: 'Un autre établissement',
          url: 'https://autre-etablissement.example/fiche',
          extrait: 'Une adresse sans rapport à Toulouse.',
        }),
      ),
    );

    expect(resultat).toMatchObject({
      statut: 'introuvable',
      cleDemande:
        'Foursquare:fsq-point-rouge:sortie:bordeaux:le-point-rouge',
      recupereLe: DATE_RECUPERATION,
    });
  });

  it('propage une indisponibilité Tavily sans la transformer en absence', () => {
    const resultat = selectionnerLien(demandeLieu(), {
      statut: 'indisponible',
      fournisseur: 'Tavily',
      raison: 'quota',
      constateLe: DATE_RECUPERATION,
    });

    expect(resultat).toEqual({
      statut: 'indisponible',
      cleDemande:
        'Foursquare:fsq-point-rouge:sortie:bordeaux:le-point-rouge',
      fournisseurRecherche: 'Tavily',
      raison: 'quota',
      constateLe: DATE_RECUPERATION,
    });
  });
});

describe('selectionnerLien — événements', () => {
  it('refuse une page descriptive sans preuve officielle externe', () => {
    const resultat = selectionnerLien(
      demandeEvenement(),
      rechercheOk(
        candidatWeb({
          titre: 'Festival du Port — Programme 2026',
          url: 'https://festivalduport.fr/programme/festival-du-port-2026',
          extrait:
            'Festival du Port le 10 août 2026 au Hangar 14 à Bordeaux.',
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('accepte une vraie page de billetterie avec événement, salle et date', () => {
    const resultat = selectionnerLien(
      demandeEvenement(),
      rechercheOk(candidatBilletterie()),
    );

    expect(resultat).toMatchObject({
      statut: 'resolu',
      typeLien: 'billetterie',
      domaine: 'www.ticketmaster.fr',
    });
    expect(naturesPreuves(resultat)).not.toContain('domaine_officiel');
  });

  it('accepte « Réserver vos billets » comme signal avec les autres preuves', () => {
    const resultat = selectionnerLien(
      demandeEvenement(),
      rechercheOk(
        candidatBilletterie({
          titre: 'Festival du Port — Réserver vos billets',
          extrait:
            'Réserver vos billets pour le Festival du Port, ' +
            'le 10 août 2026 au Hangar 14 à Bordeaux.',
        }),
      ),
    );

    expect(resultat).toMatchObject({
      statut: 'resolu',
      typeLien: 'billetterie',
    });
  });

  it.each([
    'Billetterie fermée',
    'Aucun billet requis',
    'Vente terminée',
    'Billets indisponibles',
    'Sold out',
    'No tickets',
    'Tickets unavailable',
    'Complet',
  ])('la négation « %s » interdit la billetterie', (negation) => {
    const resultat = selectionnerLien(
      demandeEvenement(),
      rechercheOk(
        candidatBilletterie({
          titre: `Festival du Port — ${negation}`,
          extrait:
            `${negation}. Festival du Port le 10 août 2026 ` +
            'au Hangar 14 à Bordeaux. Acheter des billets.',
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('refuse des informations tarifaires sans signal d’achat', () => {
    const resultat = selectionnerLien(
      demandeEvenement(),
      rechercheOk(
        candidatBilletterie({
          titre: 'Festival du Port — Informations et tarifs',
          extrait:
            'Informations et tarifs du Festival du Port, ' +
            'le 10 août 2026 au Hangar 14 à Bordeaux.',
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });

  it('refuse une date événementielle incompatible', () => {
    const resultat = selectionnerLien(
      demandeEvenement(),
      rechercheOk(
        candidatBilletterie({
          extrait:
            'Acheter des billets pour le Festival du Port, ' +
            'le 11 août 2026 au Hangar 14 à Bordeaux.',
        }),
      ),
    );

    expect(resultat.statut).toBe('introuvable');
  });
});

describe('preuve d’identifiant externe', () => {
  it.each([
    [
      'un segment de chemin exact',
      {
        url:
          'https://www.thefork.fr/restaurant/' +
          'le-point-rouge/123',
      },
    ],
    [
      'un paramètre exact',
      {
        url:
          'https://www.thefork.fr/restaurant/' +
          'le-point-rouge-r999?eventId=123',
      },
    ],
    [
      'un jeton borné dans l’extrait',
      {
        extrait:
          'Réserver une table au Point Rouge, identifiant 123, ' +
          '12 quai de Paludate, Bordeaux.',
      },
    ],
  ])('ajoute la preuve depuis %s', (_cas, changements) => {
    const resultat = selectionnerLien(
      demandeLieu({ identifiantExterne: '123' }),
      rechercheOk(candidatReservation(changements)),
    );

    expect(naturesPreuves(resultat)).toContain('identifiant_externe');
  });

  it('compare aussi un identifiant ponctué dans l’extrait normalisé', () => {
    const resultat = selectionnerLien(
      demandeLieu({ identifiantExterne: 'fsq-point-rouge' }),
      rechercheOk(
        candidatReservation({
          extrait:
            'Réserver une table au Point Rouge, ' +
            'identifiant fsq-point-rouge, ' +
            '12 quai de Paludate, Bordeaux.',
        }),
      ),
    );

    expect(naturesPreuves(resultat)).toContain('identifiant_externe');
  });

  it.each([
    ['1234', 'https://www.thefork.fr/restaurant/le-point-rouge/1234'],
    [
      'abc123xyz',
      'https://www.thefork.fr/restaurant/le-point-rouge/abc123xyz',
    ],
    [
      '2026123',
      'https://www.thefork.fr/restaurant/le-point-rouge/2026123',
    ],
  ])(
    'ne confond pas l’identifiant 123 avec la séquence %s',
    (_sequence, url) => {
      const resultat = selectionnerLien(
        demandeLieu({ identifiantExterne: '123' }),
        rechercheOk(candidatReservation({ url })),
      );

      expect(naturesPreuves(resultat)).not.toContain(
        'identifiant_externe',
      );
    },
  );

  it('n’invente aucune preuve lorsque l’identifiant est absent', () => {
    const resultat = selectionnerLien(
      demandeLieu(),
      rechercheOk(candidatReservation()),
    );

    expect(naturesPreuves(resultat)).not.toContain('identifiant_externe');
  });
});

describe('clé de demande structurée', () => {
  it('normalise les espaces et encode les séparateurs de façon stable', () => {
    expect(
      cleDemandeResolutionLien(
        demandeLieu({
          identifiantExterne: 'fsq:123',
          villeDemandee: ' Bordeaux ',
          nom: ' Le Point Rouge ',
        }),
      ),
    ).toBe(
      'Foursquare:fsq%3A123:sortie:bordeaux:le-point-rouge',
    );
  });

  it.each<
    [
      ChampDemandeResolutionLien,
      Partial<DemandeLieu>,
    ]
  >([
    ['villeDemandee', { villeDemandee: '' }],
    ['villeDemandee', { villeDemandee: '   ' }],
    ['nom', { nom: '' }],
    ['nom', { nom: '   ' }],
    ['identifiantExterne', { identifiantExterne: '' }],
    ['identifiantExterne', { identifiantExterne: '   ' }],
    [
      'fournisseurMetier',
      {
        fournisseurMetier:
          '' as DemandeLieu['fournisseurMetier'],
      },
    ],
    [
      'typeMetierRecherche',
      {
        typeMetierRecherche:
          '' as DemandeLieu['typeMetierRecherche'],
      },
    ],
  ])('refuse le composant obligatoire vide %s', (champ, changements) => {
    attendreDemandeInvalide(demandeLieu(changements), champ);
  });

  it('diffère selon la ville', () => {
    expect(
      cleDemandeResolutionLien(demandeLieu({ villeDemandee: 'Bordeaux' })),
    ).not.toBe(
      cleDemandeResolutionLien(demandeLieu({ villeDemandee: 'Lyon' })),
    );
  });

  it('diffère selon deux noms proches', () => {
    expect(
      cleDemandeResolutionLien(demandeLieu({ nom: 'Le Point' })),
    ).not.toBe(
      cleDemandeResolutionLien(demandeLieu({ nom: 'Le Pointeau' })),
    );
  });

  it('diffère selon le type métier', () => {
    expect(
      cleDemandeResolutionLien(
        demandeLieu({ typeMetierRecherche: 'restaurant' }),
      ),
    ).not.toBe(
      cleDemandeResolutionLien(
        demandeLieu({ typeMetierRecherche: 'activite' }),
      ),
    );
  });

  it('diffère selon le fournisseur métier', () => {
    expect(cleDemandeResolutionLien(demandeLieu())).not.toBe(
      cleDemandeResolutionLien(
        demandeEvenement({
          identifiantExterne: 'fsq-point-rouge',
          nom: 'Le Point Rouge',
        }),
      ),
    );
  });

  it('diffère selon l’identifiant externe', () => {
    expect(
      cleDemandeResolutionLien(
        demandeLieu({ identifiantExterne: 'fsq-1' }),
      ),
    ).not.toBe(
      cleDemandeResolutionLien(
        demandeLieu({ identifiantExterne: 'fsq-2' }),
      ),
    );
  });

  it.each([
    [
      'resolu',
      rechercheOk(candidatReservation()),
    ],
    [
      'ambigu',
      rechercheOk(
        candidatReservation(),
        candidatReservation({
          url:
            'https://www.opentable.com/r/' +
            'le-point-rouge-bordeaux',
        }),
      ),
    ],
    [
      'introuvable',
      {
        statut: 'vide',
        resultats: [],
        fournisseur: 'Tavily',
        recupereLe: DATE_RECUPERATION,
      } satisfies ResultatRechercheWeb,
    ],
    [
      'indisponible',
      {
        statut: 'indisponible',
        fournisseur: 'Tavily',
        raison: 'quota',
        constateLe: DATE_RECUPERATION,
      } satisfies ResultatRechercheWeb,
    ],
  ])(
    'échoue avant de produire un résultat %s',
    (_statut, recherche) => {
      expect(() =>
        selectionnerLien(
          demandeLieu({ villeDemandee: '   ' }),
          recherche,
        ),
      ).toThrowError(DemandeResolutionLienInvalide);
    },
  );
});

describe('domaine enregistrable des liens', () => {
  it('normalise la casse et le point terminal DNS', () => {
    expect(
      domaineEnregistrableLien(
        'https://RESERVATION.THEFORK.FR./restaurant/123',
      ),
    ).toBe('thefork.fr');
  });

  it('normalise un domaine internationalisé via URL', () => {
    expect(
      domaineEnregistrableLien('https://BÜCHER.de/catalogue'),
    ).toBe('xn--bcher-kva.de');
    expect(
      domaineEnregistrableLien(
        'https://xn--bcher-kva.de/catalogue',
      ),
    ).toBe('xn--bcher-kva.de');
  });

  it.each([
    'https://localhost/page',
    'https://service.invalid/page',
    'valeur sans URL',
  ])('refuse l’absence de domaine enregistrable : %s', (url) => {
    expect(domaineEnregistrableLien(url)).toBeNull();
  });
});

describe('intégration structurée et compatibilité', () => {
  it('conserve le type reservation après le contrôle réseau', async () => {
    vi.mocked(rechercherWeb).mockResolvedValueOnce(
      rechercheOk(candidatReservation()),
    );

    const resultat = await resoudreLien(demandeLieu());

    expect(resultat).toMatchObject({
      statut: 'resolu',
      typeLien: 'reservation',
      cleDemande:
        'Foursquare:fsq-point-rouge:sortie:bordeaux:le-point-rouge',
      controleLe: DATE_RECUPERATION,
      statutHttp: 200,
    });
    expect(rechercherWeb).toHaveBeenCalledOnce();
    expect(rechercherWeb).toHaveBeenCalledWith(
      expect.stringContaining('"Le Point Rouge"'),
      8,
    );
    expect(controlerAccessibiliteLien).toHaveBeenCalledOnce();
    expect(controlerAccessibiliteLien).toHaveBeenCalledWith(
      candidatReservation().url,
    );
  });

  it('conserve le type billetterie et les preuves après redirection', async () => {
    vi.mocked(rechercherWeb).mockResolvedValueOnce(
      rechercheOk(candidatBilletterie()),
    );
    vi.mocked(controlerAccessibiliteLien).mockResolvedValueOnce({
      statut: 'accessible',
      urlInitiale: candidatBilletterie().url,
      urlFinale:
        'https://www.ticketmaster.fr/fr/manifestation/festival-du-port/12345',
      statutHttp: 200,
      redirections: [
        'https://www.ticketmaster.fr/fr/manifestation/festival-du-port/12345',
      ],
      controleLe: DATE_RECUPERATION,
    });

    const resultat = await resoudreLien(demandeEvenement());

    expect(resultat).toMatchObject({
      statut: 'resolu',
      typeLien: 'billetterie',
      urlInitiale: candidatBilletterie().url,
      url:
        'https://www.ticketmaster.fr/fr/manifestation/festival-du-port/12345',
      domaine: 'www.ticketmaster.fr',
      redirections: [
        'https://www.ticketmaster.fr/fr/manifestation/festival-du-port/12345',
      ],
    });
    if (resultat.statut === 'resolu') {
      expect(resultat.preuves.map((preuve) => preuve.nature)).toContain(
        'date_evenement',
      );
      expect(resultat.typeLien).not.toBe('officiel');
    }
  });

  it('ne transfère pas une réservation TheFork vers un autre domaine enregistrable', async () => {
    vi.mocked(rechercherWeb).mockResolvedValueOnce(
      rechercheOk(candidatReservation()),
    );
    vi.mocked(controlerAccessibiliteLien).mockResolvedValueOnce({
      statut: 'accessible',
      urlInitiale: candidatReservation().url,
      urlFinale: 'https://autre-domaine-public.com/page',
      statutHttp: 200,
      redirections: ['https://autre-domaine-public.com/page'],
      controleLe: DATE_RECUPERATION,
    });

    const resultat = await resoudreLien(demandeLieu());

    expect(resultat).toEqual({
      statut: 'refuse',
      cleDemande:
        'Foursquare:fsq-point-rouge:sortie:bordeaux:le-point-rouge',
      raison: 'changement_domaine_enregistrable',
      constateLe: DATE_RECUPERATION,
    });
  });

  it('ne transfère pas une billetterie Ticketmaster vers un domaine non reconnu', async () => {
    vi.mocked(rechercherWeb).mockResolvedValueOnce(
      rechercheOk(candidatBilletterie()),
    );
    vi.mocked(controlerAccessibiliteLien).mockResolvedValueOnce({
      statut: 'accessible',
      urlInitiale: candidatBilletterie().url,
      urlFinale: 'https://billets-autres.com/page',
      statutHttp: 200,
      redirections: ['https://billets-autres.com/page'],
      controleLe: DATE_RECUPERATION,
    });

    const resultat = await resoudreLien(demandeEvenement());

    expect(resultat).toEqual({
      statut: 'refuse',
      cleDemande:
        'PredictHQ:phq-festival-port:evenement:bordeaux:festival-du-port',
      raison: 'changement_domaine_enregistrable',
      constateLe: DATE_RECUPERATION,
    });
  });

  it('conserve une réservation entre sous-domaines du même domaine enregistrable', async () => {
    vi.mocked(rechercherWeb).mockResolvedValueOnce(
      rechercheOk(candidatReservation()),
    );
    vi.mocked(controlerAccessibiliteLien).mockResolvedValueOnce({
      statut: 'accessible',
      urlInitiale: candidatReservation().url,
      urlFinale:
        'https://reservation.thefork.fr/restaurant/le-point-rouge-r12345',
      statutHttp: 200,
      redirections: [
        'https://reservation.thefork.fr/restaurant/le-point-rouge-r12345',
      ],
      controleLe: DATE_RECUPERATION,
    });

    const resultat = await resoudreLien(demandeLieu());

    expect(resultat).toMatchObject({
      statut: 'resolu',
      typeLien: 'reservation',
      domaine: 'reservation.thefork.fr',
    });
  });

  it('refuse une destination finale sans domaine enregistrable', async () => {
    vi.mocked(rechercherWeb).mockResolvedValueOnce(
      rechercheOk(candidatReservation()),
    );
    vi.mocked(controlerAccessibiliteLien).mockResolvedValueOnce({
      statut: 'accessible',
      urlInitiale: candidatReservation().url,
      urlFinale: 'https://localhost/page',
      statutHttp: 200,
      redirections: ['https://localhost/page'],
      controleLe: DATE_RECUPERATION,
    });

    await expect(resoudreLien(demandeLieu())).resolves.toMatchObject({
      statut: 'refuse',
      raison: 'changement_domaine_enregistrable',
    });
  });

  it('retire le statut résolu quand le contrôle refuse le lien', async () => {
    vi.mocked(rechercherWeb).mockResolvedValueOnce(
      rechercheOk(candidatReservation()),
    );
    vi.mocked(controlerAccessibiliteLien).mockResolvedValueOnce({
      statut: 'refuse',
      raison: 'destination_interdite',
      constateLe: DATE_RECUPERATION,
    });

    await expect(resoudreLien(demandeLieu())).resolves.toEqual({
      statut: 'refuse',
      cleDemande:
        'Foursquare:fsq-point-rouge:sortie:bordeaux:le-point-rouge',
      raison: 'destination_interdite',
      constateLe: DATE_RECUPERATION,
    });
  });

  it('conserve une panne réseau comme indisponible, jamais introuvable', async () => {
    vi.mocked(rechercherWeb).mockResolvedValueOnce(
      rechercheOk(candidatReservation()),
    );
    vi.mocked(controlerAccessibiliteLien).mockResolvedValueOnce({
      statut: 'indisponible',
      raison: 'erreur_dns',
      constateLe: DATE_RECUPERATION,
    });

    await expect(resoudreLien(demandeLieu())).resolves.toEqual({
      statut: 'indisponible',
      cleDemande:
        'Foursquare:fsq-point-rouge:sortie:bordeaux:le-point-rouge',
      origine: 'controle_reseau',
      raison: 'erreur_dns',
      constateLe: DATE_RECUPERATION,
    });
  });

  it.each([
    [
      'ambigu',
      rechercheOk(
        candidatReservation(),
        candidatReservation({
          url:
            'https://www.opentable.com/r/' +
            'le-point-rouge-bordeaux',
        }),
      ),
    ],
    [
      'introuvable',
      {
        statut: 'vide',
        resultats: [],
        fournisseur: 'Tavily',
        recupereLe: DATE_RECUPERATION,
      } satisfies ResultatRechercheWeb,
    ],
    [
      'indisponible',
      {
        statut: 'indisponible',
        fournisseur: 'Tavily',
        raison: 'quota',
        constateLe: DATE_RECUPERATION,
      } satisfies ResultatRechercheWeb,
    ],
  ])(
    'ne lance aucun contrôle réseau après une sélection %s',
    async (statut, recherche) => {
      vi.mocked(rechercherWeb).mockResolvedValueOnce(recherche);

      const resultat = await resoudreLien(demandeLieu());

      expect(resultat.statut).toBe(statut);
      expect(controlerAccessibiliteLien).not.toHaveBeenCalled();
    },
  );

  it('n’effectue aucun appel réseau supplémentaire pendant la sélection pure', () => {
    const requeteReseau = vi.fn();
    vi.stubGlobal('fetch', requeteReseau);

    selectionnerLien(
      demandeLieu(),
      rechercheOk(candidatReservation()),
    );

    expect(requeteReseau).not.toHaveBeenCalled();
  });
});
