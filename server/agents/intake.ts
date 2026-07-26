import { z } from 'zod';
import { callAI, parseJSON, sanitizeInput } from '../services/claude/core.js';
import { AppError } from '../lib/AppError.js';
import { DateTimeISOSchema } from '../domaine/parcours/index.js';
import {
  BriefPartielSchema,
  champsManquants,
  reformulerBrief,
  normaliserDatesBrief,
  calculerDates,
  BriefSchema,
  type BriefPartiel,
} from './brief.js';

// Agent d'intake : mène le dialogue d'entrée, extrait le brief au fil des
// réponses et ne pose QUE les questions nécessaires. Il ne génère rien —
// la génération est le rôle de l'orchestrateur (generation.ts).

const SYSTEM_INTAKE = `Tu aides à comprendre l'envie d'un utilisateur pour construire un parcours personnalisé.
Réponds UNIQUEMENT en JSON valide : {"reponse": string, "brief": objet}.
- "brief" : uniquement les champs que le DERNIER message permet d'établir, parmi :
  intention (string, l'envie — jamais une destination), avecQui ("solo"|"couple"|"famille"|"amis"|"groupe"),
  duree ({"valeur": number, "unite": "heures"|"jours"|"semaines"}), dates ({"debut": ISO, "fin": ISO} — UNIQUEMENT si
  l'utilisateur donne les DEUX bornes explicitement), dateDebut (ISO — UNIQUEMENT si l'utilisateur donne une VRAIE date
  de départ, même approximative : "mi-août", "le 15 août", "dans deux semaines". Sans année précisée, suppose la
  prochaine occurrence future de cette date. Ne devine JAMAIS dateDebut s'il n'a rien dit sur le moment où il part —
  ce champ concerne QUAND il part, jamais D'OÙ il part : une ville reste "lieux", pas "dateDebut"),
  lieux (string[]), budgetTotal (number, en euros), ambiance (string), contraintes (string[]).
- "duree" GARDE TOUJOURS l'unité EXACTE que l'utilisateur emploie, ne la convertis JAMAIS toi-même :
  "3 semaines" → {"valeur": 3, "unite": "semaines"}, jamais {"valeur": 3, "unite": "jours"}.
- "reponse" : UNE question courte et chaleureuse en français sur UN champ requis manquant (intention, avecQui, duree,
  une date de départ approximative — jamais "point de départ", qui prête à confusion avec une ville). Jamais deux
  questions. TUTOIE toujours l'utilisateur (« tu », jamais « vous »).
- N'invente jamais un champ que l'utilisateur n'a pas exprimé.`;

const SortieIntakeSchema = z.object({
  reponse: z.string().min(1),
  brief: z.unknown(),
});

/** Juste un point de départ, sans la fin — extrait séparément de "dates" (les deux bornes). */
function extraireDateDebut(brut: unknown): string | undefined {
  if (typeof brut !== 'object' || brut === null) return undefined;
  const valeur = (brut as Record<string, unknown>).dateDebut;
  const resultat = DateTimeISOSchema.safeParse(valeur);
  return resultat.success ? resultat.data : undefined;
}

/**
 * Filet déterministe pour une plage écrite en chiffres ("du 15/08 au 10/09") :
 * constaté en recette, le LLM la comprend très bien — il la reformule dans
 * "reponse" — mais ne la structure pas toujours dans "brief". On ne dépend
 * pas de lui seul pour un champ aussi structurant. Motif générique : aucune
 * date câblée en dur, marche pour n'importe quelle plage JJ/MM.
 */
function extrairePlageExplicite(message: string): { debut: string; fin: string } | undefined {
  const motif = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*(?:au|-|à)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/i;
  const trouve = message.match(motif);
  if (!trouve) return undefined;

  const construire = (jourStr: string, moisStr: string, annee: number): Date | undefined => {
    const jour = Number(jourStr);
    const mois = Number(moisStr);
    if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return undefined;
    return new Date(Date.UTC(annee, mois - 1, jour));
  };

  const anneeExpliciteDebut = trouve[3] ? Number(trouve[3]) : undefined;
  const anneeExpliciteFin = trouve[6] ? Number(trouve[6]) : undefined;
  const anneeCourante = new Date().getUTCFullYear();

  let debut = construire(trouve[1], trouve[2], anneeExpliciteDebut ?? anneeCourante);
  if (!debut) return undefined;
  // Sans année précisée : la prochaine occurrence future, jamais une date passée.
  if (!anneeExpliciteDebut && debut.getTime() < Date.now()) {
    debut = construire(trouve[1], trouve[2], anneeCourante + 1);
    if (!debut) return undefined;
  }

  let fin = construire(trouve[4], trouve[5], anneeExpliciteFin ?? debut.getUTCFullYear());
  if (!fin) return undefined;
  // La fin suit le début : si elle tombe avant ("20/12 au 05/01"), l'année suivante.
  if (!anneeExpliciteFin && fin.getTime() <= debut.getTime()) {
    fin = construire(trouve[4], trouve[5], debut.getUTCFullYear() + 1);
    if (!fin) return undefined;
  }
  if (fin.getTime() <= debut.getTime()) return undefined; // garde-fou : jamais une plage inversée

  return { debut: debut.toISOString(), fin: fin.toISOString() };
}

/**
 * Ne jamais faire confiance au LLM : ses extractions passent par Zod. Mais la
 * validation se fait CHAMP PAR CHAMP, jamais sur l'objet entier.
 *
 * Pourquoi : `safeParse` est tout-ou-rien. Un seul champ mal formé — le modèle
 * écrit `avecQui: "groupe de 8"` là où l'enum attend `"amis"` — faisait perdre
 * TOUS les autres, pourtant valides. En pratique la ville, le budget et les
 * dates donnés dans la même phrase disparaissaient, et le dialogue les
 * redemandait : exactement ce que le produit s'interdit de faire.
 *
 * Ici, un champ invalide est le seul à être ignoré ; le dialogue le redemandera.
 */
function extraireChampsValides(brut: unknown): BriefPartiel {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return {};

  const formes = BriefPartielSchema.shape;
  const retenu: Record<string, unknown> = {};

  for (const [cle, valeur] of Object.entries(brut as Record<string, unknown>)) {
    const forme = formes[cle as keyof typeof formes];
    if (!forme) continue; // champ inventé par le modèle : ignoré
    const resultat = forme.safeParse(valeur);
    if (resultat.success && resultat.data !== undefined) retenu[cle] = resultat.data;
  }

  return retenu as BriefPartiel;
}

export interface EtapeDialogue {
  /** Question suivante, ou reformulation à valider quand le brief est complet. */
  reponse: string;
  brief: BriefPartiel;
  estComplet: boolean;
}

export async function avancerDialogue(
  briefActuel: BriefPartiel,
  messageUtilisateur: string
): Promise<EtapeDialogue> {
  const prompt = `Brief déjà établi : ${JSON.stringify(briefActuel)}
Dernier message de l'utilisateur : "${sanitizeInput(messageUtilisateur)}"
Champs requis encore manquants : ${champsManquants(briefActuel).join(', ') || 'aucun'}`;

  const brut = await callAI(prompt, SYSTEM_INTAKE, 'onboarding');
  const sortie = SortieIntakeSchema.safeParse(parseJSON(brut));
  if (!sortie.success) {
    throw new AppError('Je n’ai pas réussi à comprendre, peux-tu reformuler ?', 502);
  }

  const extrait = extraireChampsValides(sortie.data.brief);
  let brief: BriefPartiel = normaliserDatesBrief({ ...briefActuel, ...extrait });

  // Filet déterministe, avant de compter sur le LLM : une plage explicite
  // ("du 15/08 au 10/09") qu'il aurait comprise sans la structurer.
  let plageExpliciteUtilisee = false;
  if (!brief.dates) {
    const plage = extrairePlageExplicite(messageUtilisateur);
    if (plage) {
      brief = { ...brief, dates: plage };
      plageExpliciteUtilisee = true;
    }
  }

  // Un point de départ seul (sans la fin) ne vient pas de extraireChampsValides,
  // qui ne connaît que les champs du domaine : on calcule la fin nous-mêmes,
  // depuis la durée déjà connue — jamais confié au LLM.
  let dateDebutUtilise = false;
  if (!brief.dates && brief.duree) {
    const dateDebut = extraireDateDebut(sortie.data.brief);
    if (dateDebut) {
      brief = { ...brief, dates: calculerDates(dateDebut, brief.duree) };
      dateDebutUtilise = true;
    }
  }

  const complet = BriefSchema.safeParse(brief);
  // « Complet » exige aussi un point de départ (dates) : une durée seule
  // n'ancre le parcours à aucune vraie date, et les connecteurs chercheraient
  // alors sur une date inventée, sans rapport avec le vrai séjour.
  const dialogueTermine = complet.success && champsManquants(brief).length === 0;
  if (dialogueTermine) {
    // Le brief était déjà complet et rien de nouveau n'a été retenu de ce
    // message : l'utilisateur essayait de corriger quelque chose, mais rien
    // n'a été compris (dates ambiguës, format inattendu...). Rejouer la même
    // confirmation mot pour mot donnerait l'impression qu'on l'ignore — on le
    // dit plutôt franchement, sans reformuler le contenu passé sous silence.
    const auMoinsUnChampNouveau =
      Object.keys(extrait).length > 0 || dateDebutUtilise || plageExpliciteUtilisee;
    const briefActuelDejaTermine =
      BriefSchema.safeParse(briefActuel).success && champsManquants(briefActuel).length === 0;
    if (!auMoinsUnChampNouveau && briefActuelDejaTermine) {
      return {
        reponse: "Je n'ai pas compris ce changement — peux-tu préciser autrement (ex. une date au format JJ/MM/AAAA) ?",
        brief,
        estComplet: true,
      };
    }
    return {
      reponse: `${reformulerBrief(complet.data)} C'est bien ça ?`,
      brief,
      estComplet: true,
    };
  }
  return { reponse: sortie.data.reponse, brief, estComplet: false };
}
