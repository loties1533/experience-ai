import { describe, expect, it, vi } from 'vitest';
import { BriefSchema, type Brief } from '../../server/agents/brief.js';
import {
  decouvrirDestinations,
  proposerDestinations,
} from '../../server/agents/generation/decouverteDestinations.js';
import type { PropositionDecouverteDestinations } from '../../server/agents/generation/contratDecouverteDestinations.js';
import type { ResultatResolutionDestinations } from '../../server/agents/generation/resolutionDestinations.js';

function brief(changements: Partial<Brief> = {}): Brief {
  return BriefSchema.parse({
    intention: 'Faire du trek en montagne et découvrir la nature',
    avecQui: 'solo',
    duree: { valeur: 3, unite: 'semaines' },
    dates: {
      debut: '2027-01-05T00:00:00.000Z',
      fin: '2027-01-25T23:59:59.999Z',
    },
    lieux: [],
    contraintes: [],
    ...changements,
  });
}

function sortieLLM(
  changements: Partial<PropositionDecouverteDestinations> = {}
): string {
  return JSON.stringify({
    format: 'itineraire',
    facettesObligatoires: ['sports_hiver', 'nature'],
    facettesSouples: ['detente'],
    candidats: [
      { nom: 'Chamonix', codePaysSuggere: 'FR' },
      { nom: 'Innsbruck', codePaysSuggere: 'AT' },
    ],
    ...changements,
  });
}

function resolutionOk(
  noms = ['Chamonix', 'Innsbruck']
): ResultatResolutionDestinations {
  return {
    statut: 'ok',
    destinations: noms.map((nom, index) => ({
      destination: {
        identifiantGeoNames: index + 1,
        nomCanonique: nom,
        codePays: index === 0 ? 'FR' : 'AT',
        coordonnees: { latitude: 45 + index, longitude: 6 + index },
        featureCode: 'PPL',
        fournisseur: 'Open-Meteo/GeoNames',
        source: 'https://geocoding-api.open-meteo.com/v1/search',
        recupereLe: '2026-08-09T15:00:00.000Z',
      },
      signauxParFacette: {},
      facettesObligatoiresCouvertes: 2,
      facettesSouplesCouvertes: 1,
      minimumSignauxPlafonne: 3,
    })),
    rejets: [],
  };
}

function dependances(
  resolution: ResultatResolutionDestinations = resolutionOk()
) {
  return {
    appelerIA: vi.fn().mockResolvedValue(sortieLLM()),
    resoudre: vi.fn().mockResolvedValue(resolution),
  };
}

describe('proposeur LLM borné', () => {
  it('ne transmet au serveur que le contrat strict validé', async () => {
    const appelerIA = vi.fn().mockResolvedValue(sortieLLM());

    const proposition = await proposerDestinations(brief(), appelerIA);

    expect(proposition).toEqual({
      format: 'itineraire',
      facettesObligatoires: ['sports_hiver', 'nature'],
      facettesSouples: ['detente'],
      candidats: [
        { nom: 'Chamonix', codePaysSuggere: 'FR' },
        { nom: 'Innsbruck', codePaysSuggere: 'AT' },
      ],
    });
    expect(appelerIA).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('aucune justification, preuve, note, score, prix'),
      'destinations'
    );
  });

  it('classe une sortie LLM enrichie d’un score comme erreur 502', async () => {
    const appelerIA = vi.fn().mockResolvedValue(
      JSON.stringify({
        ...JSON.parse(sortieLLM()),
        score: 83,
      })
    );

    await expect(proposerDestinations(brief(), appelerIA)).rejects.toMatchObject(
      { statusCode: 502 }
    );
  });
});

describe('préconditions et décision de découverte', () => {
  it('construit uniquement des villes vérifiées d’origine selection_moteur sans muter le Brief', async () => {
    const demande = brief({ budgetTotal: 5000 });
    const avant = structuredClone(demande);
    const deps = dependances();

    const resultat = await decouvrirDestinations(demande, deps);

    expect(resultat).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'decouverte_destinations',
        etapes: [
          {
            ville: { nom: 'Chamonix', origine: 'selection_moteur' },
            ancres: [],
          },
          {
            ville: { nom: 'Innsbruck', origine: 'selection_moteur' },
            ancres: [],
          },
        ],
        contraintesConservees: {
          dates: demande.dates,
          budgetTotal: 5000,
        },
      },
    });
    expect(demande).toEqual(avant);
  });

  it('ne laisse jamais le nom brut proposé par le LLM entrer dans le contexte', async () => {
    const deps = dependances(resolutionOk(['Chamonix-Mont-Blanc']));

    const resultat = await decouvrirDestinations(brief(), deps);

    expect(resultat).toMatchObject({
      type: 'planifiable',
      contexte: {
        etapes: [
          {
            ville: {
              nom: 'Chamonix-Mont-Blanc',
              origine: 'selection_moteur',
            },
          },
        ],
      },
    });
    expect(
      resultat.type === 'planifiable'
        ? resultat.contexte.etapes[0].ville?.nom
        : undefined
    ).not.toBe('Chamonix');
  });

  it('clarifie une intention réellement vague avant tout appel', async () => {
    const deps = dependances();

    const resultat = await decouvrirDestinations(
      brief({ intention: 'Je veux partir quelque part de bien' }),
      deps
    );

    expect(resultat).toMatchObject({
      type: 'clarification_requise',
      clarification: {
        code: 'intention_a_preciser',
        champCible: 'intention',
      },
    });
    expect(deps.appelerIA).not.toHaveBeenCalled();
    expect(deps.resoudre).not.toHaveBeenCalled();
  });

  it('clarifie la période avant le proposeur', async () => {
    const deps = dependances();
    const resultat = await decouvrirDestinations(
      brief({ dates: undefined }),
      deps
    );

    expect(resultat).toMatchObject({
      type: 'clarification_requise',
      clarification: { code: 'periode_requise', champCible: 'dates' },
    });
    expect(deps.appelerIA).not.toHaveBeenCalled();
  });

  it('clarifie d’abord la zone puis le caractère indispensable du soleil', async () => {
    const deps = dependances();
    const sansZone = await decouvrirDestinations(
      brief({ intention: 'Je veux du soleil et de la détente' }),
      deps
    );
    expect(sansZone).toMatchObject({
      type: 'clarification_requise',
      clarification: { code: 'zone_geographique_requise' },
    });

    const avecZone = await decouvrirDestinations(
      brief({
        intention: 'Je veux du soleil et de la détente',
        lieux: ['Europe'],
      }),
      deps
    );
    expect(avecZone).toMatchObject({
      type: 'clarification_requise',
      clarification: {
        code: 'intention_a_preciser',
        question:
          'Le soleil est-il indispensable, ou une destination plage/détente sans garantie météo te convient-elle ?',
      },
    });
    expect(deps.appelerIA).not.toHaveBeenCalled();
  });

  it('refuse honnêtement un soleil confirmé indispensable', async () => {
    const deps = dependances();
    const resultat = await decouvrirDestinations(
      brief({
        intention: 'Le soleil est indispensable pour ce séjour détente',
        lieux: ['Europe'],
      }),
      deps
    );

    expect(resultat).toMatchObject({
      type: 'refus',
      refus: { code: 'hors_perimetre_produit' },
    });
    expect(JSON.stringify(resultat)).not.toContain('destination ensoleillée');
    expect(deps.appelerIA).not.toHaveBeenCalled();
  });

  it('ignore le soleil souple et continue sur les seules facettes prouvables', async () => {
    const deps = dependances(resolutionOk(['Lisbonne']));
    const resultat = await decouvrirDestinations(
      brief({
        intention:
          'Je souhaite de préférence du soleil, mais une destination détente sans garantie météo me convient',
      }),
      deps
    );

    expect(resultat).toMatchObject({
      type: 'planifiable',
      contexte: { strategie: 'decouverte_destinations' },
    });
    expect(deps.appelerIA).toHaveBeenCalledTimes(1);
  });

  it('transforme zéro candidat vérifié en refus métier, jamais en erreur technique', async () => {
    const deps = dependances({
      statut: 'vide',
      rejets: [
        {
          candidat: { nom: 'Ville imaginaire' },
          raison: 'introuvable',
        },
      ],
    });

    await expect(decouvrirDestinations(brief(), deps)).resolves.toMatchObject({
      type: 'refus',
      refus: { code: 'donnees_essentielles_insuffisantes' },
    });
  });

  it('transforme une ambiguïté pertinente en clarification structurée', async () => {
    const deps = dependances({
      statut: 'clarification_zone',
      rejets: [
        { candidat: { nom: 'Boston' }, raison: 'ambigue' },
      ],
    });

    await expect(decouvrirDestinations(brief(), deps)).resolves.toMatchObject({
      type: 'clarification_requise',
      clarification: { code: 'zone_geographique_requise' },
    });
  });
});
