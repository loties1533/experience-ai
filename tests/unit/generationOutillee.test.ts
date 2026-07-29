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
vi.mock('../../server/services/foursquare.js', () => ({ rechercherLieuxFoursquare: vi.fn() }));
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
  typeMetierRecherche: 'restaurant' | 'activite' | 'sortie';
  adresse?: string;
}) {
  return {
    identifiantExterne: args.identifiantExterne,
    nom: args.nom,
    villeDemandee: args.villeDemandee,
    categorieFournisseur: 'Catégorie de test',
    typeMetierRecherche: args.typeMetierRecherche,
    adresse: args.adresse,
    lienCarte: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${args.nom} ${args.villeDemandee}`
    )}`,
    fournisseur: 'Foursquare' as const,
    source: 'https://places-api.foursquare.com/places/search',
    recupereLe: DATE_RECUPERATION,
  };
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
    type?: 'activite' | 'restaurant' | 'sortie' | 'evenement';
    ville?: string;
    identifiantExterne?: string;
    estAncre?: boolean;
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
