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
  DemandeSurElementClientSchema,
  ParcoursSchema,
  type DemandeModificationTransportClient,
  type Parcours,
} from '../../server/domaine/parcours/index.js';

// F4-E — modifier honnêtement la demande de transport, puis reconstruire les
// liens via la résolution prudente F4-D2. On teste ici le SERVICE : mise à jour
// de la demande, redérivation serveur des libellés, reconstruction ou absence
// prudente de lien, garde du nombre de trajets et responsabilité.
//
// Aucun réseau réel : les résolveurs Amadeus et Navitia sont mockés, leur
// classification pure `evaluer…` reste réelle.

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
const { rechercherGaresNavitia } = await import(
  '../../server/services/navitia/index.js'
);
const { appliquerModificationTransport } = await import(
  '../../server/services/modificationTransport.js'
);

const DATE = '2026-07-31T09:00:00.000Z';
const CONTEXTE = { auteurId: 'organisateur', horodatage: DATE };

function candidatAeroport(codeIata: string, ville: string): CandidatLieuAerien {
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

const rechercheOk = <T>(resultats: T[]) => ({
  statut: 'ok' as const,
  resultats,
  recupereLe: DATE,
});
const rechercheIndisponible = () => ({
  statut: 'indisponible' as const,
  fournisseur: 'Amadeus' as const,
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

function parcours(demandeTransport: DemandeTransport | undefined): Parcours {
  return ParcoursSchema.parse({
    id: 'parcours-test',
    intention: { texte: 'aller d’une ville à une autre' },
    contexte: {
      avecQui: 'amis',
      duree: { valeur: 2, unite: 'jours' },
      lieux: ['Bordeaux', 'Paris'],
      ...(demandeTransport ? { demandeTransport } : {}),
    },
    participants: [{ id: 'organisateur', nom: 'Organisateur', role: 'organisateur' }],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'moment-transport',
        titre: 'Transports à organiser',
        elements: (demandeTransport?.troncons ?? [demande(troncon(undefined)).troncons[0]]).map(
          (_, index) => ({
            id: `transport-${index}`,
            type: 'transport',
            nom: LIBELLE_TRANSPORT_GENERIQUE,
            justification: JUSTIFICATION_TRANSPORT_GENERIQUE,
            confiance: { niveau: 'suggestion' },
          })
        ),
      },
    ],
  });
}

function commande(
  demandeTransport: DemandeTransport
): DemandeModificationTransportClient {
  return { type: 'modifier_demande_transport', demandeTransport };
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

describe('F4-E — modification transport valide', () => {
  it('met à jour la demande et reconstruit le lien quand les deux aéroports se résolvent', async () => {
    vi.mocked(rechercherLieuxAeriens)
      .mockResolvedValueOnce(rechercheOk([candidatAeroport('BOD', 'Bordeaux')]))
      .mockResolvedValueOnce(rechercheOk([candidatAeroport('CDG', 'Paris')]));

    const resultat = await appliquerModificationTransport(
      parcours(demande(troncon(undefined))),
      commande(demande(troncon('avion'))),
      CONTEXTE
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(resultat.parcours.contexte.demandeTransport?.troncons[0].modeSouhaite).toBe('avion');
    const [element] = elementsTransport(resultat.parcours);
    expect(element.lienRechercheTransport?.type).toBe('recherche_vol');
    // Le libellé et la justification viennent du serveur, jamais du client.
    expect(element.nom).toContain('Bordeaux');
    expect(element.nom).toContain('Paris');
    expect(resultat.parcours.historique.at(-1)?.description).toBe(
      'Demande de transport mise à jour'
    );
  });
});

describe('F4-E — absence prudente de lien', () => {
  it('met à jour la demande sans lien quand un fournisseur est indisponible', async () => {
    vi.mocked(rechercherLieuxAeriens).mockResolvedValue(rechercheIndisponible());

    const resultat = await appliquerModificationTransport(
      parcours(demande(troncon(undefined))),
      commande(demande(troncon('avion'))),
      CONTEXTE
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    const [element] = elementsTransport(resultat.parcours);
    expect(element.lienRechercheTransport).toBeUndefined();
    expect(resultat.parcours.contexte.demandeTransport?.troncons[0].modeSouhaite).toBe('avion');
  });

  it('retire un ancien lien lorsque la résolution devient ambiguë', async () => {
    vi.mocked(rechercherLieuxAeriens).mockResolvedValue(
      rechercheOk([candidatAeroport('BOD', 'Bordeaux'), candidatAeroport('BOJ', 'Bordeaux')])
    );

    const base = parcours(demande(troncon('avion')));
    base.timeline[0].elements[0] = {
      ...base.timeline[0].elements[0],
      lienRechercheTransport: {
        type: 'recherche_vol',
        fournisseur: 'Google Flights',
        url: 'https://www.google.com/travel/flights',
        libelle: 'Rechercher des vols sur Google Flights',
        genereLe: DATE,
      },
    };

    const resultat = await appliquerModificationTransport(
      base,
      commande(demande(troncon('avion'))),
      CONTEXTE
    );

    if (!resultat.ok) throw new Error(resultat.erreur);
    expect(elementsTransport(resultat.parcours)[0].lienRechercheTransport).toBeUndefined();
  });
});

describe('F4-E — gardes fail-closed', () => {
  it('refuse lorsque le nombre de trajets diffère du nombre d’éléments transport', async () => {
    const resultat = await appliquerModificationTransport(
      parcours(demande(troncon('avion'))),
      commande(demande(troncon('avion'), troncon('train', 'Paris', 'Lyon'))),
      CONTEXTE
    );

    expect(resultat).toMatchObject({ ok: false, statutHttp: 422 });
    expect(vi.mocked(rechercherLieuxAeriens)).not.toHaveBeenCalled();
  });

  it('refuse lorsque le parcours ne porte aucune demande de transport', async () => {
    const resultat = await appliquerModificationTransport(
      parcours(undefined),
      commande(demande(troncon('avion'))),
      CONTEXTE
    );

    expect(resultat).toMatchObject({ ok: false, statutHttp: 422 });
  });

  it('refuse une modification signée par un rôle non responsable', async () => {
    const base = parcours(demande(troncon('avion')));
    base.participants.push({ id: 'heros', nom: 'Hugo', role: 'heros' });
    base.visibilite = 'surprise';

    const resultat = await appliquerModificationTransport(
      base,
      commande(demande(troncon('avion'))),
      { ...CONTEXTE, auteurId: 'heros' }
    );

    expect(resultat).toMatchObject({ ok: false, statutHttp: 403 });
  });
});

describe('F4-E — aucune identité fournisseur côté client', () => {
  it('rejette au contrat une ville qui désigne en réalité un aéroport ou une gare', () => {
    const brut = commande(demande(troncon('avion', 'Aéroport de Bordeaux', 'Paris')));
    expect(DemandeSurElementClientSchema.safeParse(brut).success).toBe(false);
  });

  it('rejette au contrat un code fournisseur glissé dans une ville', () => {
    const brut = commande(demande(troncon('avion', 'BOD', 'Paris')));
    expect(DemandeSurElementClientSchema.safeParse(brut).success).toBe(false);
  });
});
