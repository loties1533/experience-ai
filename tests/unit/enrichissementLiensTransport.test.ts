import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SOURCE_LIEUX_AMADEUS,
  type CandidatLieuAerien,
  type DemandeTransport,
  type ModeTransport,
  type TronconTransportDemande,
} from '../../server/domaine/transport/index.js';
import {
  JUSTIFICATION_TRANSPORT_GENERIQUE,
  LIBELLE_TRANSPORT_GENERIQUE,
} from '../../server/domaine/transport/invariants.js';
import {
  ParcoursSchema,
  type Parcours,
} from '../../server/domaine/parcours/index.js';

// F4-D2 — intégration des liens de recherche transport dans la génération.
//
// On teste ici uniquement le BRANCHEMENT : choix du mode éligible, résolution
// des deux extrémités, absence prudente en cas d'ambiguïté / vide /
// indisponibilité, et pose du lien F4-D1 au bon endroit. Les 35 invariants purs
// des constructeurs F4-D1 restent couverts par `liensTransport.test.ts`.
//
// Aucun réseau réel : les résolveurs Amadeus et Navitia sont mockés, mais leur
// classification `evaluer…` reste réelle (fonctions pures).

vi.mock('../../server/services/amadeus/index.js', async (importOriginal) => {
  const reel =
    await importOriginal<typeof import('../../server/services/amadeus/index.js')>();
  return { ...reel, rechercherLieuxAeriens: vi.fn() };
});
vi.mock('../../server/services/navitia/index.js', async (importOriginal) => {
  const reel =
    await importOriginal<typeof import('../../server/services/navitia/index.js')>();
  return { ...reel, rechercherGaresNavitia: vi.fn() };
});

const { rechercherLieuxAeriens } = await import(
  '../../server/services/amadeus/index.js'
);
const { rechercherGaresNavitia, FOURNISSEUR_NAVITIA } = await import(
  '../../server/services/navitia/index.js'
);
const { ajouterLiensRechercheTransport } = await import(
  '../../server/agents/enrichissementLiensTransport.js'
);

const DATE = '2026-07-31T09:00:00.000Z';

function candidatAeroport(
  codeIata: string,
  ville: string
): CandidatLieuAerien {
  return {
    type: 'aeroport',
    identifiantExterne: `airport-${codeIata}`,
    nom: `Aéroport de ${ville}`,
    ville,
    codePays: 'FR',
    codeIata,
    fournisseur: 'Amadeus',
    source: SOURCE_LIEUX_AMADEUS,
    recupereLe: DATE,
  };
}

function candidatVille(ville: string): CandidatLieuAerien {
  return {
    type: 'ville',
    identifiantExterne: `city-${ville}`,
    nom: ville,
    ville,
    codePays: 'FR',
    fournisseur: 'Amadeus',
    source: SOURCE_LIEUX_AMADEUS,
    recupereLe: DATE,
  };
}

const IDENTIFIANT_GARE_INTERDIT = 'stop_area:SNCF:87581009';
const CODE_UIC_INTERDIT = '87581009';

function candidatGare(nom: string) {
  return {
    fournisseur: FOURNISSEUR_NAVITIA,
    identifiantExterne: IDENTIFIANT_GARE_INTERDIT,
    nom,
    coordonnees: { latitude: 44.826, longitude: -0.556 },
    fuseauIana: 'Europe/Paris',
    code: { systeme: 'UIC' as const, valeur: CODE_UIC_INTERDIT },
    source: 'https://api.navitia.io/v1/coverage/fr/places',
    recupereLe: DATE,
  };
}

const rechercheOk = <T>(resultats: T[]) => ({
  statut: 'ok' as const,
  resultats,
  recupereLe: DATE,
});
const rechercheVide = () => ({ statut: 'vide' as const, recupereLe: DATE });
const rechercheIndisponible = (fournisseur: 'Amadeus' | 'Navitia') => ({
  statut: 'indisponible' as const,
  fournisseur,
  raison: 'reseau' as const,
});

function troncon(
  modeSouhaite: ModeTransport | undefined,
  origine = 'Bordeaux',
  destination = 'Paris'
): TronconTransportDemande {
  return {
    origine: { ville: origine },
    destination: { ville: destination },
    depart: { date: '2026-08-01' },
    ...(modeSouhaite ? { modeSouhaite } : {}),
  };
}

function demande(...troncons: TronconTransportDemande[]): DemandeTransport {
  return {
    troncons: troncons as DemandeTransport['troncons'],
    occupation: { statut: 'declaree', adultes: 2, enfants: 0 },
  };
}

/**
 * Un parcours minimal valide : un moment transport dédié portant un élément
 * transport générique par tronçon, dans l'ordre. Le reste du parcours est
 * réduit au strict nécessaire pour que le domaine l'accepte.
 */
function parcours(demandeTransport: DemandeTransport): Parcours {
  return ParcoursSchema.parse({
    id: 'parcours-test',
    intention: { texte: 'aller d’une ville à une autre' },
    contexte: {
      avecQui: 'amis',
      duree: { valeur: 2, unite: 'jours' },
      lieux: ['Bordeaux', 'Paris'],
      demandeTransport,
    },
    participants: [{ id: 'p1', nom: 'Organisateur', role: 'organisateur' }],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'moment-transport',
        titre: 'Transports à organiser',
        elements: demandeTransport.troncons.map((_, index) => ({
          id: `transport-${index}`,
          type: 'transport',
          nom: LIBELLE_TRANSPORT_GENERIQUE,
          justification: JUSTIFICATION_TRANSPORT_GENERIQUE,
          confiance: { niveau: 'suggestion' },
        })),
      },
    ],
  });
}

function elementsTransport(p: Parcours) {
  return p.timeline.flatMap((moment) =>
    moment.elements.filter((element) => element.type === 'transport')
  );
}

beforeEach(() => {
  vi.mocked(rechercherLieuxAeriens).mockReset();
  vi.mocked(rechercherGaresNavitia).mockReset();
});

describe('F4-D2 — résolution aérienne', () => {
  it('pose un lien Google Flights générique pour deux aéroports uniques et distincts', async () => {
    vi.mocked(rechercherLieuxAeriens)
      .mockResolvedValueOnce(rechercheOk([candidatAeroport('BOD', 'Bordeaux')]))
      .mockResolvedValueOnce(rechercheOk([candidatAeroport('CDG', 'Paris')]));

    const enrichi = await ajouterLiensRechercheTransport(
      parcours(demande(troncon('avion'))),
      demande(troncon('avion'))
    );

    const [element] = elementsTransport(enrichi);
    const lien = element.lienRechercheTransport;
    expect(lien?.type).toBe('recherche_vol');
    expect(lien?.fournisseur).toBe('Google Flights');
    expect(lien?.url).toBe('https://www.google.com/travel/flights');
    const url = new URL(lien?.url ?? '');
    expect(url.search).toBe('');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('tfs')).toBe(false);
    // Le parcours enrichi reste valide pour le domaine.
    expect(() => ParcoursSchema.parse(enrichi)).not.toThrow();
  });

  it('demande explicitement des aéroports : aucune ville n’est promue', async () => {
    vi.mocked(rechercherLieuxAeriens).mockResolvedValue(
      rechercheOk([candidatAeroport('BOD', 'Bordeaux')])
    );
    await ajouterLiensRechercheTransport(
      parcours(demande(troncon('avion'))),
      demande(troncon('avion'))
    );
    expect(rechercherLieuxAeriens).toHaveBeenCalledWith(
      expect.objectContaining({ preference: 'aeroport' })
    );
  });

  it('une résolution unique sans code IATA (ville) ne produit aucun lien', async () => {
    vi.mocked(rechercherLieuxAeriens).mockResolvedValue(
      rechercheOk([candidatVille('Bordeaux')])
    );
    const enrichi = await ajouterLiensRechercheTransport(
      parcours(demande(troncon('avion'))),
      demande(troncon('avion'))
    );
    expect(elementsTransport(enrichi)[0].lienRechercheTransport).toBeUndefined();
  });

  it('deux aéroports au même code IATA ne produisent aucun lien', async () => {
    vi.mocked(rechercherLieuxAeriens).mockResolvedValue(
      rechercheOk([candidatAeroport('CDG', 'Paris')])
    );
    const enrichi = await ajouterLiensRechercheTransport(
      parcours(demande(troncon('avion'))),
      demande(troncon('avion'))
    );
    expect(elementsTransport(enrichi)[0].lienRechercheTransport).toBeUndefined();
  });

  it.each([
    ['origine ambiguë', 'ambigu'],
    ['destination vide', 'vide'],
    ['fournisseur indisponible', 'indisponible'],
  ] as const)('%s : aucun lien', async (_titre, cas) => {
    const origine =
      cas === 'ambigu'
        ? rechercheOk([
            candidatAeroport('BOD', 'Bordeaux'),
            candidatAeroport('BOE', 'Bordeaux'),
          ])
        : rechercheOk([candidatAeroport('BOD', 'Bordeaux')]);
    const destination =
      cas === 'vide'
        ? rechercheVide()
        : cas === 'indisponible'
          ? rechercheIndisponible('Amadeus')
          : rechercheOk([candidatAeroport('CDG', 'Paris')]);
    vi.mocked(rechercherLieuxAeriens)
      .mockResolvedValueOnce(origine)
      .mockResolvedValueOnce(destination);

    const enrichi = await ajouterLiensRechercheTransport(
      parcours(demande(troncon('avion'))),
      demande(troncon('avion'))
    );
    expect(elementsTransport(enrichi)[0].lienRechercheTransport).toBeUndefined();
  });
});

describe('F4-D2 — résolution ferroviaire', () => {
  it('pose un lien Google Maps avec les noms de gares observés', async () => {
    vi.mocked(rechercherGaresNavitia)
      .mockResolvedValueOnce(rechercheOk([candidatGare('Bordeaux Saint-Jean')]))
      .mockResolvedValueOnce(rechercheOk([candidatGare('Paris Montparnasse')]));

    const enrichi = await ajouterLiensRechercheTransport(
      parcours(demande(troncon('train'))),
      demande(troncon('train'))
    );

    const lien = elementsTransport(enrichi)[0].lienRechercheTransport;
    expect(lien?.type).toBe('recherche_train');
    expect(lien?.fournisseur).toBe('Google Maps');
    const url = new URL(lien?.url ?? '');
    expect(url.searchParams.get('origin')).toBe('Bordeaux Saint-Jean');
    expect(url.searchParams.get('destination')).toBe('Paris Montparnasse');
    expect(url.searchParams.get('travelmode')).toBe('transit');
    // Aucun identifiant Navitia ni code UIC ne fuite dans l'URL.
    expect(lien?.url).not.toContain(IDENTIFIANT_GARE_INTERDIT);
    expect(lien?.url).not.toContain(CODE_UIC_INTERDIT);
    expect(() => ParcoursSchema.parse(enrichi)).not.toThrow();
  });

  it('deux gares de nom identique ne produisent aucun lien', async () => {
    vi.mocked(rechercherGaresNavitia).mockResolvedValue(
      rechercheOk([candidatGare('Gare Centrale')])
    );
    const enrichi = await ajouterLiensRechercheTransport(
      parcours(demande(troncon('train'))),
      demande(troncon('train'))
    );
    expect(elementsTransport(enrichi)[0].lienRechercheTransport).toBeUndefined();
  });

  it.each([
    ['ambiguë', 'ambigu'],
    ['vide', 'vide'],
    ['indisponible', 'indisponible'],
  ] as const)('résolution %s : aucun lien', async (_titre, cas) => {
    const destination =
      cas === 'vide'
        ? rechercheVide()
        : cas === 'indisponible'
          ? rechercheIndisponible('Navitia')
          : rechercheOk([
              candidatGare('Paris Nord'),
              candidatGare('Paris Est'),
            ]);
    vi.mocked(rechercherGaresNavitia)
      .mockResolvedValueOnce(rechercheOk([candidatGare('Bordeaux Saint-Jean')]))
      .mockResolvedValueOnce(destination);
    const enrichi = await ajouterLiensRechercheTransport(
      parcours(demande(troncon('train'))),
      demande(troncon('train'))
    );
    expect(elementsTransport(enrichi)[0].lienRechercheTransport).toBeUndefined();
  });
});

describe('F4-D2 — modes non couverts et invariants', () => {
  it.each(['voiture', 'bus', 'ferry', 'transport_local', 'autre'] as const)(
    'le mode %s ne déclenche aucune résolution ni aucun lien',
    async (mode) => {
      const enrichi = await ajouterLiensRechercheTransport(
        parcours(demande(troncon(mode))),
        demande(troncon(mode))
      );
      expect(elementsTransport(enrichi)[0].lienRechercheTransport).toBeUndefined();
      expect(rechercherLieuxAeriens).not.toHaveBeenCalled();
      expect(rechercherGaresNavitia).not.toHaveBeenCalled();
    }
  );

  it('un mode absent ne déclenche aucune résolution', async () => {
    const enrichi = await ajouterLiensRechercheTransport(
      parcours(demande(troncon(undefined))),
      demande(troncon(undefined))
    );
    expect(elementsTransport(enrichi)[0].lienRechercheTransport).toBeUndefined();
    expect(rechercherLieuxAeriens).not.toHaveBeenCalled();
    expect(rechercherGaresNavitia).not.toHaveBeenCalled();
  });

  it('sans demande de transport, le parcours ressort inchangé', async () => {
    const p = parcours(demande(troncon('avion')));
    const enrichi = await ajouterLiensRechercheTransport(p, undefined);
    expect(enrichi).toBe(p);
    expect(rechercherLieuxAeriens).not.toHaveBeenCalled();
  });

  it('ne modifie ni le nom, ni la justification, ni la confiance du transport', async () => {
    vi.mocked(rechercherLieuxAeriens)
      .mockResolvedValueOnce(rechercheOk([candidatAeroport('BOD', 'Bordeaux')]))
      .mockResolvedValueOnce(rechercheOk([candidatAeroport('CDG', 'Paris')]));
    const enrichi = await ajouterLiensRechercheTransport(
      parcours(demande(troncon('avion'))),
      demande(troncon('avion'))
    );
    const [element] = elementsTransport(enrichi);
    expect(element.nom).toBe(LIBELLE_TRANSPORT_GENERIQUE);
    expect(element.justification).toBe(JUSTIFICATION_TRANSPORT_GENERIQUE);
    expect(element.confiance.niveau).toBe('suggestion');
  });

  it('associe chaque lien au bon tronçon (avion puis train)', async () => {
    vi.mocked(rechercherLieuxAeriens)
      .mockResolvedValueOnce(rechercheOk([candidatAeroport('BOD', 'Bordeaux')]))
      .mockResolvedValueOnce(rechercheOk([candidatAeroport('CDG', 'Paris')]));
    vi.mocked(rechercherGaresNavitia)
      .mockResolvedValueOnce(rechercheOk([candidatGare('Paris Montparnasse')]))
      .mockResolvedValueOnce(rechercheOk([candidatGare('Bordeaux Saint-Jean')]));

    const d = demande(
      troncon('avion', 'Bordeaux', 'Paris'),
      troncon('train', 'Paris', 'Bordeaux')
    );
    const enrichi = await ajouterLiensRechercheTransport(parcours(d), d);
    const [premier, second] = elementsTransport(enrichi);
    expect(premier.lienRechercheTransport?.type).toBe('recherche_vol');
    expect(second.lienRechercheTransport?.type).toBe('recherche_train');
  });
});

describe('F4-D2 — architecture', () => {
  const racine = fileURLToPath(new URL('../../', import.meta.url));
  const lire = (chemin: string) => readFileSync(`${racine}${chemin}`, 'utf-8');

  it('generation.ts branche l’enrichissement sans assembler d’URL transport', () => {
    const contenu = lire('server/agents/generation.ts');
    expect(contenu).toContain('ajouterLiensRechercheTransport');
    expect(contenu).not.toContain('travel/flights');
    expect(contenu).not.toContain('/maps/dir/');
  });

  it('l’enrichissement délègue les URLs aux constructeurs F4-D1', () => {
    const contenu = lire('server/agents/enrichissementLiensTransport.ts');
    expect(contenu).toContain('creerLienRechercheVol');
    expect(contenu).toContain('creerLienRechercheTrain');
    // Aucune URL assemblée à la main, aucun paramètre Google Flights non documenté.
    expect(contenu).not.toContain('new URL(');
    expect(contenu).not.toContain('travel/flights');
    expect(contenu).not.toContain('tfs');
    expect(contenu).not.toContain("searchParams");
  });

  it('l’enrichissement n’importe ni front, ni routes, ni Prisma', () => {
    const contenu = lire('server/agents/enrichissementLiensTransport.ts');
    expect(contenu).not.toContain('client-react');
    expect(contenu).not.toContain('prisma');
    expect(contenu).not.toContain('routes/');
  });
});
