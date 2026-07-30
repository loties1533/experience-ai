import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enTeteAuthentificationNavitia } from '../../server/services/navitia/auth.js';
import {
  cheminLieuxNavitia,
  lireConfigurationNavitia,
} from '../../server/services/navitia/config.js';

const jetonInitial = process.env.NAVITIA_API_TOKEN;

afterEach(() => {
  if (jetonInitial === undefined) delete process.env.NAVITIA_API_TOKEN;
  else process.env.NAVITIA_API_TOKEN = jetonInitial;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lireConfigurationNavitia', () => {
  it('rend le jeton déclaré', () => {
    process.env.NAVITIA_API_TOKEN = 'jeton-navitia-test';

    expect(lireConfigurationNavitia()).toEqual({
      jeton: 'jeton-navitia-test',
    });
  });

  it('détoure le jeton déclaré', () => {
    process.env.NAVITIA_API_TOKEN = '  jeton-navitia-test  ';

    expect(lireConfigurationNavitia()?.jeton).toBe('jeton-navitia-test');
  });

  it.each([
    ['absent', undefined],
    ['vide', ''],
    ['en espaces seuls', '   '],
  ])('rend null quand le jeton est %s', (_libelle, jeton) => {
    if (jeton === undefined) delete process.env.NAVITIA_API_TOKEN;
    else process.env.NAVITIA_API_TOKEN = jeton;

    expect(lireConfigurationNavitia()).toBeNull();
  });
});

describe('enTeteAuthentificationNavitia', () => {
  it('construit une authentification Basic avec un mot de passe vide', () => {
    const enTete = enTeteAuthentificationNavitia('jeton-navitia-test');

    expect(enTete.startsWith('Basic ')).toBe(true);
    expect(
      Buffer.from(enTete.slice('Basic '.length), 'base64').toString('utf8')
    ).toBe('jeton-navitia-test:');
  });

  it('n’ajoute aucun mot de passe même pour un jeton contenant deux points', () => {
    const enTete = enTeteAuthentificationNavitia('a:b');

    expect(
      Buffer.from(enTete.slice('Basic '.length), 'base64').toString('utf8')
    ).toBe('a:b:');
  });

  it('n’expose jamais le jeton en clair dans l’en-tête', () => {
    expect(enTeteAuthentificationNavitia('jeton-secret')).not.toContain(
      'jeton-secret'
    );
  });
});

describe('cheminLieuxNavitia', () => {
  it('interroge le monde entier sans couverture', () => {
    expect(cheminLieuxNavitia()).toBe('/v1/places');
  });

  it('restreint le chemin à la couverture demandée', () => {
    expect(cheminLieuxNavitia('fr-idf')).toBe('/v1/coverage/fr-idf/places');
  });
});
