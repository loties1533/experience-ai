import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { LieuTransportConfirmeSchema } from '../../server/domaine/transport/index.js';
import {
  CandidatGareNavitiaSchema,
  candidatDepuisStopArea,
  StopAreaNavitiaSchema,
  type ProvenanceGareNavitia,
} from '../../server/services/navitia/index.js';

const SOURCE = 'https://api.navitia.io/v1/coverage/fr-sw/places?q=bordeaux';
const RECUPERE_LE = '2026-07-30T09:15:00.000Z';
const PROVENANCE: ProvenanceGareNavitia = {
  source: SOURCE,
  recupereLe: RECUPERE_LE,
};

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
    stop_area: stopArea(complement),
  };
}

function candidatValide(): Record<string, unknown> {
  return {
    fournisseur: 'Navitia',
    identifiantExterne: 'stop_area:SNCF:87581009',
    nom: 'Bordeaux Saint-Jean',
    coordonnees: { latitude: 44.825873, longitude: -0.556347 },
    fuseauIana: 'Europe/Paris',
    code: { systeme: 'UIC', valeur: '87581009' },
    source: SOURCE,
    recupereLe: RECUPERE_LE,
  };
}

describe('candidatDepuisStopArea — gare exploitable', () => {
  it('normalise un stop_area portant un code UIC', () => {
    const candidat = candidatDepuisStopArea(
      place({ codes: [{ type: 'UIC', value: '87581009' }] }),
      PROVENANCE
    );

    expect(candidat).toEqual({
      fournisseur: 'Navitia',
      identifiantExterne: 'stop_area:SNCF:87581009',
      nom: 'Bordeaux Saint-Jean',
      coordonnees: { latitude: 44.825873, longitude: -0.556347 },
      fuseauIana: 'Europe/Paris',
      code: { systeme: 'UIC', valeur: '87581009' },
      source: SOURCE,
      recupereLe: RECUPERE_LE,
    });
  });

  it('accepte un stop_area portant des champs Navitia non consommés', () => {
    const candidat = candidatDepuisStopArea(
      place({
        links: [],
        administrative_regions: [
          { id: 'admin:fr:33063', name: 'Bordeaux', zip_code: '33000' },
        ],
      }),
      PROVENANCE
    );

    expect(candidat?.identifiantExterne).toBe('stop_area:SNCF:87581009');
  });

  it('accepte des coordonnées numériques comme textuelles', () => {
    const candidat = candidatDepuisStopArea(
      place({ coord: { lat: 44.825873, lon: -0.556347 } }),
      PROVENANCE
    );

    expect(candidat?.coordonnees).toEqual({
      latitude: 44.825873,
      longitude: -0.556347,
    });
  });

  it('reste déterministe pour une même entrée et une même provenance', () => {
    const entree = place({ codes: [{ type: 'UIC', value: '87581009' }] });

    expect(candidatDepuisStopArea(entree, PROVENANCE)).toEqual(
      candidatDepuisStopArea(entree, PROVENANCE)
    );
  });

  it('ne modifie pas l’objet Navitia reçu', () => {
    const entree = place({ codes: [{ type: 'UIC', value: '87581009' }] });
    const avant = JSON.stringify(entree);

    candidatDepuisStopArea(entree, PROVENANCE);

    expect(JSON.stringify(entree)).toBe(avant);
  });
});

describe('candidatDepuisStopArea — politique du code métier', () => {
  function codeNormalise(codes?: unknown) {
    const candidat = candidatDepuisStopArea(
      place(codes === undefined ? {} : { codes }),
      PROVENANCE
    );
    return candidat?.code ?? null;
  }

  const CODE_NAVITIA = {
    systeme: 'NAVITIA',
    valeur: 'stop_area:SNCF:87581009',
  };
  const CODE_UIC = { systeme: 'UIC', valeur: '87581009' };

  it('1. sans aucun code, retombe sur l’identifiant Navitia réel', () => {
    expect(codeNormalise()).toEqual(CODE_NAVITIA);
  });

  it('1b. avec un tableau de codes vide, retombe sur l’identifiant Navitia', () => {
    expect(codeNormalise([])).toEqual(CODE_NAVITIA);
  });

  it('2. avec un seul UIC valide, retient ce code UIC', () => {
    expect(codeNormalise([{ type: 'UIC', value: '87581009' }])).toEqual(
      CODE_UIC
    );
  });

  it('3. avec un UIC illisible seul, retombe sur l’identifiant Navitia', () => {
    expect(codeNormalise([{ type: 'UIC', value: '87-581-009' }])).toEqual(
      CODE_NAVITIA
    );
  });

  it('4. avec plusieurs UIC identiques, retient un seul code UIC', () => {
    expect(
      codeNormalise([
        { type: 'UIC', value: '87581009' },
        { type: 'uic', value: '87581009' },
      ])
    ).toEqual(CODE_UIC);
  });

  it('5. avec plusieurs UIC valides distincts, refuse la gare', () => {
    expect(
      codeNormalise([
        { type: 'UIC', value: '87581009' },
        { type: 'UIC', value: '87581991' },
      ])
    ).toBeNull();
  });

  it('6. un UIC illisible ne masque jamais un UIC valide', () => {
    expect(
      codeNormalise([
        { type: 'UIC', value: '87-581-009' },
        { type: 'uic', value: '87581009' },
      ])
    ).toEqual(CODE_UIC);
  });

  it('7. avec uniquement des codes non-UIC, retombe sur l’identifiant Navitia', () => {
    expect(
      codeNormalise([
        { type: 'external_code', value: 'OCE87581009' },
        { type: 'source', value: 'CAMPO' },
        { type: 'gtfs_stop_code', value: 'BSJ' },
      ])
    ).toEqual(CODE_NAVITIA);
  });

  it('avec plusieurs UIC illisibles, retombe sur l’identifiant Navitia', () => {
    expect(
      codeNormalise([
        { type: 'UIC', value: '87-581-009' },
        { type: 'uic', value: 'FRBOJ' },
      ])
    ).toEqual(CODE_NAVITIA);
  });

  it('reconnaît le type UIC quelle que soit sa casse', () => {
    expect(codeNormalise([{ type: 'Uic', value: '87581009' }])).toEqual(
      CODE_UIC
    );
  });

  it('trouve le code UIC quelle que soit sa position dans le tableau', () => {
    expect(
      codeNormalise([
        { type: 'source', value: 'CAMPO' },
        { type: 'gtfs_stop_code', value: 'BSJ' },
        { type: 'UIC', value: '87581009' },
      ])
    ).toEqual(CODE_UIC);
  });

  it('ne reformate ni ne renumérote jamais une valeur UIC', () => {
    expect(codeNormalise([{ type: 'UIC', value: '0087581009' }])).toEqual({
      systeme: 'UIC',
      valeur: '0087581009',
    });
  });

  it('refuse un UIC trop long pour le domaine sans le tronquer', () => {
    expect(
      codeNormalise([{ type: 'UIC', value: '123456789012345678901' }])
    ).toEqual(CODE_NAVITIA);
  });
});

describe('candidatDepuisStopArea — objet brut invalide au niveau du schéma Navitia', () => {
  it.each([
    ['identifiant vide', { id: '   ' }],
    ['nom vide', { name: '' }],
    ['fuseau manquant', { timezone: undefined }],
    ['coordonnées absentes', { coord: undefined }],
    ['code sans type', { codes: [{ value: '87581009' }] }],
    ['code sans valeur', { codes: [{ type: 'UIC' }] }],
  ])('refuse un stop_area avec %s', (_libelle, complement) => {
    expect(candidatDepuisStopArea(place(complement), PROVENANCE)).toBeNull();
  });

  it.each([
    ['un objet nul', null],
    ['une chaîne', 'stop_area:SNCF:87581009'],
    ['un objet sans embedded_type', { stop_area: stopArea() }],
  ])('refuse %s', (_libelle, entree) => {
    expect(candidatDepuisStopArea(entree, PROVENANCE)).toBeNull();
  });

  it('refuse un embedded_type stop_area sans objet stop_area', () => {
    expect(
      candidatDepuisStopArea({ embedded_type: 'stop_area' }, PROVENANCE)
    ).toBeNull();
  });
});

describe('candidatDepuisStopArea — coordonnées', () => {
  function coordonnees(coord: unknown) {
    return candidatDepuisStopArea(place({ coord }), PROVENANCE)?.coordonnees;
  }

  it('accepte la chaîne « 0 » et la normalise en zéro', () => {
    expect(coordonnees({ lat: '0', lon: '0' })).toEqual({
      latitude: 0,
      longitude: 0,
    });
  });

  it('accepte les bornes extrêmes', () => {
    expect(coordonnees({ lat: '-90', lon: '180' })).toEqual({
      latitude: -90,
      longitude: 180,
    });
  });

  it.each([
    ['latitude non numérique', { lat: 'quarante-quatre', lon: '-0.556347' }],
    ['latitude vide', { lat: '', lon: '-0.556347' }],
    ['latitude en espaces seuls', { lat: '   ', lon: '-0.556347' }],
    ['latitude hors bornes', { lat: '120.5', lon: '-0.556347' }],
    ['latitude NaN', { lat: NaN, lon: 0 }],
    ['latitude Infinity', { lat: Infinity, lon: 0 }],
    ['latitude -Infinity', { lat: -Infinity, lon: 0 }],
    ['latitude nulle', { lat: null, lon: 0 }],
    ['latitude booléenne', { lat: true, lon: 0 }],
    ['longitude non numérique', { lat: '44.825873', lon: 'ouest' }],
    ['longitude vide', { lat: '44.825873', lon: '   ' }],
    ['longitude hors bornes', { lat: '44.825873', lon: '-200.1' }],
    ['longitude NaN', { lat: 44.8, lon: NaN }],
    ['longitude Infinity', { lat: 44.8, lon: Infinity }],
    ['virgule décimale française', { lat: '44,825873', lon: '0' }],
    ['notation hexadécimale', { lat: '0x2C', lon: '0' }],
  ])('refuse une gare avec %s', (_libelle, coord) => {
    expect(coordonnees(coord)).toBeUndefined();
  });

  it('ne convertit jamais une coordonnée vide en zéro', () => {
    expect(coordonnees({ lat: '', lon: '' })).toBeUndefined();
  });
});

describe('candidatDepuisStopArea — fuseau horaire', () => {
  function fuseau(timezone: unknown) {
    return candidatDepuisStopArea(place({ timezone }), PROVENANCE)?.fuseauIana;
  }

  it('accepte Europe/Paris', () => {
    expect(fuseau('Europe/Paris')).toBe('Europe/Paris');
  });

  it('accepte UTC', () => {
    expect(fuseau('UTC')).toBe('UTC');
  });

  it('accepte Etc/UTC', () => {
    expect(fuseau('Etc/UTC')).toBe('UTC');
  });

  it('accepte un fuseau à trois segments en suivant la canonisation du runtime', () => {
    // Selon la version d'ICU, cette zone peut être canonisée en
    // America/Buenos_Aires : c'est le runtime qui fait foi, pas une table locale.
    const zoneCanonique = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
    })
      .resolvedOptions().timeZone;

    expect(fuseau('America/Argentina/Buenos_Aires')).toBe(zoneCanonique);
  });

  it('canonise la casse rendue par le fournisseur', () => {
    expect(fuseau('europe/paris')).toBe('Europe/Paris');
  });

  it('canonise un alias de zone en suivant la canonisation du runtime', () => {
    // Selon la version d'ICU, cet alias peut être canonisé différemment :
    // c'est le runtime qui fait foi, pas une table locale.
    const zoneCanonique = new Intl.DateTimeFormat('en-US', {
      timeZone: 'US/Pacific',
    })
      .resolvedOptions().timeZone;

    expect(fuseau('US/Pacific')).toBe(zoneCanonique);
  });

  it.each([
    ['une chaîne vide', ''],
    ['des espaces seuls', '   '],
    ['une zone inconnue', 'Zone/Inconnue'],
    ['un décalage seul', '+02:00'],
    ['un décalage négatif seul', '-08:00'],
    ['une heure seule', '02:00'],
  ])('refuse %s', (_libelle, timezone) => {
    expect(fuseau(timezone)).toBeUndefined();
  });
});

describe('candidatDepuisStopArea — types d’objet Navitia refusés', () => {
  it.each(['administrative_region', 'stop_point', 'poi', 'address'])(
    'refuse un embedded_type %s',
    (embeddedType) => {
      expect(
        candidatDepuisStopArea(place({}, embeddedType), PROVENANCE)
      ).toBeNull();
    }
  );

  it('refuse un stop_point même lorsqu’un stop_area est joint', () => {
    expect(
      candidatDepuisStopArea(
        {
          embedded_type: 'stop_point',
          stop_point: { id: 'stop_point:SNCF:87581009', name: 'Quai 4' },
          stop_area: stopArea(),
        },
        PROVENANCE
      )
    ).toBeNull();
  });
});

describe('candidatDepuisStopArea — provenance fournie par l’appelant', () => {
  it('conserve exactement la source injectée', () => {
    const source = 'https://api.navitia.io/v1/coverage/fr-idf/places?q=gare';
    const candidat = candidatDepuisStopArea(place(), { source, recupereLe: RECUPERE_LE });

    expect(candidat?.source).toBe(source);
  });

  it('conserve exactement la date de récupération injectée', () => {
    const recupereLe = '2026-01-02T03:04:05+02:00';
    const candidat = candidatDepuisStopArea(place(), {
      source: SOURCE,
      recupereLe,
    });

    expect(candidat?.recupereLe).toBe(recupereLe);
  });

  it.each([
    ['une source HTTP', 'http://api.navitia.io/v1/places'],
    ['une source non URL', 'api.navitia.io/v1/places'],
    ['une source vide', ''],
  ])('refuse %s', (_libelle, source) => {
    expect(
      candidatDepuisStopArea(place(), { source, recupereLe: RECUPERE_LE })
    ).toBeNull();
  });

  it.each([
    ['une date sans décalage', '2026-07-30T09:15:00'],
    ['une date vide', ''],
    ['une date absurde', 'hier matin'],
  ])('refuse %s', (_libelle, recupereLe) => {
    expect(
      candidatDepuisStopArea(place(), { source: SOURCE, recupereLe })
    ).toBeNull();
  });

  it('n’utilise aucune source par défaut cachée', () => {
    expect(
      candidatDepuisStopArea(place(), {
        source: undefined as unknown as string,
        recupereLe: RECUPERE_LE,
      })
    ).toBeNull();
  });

  it('refuse une provenance portant un champ inconnu', () => {
    expect(
      candidatDepuisStopArea(place(), {
        source: SOURCE,
        recupereLe: RECUPERE_LE,
        fournisseur: 'Navitia',
      } as unknown as ProvenanceGareNavitia)
    ).toBeNull();
  });
});

describe('CandidatGareNavitiaSchema — ce que le candidat ne peut pas porter', () => {
  it('accepte le candidat de référence', () => {
    expect(CandidatGareNavitiaSchema.safeParse(candidatValide()).success).toBe(
      true
    );
  });

  it('refuse un candidat sans code métier', () => {
    const { code: _code, ...sansCode } = candidatValide();

    expect(CandidatGareNavitiaSchema.safeParse(sansCode).success).toBe(false);
  });

  it.each([
    ['une ville', { ville: 'Bordeaux' }],
    ['un code pays', { codePays: 'FR' }],
    ['un niveau de confiance', { niveau: 'verifie' }],
    ['un lieu confirmé', { lieuConfirme: true }],
    ['un opérateur', { operateur: { nom: 'SNCF' } }],
    ['un horaire de départ', { depart: '2026-08-01T08:00:00+02:00' }],
    ['une durée', { dureeFournisseur: 'PT2H10M' }],
    ['un prix', { prix: 59 }],
    ['une disponibilité', { disponible: true }],
    ['une réservation', { reservation: { lienExterne: 'https://x.test' } }],
  ])('refuse un candidat portant %s', (_libelle, complement) => {
    expect(
      CandidatGareNavitiaSchema.safeParse({
        ...candidatValide(),
        ...complement,
      }).success
    ).toBe(false);
  });

  it('n’est pas acceptable comme LieuTransportConfirme', () => {
    expect(
      LieuTransportConfirmeSchema.safeParse(candidatValide()).success
    ).toBe(false);
  });
});

describe('StopAreaNavitiaSchema — champs consommés', () => {
  it('valide un stop_area complet', () => {
    expect(StopAreaNavitiaSchema.safeParse(stopArea()).success).toBe(true);
  });

  it('ignore les champs Navitia non consommés sans les rendre', () => {
    const valide = StopAreaNavitiaSchema.safeParse(
      stopArea({ links: [], quality: 90 })
    );

    expect(valide.success).toBe(true);
    expect(valide.success && 'quality' in valide.data).toBe(false);
  });
});

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const COUCHES_ACTIVES = [
  'server/agents',
  'server/routes',
  'server/docs',
  'server/depots',
  'client-react/src',
  'prisma',
];
const EXTENSIONS_SOURCE = ['.ts', '.tsx', '.js', '.jsx', '.prisma'];

function fichiersSources(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) return fichiersSources(chemin);
    return EXTENSIONS_SOURCE.some((extension) =>
      entree.name.endsWith(extension)
    )
      ? [chemin]
      : [];
  });
}

describe('F4-C3a — aucun réseau et aucune intégration active', () => {
  it('normalise sans appeler fetch', () => {
    const espionFetch = vi.spyOn(globalThis, 'fetch');

    candidatDepuisStopArea(
      place({ codes: [{ type: 'UIC', value: '87581009' }] }),
      PROVENANCE
    );

    expect(espionFetch).not.toHaveBeenCalled();
    espionFetch.mockRestore();
  });

  it('contrôle réellement des fichiers dans chaque couche active', () => {
    for (const couche of COUCHES_ACTIVES) {
      expect(fichiersSources(join(RACINE, couche)).length).toBeGreaterThan(0);
    }
  });

  // Depuis F4-D2, Navitia possède un unique point de branchement autorisé dans
  // la génération : l'enrichissement des liens de recherche transport. Toutes
  // les autres couches actives (routes, dépôts, front, Prisma, autres agents)
  // doivent rester exemptes de toute référence directe au module Navitia.
  const FICHIERS_BRANCHEMENT_NAVITIA_AUTORISES = [
    join(RACINE, 'server/agents/enrichissementLiensTransport.ts'),
  ];

  it('ne référence Navitia que par le point de branchement F4-D2 autorisé', () => {
    const referencesDirectes = COUCHES_ACTIVES.flatMap((couche) =>
      fichiersSources(join(RACINE, couche)).filter(
        (chemin) =>
          !FICHIERS_BRANCHEMENT_NAVITIA_AUTORISES.includes(chemin) &&
          readFileSync(chemin, 'utf8').includes('services/navitia')
      )
    );

    expect(referencesDirectes).toEqual([]);
  });
});
