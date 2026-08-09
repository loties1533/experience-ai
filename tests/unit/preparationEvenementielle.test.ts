import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rechercherEvenementsPredictHQEventFirst } = vi.hoisted(() => ({
  rechercherEvenementsPredictHQEventFirst: vi.fn(),
}));
vi.mock('../../server/services/predictHQ.js', () => ({
  rechercherEvenementsPredictHQEventFirst,
}));

const { BriefSchema } = await import('../../server/agents/brief.js');
const {
  construireEtapesEvenementielles,
  estDemandeNBAEvenementielle,
  preparerGeneration,
  selectionnerEvenementsEventFirst,
} = await import('../../server/agents/generation/preparation.js');

function evenement(
  identifiantExterne: string,
  ville: string,
  dateDebut: string
) {
  return {
    identifiantExterne,
    nom: `Match ${identifiantExterne}`,
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

const BRIEF_NBA = BriefSchema.parse({
  intention: 'Vivre la NBA et voir des matchs en direct',
  avecQui: 'amis',
  duree: { valeur: 3, unite: 'semaines' },
  dates: { debut: '2027-01-15T00:00:00.000Z', fin: '2027-02-10T23:59:59.999Z' },
  contraintes: ['aux États-Unis'],
});

const BRIEF_RECETTE = BriefSchema.parse({
  intention: 'Vivre la NBA ; voir des matchs en direct',
  avecQui: 'solo',
  duree: { valeur: 3, unite: 'semaines' },
  dates: {
    debut: '2027-01-15T00:00:00.000Z',
    fin: '2027-02-10T00:00:00.000Z',
  },
  lieux: ['États-Unis'],
  budgetTotal: 9000,
});

describe('préparation événementielle NBA', () => {
  beforeEach(() => vi.clearAllMocks());

  it('branche NBA sans ville vers PredictHQ event-first et construit des étapes fournisseur', async () => {
    rechercherEvenementsPredictHQEventFirst.mockResolvedValue({
      statut: 'ok',
      recupereLe: '2026-08-08T12:00:00.000Z',
      resultats: [
        evenement('evt-boston', 'Boston', '2027-01-18T00:30:00.000Z'),
        evenement('evt-new-york', 'New York', '2027-01-25T00:30:00.000Z'),
        evenement('evt-chicago', 'Chicago', '2027-02-02T00:30:00.000Z'),
      ],
    });

    const resultat = await preparerGeneration(BRIEF_NBA);

    expect(rechercherEvenementsPredictHQEventFirst).toHaveBeenCalledWith({
      requete: 'NBA',
      dateDebut: '2027-01-15',
      dateFin: '2027-02-10',
      categorie: 'sports',
      pays: 'US',
    });
    expect(resultat).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'decouverte_evenementielle',
        etapes: [
          { ville: { nom: 'Boston', origine: 'fournisseur' }, ancres: [{ identifiantExterne: 'evt-boston' }] },
          { ville: { nom: 'New York', origine: 'fournisseur' }, ancres: [{ identifiantExterne: 'evt-new-york' }] },
          { ville: { nom: 'Chicago', origine: 'fournisseur' }, ancres: [{ identifiantExterne: 'evt-chicago' }] },
        ],
      },
    });
    expect(BRIEF_NBA.lieux).toEqual([]);
  });

  it('interprète le pays du Brief réel comme filtre US sans le projeter en ville', async () => {
    rechercherEvenementsPredictHQEventFirst.mockResolvedValue({
      statut: 'ok',
      recupereLe: '2026-08-08T12:00:00.000Z',
      resultats: [evenement('evt-boston', 'Boston', '2027-01-18T00:30:00.000Z')],
    });

    const resultat = await preparerGeneration(BRIEF_RECETTE);

    expect(estDemandeNBAEvenementielle(BRIEF_RECETTE)).toBe(true);
    expect(rechercherEvenementsPredictHQEventFirst).toHaveBeenCalledWith({
      requete: 'NBA',
      dateDebut: '2027-01-15',
      dateFin: '2027-02-10',
      categorie: 'sports',
      pays: 'US',
    });
    expect(resultat).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'decouverte_evenementielle',
        etapes: [{ ville: { nom: 'Boston', origine: 'fournisseur' } }],
      },
    });
    if (resultat.type === 'planifiable') {
      expect(resultat.contexte.etapes.map((etape) => etape.ville?.nom)).not.toContain(
        'États-Unis'
      );
    }
    expect(BRIEF_RECETTE.lieux).toEqual(['États-Unis']);
  });

  it.each(['Etats-Unis', 'USA', 'US'])(
    'reconnaît %s comme zone US pour la seule stratégie NBA',
    async (zone) => {
      rechercherEvenementsPredictHQEventFirst.mockResolvedValue({
        statut: 'ok',
        recupereLe: '2026-08-08T12:00:00.000Z',
        resultats: [evenement('evt-boston', 'Boston', '2027-01-18T00:30:00.000Z')],
      });
      const brief = BriefSchema.parse({ ...BRIEF_RECETTE, lieux: [zone] });

      const resultat = await preparerGeneration(brief);

      expect(rechercherEvenementsPredictHQEventFirst).toHaveBeenCalledWith(
        expect.objectContaining({ pays: 'US' })
      );
      expect(resultat).toMatchObject({
        type: 'planifiable',
        contexte: { strategie: 'decouverte_evenementielle' },
      });
      expect(brief.lieux).toEqual([zone]);
    }
  );

  it('conserve Boston explicite et exclut la zone US des étapes du chemin villes', async () => {
    const brief = BriefSchema.parse({
      ...BRIEF_RECETTE,
      lieux: ['États-Unis', 'Boston'],
    });

    const resultat = await preparerGeneration(brief);

    expect(rechercherEvenementsPredictHQEventFirst).not.toHaveBeenCalled();
    expect(resultat).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'villes_du_brief',
        etapes: [{ ville: { nom: 'Boston', origine: 'utilisateur' } }],
      },
    });
    if (resultat.type === 'planifiable') {
      expect(resultat.contexte.etapes).toHaveLength(1);
    }
    expect(brief.lieux).toEqual(['États-Unis', 'Boston']);
  });

  it('conserve le chemin villes du brief et ignore les intentions non événementielles', async () => {
    const avecVilles = BriefSchema.parse({ ...BRIEF_NBA, lieux: ['Boston'] });
    const resultatAvecVille = await preparerGeneration(avecVilles);
    const resultatNonEvenementiel = await preparerGeneration(
      BriefSchema.parse({ ...BRIEF_NBA, intention: 'Faire un trek dans les Alpes' })
    );

    expect(rechercherEvenementsPredictHQEventFirst).not.toHaveBeenCalled();
    expect(resultatAvecVille).toMatchObject({
      type: 'planifiable',
      contexte: { strategie: 'villes_du_brief' },
    });
    expect(resultatNonEvenementiel).toMatchObject({
      type: 'planifiable',
      contexte: { strategie: 'compatibilite_sans_localisation' },
    });
  });

  it('distingue zéro événement vérifiable (refus) et fournisseur indisponible (503)', async () => {
    rechercherEvenementsPredictHQEventFirst.mockResolvedValueOnce({
      statut: 'vide', resultats: [], recupereLe: '2026-08-08T12:00:00.000Z',
    });
    await expect(preparerGeneration(BRIEF_NBA)).resolves.toMatchObject({
      type: 'refus',
      refus: { code: 'donnees_essentielles_insuffisantes' },
    });

    rechercherEvenementsPredictHQEventFirst.mockResolvedValueOnce({
      statut: 'indisponible', fournisseur: 'PredictHQ', raison: 'reseau',
    });
    await expect(preparerGeneration(BRIEF_NBA)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('refuse métier si tous les candidats reçus ont une plage temporelle inutilisable', async () => {
    const dateDebut = '2027-01-18T00:30:00.000Z';
    const { dateFin: _dateFin, ...sansFin } = evenement('evt-sans-fin', 'Boston', dateDebut);
    rechercherEvenementsPredictHQEventFirst.mockResolvedValue({
      statut: 'ok',
      recupereLe: '2026-08-08T12:00:00.000Z',
      resultats: [
        sansFin,
        { ...evenement('evt-fin-egale', 'Boston', dateDebut), dateFin: dateDebut },
        {
          ...evenement('evt-fin-avant', 'Boston', dateDebut),
          dateFin: '2027-01-18T00:29:59.999Z',
        },
      ],
    });

    await expect(preparerGeneration(BRIEF_NBA)).resolves.toMatchObject({
      type: 'refus',
      refus: {
        code: 'donnees_essentielles_insuffisantes',
        message: 'Aucun événement NBA vérifiable n’a été trouvé sur les dates et la zone demandées.',
      },
    });
  });

  it('sélectionne uniquement des IDs fournisseur existants, sans doublon et de façon bornée', () => {
    const candidats = [
      evenement('evt-boston', 'Boston', '2027-01-18T00:30:00.000Z'),
      evenement('evt-boston', 'Boston', '2027-01-18T00:30:00.000Z'),
      evenement('evt-boston-2', 'Boston', '2027-01-21T00:30:00.000Z'),
      evenement('evt-new-york', 'New York', '2027-01-25T00:30:00.000Z'),
      evenement('evt-chicago', 'Chicago', '2027-02-02T00:30:00.000Z'),
      evenement('evt-miami', 'Miami', '2027-02-07T00:30:00.000Z'),
    ];

    const retenus = selectionnerEvenementsEventFirst(candidats, '2027-01-15', '2027-02-10');

    expect(retenus).toHaveLength(3);
    expect(new Set(retenus.map((candidat) => candidat.identifiantExterne)).size).toBe(3);
    expect(retenus.every((candidat) => candidats.some((source) => source.identifiantExterne === candidat.identifiantExterne))).toBe(true);
    expect(retenus.map((candidat) => candidat.ville)).toEqual(['Boston', 'New York', 'Chicago']);
  });

  it('regroupe les ancres consécutives par ville dans des fenêtres non chevauchantes', () => {
    const etapes = construireEtapesEvenementielles(
      [
        evenement('evt-boston-1', 'Boston', '2027-01-18T00:30:00.000Z'),
        evenement('evt-boston-2', 'Boston', '2027-01-21T00:30:00.000Z'),
        evenement('evt-new-york', 'New York', '2027-01-25T00:30:00.000Z'),
      ],
      '2027-01-15',
      '2027-01-31'
    );

    expect(etapes).toMatchObject([
      { ville: { nom: 'Boston', origine: 'fournisseur' }, plage: { debut: '2027-01-15', fin: '2027-01-24' }, ancres: [{ identifiantExterne: 'evt-boston-1' }, { identifiantExterne: 'evt-boston-2' }] },
      { ville: { nom: 'New York', origine: 'fournisseur' }, plage: { debut: '2027-01-25', fin: '2027-01-31' }, ancres: [{ identifiantExterne: 'evt-new-york' }] },
    ]);
  });
});
