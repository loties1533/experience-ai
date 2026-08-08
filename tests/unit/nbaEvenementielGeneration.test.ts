import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn(), callAIAvecOutils: vi.fn() };
});
vi.mock('../../server/services/liens.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/liens.js')>();
  return { ...reel, resoudreLien: vi.fn(), resoudreLiensReels: vi.fn() };
});

const { callAIAvecOutils } = await import('../../server/services/claude/core.js');
const { resoudreLien } = await import('../../server/services/liens.js');
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
});
