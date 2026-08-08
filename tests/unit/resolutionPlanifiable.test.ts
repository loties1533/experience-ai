import { describe, expect, it } from 'vitest';
import { SortieGenerationSchema } from '../../server/agents/generation/contratLLM.js';
import { preparerMomentsPourResolution } from '../../server/agents/generation/resolution.js';
import { creerBoiteAOutils } from '../../server/services/claude/outils.js';

describe('résolution — villes du contexte planifiable', () => {
  it('rapproche un candidat exact dans la ville planifiée', () => {
    const candidat = {
      identifiantExterne: 'fsq-point-rouge',
      nom: 'Le Point Rouge',
      villeDemandee: 'Bordeaux',
      categorieFournisseur: 'Cocktail Bar',
      typeMetierRecherche: 'sortie' as const,
      adresse: '3 rue Sainte-Colombe, Bordeaux',
      lienCarte: 'https://www.google.com/maps/search/?api=1&query=Le%20Point%20Rouge%20Bordeaux',
      fournisseur: 'Foursquare' as const,
      source: 'https://places-api.foursquare.com/places/search',
      recupereLe: '2026-09-01T08:00:00.000Z',
    };
    const moments = SortieGenerationSchema.parse({
      moments: [
        {
          titre: 'Une sortie',
          ville: 'Bordeaux',
          elements: [
            {
              ref: 'sortie-1',
              type: 'sortie',
              identifiantExterne: candidat.identifiantExterne,
              nom: candidat.nom,
              justification: 'correspond à la soirée recherchée',
            },
          ],
        },
      ],
    }).moments;
    const boite = creerBoiteAOutils({
      villesAutorisees: ['Bordeaux'],
      candidatsInitiaux: [candidat],
    });

    const preparation = preparerMomentsPourResolution(
      moments,
      boite,
      ['Bordeaux']
    );

    expect(preparation.moments[0].ville).toBe('Bordeaux');
    expect(preparation.moments[0].elements[0].candidat).toMatchObject({
      identifiantExterne: 'fsq-point-rouge',
      villeDemandee: 'Bordeaux',
    });
  });
});
