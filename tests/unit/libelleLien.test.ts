import { describe, it, expect } from 'vitest';
import { ElementSchema, type TypeLienExterne } from '../../server/domaine/parcours/index.js';
import { libelleLien } from '../../client-react/src/components/ConfianceElement';

function elementAvecLien(typeLien: TypeLienExterne) {
  return ElementSchema.parse({
    id: 'e1',
    type: 'activite',
    nom: 'Élément',
    justification: 'cohérent avec l’intention',
    reservation: { lienExterne: 'https://exemple.test', fournisseur: 'Test', typeLien },
  });
}

describe('libelleLien — un libellé pour chaque type de lien du domaine', () => {
  it.each<TypeLienExterne>(['officiel', 'billetterie', 'reservation', 'recherche', 'carte'])(
    'renvoie un libellé non vide pour le type « %s »',
    (typeLien) => {
      expect(libelleLien(elementAvecLien(typeLien))).toBeTruthy();
    },
  );

  it('ne renvoie rien sans réservation', () => {
    const element = ElementSchema.parse({
      id: 'e1',
      type: 'activite',
      nom: 'Élément',
      justification: 'cohérent avec l’intention',
    });
    expect(libelleLien(element)).toBe('');
  });
});
