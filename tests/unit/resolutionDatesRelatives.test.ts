import { describe, it, expect } from 'vitest';
import {
  resoudreExpressionRelative,
  type ContexteTemporel,
} from '../../server/agents/resolutionDatesRelatives.js';

const FUSEAU = 'Europe/Paris';
const ctx = (iso: string): ContexteTemporel => ({ maintenant: new Date(iso), fuseau: FUSEAU });

// Repères fixes : 2026-08-01 est un samedi, 2026-08-02 un dimanche,
// 2026-08-03 un lundi (vérifié via Intl, pas deviné).
describe('résolution des dates relatives (F7-A) — horloge et fuseau injectés, jamais new Date() implicite', () => {
  it('aujourd’hui — journée civile complète dans le fuseau de référence', () => {
    expect(resoudreExpressionRelative('aujourd’hui', ctx('2026-08-01T10:00:00Z'))).toEqual({
      debut: '2026-07-31T22:00:00.000Z',
      fin: '2026-08-01T21:59:59.999Z',
    });
  });

  it('demain', () => {
    expect(resoudreExpressionRelative('on part demain', ctx('2026-08-01T10:00:00Z'))).toEqual({
      debut: '2026-08-01T22:00:00.000Z',
      fin: '2026-08-02T21:59:59.999Z',
    });
  });

  it('après-demain (et ne matche pas "demain" seul)', () => {
    expect(resoudreExpressionRelative('après-demain', ctx('2026-08-01T10:00:00Z'))).toEqual({
      debut: '2026-08-02T22:00:00.000Z',
      fin: '2026-08-03T21:59:59.999Z',
    });
  });

  it('dans 3 jours', () => {
    expect(resoudreExpressionRelative('dans 3 jours', ctx('2026-08-01T10:00:00Z'))).toEqual({
      debut: '2026-08-03T22:00:00.000Z',
      fin: '2026-08-04T21:59:59.999Z',
    });
  });

  it('dans 2 semaines — même jour local, 14 jours plus tard', () => {
    expect(resoudreExpressionRelative('dans 2 semaines', ctx('2026-08-01T10:00:00Z'))).toEqual({
      debut: '2026-08-14T22:00:00.000Z',
      fin: '2026-08-15T21:59:59.999Z',
    });
  });

  it('ce week-end demandé un lundi — le week-end à venir', () => {
    expect(resoudreExpressionRelative('ce week-end', ctx('2026-08-03T10:00:00Z'))).toEqual({
      debut: '2026-08-07T22:00:00.000Z',
      fin: '2026-08-09T21:59:59.999Z',
    });
  });

  it('ce week-end demandé un samedi — le week-end en cours', () => {
    expect(resoudreExpressionRelative('ce week-end', ctx('2026-08-01T10:00:00Z'))).toEqual({
      debut: '2026-07-31T22:00:00.000Z',
      fin: '2026-08-02T21:59:59.999Z',
    });
  });

  it('ce week-end demandé un dimanche — encore le week-end en cours', () => {
    expect(resoudreExpressionRelative('ce week-end', ctx('2026-08-02T10:00:00Z'))).toEqual({
      debut: '2026-07-31T22:00:00.000Z',
      fin: '2026-08-02T21:59:59.999Z',
    });
  });

  it('ce week-end demandé après la fin du dimanche (lundi 00h local) — déjà le week-end suivant', () => {
    // 2026-08-03T00:00:00Z est lundi 02:00 heure de Paris : le dimanche
    // précédent est bien terminé.
    expect(resoudreExpressionRelative('ce week-end', ctx('2026-08-03T00:00:00Z'))).toEqual({
      debut: '2026-08-07T22:00:00.000Z',
      fin: '2026-08-09T21:59:59.999Z',
    });
  });

  it('le week-end prochain — celui qui suit "ce week-end", jamais celui en cours', () => {
    expect(resoudreExpressionRelative('le week-end prochain', ctx('2026-08-01T10:00:00Z'))).toEqual({
      debut: '2026-08-07T22:00:00.000Z',
      fin: '2026-08-09T21:59:59.999Z',
    });
  });

  it('passage de mois (31 janvier → 1er février)', () => {
    expect(resoudreExpressionRelative('demain', ctx('2026-01-31T10:00:00Z'))).toEqual({
      debut: '2026-01-31T23:00:00.000Z',
      fin: '2026-02-01T22:59:59.999Z',
    });
  });

  it('passage d’année (31 décembre → 1er janvier)', () => {
    expect(resoudreExpressionRelative('après-demain', ctx('2026-12-30T10:00:00Z'))).toEqual({
      debut: '2026-12-31T23:00:00.000Z',
      fin: '2027-01-01T22:59:59.999Z',
    });
  });

  it('changement d’heure été/hiver (passage à l’heure d’été le 29/03/2026 à Paris)', () => {
    // "demain" depuis le 28/03 vise le 29/03 : une journée civile de 23h,
    // pas 24, à cause du passage à l'heure d'été à 2h du matin.
    const plage = resoudreExpressionRelative('demain', ctx('2026-03-28T12:00:00Z'));
    expect(plage).toEqual({
      debut: '2026-03-28T23:00:00.000Z',
      fin: '2026-03-29T21:59:59.999Z',
    });
    const dureeHeures = (Date.parse(plage!.fin) - Date.parse(plage!.debut)) / 3_600_000;
    expect(dureeHeures).toBeCloseTo(23, 1);
  });

  it('expression inconnue — non résolue', () => {
    expect(resoudreExpressionRelative('pendant les vacances de la Toussaint', ctx('2026-08-01T10:00:00Z'))).toBeUndefined();
    expect(resoudreExpressionRelative('à Noël', ctx('2026-08-01T10:00:00Z'))).toBeUndefined();
  });

  it('nombre invalide ou négatif — non résolu', () => {
    expect(resoudreExpressionRelative('dans -3 jours', ctx('2026-08-01T10:00:00Z'))).toBeUndefined();
    expect(resoudreExpressionRelative('dans 0 jours', ctx('2026-08-01T10:00:00Z'))).toBeUndefined();
  });
});
