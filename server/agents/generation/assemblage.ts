import type { MomentPrepare } from './resolution.js';

/**
 * Retire les répétitions d'une même identité fournisseur après rapprochement.
 * L'ordre du parcours fait foi : la première occurrence est conservée, sans
 * créer d'élément de remplacement. Un nom, même identique, n'est jamais une
 * identité suffisante.
 */
export function dedoublonnerElementsVerifies(
  moments: MomentPrepare[]
): MomentPrepare[] {
  const identitesVues = new Set<string>();

  return moments.flatMap((moment) => {
    const elements = moment.elements.filter(({ candidat }) => {
      if (!candidat) return true;

      const fournisseur = candidat.fournisseur.trim();
      const identifiantExterne = candidat.identifiantExterne.trim();
      if (!fournisseur || !identifiantExterne) return true;

      const identite = JSON.stringify([fournisseur, identifiantExterne]);
      if (identitesVues.has(identite)) return false;

      identitesVues.add(identite);
      return true;
    });

    return elements.length > 0 ? [{ ...moment, elements }] : [];
  });
}
