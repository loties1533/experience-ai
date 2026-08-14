import { describe, it, expect } from 'vitest';
import { ElementSchema, type TypeLienExterne } from '../../server/domaine/parcours/index.js';
import { libelleLien } from '../../client-react/src/components/ConfianceElement';

function elementAvecLien(typeLien: TypeLienExterne) {
  return ElementSchema.parse({
    id: 'e1',
    type: 'activite',
    nom: 'Élément',
    justification: 'cohérent avec l’intention',
    lienExterne: { url: 'https://exemple.test', fournisseur: 'Test', typeLien },
  });
}

describe('libelleLien — un libellé pour chaque type de lien du domaine', () => {
  it.each<[TypeLienExterne, string]>([
    ['officiel', 'Voir le site officiel'],
    ['billetterie', 'Ouvrir la billetterie'],
    ['reservation', 'Ouvrir la page de réservation'],
    ['recherche', 'Consulter les résultats actuels'],
    ['carte', 'Voir sur la carte'],
  ])(
    'renvoie le libellé explicite pour le type « %s »',
    (typeLien, libelle) => {
      expect(libelleLien(elementAvecLien(typeLien))).toBe(libelle);
    },
  );

  it('ne renvoie rien sans lien externe', () => {
    const element = ElementSchema.parse({
      id: 'e1',
      type: 'activite',
      nom: 'Élément',
      justification: 'cohérent avec l’intention',
    });
    expect(libelleLien(element)).toBe('');
  });
});
