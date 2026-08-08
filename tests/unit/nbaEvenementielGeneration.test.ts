import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn(), callAIAvecOutils: vi.fn() };
});
vi.mock('../../server/services/liens.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/liens.js')>();
  return { ...reel, resoudreLien: vi.fn(), resoudreLiensReels: vi.fn() };
});
vi.mock('../../server/services/foursquare.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/foursquare.js')>();
  return { ...reel, rechercherLieuxFoursquare: vi.fn() };
});

const { callAIAvecOutils } = await import('../../server/services/claude/core.js');
const { resoudreLien } = await import('../../server/services/liens.js');
const { rechercherLieuxFoursquare } = await import('../../server/services/foursquare.js');
const { viderCacheMemoire } = await import('../../server/lib/cacheMemoire.js');
const { BriefSchema } = await import('../../server/agents/brief.js');
const { genererParcours } = await import('../../server/agents/generation.js');
const { ContextePlanifiableSchema } = await import(
  '../../server/agents/generation/contratPreparation.js'
);

function ancre(identifiantExterne: string, ville: string, dateDebut: string) {
  return {
    identifiantExterne,
    nom: `Match réel ${identifiantExterne}`,
    ville,
    codePays: 'US',
    dateDebut,
    dateFin: dateDebut.replace('00:30:00.000Z', '03:00:00.000Z'),
    salle: `Salle ${ville}`,
    categorieFournisseur: 'sports',
    fournisseur: 'PredictHQ' as const,
    source: 'https://api.predicthq.com/v1/events/',
    recupereLe: '2026-08-08T12:00:00.000Z',
  };
}

const BRIEF = BriefSchema.parse({
  intention: 'Vivre la NBA pendant plusieurs semaines',
  avecQui: 'amis',
  duree: { valeur: 3, unite: 'semaines' },
  dates: { debut: '2027-01-15T00:00:00.000Z', fin: '2027-02-10T23:59:59.999Z' },
  lieux: [],
});

const BRIEF_HOTEL = BriefSchema.parse({
  intention: 'Vivre la NBA ; voir des matchs en direct',
  avecQui: 'solo',
  duree: { valeur: 3, unite: 'semaines' },
  dates: { debut: '2027-01-15T00:00:00.000Z', fin: '2027-02-10T00:00:00.000Z' },
  lieux: ['États-Unis'],
  budgetTotal: 9000,
  hebergement: {
    necessaire: true,
    occupation: {
      statut: 'declaree',
      adultes: 1,
      enfants: 0,
      chambres: 1,
    },
    sejours: [],
  },
});

const CONTEXTE = ContextePlanifiableSchema.parse({
  strategie: 'decouverte_evenementielle',
  etapes: [
    {
      ville: { nom: 'Boston', origine: 'fournisseur' },
      plage: { debut: '2027-01-15', fin: '2027-01-22' },
      ancres: [ancre('evt-boston', 'Boston', '2027-01-18T00:30:00.000Z')],
    },
    {
      ville: { nom: 'New York', origine: 'fournisseur' },
      plage: { debut: '2027-01-23', fin: '2027-01-31' },
      ancres: [ancre('evt-new-york', 'New York', '2027-01-25T00:30:00.000Z')],
    },
    {
      ville: { nom: 'Chicago', origine: 'fournisseur' },
      plage: { debut: '2027-02-01', fin: '2027-02-10' },
      ancres: [ancre('evt-chicago', 'Chicago', '2027-02-02T00:30:00.000Z')],
    },
  ],
  contraintesConservees: { dates: BRIEF.dates },
});

describe('NBA event-first — génération progressive depuis des ancres fournisseur', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viderCacheMemoire();
    vi.mocked(callAIAvecOutils).mockImplementation(async (prompt) => {
      const debut = prompt.indexOf('{');
      const fin = prompt.lastIndexOf('}');
      const briefLot = JSON.parse(prompt.slice(debut, fin + 1)) as { lieux: string[] };
      const ville = briefLot.lieux[0];
      // Le modèle n'écrit aucun match : l'ancre doit être réhydratée côté serveur.
      return JSON.stringify({
        moments: [
          {
            titre: `Découverte ${ville}`,
            ville,
            elements: [
              {
                ref: 'activite',
                type: 'activite',
                nom: 'Une activité libre',
                justification: 'Découvrir la ville entre les matchs.',
              },
            ],
          },
        ],
      });
    });
    vi.mocked(resoudreLien).mockResolvedValue({ statut: 'vide' } as never);
  });

  it('conserve les villes moteur et les événements vérifiés sans muter le Brief', async () => {
    const parcours = await genererParcours(BRIEF, null, {}, CONTEXTE);
    const evenements = parcours.timeline.flatMap((moment) =>
      moment.elements.filter((element) => element.type === 'evenement')
    );

    expect(parcours.contexte.lieux).toEqual(['Boston', 'New York', 'Chicago']);
    expect(BRIEF.lieux).toEqual([]);
    expect(evenements.map((element) => element.nom)).toEqual([
      'Match réel evt-boston',
      'Match réel evt-new-york',
      'Match réel evt-chicago',
    ]);
    expect(evenements.every((element) => element.estAncre)).toBe(true);
    expect(evenements.every((element) => element.confiance.niveau === 'verifie')).toBe(true);
    expect(evenements.map((element) => element.confiance.identifiantExterne)).toEqual([
      'evt-boston',
      'evt-new-york',
      'evt-chicago',
    ]);
    const transports = parcours.timeline.flatMap((moment) =>
      moment.elements.filter((element) => element.type === 'transport')
    );
    expect(transports).toHaveLength(2);
    expect(transports.every((element) => element.nom === 'Transport à organiser')).toBe(true);
    expect(transports.every((element) => element.lieu === undefined && element.plage === undefined)).toBe(true);
    expect(vi.mocked(callAIAvecOutils)).toHaveBeenCalled();
  });

  it('cherche des hôtels dans les villes moteur sans inventer séjour ni lien daté', async () => {
    const briefsLots: Array<Record<string, unknown>> = [];
    const avant = JSON.stringify(BRIEF_HOTEL);
    vi.mocked(rechercherLieuxFoursquare).mockImplementation(
      async (villeDemandee) => ({
        statut: 'ok',
        recupereLe: '2026-08-08T12:00:00.000Z',
        resultats: [
          {
            identifiantExterne: `fsq-hotel-${villeDemandee}`,
            nom: `Hôtel réel ${villeDemandee}`,
            villeDemandee,
            villeConfirmee: villeDemandee,
            categorieFournisseur: 'Hotel',
            identifiantCategorieFournisseur: '19014',
            typeMetierRecherche: 'hebergement',
            adresse: `Adresse réelle ${villeDemandee}`,
            fournisseur: 'Foursquare',
            source: 'https://places-api.foursquare.com/places/search',
            recupereLe: '2026-08-08T12:00:00.000Z',
          },
        ],
      })
    );
    vi.mocked(callAIAvecOutils).mockImplementation(
      async (prompt, _system, boite) => {
        const debut = prompt.indexOf('{');
        const fin = prompt.lastIndexOf('}');
        const briefLot = JSON.parse(prompt.slice(debut, fin + 1)) as {
          lieux: string[];
          hebergement?: unknown;
        };
        briefsLots.push(briefLot);
        const ville = briefLot.lieux[0];
        await boite.executer('chercher_lieux', {
          ville,
          requete: 'hôtel',
          typeMetierRecherche: 'hebergement',
        });
        return JSON.stringify({
          moments: [
            {
              titre: `Hébergement à ${ville}`,
              ville,
              elements: [
                {
                  ref: 'hotel',
                  type: 'hebergement',
                  identifiantExterne: `fsq-hotel-${ville}`,
                  nom: `Hôtel réel ${ville}`,
                  justification: 'Dormir dans la ville retenue par le moteur.',
                },
              ],
            },
          ],
        });
      }
    );

    const parcours = await genererParcours(BRIEF_HOTEL, null, {}, CONTEXTE);
    const hotels = parcours.timeline.flatMap((moment) =>
      moment.elements.filter((element) => element.type === 'hebergement')
    );

    expect(briefsLots.length).toBeGreaterThan(0);
    expect(
      briefsLots.every((briefLot) =>
        JSON.stringify(briefLot.hebergement) ===
        JSON.stringify(BRIEF_HOTEL.hebergement)
      )
    ).toBe(true);
    expect(parcours.contexte.lieux).toEqual(['Boston', 'New York', 'Chicago']);
    expect(parcours.contexte.occupationHebergement).toEqual(
      BRIEF_HOTEL.hebergement.occupation
    );
    expect(hotels.length).toBeGreaterThan(0);
    expect(
      hotels.every(
        (hotel) =>
          hotel.confiance.niveau === 'verifie' &&
          hotel.confiance.fournisseur === 'Foursquare'
      )
    ).toBe(true);
    expect(hotels.every((hotel) => hotel.sejourHebergement === undefined)).toBe(true);
    expect(hotels.every((hotel) => hotel.lienRechercheHebergement === undefined)).toBe(true);
    expect(hotels.every((hotel) => hotel.reservation === undefined)).toBe(true);
    expect(JSON.stringify(BRIEF_HOTEL)).toBe(avant);
  });

  it('refuse toujours une occupation NBA incomplète avant tout appel externe', async () => {
    const brief = BriefSchema.parse({
      ...BRIEF_HOTEL,
      hebergement: {
        necessaire: true,
        occupation: { statut: 'a_confirmer', adultes: 1 },
        sejours: [],
      },
    });

    await expect(genererParcours(brief, null, {}, CONTEXTE)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(callAIAvecOutils).not.toHaveBeenCalled();
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('conserve un séjour utilisateur explicite dans sa ville moteur', async () => {
    const sejourBoston = {
      ville: 'Boston',
      arrivee: '2027-01-16',
      depart: '2027-01-20',
    };
    const brief = BriefSchema.parse({
      ...BRIEF_HOTEL,
      hebergement: {
        ...BRIEF_HOTEL.hebergement,
        sejours: [sejourBoston],
      },
    });
    const avant = JSON.stringify(brief);
    const briefsLots: Array<Record<string, unknown>> = [];
    vi.mocked(callAIAvecOutils).mockImplementation(async (prompt) => {
      const debut = prompt.indexOf('{');
      const fin = prompt.lastIndexOf('}');
      const briefLot = JSON.parse(
        prompt.slice(debut, fin + 1)
      ) as Record<string, unknown>;
      briefsLots.push(briefLot);
      const ville = (briefLot.lieux as string[])[0];
      return JSON.stringify({
        moments: [
          {
            titre: `Découverte ${ville}`,
            ville,
            elements: [
              {
                ref: 'activite',
                type: 'activite',
                nom: 'Une activité libre',
                justification: 'Découvrir la ville entre les matchs.',
              },
            ],
          },
        ],
      });
    });

    await expect(genererParcours(brief, null, {}, CONTEXTE)).resolves.toBeDefined();
    const lotBoston = briefsLots.find(
      (briefLot) => (briefLot.lieux as string[])[0] === 'Boston'
    );
    expect(lotBoston?.hebergement).toMatchObject({ sejours: [sejourBoston] });
    expect(JSON.stringify(brief)).toBe(avant);
  });

  it('ne relâche pas la validation sejours vide pour une demande non NBA', async () => {
    const brief = BriefSchema.parse({
      ...BRIEF_HOTEL,
      intention: 'Découvrir la scène musicale américaine',
    });

    await expect(genererParcours(brief, null, {}, CONTEXTE)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(callAIAvecOutils).not.toHaveBeenCalled();
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('refuse un séjour utilisateur hors des villes découvertes', async () => {
    const brief = BriefSchema.parse({
      ...BRIEF_HOTEL,
      hebergement: {
        ...BRIEF_HOTEL.hebergement,
        sejours: [
          {
            ville: 'Los Angeles',
            arrivee: '2027-01-20',
            depart: '2027-01-22',
          },
        ],
      },
    });

    await expect(genererParcours(brief, null, {}, CONTEXTE)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(callAIAvecOutils).not.toHaveBeenCalled();
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });
});
