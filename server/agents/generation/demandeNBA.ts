interface BriefNBAMinimal {
  intention?: string;
  lieux?: string[];
  hebergement?: {
    necessaire: boolean;
    sejours?: unknown[];
  };
}

export function normaliserTexteNBA(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Le périmètre reste volontairement NBA, sans classifieur universel. */
export function estDemandeNBAEvenementielle(brief: BriefNBAMinimal): boolean {
  return /\bnba\b/.test(normaliserTexteNBA(brief.intention ?? ''));
}

/** Périmètre volontairement NBA/US : aucun classifieur géographique général. */
export function estZonePaysUSNBA(lieu: string): boolean {
  return /^(?:etats unis|usa|us)$/.test(normaliserTexteNBA(lieu));
}

export function villesExplicitesNBA(lieux: string[]): string[] {
  return lieux.filter((lieu) => !estZonePaysUSNBA(lieu));
}

/**
 * L'intake peut différer uniquement les séjours hôteliers que l'utilisateur
 * ne peut pas encore localiser : le besoin et l'occupation restent requis.
 */
export function doitDiffererSejoursHebergementNBA(
  brief: BriefNBAMinimal
): boolean {
  return (
    estDemandeNBAEvenementielle(brief) &&
    villesExplicitesNBA(brief.lieux ?? []).length === 0 &&
    brief.hebergement?.necessaire === true &&
    (brief.hebergement.sejours?.length ?? 0) === 0
  );
}
