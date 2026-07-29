import { describe, expect, it } from 'vitest';
import {
  CandidatTrajetExterneSchema,
  couvreIdentiteCompleteTrajet,
  DateHeureTransportObserveeSchema,
  DateTransportDemandeeSchema,
  DemandeTransportSchema,
  LieuTransportConfirmeSchema,
  LieuTransportDemandeSchema,
  ModeTransportSchema,
  NOMBRE_MAX_SEGMENTS_TRAJET,
  NOMBRE_MAX_TRONCONS_TRANSPORT,
  OccupationTransportSchema,
  PreuveTrajetSchema,
  SegmentTransportExterneSchema,
  TronconTransportDemandeSchema,
  comparerDatesCiviles,
  comparerInstants,
  normaliserVillePourComparaison,
  verifierContinuiteSegments,
  type LieuTransportConfirme,
  type SegmentTransportExterne,
} from '../../server/domaine/transport/index.js';

const RECUPERE_LE = '2026-07-29T10:00:00Z';

function lieuDemande(
  ville: string,
  complement: Record<string, unknown> = {}
) {
  return { ville, ...complement };
}

function lieuConfirme(
  identifiantExterne: string,
  nom: string,
  ville: string,
  complement: Partial<LieuTransportConfirme> = {}
): LieuTransportConfirme {
  return {
    type: 'gare',
    identifiantExterne,
    nom,
    ville,
    codePays: 'FR',
    fuseauIana: 'Europe/Paris',
    fournisseur: 'Source transport',
    source: 'https://transport.example/lieux',
    recupereLe: RECUPERE_LE,
    ...complement,
  };
}

function segment(
  identifiantExterne: string,
  origine: LieuTransportConfirme,
  destination: LieuTransportConfirme,
  depart: string,
  arrivee: string,
  complement: Partial<SegmentTransportExterne> = {}
): SegmentTransportExterne {
  return {
    identifiantExterne,
    mode: 'train',
    origine,
    destination,
    depart: {
      horodatage: depart,
      fuseauIana: origine.fuseauIana,
    },
    arrivee: {
      horodatage: arrivee,
      fuseauIana: destination.fuseauIana,
    },
    ...complement,
  };
}

const BORDEAUX = lieuConfirme(
  'gare-bordeaux',
  'Bordeaux Saint-Jean',
  'Bordeaux',
  { code: { systeme: 'UIC', valeur: '87581009' } }
);
const PARIS = lieuConfirme('gare-paris', 'Paris Montparnasse', 'Paris', {
  code: { systeme: 'UIC', valeur: '87391003' },
});
const CDG = lieuConfirme('aeroport-cdg', 'Paris Charles-de-Gaulle', 'Paris', {
  type: 'aeroport',
  code: { systeme: 'IATA', valeur: 'CDG' },
});
const MONTREAL = lieuConfirme(
  'aeroport-yul',
  'Montréal-Trudeau',
  'Montréal',
  {
    type: 'aeroport',
    codePays: 'CA',
    code: { systeme: 'IATA', valeur: 'YUL' },
    fuseauIana: 'America/Toronto',
  }
);

describe('ModeTransportSchema', () => {
  it.each([
    'avion',
    'train',
    'bus',
    'ferry',
    'voiture',
    'transport_local',
    'autre',
  ])('accepte le mode fermé %s', (mode) => {
    expect(ModeTransportSchema.parse(mode)).toBe(mode);
  });

  it.each(['taxi', 'metro', 'vélo', 'inconnu'])(
    'refuse le mode hors contrat %s',
    (mode) => {
      expect(ModeTransportSchema.safeParse(mode).success).toBe(false);
    }
  );
});

describe('LieuTransportDemandeSchema — intention, jamais preuve', () => {
  it('nettoie une ville valide et conserve une préférence stricte', () => {
    expect(
      LieuTransportDemandeSchema.parse({
        ville: '  Bordeaux  ',
        codePays: 'FR',
        preference: { type: 'gare', libelle: ' Saint-Jean ' },
      })
    ).toEqual({
      ville: 'Bordeaux',
      codePays: 'FR',
      preference: { type: 'gare', libelle: 'Saint-Jean' },
    });
  });

  it.each(['', '   '])('refuse une ville vide (%j)', (ville) => {
    expect(
      LieuTransportDemandeSchema.safeParse({ ville }).success
    ).toBe(false);
  });

  it.each(['fr', 'FRA', 'France', 'F1'])(
    'refuse le pays mal formé %s',
    (codePays) => {
      expect(
        LieuTransportDemandeSchema.safeParse({
          ville: 'Bordeaux',
          codePays,
        }).success
      ).toBe(false);
    }
  );

  it.each([
    { type: 'metro', libelle: 'A' },
    { type: 'gare', libelle: '   ' },
    { type: 'gare', libelle: 'Saint-Jean', code: '87581009' },
  ])('refuse la préférence invalide ou enrichie %o', (preference) => {
    expect(
      LieuTransportDemandeSchema.safeParse({
        ville: 'Bordeaux',
        preference,
      }).success
    ).toBe(false);
  });

  it.each([
    ['un code IATA', { codeIata: 'BOD' }],
    ['un identifiant fournisseur', { identifiantExterne: 'airport-1' }],
    ['une provenance', { fournisseur: 'Amadeus' }],
    ['un fuseau', { fuseauIana: 'Europe/Paris' }],
  ])('refuse %s injecté dans un lieu demandé', (_libelle, complement) => {
    expect(
      LieuTransportDemandeSchema.safeParse({
        ville: 'Bordeaux',
        ...complement,
      }).success
    ).toBe(false);
  });
});

describe('OccupationTransportSchema — aucune occupation déduite', () => {
  it('accepte a_confirmer seul', () => {
    expect(
      OccupationTransportSchema.parse({ statut: 'a_confirmer' })
    ).toEqual({ statut: 'a_confirmer' });
  });

  it('refuse toute valeur sous a_confirmer', () => {
    expect(
      OccupationTransportSchema.safeParse({
        statut: 'a_confirmer',
        adultes: 2,
      }).success
    ).toBe(false);
  });

  it.each([
    { adultes: 1, enfants: 0 },
    { adultes: 2, enfants: 3 },
    { adultes: 20, enfants: 20 },
  ])('accepte une occupation complète %o', (occupation) => {
    expect(
      OccupationTransportSchema.parse({
        statut: 'declaree',
        ...occupation,
      })
    ).toEqual({ statut: 'declaree', ...occupation });
  });

  it.each([
    ['adultes manquants', { enfants: 0 }],
    ['enfants manquants', { adultes: 1 }],
    ['zéro adulte', { adultes: 0, enfants: 0 }],
    ['adulte décimal', { adultes: 1.5, enfants: 0 }],
    ['enfant décimal', { adultes: 1, enfants: 0.5 }],
    ['trop d’adultes', { adultes: 21, enfants: 0 }],
    ['trop d’enfants', { adultes: 1, enfants: 21 }],
    ['chambres injectées', { adultes: 2, enfants: 0, chambres: 1 }],
  ])('refuse %s', (_libelle, occupation) => {
    expect(
      OccupationTransportSchema.safeParse({
        statut: 'declaree',
        ...occupation,
      }).success
    ).toBe(false);
  });
});

describe('DateTransportDemandeeSchema — date civile sans heure', () => {
  it.each(['matin', 'apres_midi', 'soir', 'nuit'])(
    'accepte le créneau %s',
    (creneau) => {
      expect(
        DateTransportDemandeeSchema.safeParse({
          date: '2026-08-10',
          creneau,
        }).success
      ).toBe(true);
    }
  );

  it.each([
    ['date impossible', { date: '2026-02-30' }],
    ['format français', { date: '10/08/2026' }],
    ['date-heure', { date: '2026-08-10T09:00:00Z' }],
    ['créneau libre', { date: '2026-08-10', creneau: 'vers 9 h' }],
    ['heure exacte injectée', { date: '2026-08-10', heure: '09:00' }],
  ])('refuse %s', (_libelle, date) => {
    expect(DateTransportDemandeeSchema.safeParse(date).success).toBe(false);
  });

  it('accepte une vraie date sans créneau', () => {
    expect(
      DateTransportDemandeeSchema.parse({ date: '2028-02-29' })
    ).toEqual({ date: '2028-02-29' });
  });
});

describe('TronconTransportDemandeSchema', () => {
  const tronconValide = {
    origine: lieuDemande('Bordeaux', { codePays: 'FR' }),
    destination: lieuDemande('Paris', { codePays: 'FR' }),
    depart: { date: '2026-08-10', creneau: 'matin' },
    modeSouhaite: 'train',
  };

  it('accepte un trajet demandé sans donnée fournisseur', () => {
    expect(
      TronconTransportDemandeSchema.safeParse(tronconValide).success
    ).toBe(true);
  });

  it.each(['PARIS', ' Páris ', 'paris'])(
    'refuse la même ville après normalisation : %s',
    (ville) => {
      expect(
        TronconTransportDemandeSchema.safeParse({
          ...tronconValide,
          origine: lieuDemande('Paris'),
          destination: lieuDemande(ville),
        }).success
      ).toBe(false);
    }
  );

  it.each([
    ['compagnie', { compagnie: 'SNCF' }],
    ['horaire exact', { heureDepart: '09:42' }],
    ['prix', { prix: 35 }],
  ])('refuse le champ %s', (_libelle, complement) => {
    expect(
      TronconTransportDemandeSchema.safeParse({
        ...tronconValide,
        ...complement,
      }).success
    ).toBe(false);
  });
});

describe('DemandeTransportSchema — tronçons ordonnés', () => {
  function troncon(
    origine: string,
    destination: string,
    date: string
  ) {
    return {
      origine: lieuDemande(origine),
      destination: lieuDemande(destination),
      depart: { date },
    };
  }

  it.each([
    [
      'aller simple',
      [troncon('Bordeaux', 'Paris', '2026-08-10')],
    ],
    [
      'aller-retour explicite',
      [
        troncon('Bordeaux', 'Paris', '2026-08-10'),
        troncon('Paris', 'Bordeaux', '2026-08-12'),
      ],
    ],
    [
      'multi-ville',
      [
        troncon('Bordeaux', 'Paris', '2026-08-10'),
        troncon('Paris', 'Lyon', '2026-08-10'),
        troncon('Lyon', 'Marseille', '2026-08-13'),
      ],
    ],
  ])('accepte %s', (_libelle, troncons) => {
    expect(
      DemandeTransportSchema.safeParse({
        troncons,
        occupation: { statut: 'a_confirmer' },
      }).success
    ).toBe(true);
  });

  it('accepte une occupation explicitement déclarée et des préférences fermées', () => {
    expect(
      DemandeTransportSchema.safeParse({
        troncons: [troncon('Bordeaux', 'Paris', '2026-08-10')],
        occupation: { statut: 'declaree', adultes: 2, enfants: 0 },
        preferences: {
          correspondances: 'direct_uniquement',
          dureeMaxMinutes: 360,
          mobiliteReduite: true,
          budgetMax: {
            montant: 250,
            devise: 'EUR',
            portee: 'total',
          },
        },
      }).success
    ).toBe(true);
  });

  it.each([
    ['liste vide', []],
    [
      'trop de tronçons',
      Array.from(
        { length: NOMBRE_MAX_TRONCONS_TRANSPORT + 1 },
        (_, index) =>
          troncon(`Ville ${index}`, `Ville ${index + 1}`, '2026-08-10')
      ),
    ],
    [
      'dates décroissantes',
      [
        troncon('Bordeaux', 'Paris', '2026-08-11'),
        troncon('Paris', 'Lyon', '2026-08-10'),
      ],
    ],
  ])('refuse %s', (_libelle, troncons) => {
    expect(
      DemandeTransportSchema.safeParse({
        troncons,
        occupation: { statut: 'a_confirmer' },
      }).success
    ).toBe(false);
  });

  it('refuse une dateRetour globale et ne fabrique aucun tronçon', () => {
    const entree = {
      troncons: [troncon('Bordeaux', 'Paris', '2026-08-10')],
      occupation: { statut: 'a_confirmer' },
      dateRetour: '2026-08-12',
    };
    expect(DemandeTransportSchema.safeParse(entree).success).toBe(false);
    expect(entree.troncons).toHaveLength(1);
  });

  it.each([
    ['durée nulle', { dureeMaxMinutes: 0 }],
    ['durée décimale', { dureeMaxMinutes: 90.5 }],
    ['durée excessive', { dureeMaxMinutes: 43_201 }],
    [
      'devise libre',
      {
        budgetMax: {
          montant: 100,
          devise: 'euro',
          portee: 'total',
        },
      },
    ],
    [
      'budget nul',
      {
        budgetMax: {
          montant: 0,
          devise: 'EUR',
          portee: 'total',
        },
      },
    ],
    ['compagnie injectée', { compagnie: 'SNCF' }],
  ])('refuse la préférence invalide %s', (_libelle, preferences) => {
    expect(
      DemandeTransportSchema.safeParse({
        troncons: [troncon('Bordeaux', 'Paris', '2026-08-10')],
        occupation: { statut: 'a_confirmer' },
        preferences,
      }).success
    ).toBe(false);
  });
});

describe('LieuTransportConfirmeSchema — identité d’une source future', () => {
  it.each([
    [
      'aéroport IATA',
      lieuConfirme('airport-cdg', 'Paris CDG', 'Paris', {
        type: 'aeroport',
        code: { systeme: 'IATA', valeur: 'CDG' },
      }),
    ],
    [
      'aéroport ICAO',
      lieuConfirme('airport-lfpg', 'Paris CDG', 'Paris', {
        type: 'aeroport',
        code: { systeme: 'ICAO', valeur: 'LFPG' },
      }),
    ],
    ['gare UIC', BORDEAUX],
    [
      'arrêt Navitia',
      lieuConfirme('stop-bus', 'Victoire', 'Bordeaux', {
        type: 'arret',
        code: {
          systeme: 'NAVITIA',
          valeur: 'stop_area:NAQ:SA:87581009',
        },
      }),
    ],
  ])('accepte %s', (_libelle, lieu) => {
    expect(LieuTransportConfirmeSchema.safeParse(lieu).success).toBe(true);
  });

  it.each([
    ['source HTTP', { ...BORDEAUX, source: 'http://transport.example/gare' }],
    ['identifiant vide', { ...BORDEAUX, identifiantExterne: '   ' }],
    ['pays invalide', { ...BORDEAUX, codePays: 'France' }],
    [
      'IATA trop long',
      { ...BORDEAUX, code: { systeme: 'IATA', valeur: 'BODX' } },
    ],
    [
      'ICAO minuscule',
      { ...BORDEAUX, code: { systeme: 'ICAO', valeur: 'lfbd' } },
    ],
    [
      'UIC non numérique',
      { ...BORDEAUX, code: { systeme: 'UIC', valeur: 'UIC-123' } },
    ],
    ['fuseau vide', { ...BORDEAUX, fuseauIana: '   ' }],
    ['champ utilisateur', { ...BORDEAUX, preference: 'Saint-Jean' }],
  ])('refuse %s', (_libelle, lieu) => {
    expect(LieuTransportConfirmeSchema.safeParse(lieu).success).toBe(false);
  });
});

describe('DateHeureTransportObserveeSchema — instant avec fuseau explicite', () => {
  it.each([
    '2026-08-10T09:42:00+02:00',
    '2026-08-10T09:42:00Z',
  ])('accepte %s', (horodatage) => {
    expect(
      DateHeureTransportObserveeSchema.safeParse({
        horodatage,
        fuseauIana: 'Europe/Paris',
      }).success
    ).toBe(true);
  });

  it.each([
    ['horaire naïf', '2026-08-10T09:42:00', 'Europe/Paris'],
    ['date seule', '2026-08-10', 'Europe/Paris'],
    ['fuseau vide', '2026-08-10T09:42:00Z', '   '],
  ])('refuse %s', (_libelle, horodatage, fuseauIana) => {
    expect(
      DateHeureTransportObserveeSchema.safeParse({
        horodatage,
        fuseauIana,
      }).success
    ).toBe(false);
  });
});

describe('SegmentTransportExterneSchema', () => {
  const direct = segment(
    'train-1',
    BORDEAUX,
    PARIS,
    '2026-08-10T08:00:00+02:00',
    '2026-08-10T10:10:00+02:00'
  );

  it('accepte un segment direct sans opérateur ni numéro', () => {
    const resultat = SegmentTransportExterneSchema.parse(direct);
    expect(resultat.operateur).toBeUndefined();
    expect(resultat.numeroTrajet).toBeUndefined();
  });

  it('accepte une arrivée le lendemain', () => {
    expect(
      SegmentTransportExterneSchema.safeParse(
        segment(
          'bus-nuit',
          BORDEAUX,
          PARIS,
          '2026-08-10T23:00:00+02:00',
          '2026-08-11T06:00:00+02:00',
          { mode: 'bus' }
        )
      ).success
    ).toBe(true);
  });

  it('compare correctement des fuseaux différents', () => {
    expect(
      SegmentTransportExterneSchema.safeParse(
        segment(
          'vol-1',
          CDG,
          MONTREAL,
          '2026-08-10T10:00:00+02:00',
          '2026-08-10T09:30:00-04:00',
          { mode: 'avion' }
        )
      ).success
    ).toBe(true);
  });

  it.each([
    [
      'arrivée avant départ',
      segment(
        'train-inverse',
        BORDEAUX,
        PARIS,
        '2026-08-10T10:00:00+02:00',
        '2026-08-10T09:59:00+02:00'
      ),
    ],
    [
      'même lieu',
      segment(
        'train-boucle',
        BORDEAUX,
        BORDEAUX,
        '2026-08-10T08:00:00+02:00',
        '2026-08-10T09:00:00+02:00'
      ),
    ],
  ])('refuse %s', (_libelle, valeur) => {
    expect(SegmentTransportExterneSchema.safeParse(valeur).success).toBe(false);
  });

  it.each([
    ['terminal', { terminal: '2E' }],
    ['prix', { prix: 99 }],
    ['disponibilité', { disponible: true }],
    ['réservation', { reservation: { url: 'https://example.test' } }],
    ['quai', { quai: '4' }],
    ['porte', { porte: 'A12' }],
  ])('refuse le champ commercial ou opérationnel %s', (_libelle, complement) => {
    expect(
      SegmentTransportExterneSchema.safeParse({
        ...direct,
        ...complement,
      }).success
    ).toBe(false);
  });
});

describe('CandidatTrajetExterneSchema — trajet, jamais offre', () => {
  const train = segment(
    'train-bordeaux-cdg',
    BORDEAUX,
    CDG,
    '2026-08-10T06:00:00+02:00',
    '2026-08-10T09:00:00+02:00'
  );
  const avion = segment(
    'vol-cdg-yul',
    CDG,
    MONTREAL,
    '2026-08-10T11:00:00+02:00',
    '2026-08-10T13:00:00-04:00',
    { mode: 'avion' }
  );

  function candidat(segments: SegmentTransportExterne[]) {
    return {
      fournisseur: 'Source transport',
      source: 'https://transport.example/trajets',
      identifiantExterne: 'trajet-1',
      recupereLe: RECUPERE_LE,
      segments,
    };
  }

  it('accepte un candidat à un segment', () => {
    expect(
      CandidatTrajetExterneSchema.safeParse(candidat([train])).success
    ).toBe(true);
  });

  it('accepte plusieurs segments continus, y compris train puis avion', () => {
    expect(
      CandidatTrajetExterneSchema.safeParse(candidat([train, avion])).success
    ).toBe(true);
  });

  it('refuse une rupture d’identité de lieu malgré des noms proches', () => {
    const fauxCdg = lieuConfirme(
      'autre-identifiant-cdg',
      CDG.nom,
      CDG.ville,
      { type: 'aeroport' }
    );
    const segmentRupture = segment(
      'vol-rupture',
      fauxCdg,
      MONTREAL,
      '2026-08-10T11:00:00+02:00',
      '2026-08-10T13:00:00-04:00',
      { mode: 'avion' }
    );
    expect(
      CandidatTrajetExterneSchema.safeParse(
        candidat([train, segmentRupture])
      ).success
    ).toBe(false);
  });

  it('refuse une rupture chronologique', () => {
    const avionTropTot = segment(
      'vol-trop-tot',
      CDG,
      MONTREAL,
      '2026-08-10T08:30:00+02:00',
      '2026-08-10T11:00:00-04:00',
      { mode: 'avion' }
    );
    expect(
      CandidatTrajetExterneSchema.safeParse(
        candidat([train, avionTropTot])
      ).success
    ).toBe(false);
  });

  it('refuse deux segments portant le même identifiant', () => {
    expect(
      CandidatTrajetExterneSchema.safeParse(
        candidat([{ ...train }, { ...avion, identifiantExterne: train.identifiantExterne }])
      ).success
    ).toBe(false);
  });

  it.each([
    ['liste vide', candidat([])],
    [
      'trop de segments',
      candidat(
        Array.from(
          { length: NOMBRE_MAX_SEGMENTS_TRAJET + 1 },
          (_, index) => ({
            ...train,
            identifiantExterne: `segment-${index}`,
          })
        )
      ),
    ],
    [
      'source HTTP',
      {
        ...candidat([train]),
        source: 'http://transport.example/trajets',
      },
    ],
    [
      'offre injectée',
      {
        ...candidat([train]),
        offre: { prix: 120, devise: 'EUR' },
      },
    ],
  ])('refuse %s', (_libelle, valeur) => {
    expect(CandidatTrajetExterneSchema.safeParse(valeur).success).toBe(false);
  });
});

describe('PreuveTrajetSchema — couverture explicite et partielle', () => {
  const preuveComplete = {
    fournisseur: 'Source transport',
    source: 'https://transport.example/preuves/trajet-1',
    identifiantExterne: 'trajet-1',
    recupereLe: RECUPERE_LE,
    champsVerifies: [
      'mode',
      'origine',
      'destination',
      'depart',
      'arrivee',
    ],
  } as const;

  it('accepte une preuve complète et reconnaît sa couverture', () => {
    const preuve = PreuveTrajetSchema.parse(preuveComplete);
    expect(couvreIdentiteCompleteTrajet(preuve)).toBe(true);
  });

  it('accepte une preuve partielle sans la promouvoir', () => {
    const preuve = PreuveTrajetSchema.parse({
      ...preuveComplete,
      champsVerifies: ['origine', 'destination'],
    });
    expect(couvreIdentiteCompleteTrajet(preuve)).toBe(false);
  });

  it.each([
    [
      'doublon',
      { ...preuveComplete, champsVerifies: ['mode', 'mode'] },
    ],
    [
      'champ inconnu',
      { ...preuveComplete, champsVerifies: ['mode', 'prix'] },
    ],
    ['liste vide', { ...preuveComplete, champsVerifies: [] }],
    ['lien injecté', { ...preuveComplete, lien: 'https://example.test' }],
    ['prix injecté', { ...preuveComplete, prix: 100 }],
  ])('refuse %s', (_libelle, preuve) => {
    expect(PreuveTrajetSchema.safeParse(preuve).success).toBe(false);
  });
});

describe('helpers purs et absence de mutation', () => {
  it('normalise les villes sans modifier les entrées', () => {
    const ville = '  Saint-Étienne  ';
    expect(normaliserVillePourComparaison(ville)).toBe('saint etienne');
    expect(ville).toBe('  Saint-Étienne  ');
    expect(normaliserVillePourComparaison(' Москва ')).toBe('москва');
    expect(normaliserVillePourComparaison('Київ')).toBe('київ');
  });

  it('compare les dates civiles et les instants', () => {
    expect(comparerDatesCiviles('2026-08-10', '2026-08-10')).toBe(0);
    expect(comparerDatesCiviles('2026-08-09', '2026-08-10')).toBe(-1);
    expect(comparerDatesCiviles('2026-08-11', '2026-08-10')).toBe(1);
    expect(
      comparerInstants(
        '2026-08-10T10:00:00+02:00',
        '2026-08-10T08:00:00Z'
      )
    ).toBe(0);
  });

  it('vérifie la continuité sans muter les segments', () => {
    const premier = segment(
      'train',
      BORDEAUX,
      CDG,
      '2026-08-10T06:00:00+02:00',
      '2026-08-10T09:00:00+02:00'
    );
    const second = segment(
      'avion',
      CDG,
      MONTREAL,
      '2026-08-10T11:00:00+02:00',
      '2026-08-10T13:00:00-04:00',
      { mode: 'avion' }
    );
    const segments = [premier, second];
    const avant = structuredClone(segments);
    expect(verifierContinuiteSegments(segments)).toBe(true);
    expect(segments).toEqual(avant);
  });

  it('les validations Zod ne mutent pas les objets reçus', () => {
    const entree = {
      troncons: [
        {
          origine: { ville: ' Bordeaux ' },
          destination: { ville: ' Paris ' },
          depart: { date: '2026-08-10' },
        },
      ],
      occupation: { statut: 'a_confirmer' },
    } as const;
    const avant = structuredClone(entree);
    const resultat = DemandeTransportSchema.parse(entree);
    expect(entree).toEqual(avant);
    expect(resultat.troncons[0].origine.ville).toBe('Bordeaux');
    expect(entree.troncons[0].origine.ville).toBe(' Bordeaux ');
  });
});
