// Résolveur déterministe des expressions temporelles relatives simples
// ("demain", "ce week-end", "dans 3 jours"...). Objectif : ne jamais confier
// au LLM un calcul de date — même chose que calculerDates dans brief.ts, mais
// pour l'entrée plutôt que pour la durée.
//
// Horloge et fuseau sont toujours injectés (jamais new Date() dans le calcul
// lui-même) pour rester pur et testable avec un instant fixe.
//
// Convention verrouillée par F7-A, à documenter ici plutôt que de la deviner
// ailleurs :
// - une expression qui désigne un seul jour ("demain", "dans 3 jours", "dans
//   2 semaines") produit la journée civile locale complète, de 00:00:00.000
//   à 23:59:59.999 dans le fuseau de référence ;
// - "ce week-end" désigne samedi 00:00 à dimanche 23:59:59.999 ; si l'instant
//   de référence tombe après la fin de ce dimanche (donc à partir du lundi
//   suivant), on prend le week-end suivant plutôt que celui déjà passé ;
// - "le week-end prochain" est toujours le week-end qui suit celui de
//   "ce week-end", jamais celui en cours ;
// - "dans X semaines" garde le même jour local, X semaines plus tard ;
// - aucune heure précise n'est déduite d'une expression relative : si le
//   message contient déjà des heures, ce n'est pas notre rôle ici — cela
//   reste au LLM (hors périmètre F7-A).

export interface ContexteTemporel {
  /** Instant de référence ("maintenant"), toujours injecté — jamais calculé ici. */
  maintenant: Date;
  /** Fuseau IANA de référence, ex. "Europe/Paris". */
  fuseau: string;
}

export interface PlageResolue {
  debut: string;
  fin: string;
}

/**
 * Fuseau serveur explicite, utilisé tant qu'aucun fuseau utilisateur réel
 * n'est disponible dans le domaine. Ne représente PAS le fuseau réel de
 * l'utilisateur — voir docs F7-A, hors périmètre : pas de déduction depuis
 * une ville ou une géolocalisation.
 */
export const FUSEAU_SERVEUR_PAR_DEFAUT = 'Europe/Paris';

export function contexteTemporelParDefaut(): ContexteTemporel {
  return { maintenant: new Date(), fuseau: FUSEAU_SERVEUR_PAR_DEFAUT };
}

interface DateCivile {
  annee: number;
  mois: number; // 1-12
  jour: number;
}

interface PartsFuseau extends DateCivile {
  heure: number;
  minute: number;
  seconde: number;
  jourSemaine: number; // 0 = dimanche ... 6 = samedi
}

const JOURS_SEMAINE: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function partsDansFuseau(instant: Date, fuseau: string): PartsFuseau {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: fuseau,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const valeurs: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') valeurs[part.type] = part.value;
  }
  const heure = Number(valeurs.hour);
  return {
    annee: Number(valeurs.year),
    mois: Number(valeurs.month),
    jour: Number(valeurs.day),
    heure: heure === 24 ? 0 : heure,
    minute: Number(valeurs.minute),
    seconde: Number(valeurs.second),
    jourSemaine: JOURS_SEMAINE[valeurs.weekday] ?? 0,
  };
}

function decalageMs(instant: Date, fuseau: string): number {
  // Intl ne rend pas les millisecondes : on compare au niveau de la seconde,
  // sinon un instant avec ms (ex. 23:59:59.999) fausserait le décalage calculé.
  const instantSeconde = Math.floor(instant.getTime() / 1000) * 1000;
  const p = partsDansFuseau(new Date(instantSeconde), fuseau);
  const commeUTC = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute, p.seconde);
  return commeUTC - instantSeconde;
}

/**
 * Convertit une date civile + une heure locale dans un fuseau IANA vers
 * l'instant UTC réel — sans dépendance externe, via deux passes sur le
 * décalage (nécessaire autour des changements heure été/hiver).
 */
function versInstant(civile: DateCivile, heure: number, minute: number, seconde: number, ms: number, fuseau: string): Date {
  const utcSupposee = Date.UTC(civile.annee, civile.mois - 1, civile.jour, heure, minute, seconde, ms);
  const decalage1 = decalageMs(new Date(utcSupposee), fuseau);
  const decalage2 = decalageMs(new Date(utcSupposee - decalage1), fuseau);
  const decalage = decalage2 === decalage1 ? decalage1 : decalage2;
  return new Date(utcSupposee - decalage);
}

function joursDepuisEpoque(civile: DateCivile): number {
  return Math.floor(Date.UTC(civile.annee, civile.mois - 1, civile.jour) / 86_400_000);
}

function depuisJoursEpoque(jours: number): DateCivile {
  const instant = new Date(jours * 86_400_000);
  return { annee: instant.getUTCFullYear(), mois: instant.getUTCMonth() + 1, jour: instant.getUTCDate() };
}

function ajouterJours(civile: DateCivile, delta: number): DateCivile {
  return depuisJoursEpoque(joursDepuisEpoque(civile) + delta);
}

/** Journée civile complète, du début à la toute fin de journée, dans le fuseau de référence. */
function journeeComplete(civile: DateCivile, fuseau: string): PlageResolue {
  return {
    debut: versInstant(civile, 0, 0, 0, 0, fuseau).toISOString(),
    fin: versInstant(civile, 23, 59, 59, 999, fuseau).toISOString(),
  };
}

function plageWeekEnd(samedi: DateCivile, fuseau: string): PlageResolue {
  const dimanche = ajouterJours(samedi, 1);
  return {
    debut: versInstant(samedi, 0, 0, 0, 0, fuseau).toISOString(),
    fin: versInstant(dimanche, 23, 59, 59, 999, fuseau).toISOString(),
  };
}

/**
 * Samedi du week-end "en cours" au sens produit : celui qui n'est pas encore
 * terminé. Un dimanche fait encore partie de "ce week-end" ; à partir du
 * lundi suivant, c'est déjà le week-end suivant qu'on désigne.
 */
function samediDuWeekEndCourant(aujourdHui: DateCivile, jourSemaine: number): DateCivile {
  if (jourSemaine === 0) return ajouterJours(aujourdHui, -1); // dimanche : samedi = hier
  if (jourSemaine === 6) return aujourdHui; // samedi
  const joursAvantSamedi = 6 - jourSemaine; // lundi=1..vendredi=5
  return ajouterJours(aujourdHui, joursAvantSamedi);
}

function resoudreNombre(brut: string): number | undefined {
  const nombre = Number(brut);
  if (!Number.isInteger(nombre) || nombre < 1) return undefined;
  return nombre;
}

/**
 * Reconnaît une expression relative simple dans le message et rend la plage
 * résolue correspondante, ou `undefined` si rien n'est reconnu ou que
 * l'expression reconnue est invalide (nombre absent, nul ou négatif).
 * Ne résout jamais une expression ambiguë ou hors périmètre (voir F7-A) :
 * ces cas restent confiés au LLM.
 */
export function resoudreExpressionRelative(
  message: string,
  contexte: ContexteTemporel
): PlageResolue | undefined {
  const texte = message.toLowerCase();
  const { fuseau, maintenant } = contexte;
  const aujourdHui = partsDansFuseau(maintenant, fuseau);
  const civileAujourdHui: DateCivile = { annee: aujourdHui.annee, mois: aujourdHui.mois, jour: aujourdHui.jour };

  if (/après[\s-]?demain/i.test(texte)) {
    return journeeComplete(ajouterJours(civileAujourdHui, 2), fuseau);
  }
  if (/\bdemain\b/i.test(texte)) {
    return journeeComplete(ajouterJours(civileAujourdHui, 1), fuseau);
  }
  if (/\baujourd['’]hui\b/i.test(texte)) {
    return journeeComplete(civileAujourdHui, fuseau);
  }

  const semaines = texte.match(/dans\s+(-?\d+)\s+semaines?/i);
  if (semaines) {
    const n = resoudreNombre(semaines[1]);
    if (!n) return undefined;
    return journeeComplete(ajouterJours(civileAujourdHui, n * 7), fuseau);
  }

  const jours = texte.match(/dans\s+(-?\d+)\s+jours?/i);
  if (jours) {
    const n = resoudreNombre(jours[1]);
    if (!n) return undefined;
    return journeeComplete(ajouterJours(civileAujourdHui, n), fuseau);
  }

  if (/week[\s-]?end\s+prochain/i.test(texte)) {
    const samediCourant = samediDuWeekEndCourant(civileAujourdHui, aujourdHui.jourSemaine);
    return plageWeekEnd(ajouterJours(samediCourant, 7), fuseau);
  }
  if (/\bce\s+week[\s-]?end\b/i.test(texte)) {
    return plageWeekEnd(samediDuWeekEndCourant(civileAujourdHui, aujourdHui.jourSemaine), fuseau);
  }

  return undefined;
}

/** Utilisé par les tests et par l'injection dans le prompt intake. */
export function dateReferenceLisible(contexte: ContexteTemporel): string {
  const p = partsDansFuseau(contexte.maintenant, contexte.fuseau);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.annee}-${pad(p.mois)}-${pad(p.jour)}T${pad(p.heure)}:${pad(p.minute)}:${pad(p.seconde)}`;
}
