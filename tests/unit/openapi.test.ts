import { describe, expect, it } from 'vitest';
import { openapiSpec } from '../../server/docs/openapi.js';

function propriete(objet: unknown, cle: string): unknown {
  if (
    typeof objet !== 'object' ||
    objet === null ||
    Array.isArray(objet)
  ) {
    throw new Error(`Objet OpenAPI attendu avant « ${cle} »`);
  }
  return (objet as Record<string, unknown>)[cle];
}

function chemin(...cles: string[]): unknown {
  return cles.reduce<unknown>(
    (valeur, cle) => propriete(valeur, cle),
    openapiSpec
  );
}

describe('OpenAPI F3-D — lecture et modification sont séparées', () => {
  it.each([
    ['confiance'],
    ['reservation'],
    ['lienRechercheHebergement'],
    ['sejourHebergement'],
  ])('documente Element.%s en lecture seule', (champ) => {
    expect(
      propriete(
        chemin('components', 'schemas', 'Element', 'properties', champ),
        'readOnly'
      )
    ).toBe(true);
  });

  it('documente l’occupation persistée en lecture seule', () => {
    expect(
      propriete(
        chemin(
          'components',
          'schemas',
          'ContexteParcours',
          'properties',
          'occupationHebergement'
        ),
        'readOnly'
      )
    ).toBe(true);
  });

  it('référence le contrat client strict sur la route de modification', () => {
    const corps = chemin(
      'paths',
      '/api/parcours/{id}/modifications',
      'post',
      'requestBody',
      'content',
      'application/json',
      'schema',
      'oneOf'
    );
    expect(corps).toBeInstanceOf(Array);
    const demande = (corps as unknown[])[0];
    expect(
      propriete(
        propriete(propriete(demande, 'properties'), 'demande'),
        '$ref'
      )
    ).toBe(
      '#/components/schemas/DemandeModificationClient'
    );
    expect(propriete(demande, 'additionalProperties')).toBe(false);
  });

  it('représente les neuf discriminants Zod sans propriété libre', () => {
    const variantes = chemin(
      'components',
      'schemas',
      'DemandeModificationClient',
      'oneOf'
    );
    expect(variantes).toBeInstanceOf(Array);
    const liste = variantes as unknown[];
    expect(liste).toHaveLength(9);
    expect(
      liste.map((variante) => {
        expect(
          propriete(variante, 'additionalProperties')
        ).toBe(false);
        const type = propriete(
          propriete(
            propriete(variante, 'properties'),
            'type'
          ),
          'enum'
        );
        return (type as unknown[])[0];
      })
    ).toEqual([
      'remplacer_element',
      'supprimer_element',
      'ajouter_element',
      'modifier_justification',
      'changer_statut',
      'ecarter_alternative',
      'modifier_sejour_hebergement',
      'modifier_occupation_hebergement',
      'remplacer_hotel',
    ]);
  });

  it('documente aussi les sous-objets client comme stricts', () => {
    expect(
      chemin(
        'components',
        'schemas',
        'PropositionElementClient',
        'additionalProperties'
      )
    ).toBe(false);
    expect(
      chemin(
        'components',
        'schemas',
        'PlageHoraire',
        'additionalProperties'
      )
    ).toBe(false);
    const variantes = chemin(
      'components',
      'schemas',
      'DemandeModificationClient',
      'oneOf'
    ) as unknown[];
    const occupation = variantes[7];
    expect(
      propriete(
        propriete(
          propriete(occupation, 'properties'),
          'occupation'
        ),
        'additionalProperties'
      )
    ).toBe(false);
  });

  it('n’expose aucun champ de preuve dans les propositions client', () => {
    const proprietes = chemin(
      'components',
      'schemas',
      'PropositionElementClient',
      'properties'
    );
    for (const champ of [
      'confiance',
      'provenance',
      'fournisseur',
      'source',
      'recupereLe',
      'identifiantExterne',
      'adresse',
      'lienRechercheHebergement',
      'reservation',
      'disponibilite',
      'prixObserve',
    ]) {
      expect(
        typeof proprietes === 'object' &&
          proprietes !== null &&
          champ in proprietes
      ).toBe(false);
    }
  });

  it('documente 400, 403, 404, 422 et 503', () => {
    const reponses = chemin(
      'paths',
      '/api/parcours/{id}/modifications',
      'post',
      'responses'
    );
    for (const statut of ['400', '403', '404', '422', '503']) {
      expect(propriete(reponses, statut)).toBeDefined();
    }
  });

  it('ne promet ni réservation ni disponibilité hôtelière', () => {
    const description = propriete(
      chemin(
        'paths',
        '/api/parcours/{id}/modifications',
        'post'
      ),
      'description'
    );
    expect(description).toEqual(expect.any(String));
    expect(description).toContain(
      'ni réservation ni disponibilité'
    );
  });
});
