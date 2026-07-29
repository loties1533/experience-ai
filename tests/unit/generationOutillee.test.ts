import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  DemandeResolutionLien,
  ResultatResolutionLien,
} from '../../server/services/liens/contrat.js';

// L'orchestrateur va chercher de VRAIS lieux avant d'écrire (sprint R6).
//
// Rien n'appelle ici la moindre API : le transport Anthropic est mocké (on
// scénarise ses tours), les trois connecteurs aussi. Ce qui est réellement
// exercé, c'est la boucle d'outils, le cache, le repli quand une recherche ne
// rend rien, et la frontière de méfiance envers la sortie du modèle.

// La boucle d'outils n'existe que sur l'API Anthropic. On pose une clé factice
// pour l'activer ; sans elle, F1 exige une indisponibilité technique explicite.
process.env.ANTHROPIC_API_KEY = 'cle-de-test-vitest';

vi.mock('../../server/services/providers.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/providers.js')>();
  return { ...reel, callClaude: vi.fn(), callClaudeOutils: vi.fn() };
});
vi.mock('../../server/services/foursquare.js', async (importOriginal) => {
  const reel =
    await importOriginal<typeof import('../../server/services/foursquare.js')>();
  return { ...reel, rechercherLieuxFoursquare: vi.fn() };
});
vi.mock('../../server/services/predictHQ.js', () => ({
  rechercherEvenementsPredictHQ: vi.fn(),
}));
vi.mock('../../server/services/weather.js', () => ({ getRealWeather: vi.fn() }));
// Le résolveur de liens a sa propre suite : ici, on teste uniquement son
// intégration dans la génération. Les fonctions pures restent réelles.
vi.mock('../../server/services/liens.js', async (importOriginal) => {
  const reel =
    await importOriginal<typeof import('../../server/services/liens.js')>();
  return {
    ...reel,
    resoudreLien: vi.fn(),
    resoudreLiensReels: vi.fn(),
  };
});

const { callClaude, callClaudeOutils } = await import('../../server/services/providers.js');
const { rechercherLieuxFoursquare } = await import('../../server/services/foursquare.js');
const { rechercherEvenementsPredictHQ } = await import('../../server/services/predictHQ.js');
const { getRealWeather } = await import('../../server/services/weather.js');
const { resoudreLien, resoudreLiensReels } = await import(
  '../../server/services/liens.js'
);
const { creerBoiteAOutils } = await import('../../server/services/claude/outils.js');
const { MAX_TOURS_OUTILS } = await import('../../server/services/claude/core.js');
const { viderCacheMemoire } = await import('../../server/lib/cacheMemoire.js');
const { genererParcours } = await import('../../server/agents/generation.js');
const { BriefSchema } = await import('../../server/agents/brief.js');

type BlocReponse = Awaited<ReturnType<typeof callClaudeOutils>>[number];

const brief = BriefSchema.parse({
  intention: "organiser l'EVG de Max",
  avecQui: 'groupe',
  duree: { valeur: 2, unite: 'jours' },
  lieux: ['Bordeaux'],
});

const DATE_RECUPERATION = '2026-07-28T08:15:00.000Z';
const CANDIDAT_POINT_ROUGE = {
  identifiantExterne: 'fsq-point-rouge',
  nom: 'Le Point Rouge',
  villeDemandee: 'Bordeaux',
  categorieFournisseur: 'Cocktail Bar',
  typeMetierRecherche: 'sortie' as const,
  adresse: '3 rue Sainte-Colombe, Bordeaux',
  lienCarte: 'https://www.google.com/maps/search/?api=1&query=Le%20Point%20Rouge%20Bordeaux',
  fournisseur: 'Foursquare' as const,
  source: 'https://places-api.foursquare.com/places/search',
  recupereLe: DATE_RECUPERATION,
};

const RECHERCHE_LIEUX_OK = {
  statut: 'ok' as const,
  resultats: [CANDIDAT_POINT_ROUGE],
  recupereLe: DATE_RECUPERATION,
};

const RECHERCHE_EVENEMENTS_VIDE = {
  statut: 'vide' as const,
  resultats: [] as [],
  recupereLe: DATE_RECUPERATION,
};

function lienIntrouvable(): ResultatResolutionLien {
  return {
    statut: 'introuvable',
    cleDemande: 'demande-test',
    fournisseurRecherche: 'Tavily',
    recupereLe: DATE_RECUPERATION,
  };
}

function lienResolu(
  url = 'https://www.thefork.fr/restaurant/le-point-rouge-r12345',
  typeLien: 'reservation' | 'billetterie' = 'reservation',
): ResultatResolutionLien {
  return {
    statut: 'resolu',
    cleDemande: 'demande-test',
    urlInitiale: url,
    url,
    typeLien,
    domaine: new URL(url).hostname,
    rang: 1,
    fournisseurRecherche: 'Tavily',
    recupereLe: DATE_RECUPERATION,
    preuves: [
      { nature: 'nom_exact', valeur: 'Le Point Rouge' },
      { nature: 'ville', valeur: 'Bordeaux' },
      { nature: 'page_exacte', valeur: url },
    ],
    redirections: [],
    controleLe: DATE_RECUPERATION,
    statutHttp: 200,
  };
}

function candidatLieu(args: {
  identifiantExterne: string;
  nom: string;
  villeDemandee: string;
  villeConfirmee?: string;
  typeMetierRecherche:
    | 'restaurant'
    | 'activite'
    | 'sortie'
    | 'hebergement';
  adresse?: string;
  categorieFournisseur?: string;
  identifiantCategorieFournisseur?: string;
}) {
  return {
    identifiantExterne: args.identifiantExterne,
    nom: args.nom,
    villeDemandee: args.villeDemandee,
    villeConfirmee: args.villeConfirmee,
    categorieFournisseur:
      args.categorieFournisseur ?? 'Catégorie de test',
    identifiantCategorieFournisseur:
      args.identifiantCategorieFournisseur,
    typeMetierRecherche: args.typeMetierRecherche,
    adresse: args.adresse,
    ...(args.typeMetierRecherche === 'hebergement'
      ? {}
      : {
          lienCarte: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            `${args.nom} ${args.villeDemandee}`
          )}`,
        }),
    fournisseur: 'Foursquare' as const,
    source: 'https://places-api.foursquare.com/places/search',
    recupereLe: DATE_RECUPERATION,
  };
}

function candidatHotel(args: {
  identifiantExterne: string;
  nom: string;
  villeDemandee: string;
  villeConfirmee?: string;
  adresse?: string;
  categorieFournisseur?: string;
  identifiantCategorieFournisseur?: string;
}) {
  return candidatLieu({
    ...args,
    typeMetierRecherche: 'hebergement',
    categorieFournisseur:
      args.categorieFournisseur ?? 'Hotel',
    identifiantCategorieFournisseur:
      args.identifiantCategorieFournisseur ?? '19014',
  });
}

function candidatEvenement(args: {
  identifiantExterne: string;
  nom: string;
  villeDemandee: string;
  salle?: string;
  dateDebut: string;
  dateFin?: string;
}) {
  return {
    identifiantExterne: args.identifiantExterne,
    nom: args.nom,
    villeDemandee: args.villeDemandee,
    villeConfirmee: args.villeDemandee,
    salle: args.salle,
    categorieFournisseur: 'concerts',
    typeMetierRecherche: 'evenement' as const,
    fournisseur: 'PredictHQ' as const,
    source: 'https://api.predicthq.com/v1/events/',
    recupereLe: DATE_RECUPERATION,
    dateDebut: args.dateDebut,
    dateFin: args.dateFin,
    description: 'Événement de test',
  };
}

/** Le tour où le modèle demande une recherche. */
function tourOutil(nom: string, entree: unknown, id = 'outil-1'): BlocReponse[] {
  return [{ type: 'tool_use', id, name: nom, input: entree }];
}

/** Le tour où il conclut : le parcours, en JSON. */
function tourReponse(
  nomElement: string,
  options: {
    type?:
      | 'activite'
      | 'restaurant'
      | 'sortie'
      | 'hebergement'
      | 'evenement';
    ville?: string;
    identifiantExterne?: string;
    estAncre?: boolean;
    lieu?: string;
    prix?: number;
  } = {}
): BlocReponse[] {
  return [
    {
      type: 'text',
      text: JSON.stringify({
        ambiance: 'festive',
        moments: [
          {
            titre: 'Le samedi soir',
            ville: options.ville,
            elements: [
              {
                ref: 'bar-1',
                type: options.type ?? 'sortie',
                identifiantExterne: options.identifiantExterne,
                nom: nomElement,
                lieu: options.lieu,
                prix: options.prix,
                estAncre: options.estAncre,
                justification: 'le temps fort de la soirée',
              },
            ],
          },
        ],
      }),
    },
  ];
}

function tourRefus(
  message: string,
  besoinEssentiel?:
    | {
        typeMetierRecherche: 'restaurant' | 'activite' | 'sortie';
        villeDemandee: string;
        requete: string;
      }
    | {
        typeMetierRecherche: 'evenement';
        villeDemandee: string;
        dateDebut: string;
        dateFin: string;
      }
): BlocReponse[] {
  return [
    {
      type: 'text',
      text: JSON.stringify({
        refus: {
          code: 'donnees_essentielles_insuffisantes',
          message,
          besoinEssentiel,
        },
      }),
    },
  ];
}

beforeEach(() => {
  vi.mocked(callClaude).mockReset();
  vi.mocked(callClaudeOutils).mockReset();
  vi.mocked(rechercherLieuxFoursquare).mockReset().mockResolvedValue(RECHERCHE_LIEUX_OK);
  vi.mocked(rechercherEvenementsPredictHQ)
    .mockReset()
    .mockResolvedValue(RECHERCHE_EVENEMENTS_VIDE);
  vi.mocked(getRealWeather).mockReset().mockResolvedValue(null);
  vi.mocked(resoudreLien).mockReset().mockResolvedValue(lienIntrouvable());
  vi.mocked(resoudreLiensReels).mockReset().mockResolvedValue(new Map());
  viderCacheMemoire();
});

describe('la boucle d’outils — le modèle cherche, puis écrit', () => {
  it('exécute la recherche demandée et rend le résultat réel au modèle', async () => {
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'bar à cocktails',
          typeMetierRecherche: 'sortie',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Le Point Rouge', { identifiantExterne: 'fsq-point-rouge' })
      );

    const parcours = await genererParcours(brief);

    expect(rechercherLieuxFoursquare).toHaveBeenCalledWith(
      'Bordeaux',
      'bar à cocktails',
      'sortie',
      4
    );
    expect(callClaudeOutils).toHaveBeenCalledTimes(2);

    // Le second tour renvoie le résultat de l'outil au modèle, rattaché à sa demande.
    const messagesDuSecondTour = vi.mocked(callClaudeOutils).mock.calls[1][1];
    const resultats = messagesDuSecondTour[2].content as Array<{ type: string; tool_use_id: string; content: string }>;
    expect(resultats[0].type).toBe('tool_result');
    expect(resultats[0].tool_use_id).toBe('outil-1');
    expect(resultats[0].content).toContain('Le Point Rouge');

    expect(parcours.timeline[0].elements[0].nom).toBe('Le Point Rouge');
    expect(parcours.timeline[0].elements[0].reservation).toBeUndefined();
    expect(resoudreLien).toHaveBeenCalledOnce();
  });

  it('ne contacte aucun fournisseur pour un transport F4-B2', async () => {
    const briefTransport = BriefSchema.parse({
      intention: 'relier Bordeaux et Paris',
      avecQui: 'amis',
      duree: { valeur: 3, unite: 'jours' },
      lieux: ['Bordeaux', 'Paris'],
      transport: {
        necessaire: true,
        troncons: [
          {
            origine: { ville: 'Bordeaux' },
            destination: { ville: 'Paris' },
            depart: { date: '2026-09-10', creneau: 'matin' },
            modeSouhaite: 'train',
          },
        ],
        occupation: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
        },
      },
    });
    vi.mocked(callClaudeOutils).mockResolvedValueOnce([
      {
        type: 'text',
        text: JSON.stringify({
          moments: [
            {
              titre: 'TGV 8421 à 09:42',
              elements: [
                {
                  ref: 'train',
                  type: 'transport',
                  nom: 'TGV 8421',
                  lieu: 'Gare Montparnasse',
                  plage: {
                    debut: '2026-09-10T09:42:00Z',
                    fin: '2026-09-10T11:18:00Z',
                  },
                  justification: 'Train disponible',
                },
              ],
            },
          ],
        }),
      },
    ]);

    const parcours = await genererParcours(briefTransport);

    expect(parcours.timeline[0].elements[0].nom).toBe(
      'Transport à organiser de Bordeaux vers Paris'
    );
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
    expect(rechercherEvenementsPredictHQ).not.toHaveBeenCalled();
    expect(getRealWeather).not.toHaveBeenCalled();
    expect(resoudreLien).not.toHaveBeenCalled();
    expect(resoudreLiensReels).not.toHaveBeenCalled();
  });

  it('intègre un lien accepté avec son type sans remplacer la provenance métier', async () => {
    vi.mocked(resoudreLien).mockResolvedValueOnce(lienResolu());
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'bar',
          typeMetierRecherche: 'sortie',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Le Point Rouge', { identifiantExterne: 'fsq-point-rouge' })
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.lieu).toBe('3 rue Sainte-Colombe, Bordeaux');
    expect(resoudreLien).toHaveBeenCalledWith({
      identifiantExterne: 'fsq-point-rouge',
      nom: 'Le Point Rouge',
      villeDemandee: 'Bordeaux',
      adresseOuSalle: '3 rue Sainte-Colombe, Bordeaux',
      typeMetierRecherche: 'sortie',
      fournisseurMetier: 'Foursquare',
      sourceMetier: 'https://places-api.foursquare.com/places/search',
    } satisfies DemandeResolutionLien);
    expect(element.reservation).toEqual({
      lienExterne:
        'https://www.thefork.fr/restaurant/le-point-rouge-r12345',
      fournisseur: 'Tavily',
      typeLien: 'reservation',
    });
    expect(element.confiance).toMatchObject({
      niveau: 'verifie',
      source: 'https://places-api.foursquare.com/places/search',
      fournisseur: 'Foursquare',
      identifiantExterne: 'fsq-point-rouge',
    });
    if (element.confiance.niveau !== 'verifie') throw new Error('preuve attendue');
    expect(Number.isNaN(Date.parse(element.confiance.recupereLe))).toBe(false);
  });

  it('ne rattache aucun lien à un nom que le modèle a inventé', async () => {
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'bar',
          typeMetierRecherche: 'sortie',
        })
      )
      .mockResolvedValueOnce(tourReponse('Bar à cocktails réputé du centre'));

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.reservation).toBeUndefined();
    expect(element.lieu).toBeUndefined();
  });

  it('borne le nombre de tours : au dernier, les outils sont retirés', async () => {
    vi.mocked(callClaudeOutils).mockImplementation(async (_systeme, _messages, outils) =>
      outils
        ? tourOutil('chercher_lieux', {
            ville: 'Bordeaux',
            requete: 'bar',
            typeMetierRecherche: 'sortie',
          })
        : tourReponse('Le Point Rouge', { identifiantExterne: 'fsq-point-rouge' })
    );

    await genererParcours(brief);

    // MAX_TOURS_OUTILS tours de recherche, plus le tour de conclusion.
    expect(callClaudeOutils).toHaveBeenCalledTimes(MAX_TOURS_OUTILS + 1);
    expect(vi.mocked(callClaudeOutils).mock.calls.at(-1)?.[2]).toBeUndefined();
  });
});

describe('la dégradation explicite des données réelles', () => {
  it('reste générique et marque suggestion quand une recherche exécutée ne rend rien', async () => {
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValue({
      statut: 'vide',
      resultats: [],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'bar',
          typeMetierRecherche: 'sortie',
        })
      )
      .mockResolvedValueOnce(tourReponse('Un bar à cocktails du centre'));

    const parcours = await genererParcours(brief);

    const resultats = vi.mocked(callClaudeOutils).mock.calls[1][1][2].content as Array<{ content: string }>;
    expect(resultats[0].content).toContain('Aucun résultat réel');
    expect(parcours.timeline[0].elements[0].nom).toBe('Une sortie à choisir à Bordeaux');
    expect(parcours.timeline[0].elements[0].confiance).toEqual({ niveau: 'suggestion' });
  });

  it('continue quand le connecteur tombe en panne', async () => {
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValue({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'reseau',
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'bar',
          typeMetierRecherche: 'sortie',
        })
      )
      .mockResolvedValueOnce(tourReponse('Un bar du centre'));

    const [element] = (await genererParcours(brief)).timeline[0].elements;
    expect(element.nom).toBe('Une sortie à choisir à Bordeaux');
    expect(element.lieu).toBeUndefined();
    expect(element.confiance).toEqual({ niveau: 'suggestion' });
    expect(element.reservation).toBeUndefined();
  });

  it('signale une panne technique quand la boucle d’outils elle-même échoue', async () => {
    vi.mocked(callClaudeOutils).mockRejectedValue(new Error('quota dépassé'));

    await expect(genererParcours(brief)).rejects.toMatchObject({ statusCode: 503 });
    expect(callClaude).not.toHaveBeenCalled();
  });

  it('ne répond jamais un message technique sur une sortie inexploitable', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValue([{ type: 'text', text: 'Je ne peux pas construire ce parcours.' }]);
    await expect(genererParcours(brief)).rejects.toThrow('inexploitable');
  });

  it('signale un service indisponible (503) quand la boucle outillée ne répond plus', async () => {
    vi.mocked(callClaudeOutils).mockRejectedValue(new Error('quota dépassé'));
    await expect(genererParcours(brief)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('distingue un refus métier (422) quand une donnée essentielle manque', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValueOnce(
      tourRefus('Le match demandé ne peut pas être confirmé sur ces dates.')
    );

    await expect(genererParcours(brief)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Le match demandé ne peut pas être confirmé sur ces dates.',
    });
  });

  it('répond 422 quand une recherche événementielle essentielle est réellement vide', async () => {
    vi.mocked(rechercherEvenementsPredictHQ).mockResolvedValue(RECHERCHE_EVENEMENTS_VIDE);
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_evenements', {
          ville: 'Bordeaux',
          dateDebut: '2026-09-04',
          dateFin: '2026-09-06',
        })
      )
      .mockResolvedValueOnce(
        tourRefus('Aucun événement fiable ne correspond aux dates.', {
          typeMetierRecherche: 'evenement',
          villeDemandee: 'Bordeaux',
          dateDebut: '2026-09-04',
          dateFin: '2026-09-06',
        })
      );

    await expect(genererParcours(brief)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Aucun événement fiable ne correspond aux dates.',
    });
  });

  it('répond 503 quand la recherche essentielle est techniquement indisponible', async () => {
    vi.mocked(rechercherEvenementsPredictHQ).mockResolvedValue({
      statut: 'indisponible',
      fournisseur: 'PredictHQ',
      raison: 'timeout',
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_evenements', {
          ville: 'Bordeaux',
          dateDebut: '2026-09-04',
          dateFin: '2026-09-06',
        })
      )
      .mockResolvedValueOnce(
        tourRefus('Événement impossible à confirmer.', {
          typeMetierRecherche: 'evenement',
          villeDemandee: 'Bordeaux',
          dateDebut: '2026-09-04',
          dateFin: '2026-09-06',
        })
      );

    await expect(genererParcours(brief)).rejects.toMatchObject({
      statusCode: 503,
      message: 'Les sources nécessaires pour vérifier ce parcours sont momentanément indisponibles',
    });
  });

  it('garde 422 si une panne facultative indépendante précède une absence essentielle', async () => {
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValue({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'reseau',
    });
    vi.mocked(rechercherEvenementsPredictHQ).mockResolvedValue(RECHERCHE_EVENEMENTS_VIDE);
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce([
        ...tourOutil(
          'chercher_lieux',
          {
            ville: 'Bordeaux',
            requete: 'bar à cocktails',
            typeMetierRecherche: 'sortie',
          },
          'outil-facultatif'
        ),
        ...tourOutil(
          'chercher_evenements',
          {
            ville: 'Bordeaux',
            dateDebut: '2026-09-04',
            dateFin: '2026-09-06',
          },
          'outil-essentiel'
        ),
      ])
      .mockResolvedValueOnce(
        tourRefus('Aucun événement fiable ne correspond aux dates.', {
          typeMetierRecherche: 'evenement',
          villeDemandee: 'Bordeaux',
          dateDebut: '2026-09-04',
          dateFin: '2026-09-06',
        })
      );

    await expect(genererParcours(brief)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Aucun événement fiable ne correspond aux dates.',
    });
  });
});

describe('intégration F2-B5 — statuts du résolveur', () => {
  it('transmet les dates PredictHQ et conserve une billetterie acceptée', async () => {
    const evenement = candidatEvenement({
      identifiantExterne: 'evt-festival-port',
      nom: 'Festival du Port',
      villeDemandee: 'Bordeaux',
      salle: 'Hangar 14',
      dateDebut: '2026-09-05T20:00:00Z',
      dateFin: '2026-09-05T23:00:00Z',
    });
    vi.mocked(rechercherEvenementsPredictHQ).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [evenement],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(resoudreLien).mockResolvedValueOnce(
      lienResolu(
        'https://www.ticketmaster.fr/fr/manifestation/festival-du-port/12345',
        'billetterie',
      ),
    );
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_evenements', {
          ville: 'Bordeaux',
          dateDebut: '2026-09-05',
          dateFin: '2026-09-05',
        }),
      )
      .mockResolvedValueOnce(
        tourReponse('Festival du Port', {
          type: 'evenement',
          identifiantExterne: 'evt-festival-port',
          estAncre: true,
        }),
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(resoudreLien).toHaveBeenCalledWith({
      identifiantExterne: 'evt-festival-port',
      nom: 'Festival du Port',
      villeDemandee: 'Bordeaux',
      adresseOuSalle: 'Hangar 14',
      typeMetierRecherche: 'evenement',
      fournisseurMetier: 'PredictHQ',
      sourceMetier: 'https://api.predicthq.com/v1/events/',
      dateDebut: '2026-09-05T20:00:00Z',
      dateFin: '2026-09-05T23:00:00Z',
    } satisfies DemandeResolutionLien);
    expect(element.reservation).toEqual({
      lienExterne:
        'https://www.ticketmaster.fr/fr/manifestation/festival-du-port/12345',
      fournisseur: 'Tavily',
      typeLien: 'billetterie',
    });
    expect(element.confiance).toMatchObject({
      niveau: 'verifie',
      fournisseur: 'PredictHQ',
      identifiantExterne: 'evt-festival-port',
    });
    expect(element.estAncre).toBe(true);
  });

  it('ne rattache aucun lien quand plusieurs candidats restent ambigus', async () => {
    vi.mocked(resoudreLien).mockResolvedValueOnce({
      statut: 'ambigu',
      cleDemande: 'demande-test',
      candidats: [
        {
          url: 'https://www.thefork.fr/restaurant/le-point-rouge-r12345',
          domaine: 'thefork.fr',
          typeLienPossible: 'reservation',
          rang: 1,
          fournisseurRecherche: 'Tavily',
          recupereLe: DATE_RECUPERATION,
          preuves: [
            { nature: 'nom_exact', valeur: 'Le Point Rouge' },
            { nature: 'ville', valeur: 'Bordeaux' },
            {
              nature: 'page_exacte',
              valeur:
                'https://www.thefork.fr/restaurant/le-point-rouge-r12345',
            },
          ],
        },
        {
          url: 'https://www.opentable.com/r/le-point-rouge',
          domaine: 'opentable.com',
          typeLienPossible: 'reservation',
          rang: 2,
          fournisseurRecherche: 'Tavily',
          recupereLe: DATE_RECUPERATION,
          preuves: [
            { nature: 'nom_exact', valeur: 'Le Point Rouge' },
            { nature: 'ville', valeur: 'Bordeaux' },
            {
              nature: 'page_exacte',
              valeur: 'https://www.opentable.com/r/le-point-rouge',
            },
          ],
        },
      ],
      fournisseurRecherche: 'Tavily',
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'bar',
          typeMetierRecherche: 'sortie',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Le Point Rouge', { identifiantExterne: 'fsq-point-rouge' })
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.reservation).toBeUndefined();
    expect(element.confiance.niveau).toBe('verifie');
  });

  it.each([
    [
      'refuse',
      {
        statut: 'refuse',
        cleDemande: 'demande-test',
        raison: 'destination_interdite',
        constateLe: DATE_RECUPERATION,
      } satisfies ResultatResolutionLien,
    ],
    [
      'indisponible',
      {
        statut: 'indisponible',
        cleDemande: 'demande-test',
        origine: 'controle_reseau',
        raison: 'timeout',
        constateLe: DATE_RECUPERATION,
      } satisfies ResultatResolutionLien,
    ],
  ])(
    'ne produit aucun lien ni repli quand le contrôle est %s',
    async (_statut, resultatLien) => {
      vi.mocked(resoudreLien).mockResolvedValueOnce(resultatLien);
      vi.mocked(callClaudeOutils)
        .mockResolvedValueOnce(
          tourOutil('chercher_lieux', {
            ville: 'Bordeaux',
            requete: 'bar',
            typeMetierRecherche: 'sortie',
          })
        )
        .mockResolvedValueOnce(
          tourReponse('Le Point Rouge', {
            identifiantExterne: 'fsq-point-rouge',
          })
        );

      const [element] = (await genererParcours(brief)).timeline[0]
        .elements;

      expect(element.reservation).toBeUndefined();
      expect(element.confiance.niveau).toBe('verifie');
      expect(resoudreLiensReels).not.toHaveBeenCalled();
    },
  );

  it('n’appelle pas le résolveur pour un nom générique même associé à un candidat', async () => {
    const candidatGenerique = candidatLieu({
      identifiantExterne: 'fsq-bar',
      nom: 'Bar',
      villeDemandee: 'Bordeaux',
      typeMetierRecherche: 'sortie',
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [candidatGenerique],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'bar',
          typeMetierRecherche: 'sortie',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Bar', { identifiantExterne: 'fsq-bar' })
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.reservation).toBeUndefined();
    expect(resoudreLien).not.toHaveBeenCalled();
    expect(resoudreLiensReels).not.toHaveBeenCalled();
  });

  it('n’appelle pas le résolveur avec une identité externe incomplète', async () => {
    const candidatIncomplet = {
      ...CANDIDAT_POINT_ROUGE,
      identifiantExterne: '',
    };
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [candidatIncomplet],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'bar',
          typeMetierRecherche: 'sortie',
        })
      )
      .mockResolvedValueOnce(tourReponse('Le Point Rouge'));

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.reservation).toBeUndefined();
    expect(resoudreLien).not.toHaveBeenCalled();
    expect(resoudreLiensReels).not.toHaveBeenCalled();
  });

  it('déduplique deux occurrences du même établissement et partage le résultat accepté', async () => {
    vi.mocked(resoudreLien).mockResolvedValueOnce(lienResolu());
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'bar',
          typeMetierRecherche: 'sortie',
        }),
      )
      .mockResolvedValueOnce([
        {
          type: 'text',
          text: JSON.stringify({
            moments: [
              {
                titre: 'Début de soirée',
                ville: 'Bordeaux',
                elements: [
                  {
                    ref: 'bar-debut',
                    type: 'sortie',
                    identifiantExterne: 'fsq-point-rouge',
                    nom: 'Le Point Rouge',
                    justification: 'première étape',
                  },
                ],
              },
              {
                titre: 'Fin de soirée',
                ville: 'Bordeaux',
                elements: [
                  {
                    ref: 'bar-fin',
                    type: 'sortie',
                    identifiantExterne: 'fsq-point-rouge',
                    nom: 'Le Point Rouge',
                    justification: 'retour dans le même lieu',
                  },
                ],
              },
            ],
          }),
        },
      ]);

    const parcours = await genererParcours(brief);
    const elements = parcours.timeline.flatMap((moment) => moment.elements);

    expect(resoudreLien).toHaveBeenCalledOnce();
    expect(elements).toHaveLength(2);
    expect(elements.map((element) => element.reservation)).toEqual([
      {
        lienExterne:
          'https://www.thefork.fr/restaurant/le-point-rouge-r12345',
        fournisseur: 'Tavily',
        typeLien: 'reservation',
      },
      {
        lienExterne:
          'https://www.thefork.fr/restaurant/le-point-rouge-r12345',
        fournisseur: 'Tavily',
        typeLien: 'reservation',
      },
    ]);
  });

  it('isole une exception et laisse le worker poursuivre les liens facultatifs', async () => {
    const candidats = Array.from({ length: 4 }, (_, index) =>
      candidatLieu({
        identifiantExterne: `fsq-activite-${index + 1}`,
        nom: `Atelier Bordelais ${index + 1}`,
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'activite',
      }),
    );
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: candidats,
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(resoudreLien).mockImplementation(async (demande) => {
      if (demande.identifiantExterne === 'fsq-activite-1') {
        throw new Error('erreur technique inattendue');
      }
      return lienResolu();
    });
    const avertir = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'atelier',
          typeMetierRecherche: 'activite',
        }),
      )
      .mockResolvedValueOnce([
        {
          type: 'text',
          text: JSON.stringify({
            moments: [
              {
                titre: 'Ateliers',
                ville: 'Bordeaux',
                elements: candidats.map((candidat, index) => ({
                  ref: `atelier-${index + 1}`,
                  type: 'activite',
                  identifiantExterne: candidat.identifiantExterne,
                  nom: candidat.nom,
                  justification: 'une activité adaptée au groupe',
                })),
              },
            ],
          }),
        },
      ]);

    const parcours = await genererParcours(brief);
    const elements = parcours.timeline[0].elements;

    expect(resoudreLien).toHaveBeenCalledTimes(4);
    expect(elements[0].reservation).toBeUndefined();
    expect(elements[0].confiance.niveau).toBe('verifie');
    expect(
      elements.slice(1).every(
        (element) =>
          element.reservation?.fournisseur === 'Tavily' &&
          element.reservation.typeLien === 'reservation',
      ),
    ).toBe(true);
    expect(avertir).toHaveBeenCalledWith(
      'Résolution facultative de lien indisponible après une erreur technique inattendue.',
    );
    avertir.mockRestore();
    expect(resoudreLiensReels).not.toHaveBeenCalled();
  });

  it('ne laisse jamais un lien Web seul vérifier un événement sans trace PredictHQ', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValueOnce([
      {
        type: 'text',
        text: JSON.stringify({
          moments: [
            {
              titre: 'Le festival',
              elements: [
                {
                  ref: 'festival-1',
                  type: 'evenement',
                  nom: 'Festival du Port',
                  justification: 'le temps fort demandé',
                },
              ],
            },
          ],
        }),
      },
    ]);

    const [element] = (await genererParcours(brief)).timeline[0].elements;
    expect(element.nom).toBe('Un événement à confirmer à Bordeaux');
    expect(element.reservation).toBeUndefined();
    expect(element.confiance).toEqual({ niveau: 'suggestion' });
    expect(resoudreLien).not.toHaveBeenCalled();
    expect(resoudreLiensReels).not.toHaveBeenCalled();
  });

  it('vérifie un hôtel Foursquare sans lancer de résolution de lien', async () => {
    const hotel = candidatHotel({
      identifiantExterne: 'fsq-burdigala',
      nom: 'Hôtel Burdigala',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
      adresse: '115 rue Georges Bonnac, Bordeaux',
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [hotel],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'hôtel de charme',
          typeMetierRecherche: 'hebergement',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Hôtel Burdigala', {
          type: 'hebergement',
          ville: 'Bordeaux',
          identifiantExterne: 'fsq-burdigala',
          prix: 210,
        })
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(rechercherLieuxFoursquare).toHaveBeenCalledWith(
      'Bordeaux',
      'hôtel de charme',
      'hebergement',
      4
    );
    expect(element).toMatchObject({
      nom: 'Hôtel Burdigala',
      lieu: '115 rue Georges Bonnac, Bordeaux',
      confiance: {
        niveau: 'verifie',
        identifiantExterne: 'fsq-burdigala',
        fournisseur: 'Foursquare',
        source: 'https://places-api.foursquare.com/places/search',
        recupereLe: DATE_RECUPERATION,
      },
      prix: 210,
      prixEstime: true,
    });
    expect(element.reservation).toBeUndefined();
    expect(resoudreLien).not.toHaveBeenCalled();
    expect(resoudreLiensReels).not.toHaveBeenCalled();
  });

  it('ne conserve jamais une adresse hôtelière venant seulement du LLM', async () => {
    const hotel = candidatHotel({
      identifiantExterne: 'fsq-hotel-sans-adresse',
      nom: 'Hôtel sans adresse',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [hotel],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'hôtel',
          typeMetierRecherche: 'hebergement',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Hôtel sans adresse', {
          type: 'hebergement',
          ville: 'Bordeaux',
          identifiantExterne: 'fsq-hotel-sans-adresse',
          lieu: '99 rue inventée',
        })
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.nom).toBe('Hôtel sans adresse');
    expect(element.lieu).toBeUndefined();
    expect(element.confiance.niveau).toBe('verifie');
    expect(element.reservation).toBeUndefined();
  });

  it('dégrade un hôtel vers une suggestion quand Foursquare est indisponible', async () => {
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'timeout',
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'hôtel',
          typeMetierRecherche: 'hebergement',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Grand Hôtel imaginaire', {
          type: 'hebergement',
          ville: 'Bordeaux',
        })
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.nom).toBe('Un hébergement à choisir à Bordeaux');
    expect(element.lieu).toBeUndefined();
    expect(element.confiance).toEqual({ niveau: 'suggestion' });
    expect(element.reservation).toBeUndefined();
    expect(resoudreLien).not.toHaveBeenCalled();
  });

  it('dégrade un hôtel vers une suggestion après une vraie recherche vide', async () => {
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'vide',
      resultats: [],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'hôtel',
          typeMetierRecherche: 'hebergement',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Hôtel inventé', {
          type: 'hebergement',
          ville: 'Bordeaux',
          lieu: '1 rue inventée',
        })
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element).toMatchObject({
      nom: 'Un hébergement à choisir à Bordeaux',
      confiance: { niveau: 'suggestion' },
    });
    expect(element.lieu).toBeUndefined();
    expect(element.reservation).toBeUndefined();
    expect(resoudreLien).not.toHaveBeenCalled();
  });

  it('ne vérifie pas un candidat hôtelier portant une catégorie incompatible', async () => {
    const fauxHotel = candidatHotel({
      identifiantExterne: 'fsq-restaurant-hotel',
      nom: 'Hôtel Restaurant du Port',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
      categorieFournisseur: 'French Restaurant',
      identifiantCategorieFournisseur: '13065',
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [fauxHotel],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'hôtel',
          typeMetierRecherche: 'hebergement',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Hôtel Restaurant du Port', {
          type: 'hebergement',
          ville: 'Bordeaux',
          identifiantExterne: 'fsq-restaurant-hotel',
        })
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.nom).toBe('Un hébergement à choisir à Bordeaux');
    expect(element.confiance).toEqual({ niveau: 'suggestion' });
    expect(element.reservation).toBeUndefined();
  });

  it('ne rattache aucun lien externe à un hébergement non vérifié', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValueOnce([
      {
        type: 'text',
        text: JSON.stringify({
          ambiance: 'détente',
          moments: [
            {
              titre: 'La nuit',
              elements: [
                {
                  ref: 'hotel-1',
                  type: 'hebergement',
                  nom: 'Hôtel de la Paix',
                  lieu: 'Bordeaux',
                  plage: { debut: '2026-08-15T14:00:00Z', fin: '2026-08-17T10:00:00Z' },
                  justification: 'une nuit sur place',
                },
              ],
            },
          ],
        }),
      },
    ]);

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.nom).toBe('Un hébergement à choisir à Bordeaux');
    expect(element.confiance).toEqual({ niveau: 'suggestion' });
    expect(element.reservation).toBeUndefined();
    expect(resoudreLien).not.toHaveBeenCalled();
  });

  it('refuse en 422 une occupation hôtelière essentielle non confirmée avant tout appel externe', async () => {
    const briefIncomplet = BriefSchema.parse({
      ...brief,
      hebergement: {
        necessaire: true,
        occupation: {
          statut: 'a_confirmer',
          adultes: 2,
          chambres: 1,
        },
        sejours: [
          {
            ville: 'Bordeaux',
            arrivee: '2026-08-10',
            depart: '2026-08-12',
          },
        ],
      },
    });

    await expect(genererParcours(briefIncomplet)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(callClaudeOutils).not.toHaveBeenCalled();
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
    expect(rechercherEvenementsPredictHQ).not.toHaveBeenCalled();
    expect(resoudreLien).not.toHaveBeenCalled();
  });

  it('refuse en 422 un séjour hôtelier essentiel sans ville et dates propres', async () => {
    const briefSansSejour = BriefSchema.parse({
      ...brief,
      hebergement: {
        necessaire: true,
        occupation: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
        },
        sejours: [],
      },
    });

    await expect(genererParcours(briefSansSejour)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(callClaudeOutils).not.toHaveBeenCalled();
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
    expect(rechercherEvenementsPredictHQ).not.toHaveBeenCalled();
    expect(resoudreLien).not.toHaveBeenCalled();
  });

  it('refuse en 422 un séjour hors des dates du parcours avant tout appel externe', async () => {
    const briefHorsDates = BriefSchema.parse({
      ...brief,
      dates: {
        debut: '2026-08-10T00:00:00Z',
        fin: '2026-08-12T23:59:59Z',
      },
      hebergement: {
        necessaire: true,
        occupation: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
        },
        sejours: [
          {
            ville: 'Bordeaux',
            arrivee: '2026-08-20',
            depart: '2026-08-21',
          },
        ],
      },
    });

    await expect(genererParcours(briefHorsDates)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(callClaudeOutils).not.toHaveBeenCalled();
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
    expect(rechercherEvenementsPredictHQ).not.toHaveBeenCalled();
    expect(resoudreLien).not.toHaveBeenCalled();
  });

  it('ajoute une recherche Booking à l’hôtel Foursquare sans modifier sa confiance', async () => {
    const hotel = candidatHotel({
      identifiantExterne: 'fsq-burdigala-occupation',
      nom: 'Hôtel Burdigala',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
      adresse: '115 rue Georges Bonnac, Bordeaux',
    });
    const briefHotelier = BriefSchema.parse({
      ...brief,
      hebergement: {
        necessaire: true,
        occupation: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
        },
        sejours: [
          {
            ville: 'Bordeaux',
            arrivee: '2026-08-10',
            depart: '2026-08-12',
          },
        ],
      },
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [hotel],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'hôtel',
          typeMetierRecherche: 'hebergement',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Hôtel Burdigala', {
          type: 'hebergement',
          ville: 'Bordeaux',
          identifiantExterne: 'fsq-burdigala-occupation',
          prix: 210,
        })
      );

    const parcours = await genererParcours(briefHotelier);
    const element = parcours.timeline[0].elements[0];

    expect(parcours.contexte.occupationHebergement).toEqual({
      statut: 'declaree',
      adultes: 2,
      enfants: 0,
      chambres: 1,
    });
    expect(element).toMatchObject({
      nom: 'Hôtel Burdigala',
      confiance: {
        niveau: 'verifie',
        fournisseur: 'Foursquare',
        identifiantExterne: 'fsq-burdigala-occupation',
      },
      sejourHebergement: {
        ville: 'Bordeaux',
        arrivee: '2026-08-10',
        depart: '2026-08-12',
      },
      prix: 210,
      prixEstime: true,
    });
    expect(element.reservation).toBeUndefined();
    expect(element).not.toHaveProperty('disponibilite');
    expect(element.lienRechercheHebergement).toMatchObject({
      type: 'recherche',
      fournisseur: 'Booking',
      libelle: 'Rechercher des hébergements sur Booking',
    });
    const urlRecherche = new URL(
      element.lienRechercheHebergement?.url ?? ''
    );
    expect(Object.fromEntries(urlRecherche.searchParams)).toEqual({
      ss: 'Hôtel Burdigala Bordeaux',
      checkin: '2026-08-10',
      checkout: '2026-08-12',
      group_adults: '2',
      group_children: '0',
      no_rooms: '1',
    });
    expect(resoudreLien).not.toHaveBeenCalled();
    expect(resoudreLiensReels).not.toHaveBeenCalled();
  });

  it('ajoute à une suggestion générique une recherche par ville sans reprendre le nom ni l’URL du LLM', async () => {
    const briefHotelier = BriefSchema.parse({
      ...brief,
      hebergement: {
        necessaire: true,
        occupation: {
          statut: 'declaree',
          adultes: 3,
          enfants: 1,
          chambres: 2,
        },
        sejours: [
          {
            ville: 'Bordeaux',
            arrivee: '2026-08-10',
            depart: '2026-08-12',
          },
        ],
      },
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'vide',
      resultats: [],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'hôtel',
          typeMetierRecherche: 'hebergement',
        })
      )
      .mockResolvedValueOnce([
        {
          type: 'text',
          text: JSON.stringify({
            moments: [
              {
                titre: 'Nuit à Bordeaux',
                ville: 'Bordeaux',
                elements: [
                  {
                    ref: 'hotel-generique',
                    type: 'hebergement',
                    nom: 'Hôtel inventé par le modèle',
                    justification: 'dormir sur place',
                    reservation: {
                      lienExterne: 'https://evil.test/reserver',
                      fournisseur: 'LLM',
                      typeLien: 'reservation',
                    },
                    lienRechercheHebergement: {
                      type: 'recherche',
                      fournisseur: 'Booking',
                      url: 'https://evil.test/recherche',
                      libelle: 'Réserver cet hôtel',
                      genereLe: DATE_RECUPERATION,
                    },
                  },
                ],
              },
            ],
          }),
        },
      ]);

    const [element] = (await genererParcours(briefHotelier)).timeline[0]
      .elements;
    const lien = element.lienRechercheHebergement;
    const url = new URL(lien?.url ?? '');

    expect(element.nom).toBe('Un hébergement à choisir à Bordeaux');
    expect(element.confiance).toEqual({ niveau: 'suggestion' });
    expect(element.reservation).toBeUndefined();
    expect(lien?.libelle).toBe(
      'Rechercher des hébergements sur Booking'
    );
    expect(url.origin).toBe('https://www.booking.com');
    expect(url.searchParams.get('ss')).toBe('Bordeaux');
    expect(url.searchParams.get('ss')).not.toContain('inventé');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      group_adults: '3',
      group_children: '1',
      no_rooms: '2',
    });
    expect(resoudreLien).not.toHaveBeenCalled();
    expect(resoudreLiensReels).not.toHaveBeenCalled();
  });

  it('rattache deux séjours uniquement à leur ville dans un parcours multi-ville', async () => {
    const briefMultiVille = BriefSchema.parse({
      intention: 'découvrir Bordeaux et Lyon',
      avecQui: 'couple',
      duree: { valeur: 4, unite: 'jours' },
      lieux: ['Bordeaux', 'Lyon'],
      transport: { necessaire: false },
      hebergement: {
        necessaire: true,
        occupation: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
        },
        sejours: [
          {
            ville: 'Bordeaux',
            arrivee: '2026-08-10',
            depart: '2026-08-12',
          },
          {
            ville: 'Lyon',
            arrivee: '2026-08-12',
            depart: '2026-08-15',
          },
        ],
      },
    });
    vi.mocked(rechercherLieuxFoursquare).mockImplementation(
      async (villeDemandee) => ({
        statut: 'ok',
        resultats: [
          candidatHotel({
            identifiantExterne:
              villeDemandee === 'Bordeaux'
                ? 'fsq-hotel-bordeaux'
                : 'fsq-hotel-lyon',
            nom:
              villeDemandee === 'Bordeaux'
                ? 'Hôtel Bordeaux'
                : 'Hôtel Lyon',
            villeDemandee,
            villeConfirmee: villeDemandee,
          }),
        ],
        recupereLe: DATE_RECUPERATION,
      })
    );
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce([
        ...tourOutil(
          'chercher_lieux',
          {
            ville: 'Bordeaux',
            requete: 'hôtel',
            typeMetierRecherche: 'hebergement',
          },
          'hotel-bordeaux'
        ),
        ...tourOutil(
          'chercher_lieux',
          {
            ville: 'Lyon',
            requete: 'hôtel',
            typeMetierRecherche: 'hebergement',
          },
          'hotel-lyon'
        ),
      ])
      .mockResolvedValueOnce([
        {
          type: 'text',
          text: JSON.stringify({
            moments: [
              {
                titre: 'Nuit bordelaise',
                ville: 'Bordeaux',
                elements: [
                  {
                    ref: 'hotel-bordeaux',
                    type: 'hebergement',
                    identifiantExterne: 'fsq-hotel-bordeaux',
                    nom: 'Hôtel Bordeaux',
                    justification: 'première étape',
                  },
                ],
              },
              {
                titre: 'Nuit lyonnaise',
                ville: 'Lyon',
                elements: [
                  {
                    ref: 'hotel-lyon',
                    type: 'hebergement',
                    identifiantExterne: 'fsq-hotel-lyon',
                    nom: 'Hôtel Lyon',
                    justification: 'seconde étape',
                  },
                ],
              },
            ],
          }),
        },
      ]);

    const parcours = await genererParcours(briefMultiVille);

    expect(
      parcours.timeline.map(
        (moment) => moment.elements[0].sejourHebergement
      )
    ).toEqual([
      { ville: 'Bordeaux', arrivee: '2026-08-10', depart: '2026-08-12' },
      { ville: 'Lyon', arrivee: '2026-08-12', depart: '2026-08-15' },
    ]);
    expect(
      parcours.timeline.map((moment) => {
        const lien = moment.elements[0].lienRechercheHebergement;
        const url = new URL(lien?.url ?? '');
        return {
          ss: url.searchParams.get('ss'),
          arrivee: url.searchParams.get('checkin'),
          depart: url.searchParams.get('checkout'),
        };
      })
    ).toEqual([
      {
        ss: 'Hôtel Bordeaux',
        arrivee: '2026-08-10',
        depart: '2026-08-12',
      },
      {
        ss: 'Hôtel Lyon',
        arrivee: '2026-08-12',
        depart: '2026-08-15',
      },
    ]);
    expect(resoudreLien).not.toHaveBeenCalled();
  });

  it('ne duplique pas un séjour sur deux hôtels proposés dans la même ville', async () => {
    const hotelA = candidatHotel({
      identifiantExterne: 'fsq-hotel-a',
      nom: 'Hôtel A',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
    });
    const hotelB = candidatHotel({
      identifiantExterne: 'fsq-hotel-b',
      nom: 'Hôtel B',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
    });
    const briefHotelier = BriefSchema.parse({
      ...brief,
      hebergement: {
        necessaire: true,
        occupation: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
        },
        sejours: [
          {
            ville: 'Bordeaux',
            arrivee: '2026-08-10',
            depart: '2026-08-12',
          },
        ],
      },
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [hotelA, hotelB],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'hôtel',
          typeMetierRecherche: 'hebergement',
        })
      )
      .mockResolvedValueOnce([
        {
          type: 'text',
          text: JSON.stringify({
            moments: [
              {
                titre: 'Deux options hôtelières',
                ville: 'Bordeaux',
                elements: [
                  {
                    ref: 'hotel-a',
                    type: 'hebergement',
                    identifiantExterne: 'fsq-hotel-a',
                    nom: 'Hôtel A',
                    justification: 'première option',
                  },
                  {
                    ref: 'hotel-b',
                    type: 'hebergement',
                    identifiantExterne: 'fsq-hotel-b',
                    nom: 'Hôtel B',
                    justification: 'seconde option',
                  },
                ],
              },
            ],
          }),
        },
      ]);

    const parcours = await genererParcours(briefHotelier);
    const hotels = parcours.timeline[0].elements;

    expect(hotels).toHaveLength(2);
    expect(
      hotels.every((hotel) => hotel.sejourHebergement === undefined)
    ).toBe(true);
    expect(hotels.map((hotel) => hotel.confiance.niveau)).toEqual([
      'verifie',
      'verifie',
    ]);
    expect(
      hotels.every(
        (hotel) => hotel.lienRechercheHebergement === undefined
      )
    ).toBe(true);
    expect(resoudreLien).not.toHaveBeenCalled();
  });
});

describe('le cache — deux générations sur la même ville ne repaient pas', () => {
  it('ne cherche qu’une fois pour deux boîtes à outils différentes', async () => {
    const premiere = creerBoiteAOutils();
    const seconde = creerBoiteAOutils();
    const demande = {
      ville: 'Bordeaux',
      requete: 'bar à cocktails',
      typeMetierRecherche: 'sortie',
    };

    await premiere.executer('chercher_lieux', demande);
    await seconde.executer('chercher_lieux', demande);

    expect(rechercherLieuxFoursquare).toHaveBeenCalledOnce();
    // Le résultat reste rattachable dans les DEUX générations.
    expect(seconde.trouverLieuReel('Le Point Rouge')?.fournisseur).toBe('Foursquare');
    expect(seconde.trouverLieuReel('Le Point Rouge')?.recupereLe).toBe(DATE_RECUPERATION);
  });

  it('restitue une identité hôtelière avec la même provenance et la même date', async () => {
    const hotel = candidatHotel({
      identifiantExterne: 'fsq-burdigala-cache',
      nom: 'Hôtel Burdigala',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
      adresse: '115 rue Georges Bonnac, Bordeaux',
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [hotel],
      recupereLe: DATE_RECUPERATION,
    });
    const demande = {
      ville: 'Bordeaux',
      requete: 'hôtel',
      typeMetierRecherche: 'hebergement',
    } as const;
    const premiere = creerBoiteAOutils();
    const seconde = creerBoiteAOutils();

    await premiere.executer('chercher_lieux', demande);
    await seconde.executer('chercher_lieux', demande);
    const relu = seconde.rapprocherCandidat({
      identifiantExterne: 'fsq-burdigala-cache',
      nom: 'Hôtel Burdigala',
      villeDemandee: 'Bordeaux',
      typeMetierRecherche: 'hebergement',
    });

    expect(rechercherLieuxFoursquare).toHaveBeenCalledOnce();
    expect(relu).toMatchObject({
      identifiantExterne: 'fsq-burdigala-cache',
      fournisseur: 'Foursquare',
      source: 'https://places-api.foursquare.com/places/search',
      recupereLe: DATE_RECUPERATION,
      categorieFournisseur: 'Hotel',
      typeMetierRecherche: 'hebergement',
    });
  });

  it('ne met jamais une indisponibilité fournisseur en cache', async () => {
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValue({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'fournisseur',
    });
    const demande = {
      ville: 'Bordeaux',
      requete: 'bar à cocktails',
      typeMetierRecherche: 'sortie',
    };

    await creerBoiteAOutils().executer('chercher_lieux', demande);
    await creerBoiteAOutils().executer('chercher_lieux', demande);

    expect(rechercherLieuxFoursquare).toHaveBeenCalledTimes(2);
  });

  it('distingue deux recherches différentes', async () => {
    const boite = creerBoiteAOutils();
    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'bar',
      typeMetierRecherche: 'sortie',
    });
    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'restaurant',
      typeMetierRecherche: 'restaurant',
    });
    await boite.executer('chercher_lieux', {
      ville: 'Lyon',
      requete: 'bar',
      typeMetierRecherche: 'sortie',
    });

    expect(rechercherLieuxFoursquare).toHaveBeenCalledTimes(3);
  });

  it('sépare le cache et le journal pour un même identifiant recherché sous deux types', async () => {
    const restaurant = candidatLieu({
      identifiantExterne: 'fsq-etablissement-mixte',
      nom: 'Le Central',
      villeDemandee: 'Bordeaux',
      typeMetierRecherche: 'restaurant',
      adresse: '1 place Centrale, Bordeaux',
    });
    const hotel = candidatHotel({
      identifiantExterne: 'fsq-etablissement-mixte',
      nom: 'Le Central',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
      adresse: '1 place Centrale, Bordeaux',
    });
    vi.mocked(rechercherLieuxFoursquare)
      .mockResolvedValueOnce({
        statut: 'ok',
        resultats: [restaurant],
        recupereLe: DATE_RECUPERATION,
      })
      .mockResolvedValueOnce({
        statut: 'ok',
        resultats: [hotel],
        recupereLe: DATE_RECUPERATION,
      });
    const boite = creerBoiteAOutils();

    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'Le Central',
      typeMetierRecherche: 'restaurant',
    });
    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'Le Central',
      typeMetierRecherche: 'hebergement',
    });

    expect(rechercherLieuxFoursquare).toHaveBeenCalledTimes(2);
    expect(
      boite.rapprocherCandidat({
        identifiantExterne: 'fsq-etablissement-mixte',
        nom: 'Le Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'restaurant',
      })?.typeMetierRecherche
    ).toBe('restaurant');
    expect(
      boite.rapprocherCandidat({
        identifiantExterne: 'fsq-etablissement-mixte',
        nom: 'Le Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'hebergement',
      })?.typeMetierRecherche
    ).toBe('hebergement');
  });

  it('repart chercher une fois le cache vidé', async () => {
    const boite = creerBoiteAOutils();
    const demande = {
      ville: 'Bordeaux',
      requete: 'bar',
      typeMetierRecherche: 'sortie',
    };
    await boite.executer('chercher_lieux', demande);
    viderCacheMemoire();
    await boite.executer('chercher_lieux', demande);

    expect(rechercherLieuxFoursquare).toHaveBeenCalledTimes(2);
  });
});

describe('les outils — l’entrée vient du modèle, donc elle est validée', () => {
  it('refuse proprement une demande incomplète, sans appeler le connecteur', async () => {
    const boite = creerBoiteAOutils();
    const reponse = await boite.executer('chercher_lieux', { ville: 'Bordeaux' });

    expect(reponse).toContain('Recherche impossible');
    expect(rechercherLieuxFoursquare).not.toHaveBeenCalled();
  });

  it('répond à un outil inconnu au lieu de tomber', async () => {
    const boite = creerBoiteAOutils();
    await expect(creerBoiteAOutils().executer('reserver_une_table', {})).resolves.toContain('Outil inconnu');
    expect(boite.trouverLieuReel('Le Point Rouge')).toBeUndefined();
  });

  it('cherche les événements sur la période demandée et retient leur salle', async () => {
    vi.mocked(rechercherEvenementsPredictHQ).mockResolvedValue({
      statut: 'ok',
      recupereLe: DATE_RECUPERATION,
      resultats: [
        candidatEvenement({
          identifiantExterne: 'evt-la-femme',
          nom: 'Concert de La Femme',
          villeDemandee: 'Bordeaux',
          salle: 'Rock School Barbey',
          dateDebut: '2026-09-05T20:00:00Z',
        }),
      ],
    });
    const boite = creerBoiteAOutils();
    const reponse = await boite.executer('chercher_evenements', {
      ville: 'Bordeaux',
      dateDebut: '2026-09-04T00:00:00Z',
      dateFin: '2026-09-06T00:00:00Z',
      genre: 'fete',
    });

    expect(rechercherEvenementsPredictHQ).toHaveBeenCalledWith(
      'Bordeaux',
      '2026-09-04',
      '2026-09-06',
      'party'
    );
    expect(reponse).toContain('Rock School Barbey');
    // Un événement n'a pas de lien de carte : on retient sa salle, rien de plus.
    const trace = boite.trouverLieuReel('Concert de La Femme');
    expect(trace && 'salle' in trace ? trace.salle : undefined).toBe('Rock School Barbey');
    expect(trace && 'lienCarte' in trace ? trace.lienCarte : undefined).toBeUndefined();
    expect(trace?.identifiantExterne).toBe('evt-la-femme');
    expect(trace?.recupereLe).toBeTruthy();
  });

  it('rend une absence explicite quand aucun événement réel n’est trouvé', async () => {
    vi.mocked(rechercherEvenementsPredictHQ).mockResolvedValue({
      statut: 'vide',
      resultats: [],
      recupereLe: DATE_RECUPERATION,
    });
    const reponse = await creerBoiteAOutils().executer('chercher_evenements', {
      ville: 'Bordeaux',
      dateDebut: '2026-09-04',
      dateFin: '2026-09-06',
    });

    expect(reponse).toContain('Aucun résultat réel');
  });
});

describe('le journal de candidats — rapprochement conservateur', () => {
  it.each([
    ['restaurant', 'restaurant bistronomique'],
    ['activite', 'escape game'],
    ['sortie', 'bar à cocktails'],
  ] as const)(
    'fait passer un %s par le chemin Foursquare typé réellement utilisé',
    async (typeMetierRecherche, requete) => {
      const candidat = candidatLieu({
        identifiantExterne: `fsq-${typeMetierRecherche}`,
        nom: `Candidat ${typeMetierRecherche}`,
        villeDemandee: 'Bordeaux',
        typeMetierRecherche,
      });
      vi.mocked(rechercherLieuxFoursquare).mockResolvedValue({
        statut: 'ok',
        resultats: [candidat],
        recupereLe: DATE_RECUPERATION,
      });
      const boite = creerBoiteAOutils();

      await boite.executer('chercher_lieux', {
        ville: 'Bordeaux',
        requete,
        typeMetierRecherche,
      });

      expect(rechercherLieuxFoursquare).toHaveBeenCalledWith(
        'Bordeaux',
        requete,
        typeMetierRecherche,
        4
      );
      expect(
        boite.rapprocherCandidat({
          identifiantExterne: candidat.identifiantExterne,
          nom: candidat.nom,
          villeDemandee: 'Bordeaux',
          typeMetierRecherche,
        })
      ).toMatchObject({ identifiantExterne: candidat.identifiantExterne });
    }
  );

  it('distingue deux lieux homonymes grâce à la ville', async () => {
    const candidatBordeaux = candidatLieu({
      identifiantExterne: 'fsq-central-bordeaux',
      nom: 'Le Central',
      villeDemandee: 'Bordeaux',
      typeMetierRecherche: 'restaurant',
    });
    const candidatLyon = candidatLieu({
      identifiantExterne: 'fsq-central-lyon',
      nom: 'Le Central',
      villeDemandee: 'Lyon',
      typeMetierRecherche: 'restaurant',
    });
    vi.mocked(rechercherLieuxFoursquare)
      .mockResolvedValueOnce({
        statut: 'ok',
        resultats: [candidatBordeaux],
        recupereLe: DATE_RECUPERATION,
      })
      .mockResolvedValueOnce({
        statut: 'ok',
        resultats: [candidatLyon],
        recupereLe: DATE_RECUPERATION,
      });
    const boite = creerBoiteAOutils({ villesAutorisees: ['Bordeaux', 'Lyon'] });

    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'restaurant',
      typeMetierRecherche: 'restaurant',
    });
    await boite.executer('chercher_lieux', {
      ville: 'Lyon',
      requete: 'restaurant',
      typeMetierRecherche: 'restaurant',
    });

    expect(
      boite.rapprocherCandidat({
        nom: 'Le Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'restaurant',
      })?.identifiantExterne
    ).toBe('fsq-central-bordeaux');
    expect(
      boite.rapprocherCandidat({
        nom: 'Le Central',
        villeDemandee: 'Lyon',
        typeMetierRecherche: 'restaurant',
      })?.identifiantExterne
    ).toBe('fsq-central-lyon');
  });

  it('refuse une identité ambiguë dans une même ville sans identifiant externe', async () => {
    const premier = candidatLieu({
      identifiantExterne: 'fsq-central-1',
      nom: 'Le Central',
      villeDemandee: 'Bordeaux',
      typeMetierRecherche: 'restaurant',
    });
    const second = candidatLieu({
      identifiantExterne: 'fsq-central-2',
      nom: 'Le Central',
      villeDemandee: 'Bordeaux',
      typeMetierRecherche: 'restaurant',
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValue({
      statut: 'ok',
      resultats: [premier, second],
      recupereLe: DATE_RECUPERATION,
    });
    const boite = creerBoiteAOutils();
    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'restaurant',
      typeMetierRecherche: 'restaurant',
    });

    expect(
      boite.rapprocherCandidat({
        nom: 'Le Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'restaurant',
      })
    ).toBeUndefined();
    expect(
      boite.rapprocherCandidat({
        identifiantExterne: 'fsq-central-2',
        nom: 'Le Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'restaurant',
      })?.identifiantExterne
    ).toBe('fsq-central-2');
  });

  it('ne change pas le rapprochement F2 avec une adresse LLM sur des restaurants ambigus', async () => {
    const candidats = [
      candidatLieu({
        identifiantExterne: 'fsq-restaurant-adresse-1',
        nom: 'Le Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'restaurant',
        adresse: '1 rue A, Bordeaux',
      }),
      candidatLieu({
        identifiantExterne: 'fsq-restaurant-adresse-2',
        nom: 'Le Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'restaurant',
        adresse: '2 rue B, Bordeaux',
      }),
    ];
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: candidats,
      recupereLe: DATE_RECUPERATION,
    });
    const boite = creerBoiteAOutils();
    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'restaurant central',
      typeMetierRecherche: 'restaurant',
    });

    expect(
      boite.rapprocherCandidat({
        nom: 'Le Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'restaurant',
        adresse: '2 rue B, Bordeaux',
      })
    ).toBeUndefined();
  });

  it('priorise l’identifiant externe sans choisir arbitrairement un hôtel homonyme', async () => {
    const premier = candidatHotel({
      identifiantExterne: 'fsq-hotel-central-1',
      nom: 'Hôtel Central',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
      adresse: '1 rue A, Bordeaux',
    });
    const second = candidatHotel({
      identifiantExterne: 'fsq-hotel-central-2',
      nom: 'Hôtel Central',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Bordeaux',
      adresse: '2 rue B, Bordeaux',
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [premier, second],
      recupereLe: DATE_RECUPERATION,
    });
    const boite = creerBoiteAOutils();
    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'hôtel central',
      typeMetierRecherche: 'hebergement',
    });

    expect(
      boite.rapprocherCandidat({
        nom: 'Hôtel Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'hebergement',
      })
    ).toBeUndefined();
    expect(
      boite.rapprocherCandidat({
        identifiantExterne: 'fsq-hotel-central-2',
        nom: 'Nom reformulé par le modèle',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'hebergement',
      })
    ).toMatchObject({
      identifiantExterne: 'fsq-hotel-central-2',
      adresse: '2 rue B, Bordeaux',
    });
  });

  it('peut lever une ambiguïté hôtelière par une adresse Foursquare exacte', async () => {
    const candidats = [
      candidatHotel({
        identifiantExterne: 'fsq-hotel-adresse-1',
        nom: 'Hôtel Central',
        villeDemandee: 'Bordeaux',
        villeConfirmee: 'Bordeaux',
        adresse: '1 rue A, Bordeaux',
      }),
      candidatHotel({
        identifiantExterne: 'fsq-hotel-adresse-2',
        nom: 'Hôtel Central',
        villeDemandee: 'Bordeaux',
        villeConfirmee: 'Bordeaux',
        adresse: '2 rue B, Bordeaux',
      }),
    ];
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: candidats,
      recupereLe: DATE_RECUPERATION,
    });
    const boite = creerBoiteAOutils();
    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'hôtel central',
      typeMetierRecherche: 'hebergement',
    });

    expect(
      boite.rapprocherCandidat({
        nom: 'Hôtel Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'hebergement',
        adresse: '2 rue B, Bordeaux',
      })?.identifiantExterne
    ).toBe('fsq-hotel-adresse-2');
  });

  it('ne retient pas un hôtel dont la ville confirmée contredit la recherche', async () => {
    const mauvaiseVille = candidatHotel({
      identifiantExterne: 'fsq-hotel-paris',
      nom: 'Hôtel Central',
      villeDemandee: 'Bordeaux',
      villeConfirmee: 'Paris',
      adresse: '1 rue de Paris',
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: [mauvaiseVille],
      recupereLe: DATE_RECUPERATION,
    });
    const boite = creerBoiteAOutils();
    await boite.executer('chercher_lieux', {
      ville: 'Bordeaux',
      requete: 'hôtel',
      typeMetierRecherche: 'hebergement',
    });

    expect(
      boite.rapprocherCandidat({
        identifiantExterne: 'fsq-hotel-paris',
        nom: 'Hôtel Central',
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'hebergement',
      })
    ).toBeUndefined();
  });
});

describe('la génération — ville et catégorie du candidat', () => {
  it('dégrade vers suggestion quand le type métier est incompatible', async () => {
    const restaurant = candidatLieu({
      identifiantExterne: 'fsq-restaurant',
      nom: 'Le Bistrot du Port',
      villeDemandee: 'Bordeaux',
      typeMetierRecherche: 'restaurant',
      adresse: 'Quai des Chartrons, Bordeaux',
    });
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValue({
      statut: 'ok',
      resultats: [restaurant],
      recupereLe: DATE_RECUPERATION,
    });
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'restaurant',
          typeMetierRecherche: 'restaurant',
        })
      )
      .mockResolvedValueOnce(
        tourReponse('Le Bistrot du Port', {
          type: 'sortie',
          identifiantExterne: 'fsq-restaurant',
        })
      );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.nom).toBe('Une sortie à choisir à Bordeaux');
    expect(element.confiance).toEqual({ niveau: 'suggestion' });
    expect(resoudreLien).not.toHaveBeenCalled();
  });

  it('retire estAncre à un événement déclaré ancre sans trace PredictHQ', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValueOnce(
      tourReponse('Festival imaginaire', { type: 'evenement', estAncre: true })
    );

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.nom).toBe('Un événement à confirmer à Bordeaux');
    expect(element.confiance).toEqual({ niveau: 'suggestion' });
    expect(element.reservation).toBeUndefined();
    expect(element.estAncre).toBe(false);
  });

  it('utilise la ville de chaque moment dans un parcours multi-ville', async () => {
    const briefMultiVille = BriefSchema.parse({
      intention: 'découvrir deux villes',
      avecQui: 'groupe',
      duree: { valeur: 3, unite: 'jours' },
      lieux: ['Bordeaux', 'Lyon'],
      transport: { necessaire: false },
    });
    vi.mocked(rechercherLieuxFoursquare).mockImplementation(
      async (villeDemandee, _requete, typeMetierRecherche) => {
        const candidat = candidatLieu({
          identifiantExterne:
            villeDemandee === 'Bordeaux' ? 'fsq-central-bordeaux' : 'fsq-central-lyon',
          nom: 'Le Central',
          villeDemandee,
          typeMetierRecherche,
          adresse:
            villeDemandee === 'Bordeaux'
              ? '1 place de Bordeaux'
              : '2 place de Lyon',
        });
        return {
          statut: 'ok',
          resultats: [candidat],
          recupereLe: DATE_RECUPERATION,
        };
      }
    );
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce([
        ...tourOutil(
          'chercher_lieux',
          {
            ville: 'Bordeaux',
            requete: 'restaurant',
            typeMetierRecherche: 'restaurant',
          },
          'outil-bordeaux'
        ),
        ...tourOutil(
          'chercher_lieux',
          {
            ville: 'Lyon',
            requete: 'restaurant',
            typeMetierRecherche: 'restaurant',
          },
          'outil-lyon'
        ),
      ])
      .mockResolvedValueOnce([
        {
          type: 'text',
          text: JSON.stringify({
            moments: [
              {
                titre: 'Étape bordelaise',
                ville: 'Bordeaux',
                elements: [
                  {
                    ref: 'restaurant-bordeaux',
                    type: 'restaurant',
                    identifiantExterne: 'fsq-central-bordeaux',
                    nom: 'Le Central',
                    justification: 'première étape',
                  },
                ],
              },
              {
                titre: 'Étape lyonnaise',
                ville: 'Lyon',
                elements: [
                  {
                    ref: 'restaurant-lyon',
                    type: 'restaurant',
                    identifiantExterne: 'fsq-central-lyon',
                    nom: 'Le Central',
                    justification: 'seconde étape',
                  },
                ],
              },
            ],
          }),
        },
      ]);

    const parcours = await genererParcours(briefMultiVille);

    expect(parcours.timeline[0].elements[0]).toMatchObject({
      nom: 'Le Central',
      lieu: '1 place de Bordeaux',
    });
    expect(parcours.timeline[1].elements[0]).toMatchObject({
      nom: 'Le Central',
      lieu: '2 place de Lyon',
    });
    expect(vi.mocked(resoudreLien).mock.calls.map(([demande]) => ({
      identifiantExterne: demande.identifiantExterne,
      villeDemandee: demande.villeDemandee,
    }))).toEqual([
      {
        identifiantExterne: 'fsq-central-bordeaux',
        villeDemandee: 'Bordeaux',
      },
      {
        identifiantExterne: 'fsq-central-lyon',
        villeDemandee: 'Lyon',
      },
    ]);
  });

  it('borne à trois les résolutions simultanées et conserve l’ordre des demandes', async () => {
    const candidats = Array.from({ length: 4 }, (_, index) =>
      candidatLieu({
        identifiantExterne: `fsq-activite-${index + 1}`,
        nom: `Atelier Bordelais ${index + 1}`,
        villeDemandee: 'Bordeaux',
        typeMetierRecherche: 'activite',
        adresse: `${index + 1} rue des Ateliers, Bordeaux`,
      }),
    );
    vi.mocked(rechercherLieuxFoursquare).mockResolvedValueOnce({
      statut: 'ok',
      resultats: candidats,
      recupereLe: DATE_RECUPERATION,
    });

    let actifs = 0;
    let maximumActifs = 0;
    vi.mocked(resoudreLien).mockImplementation(async () => {
      actifs += 1;
      maximumActifs = Math.max(maximumActifs, actifs);
      await Promise.resolve();
      actifs -= 1;
      return lienIntrouvable();
    });

    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(
        tourOutil('chercher_lieux', {
          ville: 'Bordeaux',
          requete: 'atelier',
          typeMetierRecherche: 'activite',
          limite: 4,
        }),
      )
      .mockResolvedValueOnce([
        {
          type: 'text',
          text: JSON.stringify({
            moments: [
              {
                titre: 'Ateliers',
                ville: 'Bordeaux',
                elements: candidats.map((candidat, index) => ({
                  ref: `activite-${index + 1}`,
                  type: 'activite',
                  identifiantExterne: candidat.identifiantExterne,
                  nom: candidat.nom,
                  justification: 'une activité adaptée au groupe',
                })),
              },
            ],
          }),
        },
      ]);

    const parcours = await genererParcours(brief);

    expect(maximumActifs).toBe(3);
    expect(
      new Set(
        vi.mocked(resoudreLien).mock.calls.map(
          ([demande]) => demande.identifiantExterne,
        ),
      ),
    ).toEqual(
      new Set([
        'fsq-activite-1',
        'fsq-activite-2',
        'fsq-activite-3',
        'fsq-activite-4',
      ]),
    );
    expect(
      parcours.timeline[0].elements.map((element) => element.nom),
    ).toEqual(candidats.map((candidat) => candidat.nom));
    expect(
      parcours.timeline[0].elements.every(
        (element) => element.reservation === undefined,
      ),
    ).toBe(true);
    expect(resoudreLiensReels).not.toHaveBeenCalled();
  });
});
