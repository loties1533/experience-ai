import { z } from 'zod';

const CodePaysSchema = z.string().regex(/^[A-Z]{2}$/);

const LocalisationCommuneSchema = z.object({
  nom: z.string().trim().min(1).max(120),
  codePays: CodePaysSchema.optional(),
});

/**
 * Déclaration encore modifiable pendant le dialogue. `inconnue` signifie que
 * la nature linguistique du référent doit être clarifiée ; ce n'est jamais une
 * catégorie géographique utilisable par la préparation.
 */
export const LocalisationDeclareeEnCoursSchema = z.discriminatedUnion('type', [
  LocalisationCommuneSchema.extend({ type: z.literal('ville') }).strict(),
  LocalisationCommuneSchema.extend({ type: z.literal('zone') }).strict(),
  LocalisationCommuneSchema.extend({ type: z.literal('pays') }).strict(),
  LocalisationCommuneSchema.extend({ type: z.literal('inconnue') }).strict(),
]);

/**
 * Compatibilite limitee au dialogue HTTP et a la reprise locale : une ancienne
 * chaine n'est jamais promue silencieusement en ville. Elle redevient une
 * declaration inconnue qui devra etre confirmee avant tout Brief final.
 */
export const LocalisationsDeclareesEnCoursSchema = z.preprocess(
  (valeur) =>
    Array.isArray(valeur)
      ? valeur.map((lieu) =>
          typeof lieu === 'string'
            ? { nom: lieu, type: 'inconnue' as const }
            : lieu
        )
      : valeur,
  z.array(LocalisationDeclareeEnCoursSchema)
);

/**
 * Une localisation confirmée possède une nature déclarée. Un pays exige son
 * code ISO : ce code normalise la déclaration utilisateur, sans prouver une
 * identité fournisseur. Ville et zone peuvent rester sans pays déclaré.
 */
export const LocalisationDeclareeConfirmeeSchema = z.discriminatedUnion('type', [
  LocalisationCommuneSchema.extend({ type: z.literal('ville') }).strict(),
  LocalisationCommuneSchema.extend({ type: z.literal('zone') }).strict(),
  LocalisationCommuneSchema.extend({
    type: z.literal('pays'),
    codePays: CodePaysSchema,
  }).strict(),
]);

export type LocalisationDeclareeEnCours = z.infer<
  typeof LocalisationDeclareeEnCoursSchema
>;
export type LocalisationDeclaree = z.infer<
  typeof LocalisationDeclareeConfirmeeSchema
>;

type PorteurLocalisations = {
  lieux?: readonly LocalisationDeclareeEnCours[];
};

export function villesDeclarees(
  brief: PorteurLocalisations
): Extract<LocalisationDeclareeEnCours, { type: 'ville' }>[] {
  return (brief.lieux ?? []).filter(
    (lieu): lieu is Extract<LocalisationDeclareeEnCours, { type: 'ville' }> =>
      lieu.type === 'ville'
  );
}

export function zonesDeclarees(
  brief: PorteurLocalisations
): Extract<LocalisationDeclareeEnCours, { type: 'zone' }>[] {
  return (brief.lieux ?? []).filter(
    (lieu): lieu is Extract<LocalisationDeclareeEnCours, { type: 'zone' }> =>
      lieu.type === 'zone'
  );
}

export function paysDeclares(
  brief: PorteurLocalisations
): Extract<LocalisationDeclareeEnCours, { type: 'pays' }>[] {
  return (brief.lieux ?? []).filter(
    (lieu): lieu is Extract<LocalisationDeclareeEnCours, { type: 'pays' }> =>
      lieu.type === 'pays'
  );
}

export function nomsLocalisationsDeclarees(brief: PorteurLocalisations): string[] {
  return (brief.lieux ?? []).map((lieu) => lieu.nom);
}

export function premiereLocalisationInconnue(
  brief: PorteurLocalisations
): { localisation: Extract<LocalisationDeclareeEnCours, { type: 'inconnue' }>; index: number } | undefined {
  const index = (brief.lieux ?? []).findIndex((lieu) => lieu.type === 'inconnue');
  if (index < 0) return undefined;
  return {
    localisation: brief.lieux![index] as Extract<
      LocalisationDeclareeEnCours,
      { type: 'inconnue' }
    >,
    index,
  };
}

export function normaliserTexteGeographique(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Le nom structuré doit réellement apparaître dans le dernier message. */
export function nomPresentDansMessage(message: string, nom: string): boolean {
  const messageNormalise = ` ${normaliserTexteGeographique(message)} `;
  const nomNormalise = normaliserTexteGeographique(nom);
  return nomNormalise.length > 0 && messageNormalise.includes(` ${nomNormalise} `);
}

let codesPaysParNom: Map<string, string> | undefined;

function construireCodesPaysParNom(): Map<string, string> {
  if (codesPaysParNom) return codesPaysParNom;
  const resultat = new Map<string, string>();
  for (const langue of ['fr', 'en']) {
    const noms = new Intl.DisplayNames([langue], { type: 'region' });
    for (let premier = 65; premier <= 90; premier += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(premier, second);
        const nom = noms.of(code);
        const cle = nom ? normaliserTexteGeographique(nom) : '';
        if (cle && nom !== code && !resultat.has(cle)) resultat.set(cle, code);
      }
    }
  }
  resultat.set('etats unis', 'US');
  resultat.set('usa', 'US');
  resultat.set('us', 'US');
  resultat.set('royaume uni', 'GB');
  codesPaysParNom = resultat;
  return resultat;
}

export function codePaysDepuisNom(nom: string): string | undefined {
  return construireCodesPaysParNom().get(normaliserTexteGeographique(nom));
}

const CODES_PAYS_PAR_ADJECTIF: ReadonlyArray<[
  RegExp,
  string,
]> = [
  [/\bfrancais(?:e|es)?\b/, 'FR'],
  [/\bitalien(?:ne|nes|s)?\b/, 'IT'],
  [/\bespagnol(?:e|es|s)?\b/, 'ES'],
  [/\bamericain(?:e|es|s)?\b/, 'US'],
];

/**
 * Codes réellement déclarés dans le texte : nom de pays, code ISO écrit en
 * majuscules, ou adjectif fermé explicitement reconnu. Le résultat ne dépend
 * jamais du code proposé par le LLM.
 */
export function codesPaysDeclaresDansMessage(message: string): Set<string> {
  const resultat = new Set<string>();
  const normalise = normaliserTexteGeographique(message);
  const texteNormalise = ` ${normalise} `;
  for (const [nom, code] of construireCodesPaysParNom()) {
    if (nom.length > 2 && texteNormalise.includes(` ${nom} `)) resultat.add(code);
  }
  for (const [motif, code] of CODES_PAYS_PAR_ADJECTIF) {
    if (motif.test(normalise)) resultat.add(code);
  }
  for (const correspondance of message.matchAll(/(?:^|[^\p{L}])([A-Z]{2})(?=$|[^\p{L}])/gu)) {
    resultat.add(correspondance[1]);
  }
  return resultat;
}

/**
 * Frontière d'intake : valide la structure, la trace textuelle et le pays sans
 * transformer cette extraction linguistique en preuve géographique.
 */
export function extraireLocalisationsDeclarees(
  brut: unknown,
  messageUtilisateur: string
): LocalisationDeclareeEnCours[] | undefined {
  const tableau = z.array(LocalisationDeclareeEnCoursSchema).safeParse(brut);
  if (!tableau.success) return undefined;
  const codesDeclares = codesPaysDeclaresDansMessage(messageUtilisateur);
  const codeContexteUnique =
    codesDeclares.size === 1 ? [...codesDeclares][0] : undefined;
  const retenues: LocalisationDeclareeEnCours[] = [];
  const cles = new Set<string>();

  for (const localisation of tableau.data) {
    if (!nomPresentDansMessage(messageUtilisateur, localisation.nom)) continue;
    let normalisee: LocalisationDeclareeEnCours;
    if (localisation.type === 'pays') {
      const codeDepuisNom = codePaysDepuisNom(localisation.nom);
      normalisee = codeDepuisNom
        ? { nom: localisation.nom, type: 'pays', codePays: codeDepuisNom }
        : { nom: localisation.nom, type: 'inconnue' };
    } else if (localisation.type === 'ville' || localisation.type === 'zone') {
      const codePays =
        localisation.codePays && codesDeclares.has(localisation.codePays)
          ? localisation.codePays
          : codeContexteUnique;
      normalisee = {
        nom: localisation.nom,
        type: localisation.type,
        ...(codePays ? { codePays } : {}),
      };
    } else {
      normalisee = { nom: localisation.nom, type: 'inconnue' };
    }

    const cle = `${normaliserTexteGeographique(normalisee.nom)}:${normalisee.type}:${normalisee.codePays ?? ''}`;
    if (cles.has(cle)) continue;
    cles.add(cle);
    retenues.push(normalisee);
  }
  // Une sortie LLM non vide dont aucune entree n'est traçable au message ne
  // doit pas effacer les localisations deja acquises. Un tableau vide reste en
  // revanche une extraction vide explicite.
  return tableau.data.length > 0 && retenues.length === 0
    ? undefined
    : retenues;
}
