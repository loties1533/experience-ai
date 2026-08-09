import { describe, expect, it, vi } from 'vitest';
import { BriefSchema } from '../../server/agents/brief.js';
import { decouvrirDestinations } from '../../server/agents/generation/decouverteDestinations.js';
import { deriverPlan } from '../../server/agents/generation/plan.js';
import { preparerGeneration } from '../../server/agents/generation/preparation.js';
import { resoudreDestinationsProposees } from '../../server/agents/generation/resolutionDestinations.js';
import type { FacetteDestination } from '../../server/services/destinations/index.js';

function fournisseursBenchmark() {
  const geocoder = vi.fn(async (demande: unknown) => {
    const { nom, codePays } = demande as { nom: string; codePays?: string };
    const villes: Record<string, { id: number; pays: string; latitude: number }> = {
      Chamonix: { id: 3027301, pays: 'FR', latitude: 45.92375 },
      Innsbruck: { id: 2775220, pays: 'AT', latitude: 47.26266 },
    };
    const ville = villes[nom];
    if (!ville || (codePays && codePays !== ville.pays)) {
      return {
        statut: 'vide' as const,
        destinations: [] as [],
        recupereLe: '2026-08-09T16:00:00.000Z',
      };
    }
    return {
      statut: 'unique' as const,
      destination: {
        identifiantGeoNames: ville.id,
        nomCanonique: nom,
        codePays: ville.pays,
        coordonnees: { latitude: ville.latitude, longitude: 6 },
        featureCode: 'PPL' as const,
        fournisseur: 'Open-Meteo/GeoNames' as const,
        source: 'https://geocoding-api.open-meteo.com/v1/search',
        recupereLe: '2026-08-09T16:00:00.000Z',
      },
      recupereLe: '2026-08-09T16:00:00.000Z',
    };
  });
  const rechercherPoi = vi.fn(async (demande: unknown) => {
    const facette = (demande as { facette: FacetteDestination }).facette;
    return {
      statut: 'ok' as const,
      resultats: Array.from({ length: 3 }, (_, index) => ({
        identifiantExterne: `${facette}-${index}-${JSON.stringify(demande)}`,
        nom: `${facette} observé ${index}`,
        categories: [{ identifiant: `cat-${facette}`, nom: facette }],
        fournisseur: 'Foursquare' as const,
        source: 'https://places-api.foursquare.com/places/search',
        recupereLe: '2026-08-09T16:00:00.000Z',
      })),
      recupereLe: '2026-08-09T16:00:00.000Z',
    };
  });
  return { geocoder, rechercherPoi };
}

describe('benchmarks métier PR5-B', () => {
  it('A — montagne sans ville devient un plan vérifié sans lot sans ville', async () => {
    const brief = BriefSchema.parse({
      intention: 'Passer trois semaines à la montagne en hiver',
      avecQui: 'solo',
      duree: { valeur: 3, unite: 'semaines' },
      dates: {
        debut: '2027-01-05T00:00:00.000Z',
        fin: '2027-01-25T23:59:59.999Z',
      },
      budgetTotal: 5000,
      lieux: [],
    });
    const fournisseurs = fournisseursBenchmark();
    const appelerIA = vi.fn().mockResolvedValue(
      JSON.stringify({
        format: 'itineraire',
        facettesObligatoires: ['sports_hiver', 'nature'],
        facettesSouples: [],
        candidats: [
          { nom: 'Chamonix', codePaysSuggere: 'FR' },
          { nom: 'Innsbruck', codePaysSuggere: 'AT' },
        ],
      })
    );
    const resultat = await preparerGeneration(brief, {
      decouvrirDestinations: (demande) =>
        decouvrirDestinations(demande, {
          appelerIA,
          resoudre: (source, proposition) =>
            resoudreDestinationsProposees(
              source,
              proposition,
              fournisseurs
            ),
        }),
    });

    expect(appelerIA).toHaveBeenCalledTimes(1);
    expect(fournisseurs.geocoder).toHaveBeenCalledTimes(2);
    expect(fournisseurs.rechercherPoi).toHaveBeenCalledTimes(4);
    expect(resultat).toMatchObject({
      type: 'planifiable',
      contexte: {
        strategie: 'decouverte_destinations',
        etapes: [
          { ville: { origine: 'selection_moteur' } },
          { ville: { origine: 'selection_moteur' } },
        ],
      },
    });
    if (resultat.type !== 'planifiable') throw new Error('contexte attendu');
    const plan = deriverPlan(resultat.contexte);
    expect(plan.lots.every((lot) => lot.ville !== undefined)).toBe(true);
    expect(brief.lieux).toEqual([]);
  });

  it('B — soleil/détente clarifie la zone puis refuse toute garantie météo implicite', async () => {
    const fournisseurs = fournisseursBenchmark();
    const appelerIA = vi.fn();
    const sansZone = BriefSchema.parse({
      intention: 'Je veux du soleil et de la détente',
      avecQui: 'couple',
      duree: { valeur: 1, unite: 'semaines' },
      dates: {
        debut: '2027-06-01T00:00:00.000Z',
        fin: '2027-06-07T23:59:59.999Z',
      },
    });
    const executer = (demande: typeof sansZone) =>
      preparerGeneration(demande, {
        decouvrirDestinations: (source) =>
          decouvrirDestinations(source, {
            appelerIA,
            resoudre: (briefSource, proposition) =>
              resoudreDestinationsProposees(
                briefSource,
                proposition,
                fournisseurs
              ),
          }),
      });

    await expect(executer(sansZone)).resolves.toMatchObject({
      type: 'clarification_requise',
      clarification: { code: 'zone_geographique_requise' },
    });
    await expect(
      executer(BriefSchema.parse({ ...sansZone, lieux: ['Europe'] }))
    ).resolves.toMatchObject({
      type: 'clarification_requise',
      clarification: {
        code: 'intention_a_preciser',
        question: expect.stringContaining('sans garantie météo'),
      },
    });
    expect(appelerIA).not.toHaveBeenCalled();
    expect(fournisseurs.geocoder).not.toHaveBeenCalled();
    expect(fournisseurs.rechercherPoi).not.toHaveBeenCalled();
  });

  it('C — demande trop vague clarifie l’intention sans fournisseur', async () => {
    const fournisseurs = fournisseursBenchmark();
    const appelerIA = vi.fn();
    const demande = BriefSchema.parse({
      intention: 'Je veux partir quelque part de bien',
      avecQui: 'solo',
      duree: { valeur: 5, unite: 'jours' },
      dates: {
        debut: '2027-05-01T00:00:00.000Z',
        fin: '2027-05-05T23:59:59.999Z',
      },
    });

    const resultat = await preparerGeneration(demande, {
      decouvrirDestinations: (source) =>
        decouvrirDestinations(source, {
          appelerIA,
          resoudre: (briefSource, proposition) =>
            resoudreDestinationsProposees(
              briefSource,
              proposition,
              fournisseurs
            ),
        }),
    });

    expect(resultat).toMatchObject({
      type: 'clarification_requise',
      clarification: { code: 'intention_a_preciser' },
    });
    expect(appelerIA).not.toHaveBeenCalled();
    expect(fournisseurs.geocoder).not.toHaveBeenCalled();
    expect(fournisseurs.rechercherPoi).not.toHaveBeenCalled();
  });
});
