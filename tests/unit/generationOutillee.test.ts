import { describe, it, expect, vi, beforeEach } from 'vitest';

// L'orchestrateur va chercher de VRAIS lieux avant d'écrire (sprint R6).
//
// Rien n'appelle ici la moindre API : le transport Anthropic est mocké (on
// scénarise ses tours), les trois connecteurs aussi. Ce qui est réellement
// exercé, c'est la boucle d'outils, le cache, le repli quand une recherche ne
// rend rien, et la frontière de méfiance envers la sortie du modèle.

// La boucle d'outils n'existe que sur l'API Anthropic : sans clé, la génération
// bascule sur l'appel simple. On en pose donc une (fausse) pour l'activer.
process.env.ANTHROPIC_API_KEY = 'cle-de-test-vitest';

vi.mock('../../server/services/providers.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/providers.js')>();
  return { ...reel, callClaude: vi.fn(), callClaudeOutils: vi.fn() };
});
vi.mock('../../server/services/foursquare.js', () => ({ foursquareRechercheLieux: vi.fn() }));
vi.mock('../../server/services/predictHQ.js', () => ({ predictHQEventsSearch: vi.fn() }));
vi.mock('../../server/services/weather.js', () => ({ getRealWeather: vi.fn() }));

const { callClaude, callClaudeOutils } = await import('../../server/services/providers.js');
const { foursquareRechercheLieux } = await import('../../server/services/foursquare.js');
const { predictHQEventsSearch } = await import('../../server/services/predictHQ.js');
const { getRealWeather } = await import('../../server/services/weather.js');
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

const LIEUX_TROUVES = [
  {
    nom: 'Le Point Rouge',
    categorie: 'Cocktail Bar',
    adresse: '3 rue Sainte-Colombe, Bordeaux',
    lienCarte: 'https://www.google.com/maps/search/?api=1&query=Le%20Point%20Rouge%20Bordeaux',
  },
];

/** Le tour où le modèle demande une recherche. */
function tourOutil(nom: string, entree: unknown, id = 'outil-1'): BlocReponse[] {
  return [{ type: 'tool_use', id, name: nom, input: entree }];
}

/** Le tour où il conclut : le parcours, en JSON. */
function tourReponse(nomElement: string): BlocReponse[] {
  return [
    {
      type: 'text',
      text: JSON.stringify({
        ambiance: 'festive',
        moments: [
          {
            titre: 'Le samedi soir',
            elements: [
              { ref: 'bar-1', type: 'sortie', nom: nomElement, justification: 'le temps fort de la soirée' },
            ],
          },
        ],
      }),
    },
  ];
}

beforeEach(() => {
  vi.mocked(callClaude).mockReset();
  vi.mocked(callClaudeOutils).mockReset();
  vi.mocked(foursquareRechercheLieux).mockReset().mockResolvedValue(LIEUX_TROUVES);
  vi.mocked(predictHQEventsSearch).mockReset().mockResolvedValue([]);
  vi.mocked(getRealWeather).mockReset().mockResolvedValue(null);
  viderCacheMemoire();
});

describe('la boucle d’outils — le modèle cherche, puis écrit', () => {
  it('exécute la recherche demandée et rend le résultat réel au modèle', async () => {
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(tourOutil('chercher_lieux', { ville: 'Bordeaux', requete: 'bar à cocktails' }))
      .mockResolvedValueOnce(tourReponse('Le Point Rouge'));

    const parcours = await genererParcours(brief);

    expect(foursquareRechercheLieux).toHaveBeenCalledWith('Bordeaux', 'bar à cocktails', 4);
    expect(callClaudeOutils).toHaveBeenCalledTimes(2);

    // Le second tour renvoie le résultat de l'outil au modèle, rattaché à sa demande.
    const messagesDuSecondTour = vi.mocked(callClaudeOutils).mock.calls[1][1];
    const resultats = messagesDuSecondTour[2].content as Array<{ type: string; tool_use_id: string; content: string }>;
    expect(resultats[0].type).toBe('tool_result');
    expect(resultats[0].tool_use_id).toBe('outil-1');
    expect(resultats[0].content).toContain('Le Point Rouge');

    expect(parcours.timeline[0].elements[0].nom).toBe('Le Point Rouge');
  });

  it('trace le vrai lieu : l’adresse du connecteur, et son lien externe', async () => {
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(tourOutil('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' }))
      .mockResolvedValueOnce(tourReponse('Le Point Rouge'));

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.lieu).toBe('3 rue Sainte-Colombe, Bordeaux');
    // Le lien vient du connecteur, jamais du modèle — et c'est un lien, pas un achat.
    expect(element.reservation?.lienExterne).toBe(LIEUX_TROUVES[0].lienCarte);
    expect(element.reservation?.fournisseur).toBe('Foursquare');
  });

  it('ne rattache aucun lien à un nom que le modèle a inventé', async () => {
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(tourOutil('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' }))
      .mockResolvedValueOnce(tourReponse('Bar à cocktails réputé du centre'));

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.reservation).toBeUndefined();
    expect(element.lieu).toBeUndefined();
  });

  it('borne le nombre de tours : au dernier, les outils sont retirés', async () => {
    vi.mocked(callClaudeOutils).mockImplementation(async (_systeme, _messages, outils) =>
      outils ? tourOutil('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' }) : tourReponse('Le Point Rouge')
    );

    await genererParcours(brief);

    // MAX_TOURS_OUTILS tours de recherche, plus le tour de conclusion.
    expect(callClaudeOutils).toHaveBeenCalledTimes(MAX_TOURS_OUTILS + 1);
    expect(vi.mocked(callClaudeOutils).mock.calls.at(-1)?.[2]).toBeUndefined();
  });
});

describe('le repli — sans données réelles, mais jamais d’erreur technique', () => {
  it('continue quand la recherche ne rend rien (clé absente côté connecteur)', async () => {
    vi.mocked(foursquareRechercheLieux).mockResolvedValue([]);
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(tourOutil('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' }))
      .mockResolvedValueOnce(tourReponse('Un bar à cocktails du centre'));

    const parcours = await genererParcours(brief);

    const resultats = vi.mocked(callClaudeOutils).mock.calls[1][1][2].content as Array<{ content: string }>;
    expect(resultats[0].content).toContain('Aucun résultat réel');
    expect(parcours.timeline[0].elements[0].nom).toBe('Un bar à cocktails du centre');
  });

  it('continue quand le connecteur tombe en panne', async () => {
    vi.mocked(foursquareRechercheLieux).mockRejectedValue(new Error('réseau injoignable'));
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(tourOutil('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' }))
      .mockResolvedValueOnce(tourReponse('Un bar du centre'));

    await expect(genererParcours(brief)).resolves.toBeTruthy();
  });

  it('génère sans outils quand la boucle elle-même échoue', async () => {
    vi.mocked(callClaudeOutils).mockRejectedValue(new Error('quota dépassé'));
    vi.mocked(callClaude).mockResolvedValue(JSON.stringify({ moments: tourTexteMinimal() }));

    const parcours = await genererParcours(brief);

    expect(callClaude).toHaveBeenCalledOnce();
    expect(parcours.timeline[0].elements[0].nom).toBe('Une virée dans les bars du centre');
  });

  it('ne répond jamais un message technique sur une sortie inexploitable', async () => {
    vi.mocked(callClaudeOutils).mockResolvedValue([{ type: 'text', text: 'Je ne peux pas construire ce parcours.' }]);
    await expect(genererParcours(brief)).rejects.toThrow('inexploitable');
  });
});

function tourTexteMinimal() {
  return [
    {
      titre: 'Le samedi soir',
      elements: [
        {
          ref: 'bar-1',
          type: 'sortie',
          nom: 'Une virée dans les bars du centre',
          justification: 'le temps fort de la soirée',
        },
      ],
    },
  ];
}

describe('le cache — deux générations sur la même ville ne repaient pas', () => {
  it('ne cherche qu’une fois pour deux boîtes à outils différentes', async () => {
    const premiere = creerBoiteAOutils();
    const seconde = creerBoiteAOutils();
    const demande = { ville: 'Bordeaux', requete: 'bar à cocktails' };

    await premiere.executer('chercher_lieux', demande);
    await seconde.executer('chercher_lieux', demande);

    expect(foursquareRechercheLieux).toHaveBeenCalledOnce();
    // Le résultat reste rattachable dans les DEUX générations.
    expect(seconde.trouverLieuReel('Le Point Rouge')?.source).toBe('Foursquare');
  });

  it('distingue deux recherches différentes', async () => {
    const boite = creerBoiteAOutils();
    await boite.executer('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' });
    await boite.executer('chercher_lieux', { ville: 'Bordeaux', requete: 'restaurant' });
    await boite.executer('chercher_lieux', { ville: 'Lyon', requete: 'bar' });

    expect(foursquareRechercheLieux).toHaveBeenCalledTimes(3);
  });

  it('repart chercher une fois le cache vidé', async () => {
    const boite = creerBoiteAOutils();
    await boite.executer('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' });
    viderCacheMemoire();
    await boite.executer('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' });

    expect(foursquareRechercheLieux).toHaveBeenCalledTimes(2);
  });
});

describe('les outils — l’entrée vient du modèle, donc elle est validée', () => {
  it('refuse proprement une demande incomplète, sans appeler le connecteur', async () => {
    const boite = creerBoiteAOutils();
    const reponse = await boite.executer('chercher_lieux', { ville: 'Bordeaux' });

    expect(reponse).toContain('Recherche impossible');
    expect(foursquareRechercheLieux).not.toHaveBeenCalled();
  });

  it('répond à un outil inconnu au lieu de tomber', async () => {
    const boite = creerBoiteAOutils();
    await expect(creerBoiteAOutils().executer('reserver_une_table', {})).resolves.toContain('Outil inconnu');
    expect(boite.trouverLieuReel('Le Point Rouge')).toBeUndefined();
  });

  it('cherche les événements sur la période demandée et retient leur salle', async () => {
    vi.mocked(predictHQEventsSearch).mockResolvedValue([
      {
        title: 'Concert de La Femme',
        category: 'concerts',
        start: '2026-09-05',
        venue: 'Rock School Barbey',
        description: 'concert',
      },
    ]);
    const boite = creerBoiteAOutils();
    const reponse = await boite.executer('chercher_evenements', {
      ville: 'Bordeaux',
      dateDebut: '2026-09-04T00:00:00Z',
      dateFin: '2026-09-06T00:00:00Z',
      genre: 'fete',
    });

    expect(predictHQEventsSearch).toHaveBeenCalledWith('Bordeaux', '2026-09-04', '2026-09-06', 'party');
    expect(reponse).toContain('Rock School Barbey');
    // Un événement n'a pas de lien de carte : on retient sa salle, rien de plus.
    const trace = boite.trouverLieuReel('Concert de La Femme');
    expect(trace?.lieu).toBe('Rock School Barbey');
    expect(trace?.lienCarte).toBeUndefined();
  });
});
