import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../../server/services/foursquare.js', () => ({ foursquareRechercheLieux: vi.fn() }));
vi.mock('../../server/services/predictHQ.js', () => ({ predictHQEventsSearch: vi.fn() }));
vi.mock('../../server/services/weather.js', () => ({ getRealWeather: vi.fn() }));
// Le résolveur de vrais liens a sa propre suite (tests/unit/liens.test.ts) : ici
// on ne teste que la PRIORITÉ dans tracerLieuReel (lien réel > carte).
vi.mock('../../server/services/liens.js', () => ({ resoudreLiensReels: vi.fn() }));

const { callClaude, callClaudeOutils } = await import('../../server/services/providers.js');
const { foursquareRechercheLieux } = await import('../../server/services/foursquare.js');
const { predictHQEventsSearch } = await import('../../server/services/predictHQ.js');
const { getRealWeather } = await import('../../server/services/weather.js');
const { resoudreLiensReels } = await import('../../server/services/liens.js');
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
    identifiantExterne: 'fsq-point-rouge',
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
  vi.mocked(resoudreLiensReels).mockReset().mockResolvedValue(new Map());
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
    expect(element.reservation?.typeLien).toBe('carte');
    expect(element.confiance).toMatchObject({
      niveau: 'verifie',
      source: 'Foursquare API',
      fournisseur: 'Foursquare',
      identifiantExterne: 'fsq-point-rouge',
    });
    if (element.confiance.niveau !== 'verifie') throw new Error('preuve attendue');
    expect(Number.isNaN(Date.parse(element.confiance.recupereLe))).toBe(false);
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

describe('la dégradation explicite des données réelles', () => {
  it('reste générique et marque suggestion quand une recherche exécutée ne rend rien', async () => {
    vi.mocked(foursquareRechercheLieux).mockResolvedValue([]);
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(tourOutil('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' }))
      .mockResolvedValueOnce(tourReponse('Un bar à cocktails du centre'));

    const parcours = await genererParcours(brief);

    const resultats = vi.mocked(callClaudeOutils).mock.calls[1][1][2].content as Array<{ content: string }>;
    expect(resultats[0].content).toContain('Aucun résultat réel');
    expect(parcours.timeline[0].elements[0].nom).toBe('Une sortie à choisir à Bordeaux');
    expect(parcours.timeline[0].elements[0].confiance).toEqual({ niveau: 'suggestion' });
  });

  it('continue quand le connecteur tombe en panne', async () => {
    vi.mocked(foursquareRechercheLieux).mockRejectedValue(new Error('réseau injoignable'));
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(tourOutil('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' }))
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
    vi.mocked(callClaudeOutils).mockResolvedValueOnce([
      {
        type: 'text',
        text: JSON.stringify({
          refus: {
            code: 'donnees_essentielles_insuffisantes',
            message: 'Le match demandé ne peut pas être confirmé sur ces dates.',
          },
        }),
      },
    ]);

    await expect(genererParcours(brief)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Le match demandé ne peut pas être confirmé sur ces dates.',
    });
  });
});

describe('tracerLieuReel — priorité du lien et preuve', () => {
  it('préfère le vrai lien (site officiel/billetterie) à la carte du connecteur', async () => {
    vi.mocked(resoudreLiensReels).mockResolvedValue(
      new Map([['Le Point Rouge', 'https://lepointrouge.fr/']])
    );
    vi.mocked(callClaudeOutils)
      .mockResolvedValueOnce(tourOutil('chercher_lieux', { ville: 'Bordeaux', requete: 'bar' }))
      .mockResolvedValueOnce(tourReponse('Le Point Rouge'));

    const [element] = (await genererParcours(brief)).timeline[0].elements;

    expect(element.reservation?.lienExterne).toBe('https://lepointrouge.fr/');
    expect(element.reservation?.fournisseur).toBe('Web');
    expect(element.reservation?.typeLien).toBe('officiel');
    expect(element.confiance.niveau).toBe('verifie');
  });

  it('qualifie en billetterie le lien vérifié d’un événement', async () => {
    vi.mocked(resoudreLiensReels).mockResolvedValue(
      new Map([['Festival du Port', 'https://billetterie.example/festival-du-port']])
    );
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
    expect(element.reservation?.typeLien).toBe('billetterie');
    expect(element.confiance.niveau).toBe('verifie');
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
  });

});

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
        id: 'evt-la-femme',
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
    expect(trace?.identifiantExterne).toBe('evt-la-femme');
    expect(trace?.recupereLe).toBeTruthy();
  });

  it('rend une absence explicite quand aucun événement réel n’est trouvé', async () => {
    vi.mocked(predictHQEventsSearch).mockResolvedValue([]);
    const reponse = await creerBoiteAOutils().executer('chercher_evenements', {
      ville: 'Bordeaux',
      dateDebut: '2026-09-04',
      dateFin: '2026-09-06',
    });

    expect(reponse).toContain('Aucun résultat réel');
  });
});
