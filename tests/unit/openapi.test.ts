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

describe('OpenAPI F4-B2 — demande transport sans preuve fournisseur', () => {
  it('documente le transport dans le brief et la demande persistée en lecture seule', () => {
    expect(
      chemin(
        'components',
        'schemas',
        'Brief',
        'properties',
        'transport',
        '$ref'
      )
    ).toBe('#/components/schemas/TransportBrief');
    expect(
      chemin(
        'components',
        'schemas',
        'ContexteParcours',
        'properties',
        'demandeTransport',
        'readOnly'
      )
    ).toBe(true);
  });

  it('distingue exactement le brouillon strict de la demande finale', () => {
    const variantes = chemin(
      'components',
      'schemas',
      'TransportBrief',
      'oneOf'
    ) as Array<Record<string, unknown>>;
    expect(variantes[0]).toMatchObject({
      required: ['necessaire'],
      additionalProperties: false,
    });
    expect(variantes[1]).toMatchObject({
      required: ['necessaire', 'troncons', 'occupation'],
      additionalProperties: false,
    });
    expect(
      chemin(
        'components',
        'schemas',
        'TronconTransportBrief'
      )
    ).not.toHaveProperty('required');
    expect(
      chemin(
        'components',
        'schemas',
        'TronconTransportDemande',
        'required'
      )
    ).toEqual(['origine', 'destination', 'depart']);
  });

  it('documente les tronçons, dates civiles, créneaux et occupation déclarée', () => {
    expect(
      chemin(
        'components',
        'schemas',
        'DateTransportDemandee',
        'properties',
        'date',
        'format'
      )
    ).toBe('date');
    expect(
      chemin(
        'components',
        'schemas',
        'DateTransportDemandee',
        'properties',
        'creneau',
        'enum'
      )
    ).toEqual(['matin', 'apres_midi', 'soir', 'nuit']);
    expect(
      chemin(
        'components',
        'schemas',
        'DemandeTransport',
        'properties',
        'occupation',
        '$ref'
      )
    ).toBe(
      '#/components/schemas/OccupationTransportDeclaree'
    );
  });

  it('documente 400 et 422 avant génération', () => {
    const reponses = chemin(
      'paths',
      '/api/parcours',
      'post',
      'responses'
    );
    expect(propriete(reponses, '400')).toBeDefined();
    expect(propriete(reponses, '422')).toBeDefined();
    expect(
      propriete(propriete(reponses, '422'), 'description')
    ).toContain('transport');
  });

  it('ne publie aucun contrat fournisseur transport futur', () => {
    const composants = chemin('components', 'schemas');
    for (const nom of [
      'LieuTransportConfirme',
      'SegmentTransportExterne',
      'CandidatTrajetExterne',
      'PreuveTrajet',
      'LienTransport',
      'PrixTransportObserve',
    ]) {
      expect(
        typeof composants === 'object' &&
          composants !== null &&
          nom in composants
      ).toBe(false);
    }
  });

  it('décrit explicitement l’absence d’horaire vérifié et d’offre commerciale', () => {
    const description = chemin(
      'paths',
      '/api/parcours',
      'post',
      'description'
    );
    expect(description).toEqual(expect.any(String));
    expect(description).toContain('aucun horaire vérifié');
    expect(description).toContain(
      'lien, réservation ou disponibilité'
    );
  });
});
