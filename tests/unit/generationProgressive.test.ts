import { describe, it, expect, vi, beforeEach } from 'vitest';

// F5-B — génération progressive par lots.
//
// On mocke UNIQUEMENT l'appel IA outillé : chaque lot du plan reçoit son propre
// appel `callAIAvecOutils`, et le mock répond en fonction de la ville et de la
// plage lues dans le brief du lot. Le reste du pipeline (assemblage, transport
// déterministe, ids, validation) reste réel. Le résolveur de liens est neutre :
// sans recherche outillée, aucun candidat n'est journalisé, donc aucun lien
// réel n'est sollicité.
vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn(), callAIAvecOutils: vi.fn() };
});
vi.mock('../../server/services/liens.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/liens.js')>();
  return { ...reel, resoudreLien: vi.fn(), resoudreLiensReels: vi.fn() };
});

const { callAIAvecOutils } = await import('../../server/services/claude/core.js');
const { resoudreLien, resoudreLiensReels } = await import(
  '../../server/services/liens.js'
);
const { genererParcours, deriverPlan } = await import(
  '../../server/agents/generation.js'
);
const { BriefSchema } = await import('../../server/agents/brief.js');
const { construireContextePlanifiable } = await import(
  '../../server/agents/generation/preparation.js'
);

type Brief = import('../../server/agents/brief.js').Brief;

function planDuBrief(brief: Brief) {
  return deriverPlan(construireContextePlanifiable(brief));
}

// Numéro de jour civil, réplique locale de la logique interne (cf.
// planGeneration.test.ts) pour vérifier une plage sans dépendre de l'heure.
function numeroDeJour(dateCivile: string): number {
  const [annee, mois, jour] = dateCivile.split('-').map(Number);
  return Math.floor(Date.UTC(annee, mois - 1, jour) / 86_400_000);
}

/** Lit le brief JSON qu'un prompt de lot embarque, pour répondre par ville. */
function briefDuPrompt(prompt: string): {
  lieux?: string[];
  dates?: { debut: string; fin: string };
} {
  const debut = prompt.indexOf('{');
  const fin = prompt.lastIndexOf('}');
  if (debut === -1 || fin === -1) return {};
  try {
    return JSON.parse(prompt.slice(debut, fin + 1));
  } catch {
    return {};
  }
}

/** Mock IA par lot : `construire` reçoit la ville et la plage lues du prompt. */
function llmParLot(
  construire: (contexte: {
    ville?: string;
    dates?: { debut: string; fin: string };
  }) => unknown
) {
  return async (prompt: string) => {
    const brief = briefDuPrompt(prompt);
    return JSON.stringify(
      construire({ ville: brief.lieux?.[0], dates: brief.dates })
    );
  };
}

/** Un moment d'activité générique rattaché à une ville. */
function momentActivite(ville: string | undefined, ref = 'activite') {
  return {
    titre: ville ? `Étape à ${ville}` : 'Étape',
    ville,
    elements: [
      {
        ref,
        type: 'activite',
        nom: ville ? `Activité à ${ville}` : 'Activité',
        justification: 'une étape du parcours',
      },
    ],
  };
}

function villesDesAppels(): (string | undefined)[] {
  return vi
    .mocked(callAIAvecOutils)
    .mock.calls.map(([prompt]) => briefDuPrompt(prompt as string).lieux?.[0]);
}

const briefMono: Brief = BriefSchema.parse({
  intention: 'découvrir une ville',
  avecQui: 'amis',
  duree: { valeur: 2, unite: 'jours' },
  lieux: [{ nom: 'Bordeaux', type: 'ville' }],
});

const briefMulti: Brief = BriefSchema.parse({
  intention: 'découvrir Bordeaux, Paris et Lyon',
  avecQui: 'groupe',
  duree: { valeur: 6, unite: 'jours' },
  lieux: [
    { nom: 'Bordeaux', type: 'ville' },
    { nom: 'Paris', type: 'ville' },
    { nom: 'Lyon', type: 'ville' },
  ],
  transport: { necessaire: false },
});

function briefTransport(): Brief {
  return BriefSchema.parse({
    intention: 'relier trois villes',
    avecQui: 'amis',
    duree: { valeur: 6, unite: 'jours' },
    lieux: [
      { nom: 'Bordeaux', type: 'ville' },
      { nom: 'Paris', type: 'ville' },
      { nom: 'Lyon', type: 'ville' },
    ],
    transport: {
      necessaire: true,
      troncons: [
        {
          origine: { ville: 'Bordeaux' },
          destination: { ville: 'Paris' },
          depart: { date: '2026-09-10' },
        },
        {
          origine: { ville: 'Paris' },
          destination: { ville: 'Lyon' },
          depart: { date: '2026-09-12' },
        },
      ],
      occupation: { statut: 'declaree', adultes: 2, enfants: 0 },
    },
  });
}

beforeEach(() => {
  vi.mocked(callAIAvecOutils).mockReset();
  vi.mocked(resoudreLien).mockReset();
  vi.mocked(resoudreLiensReels).mockReset();
});

describe('F5-B — un appel IA par lot', () => {
  it('mono-lot : un seul appel et un résultat exploitable', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({ moments: [momentActivite(ville)] }))
    );

    const parcours = await genererParcours(briefMono);

    expect(callAIAvecOutils).toHaveBeenCalledTimes(1);
    expect(planDuBrief(briefMono).lots).toHaveLength(1);
    expect(parcours.timeline).toHaveLength(1);
    // Sans candidat vérifié, le nom inventé cède la place à une suggestion
    // générique — qui mentionne bien la ville du lot.
    expect(parcours.timeline[0].elements[0].nom).toContain('Bordeaux');
  });

  it('multi-villes : un appel par lot, dans l’ordre du plan', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({ moments: [momentActivite(ville)] }))
    );

    const parcours = await genererParcours(briefMulti);

    expect(callAIAvecOutils).toHaveBeenCalledTimes(3);
    expect(villesDesAppels()).toEqual(['Bordeaux', 'Paris', 'Lyon']);
    const noms = parcours.timeline.map((moment) => moment.elements[0].nom);
    expect(noms[0]).toContain('Bordeaux');
    expect(noms[1]).toContain('Paris');
    expect(noms[2]).toContain('Lyon');
  });

  it('ville longue : autant d’appels que de lots dérivés, chacun borné à sa plage', async () => {
    const brief = BriefSchema.parse({
      intention: 'un long séjour à Bordeaux',
      avecQui: 'solo',
      duree: { valeur: 11, unite: 'jours' },
      lieux: [{ nom: 'Bordeaux', type: 'ville' }],
      dates: { debut: '2026-09-01T00:00:00Z', fin: '2026-09-11T23:59:59Z' },
    });
    const lots = planDuBrief(brief).lots;
    expect(lots.length).toBeGreaterThan(1);

    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville, dates }) => {
        // Chaque appel ne voit qu'une sous-plage strictement incluse dans le
        // parcours (bornes AAAA-MM-JJ du 1 au 11 septembre).
        expect(dates?.debut.slice(0, 10) >= '2026-09-01').toBe(true);
        expect(dates?.fin.slice(0, 10) <= '2026-09-11').toBe(true);
        return { moments: [momentActivite(ville)] };
      })
    );

    const parcours = await genererParcours(brief);

    expect(callAIAvecOutils).toHaveBeenCalledTimes(lots.length);
    expect(parcours.timeline).toHaveLength(lots.length);
  });
});

describe('F5-B — assemblage et namespacing', () => {
  it('assemble tous les lots sans perte ni duplication', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({
        moments: [momentActivite(ville, 'a'), momentActivite(ville, 'b')],
      }))
    );

    const parcours = await genererParcours(briefMulti);
    const elements = parcours.timeline.flatMap((moment) => moment.elements);

    // 3 villes × 2 moments d'un élément chacun.
    expect(parcours.timeline).toHaveLength(6);
    expect(elements).toHaveLength(6);
  });

  it('rend des ids uniques même quand deux lots réutilisent la même ref', async () => {
    // Chaque lot émet la MÊME ref « resto-1 » : sans namespacing, les ids
    // entreraient en collision à l’assemblage.
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({ moments: [momentActivite(ville, 'resto-1')] }))
    );

    const parcours = await genererParcours(briefMulti);
    const ids = parcours.timeline.flatMap((moment) =>
      moment.elements.map((element) => element.id)
    );

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('réécrit un dependDe intra-lot vers l’id local, sans fuite entre lots', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({
        moments: [
          {
            titre: `Étape à ${ville}`,
            ville,
            elements: [
              {
                ref: 'ancre',
                type: 'activite',
                nom: `Ancre ${ville}`,
                justification: 'point d’appui',
              },
              {
                ref: 'suite',
                type: 'restaurant',
                nom: `Table ${ville}`,
                justification: 'après l’ancre',
                dependDe: ['ancre'],
              },
            ],
          },
        ],
      }))
    );

    const parcours = await genererParcours(briefMulti);
    const idsAncres = parcours.timeline.map(
      (moment) => moment.elements[0].id
    );
    const suites = parcours.timeline.map((moment) => moment.elements[1]);

    // Chaque « suite » ne dépend que de l’ancre de SON lot.
    suites.forEach((suite, index) => {
      expect(suite.dependDe).toEqual([idsAncres[index]]);
    });
  });

  it('refuse un lot dont un dependDe cible une ref d’un autre lot', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({
        moments: [
          {
            titre: `Étape à ${ville}`,
            ville,
            elements: [
              {
                ref: 'local',
                type: 'activite',
                nom: `Activité ${ville}`,
                justification: 'étape',
                // « resto-1 » n’existe pas dans ce lot : dépendance inter-lot.
                dependDe: ['resto-1'],
              },
            ],
          },
        ],
      }))
    );

    await expect(genererParcours(briefMulti)).rejects.toThrow('inexploitable');
  });

  it('F6-C : porte le sous-code dependance_hors_lot', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({
        moments: [
          {
            titre: `Étape à ${ville}`,
            ville,
            elements: [
              {
                ref: 'local',
                type: 'activite',
                nom: `Activité ${ville}`,
                justification: 'étape',
                dependDe: ['resto-1'],
              },
            ],
          },
        ],
      }))
    );

    await expect(genererParcours(briefMulti)).rejects.toMatchObject({
      statusCode: 502,
      codeInterne: 'dependance_hors_lot',
    });
  });

  it('F6-C : porte le sous-code ref_dupliquee quand un lot répète deux fois la même ref', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({
        moments: [
          {
            titre: `Étape à ${ville}`,
            ville,
            elements: [
              { ref: 'dup', type: 'activite', nom: `Activité ${ville}`, justification: 'étape' },
              { ref: 'dup', type: 'restaurant', nom: `Table ${ville}`, justification: 'étape' },
            ],
          },
        ],
      }))
    );

    await expect(genererParcours(briefMono)).rejects.toMatchObject({
      statusCode: 502,
      codeInterne: 'ref_dupliquee',
    });
  });
});

describe('F5-B — validation technique du scope d’un lot', () => {
  it('refuse un lot dont un moment déclare une ville différente de celle du lot', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(async (prompt) => {
      const ville = briefDuPrompt(prompt as string).lieux?.[0];
      // Le lot Bordeaux déclare pourtant un moment à Paris : ni le prompt ni
      // la restriction des outils ne suffisent seuls, la sortie elle-même
      // doit être vérifiée avant d'être assemblée.
      const villeDeclaree = ville === 'Bordeaux' ? 'Paris' : ville;
      return JSON.stringify({ moments: [momentActivite(villeDeclaree)] });
    });

    await expect(genererParcours(briefMulti)).rejects.toThrow('inexploitable');
  });

  it('F6-C : porte le sous-code ville_hors_lot', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(async (prompt) => {
      const ville = briefDuPrompt(prompt as string).lieux?.[0];
      const villeDeclaree = ville === 'Bordeaux' ? 'Paris' : ville;
      return JSON.stringify({ moments: [momentActivite(villeDeclaree)] });
    });

    await expect(genererParcours(briefMulti)).rejects.toMatchObject({
      statusCode: 502,
      codeInterne: 'ville_hors_lot',
    });
  });

  it('refuse un lot dont un élément porte une plage hors de la plage du lot', async () => {
    const brief = BriefSchema.parse({
      intention: 'un séjour à Bordeaux',
      avecQui: 'solo',
      duree: { valeur: 11, unite: 'jours' },
      lieux: [{ nom: 'Bordeaux', type: 'ville' }],
      dates: { debut: '2026-09-01T00:00:00Z', fin: '2026-09-11T23:59:59Z' },
    });
    const lots = planDuBrief(brief).lots;
    expect(lots.length).toBeGreaterThan(1);
    // Le premier lot couvre le début du séjour (jours 1 à ~4) : une plage au
    // 10 septembre y est nécessairement hors bornes.
    expect(numeroDeJour(lots[0].plage!.fin) < numeroDeJour('2026-09-10')).toBe(
      true
    );

    let appel = 0;
    vi.mocked(callAIAvecOutils).mockImplementation(async () => {
      appel += 1;
      if (appel === 1) {
        return JSON.stringify({
          moments: [
            {
              titre: 'Hors plage',
              elements: [
                {
                  ref: 'r',
                  type: 'activite',
                  nom: 'Activité',
                  justification: 'étape',
                  plage: {
                    debut: '2026-09-10T09:00:00Z',
                    fin: '2026-09-10T11:00:00Z',
                  },
                },
              ],
            },
          ],
        });
      }
      return JSON.stringify({ moments: [momentActivite('Bordeaux')] });
    });

    await expect(genererParcours(brief)).rejects.toMatchObject({
      statusCode: 502,
      codeInterne: 'plage_hors_lot',
    });
  });

  it('n’applique aucune restriction de scope au lot sans ville ni plage (mono-lot)', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({ moments: [momentActivite(ville)] }))
    );

    await expect(genererParcours(briefMono)).resolves.toBeTruthy();
  });
});

describe('F6-F — bornes temporelles d’un lot mono-bloc (ex. soirée courte)', () => {
  const briefSoiree: Brief = BriefSchema.parse({
    intention: 'passer une bonne soirée entre amis à Bordeaux',
    avecQui: 'amis',
    duree: { valeur: 5, unite: 'heures' },
    dates: { debut: '2026-09-12T18:00:00.000Z', fin: '2026-09-12T23:59:00.000Z' },
    lieux: [{ nom: 'Bordeaux', type: 'ville' }],
  });

  function elementAvecPlage(debut: string, fin: string) {
    return {
      titre: 'Soirée',
      ville: 'Bordeaux',
      elements: [
        {
          ref: 'sortie-1',
          type: 'sortie',
          nom: 'Bar',
          justification: 'clôture de soirée',
          plage: { debut, fin },
        },
      ],
    };
  }

  it('conserve les heures précises du brief pour un lot unique, sans les élargir au jour civil plein', async () => {
    expect(planDuBrief(briefSoiree).lots).toHaveLength(1);
    let datesRecues: { debut: string; fin: string } | undefined;
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville, dates }) => {
        datesRecues = dates;
        return { moments: [momentActivite(ville)] };
      })
    );

    await genererParcours(briefSoiree);

    expect(datesRecues).toEqual(briefSoiree.dates);
  });

  it('accepte une activité entièrement dans la plage acceptée', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(async () =>
      JSON.stringify({
        moments: [elementAvecPlage('2026-09-12T19:00:00.000Z', '2026-09-12T21:00:00.000Z')],
      })
    );

    await expect(genererParcours(briefSoiree)).resolves.toBeTruthy();
  });

  it('rejette une plage qui commence la veille du lot', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(async () =>
      JSON.stringify({
        moments: [elementAvecPlage('2026-09-11T19:00:00.000Z', '2026-09-12T21:00:00.000Z')],
      })
    );

    await expect(genererParcours(briefSoiree)).rejects.toMatchObject({
      statusCode: 502,
      codeInterne: 'plage_hors_lot',
    });
  });

  it('rejette une plage qui finit le lendemain du lot', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(async () =>
      JSON.stringify({
        moments: [elementAvecPlage('2026-09-12T22:00:00.000Z', '2026-09-13T01:00:00.000Z')],
      })
    );

    await expect(genererParcours(briefSoiree)).rejects.toMatchObject({
      statusCode: 502,
      codeInterne: 'plage_hors_lot',
    });
  });

  it('accepte une plage strictement calée sur les bornes exactes du brief', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(async () =>
      JSON.stringify({
        moments: [
          elementAvecPlage(briefSoiree.dates!.debut, briefSoiree.dates!.fin),
        ],
      })
    );

    await expect(genererParcours(briefSoiree)).resolves.toBeTruthy();
  });

  it('une soirée qui franchit minuit UTC reste hors périmètre du lot — règle produit inchangée', async () => {
    // Le brief borne lui-même la soirée à 23:59 UTC le 12 : une plage qui
    // déborde sur le 13 n'est jamais admise silencieusement, même si elle
    // correspond à un horaire local raisonnable (minuit UTC ≈ 2h du matin à
    // Bordeaux en septembre). Franchir minuit reste un vrai débordement tant
    // que le brief ne le couvre pas explicitement.
    vi.mocked(callAIAvecOutils).mockImplementation(async () =>
      JSON.stringify({
        moments: [elementAvecPlage('2026-09-12T23:00:00.000Z', '2026-09-13T00:30:00.000Z')],
      })
    );

    await expect(genererParcours(briefSoiree)).rejects.toMatchObject({
      statusCode: 502,
      codeInterne: 'plage_hors_lot',
    });
  });

  it('une plage sans suffixe "Z" est traitée comme UTC, sans décalage local implicite', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(async () =>
      JSON.stringify({
        moments: [elementAvecPlage('2026-09-12T19:00:00', '2026-09-12T21:00:00')],
      })
    );

    await expect(genererParcours(briefSoiree)).resolves.toBeTruthy();
  });

  it('génération progressive multi-lot inchangée : chaque lot reçoit toujours un jour civil plein', async () => {
    const brief = BriefSchema.parse({
      intention: 'un long séjour à Bordeaux',
      avecQui: 'solo',
      duree: { valeur: 11, unite: 'jours' },
      lieux: [{ nom: 'Bordeaux', type: 'ville' }],
      dates: { debut: '2026-09-01T00:00:00Z', fin: '2026-09-11T23:59:59Z' },
    });
    expect(planDuBrief(brief).lots.length).toBeGreaterThan(1);

    const datesParAppel: { debut: string; fin: string }[] = [];
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville, dates }) => {
        if (dates) datesParAppel.push(dates);
        return { moments: [momentActivite(ville)] };
      })
    );

    await genererParcours(brief);

    expect(datesParAppel.length).toBeGreaterThan(0);
    for (const dates of datesParAppel) {
      expect(dates.debut.endsWith('T00:00:00.000Z')).toBe(true);
      expect(dates.fin.endsWith('T23:59:59.999Z')).toBe(true);
    }
  });
});

describe('F5-B — reprise ciblée', () => {
  it('rejoue seulement le lot en 503, sans régénérer les lots déjà validés', async () => {
    let tentativesParis = 0;
    vi.mocked(callAIAvecOutils).mockImplementation(async (prompt) => {
      const ville = briefDuPrompt(prompt as string).lieux?.[0];
      if (ville === 'Paris') {
        tentativesParis += 1;
        if (tentativesParis === 1) return JSON.stringify({ indisponible: true });
      }
      return JSON.stringify({ moments: [momentActivite(ville)] });
    });

    const parcours = await genererParcours(briefMulti);
    const villes = villesDesAppels();

    // Paris a été rejoué une fois ; Bordeaux et Lyon générés une seule fois.
    expect(villes.filter((ville) => ville === 'Bordeaux')).toHaveLength(1);
    expect(villes.filter((ville) => ville === 'Paris')).toHaveLength(2);
    expect(villes.filter((ville) => ville === 'Lyon')).toHaveLength(1);
    const noms = parcours.timeline.map((moment) => moment.elements[0].nom);
    expect(noms[0]).toContain('Bordeaux');
    expect(noms[1]).toContain('Paris');
    expect(noms[2]).toContain('Lyon');
  });

  it('échec technique persistant : aucun parcours rendu', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(async (prompt) => {
      const ville = briefDuPrompt(prompt as string).lieux?.[0];
      if (ville === 'Paris') return JSON.stringify({ indisponible: true });
      return JSON.stringify({ moments: [momentActivite(ville)] });
    });

    await expect(genererParcours(briefMulti)).rejects.toMatchObject({
      statusCode: 503,
    });
    // Bordeaux (1) + Paris (1 initiale + 2 reprises) ; Lyon jamais atteint.
    const villes = villesDesAppels();
    expect(villes.filter((ville) => ville === 'Paris')).toHaveLength(3);
    expect(villes).not.toContain('Lyon');
  });

  it('refus métier 422 : échec global prudent, sans générer les lots suivants', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(async (prompt) => {
      const ville = briefDuPrompt(prompt as string).lieux?.[0];
      if (ville === 'Bordeaux') {
        return JSON.stringify({
          refus: {
            code: 'donnees_essentielles_insuffisantes',
            message: 'Événement essentiel introuvable.',
          },
        });
      }
      return JSON.stringify({ moments: [momentActivite(ville)] });
    });

    await expect(genererParcours(briefMulti)).rejects.toMatchObject({
      statusCode: 422,
    });
    // Le refus du premier lot arrête tout : Paris et Lyon ne sont pas générés.
    expect(callAIAvecOutils).toHaveBeenCalledTimes(1);
  });
});

describe('F5-B — transport et enrichissements sur l’agrégat', () => {
  it('synthétise chaque transport à sa frontière de ville, après assemblage', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({ moments: [momentActivite(ville)] }))
    );

    const parcours = await genererParcours(briefTransport());
    const noms = parcours.timeline.map((moment) => moment.elements[0].nom);

    expect(noms).toHaveLength(5);
    expect(noms[0]).toContain('Bordeaux');
    expect(noms[1]).toBe('Transport à organiser de Bordeaux vers Paris');
    expect(noms[2]).toContain('Paris');
    expect(noms[3]).toBe('Transport à organiser de Paris vers Lyon');
    expect(noms[4]).toContain('Lyon');
  });

  it('n’appelle jamais resoudreLiensReels et n’expose aucun lien réel inventé', async () => {
    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({ moments: [momentActivite(ville)] }))
    );

    await genererParcours(briefMulti);

    expect(resoudreLiensReels).not.toHaveBeenCalled();
    // Sans recherche outillée, aucun candidat n’est journalisé : pas de
    // résolution de lien réel, exécutée une seule fois au plus sur l’agrégat.
    expect(resoudreLien).not.toHaveBeenCalled();
  });

  it('parcours multi-villes de trois semaines : tous les lots générés, sans troncature', async () => {
    const brief = BriefSchema.parse({
      intention: 'trois semaines entre Bordeaux, Paris et Lyon',
      avecQui: 'groupe',
      duree: { valeur: 21, unite: 'jours' },
      lieux: [
        { nom: 'Bordeaux', type: 'ville' },
        { nom: 'Paris', type: 'ville' },
        { nom: 'Lyon', type: 'ville' },
      ],
      dates: { debut: '2026-09-01T00:00:00Z', fin: '2026-09-21T23:59:59Z' },
      transport: {
        necessaire: true,
        troncons: [
          {
            origine: { ville: 'Bordeaux' },
            destination: { ville: 'Paris' },
            depart: { date: '2026-09-08' },
          },
          {
            origine: { ville: 'Paris' },
            destination: { ville: 'Lyon' },
            depart: { date: '2026-09-15' },
          },
        ],
        occupation: { statut: 'declaree', adultes: 3, enfants: 0 },
      },
    });
    const lots = planDuBrief(brief).lots;
    expect(lots.length).toBeGreaterThanOrEqual(3);

    vi.mocked(callAIAvecOutils).mockImplementation(
      llmParLot(({ ville }) => ({ moments: [momentActivite(ville)] }))
    );

    const parcours = await genererParcours(brief);

    // Un appel par lot, aucun lot perdu.
    expect(callAIAvecOutils).toHaveBeenCalledTimes(lots.length);
    const activites = parcours.timeline.filter(
      (moment) => moment.elements[0].type === 'activite'
    );
    expect(activites).toHaveLength(lots.length);
    // Les trois villes apparaissent, plus les deux transports synthétisés.
    const transports = parcours.timeline.filter(
      (moment) => moment.elements[0].type === 'transport'
    );
    expect(transports).toHaveLength(2);
    for (const ville of ['Bordeaux', 'Paris', 'Lyon']) {
      expect(
        activites.some((moment) => moment.elements[0].nom.includes(ville))
      ).toBe(true);
    }
  });
});
