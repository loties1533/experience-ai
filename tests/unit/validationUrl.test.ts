import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estHoteDansDomaine,
  estUrlRechercheGenerique,
  extraireDomaine,
  extraireHote,
  retirerParametresTracking,
  validerUrlLien,
} from '../../server/services/liens/validationUrl.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validerUrlLien', () => {
  it('accepte une URL HTTPS valide', () => {
    expect(validerUrlLien('https://billetterie.example.com/evenements/42')).toEqual({
      statut: 'valide',
      url: 'https://billetterie.example.com/evenements/42',
      protocole: 'https:',
      hote: 'billetterie.example.com',
      domaine: 'billetterie.example.com',
    });
  });

  it('accepte HTTP uniquement comme entrée intermédiaire', () => {
    expect(validerUrlLien('http://example.com/lieu')).toMatchObject({
      statut: 'valide',
      protocole: 'http:',
      hote: 'example.com',
    });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/plain,contenu',
    'mailto:contact@example.com',
    'ftp://example.com/fichier',
  ])('refuse le protocole interdit %s', (url) => {
    expect(validerUrlLien(url)).toEqual({
      statut: 'invalide',
      raison: 'protocole_interdit',
    });
  });

  it('refuse un nom utilisateur ou un mot de passe intégré', () => {
    expect(validerUrlLien('https://utilisateur:secret@example.com/lieu')).toEqual({
      statut: 'invalide',
      raison: 'identifiants_interdits',
    });
  });

  it.each([
    'http://localhost/',
    'http://service.localhost/',
    'http://127.0.0.1/',
    'http://0.0.0.0/',
    'http://10.12.0.5/',
    'http://172.16.4.2/',
    'http://172.31.255.254/',
    'http://192.168.1.8/',
    'http://169.254.10.20/',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://imprimante.local/',
    'http://intranet/',
  ])('refuse l’hôte local ou privé %s', (url) => {
    expect(validerUrlLien(url)).toEqual({
      statut: 'invalide',
      raison: 'hote_prive',
    });
  });

  it('borne précisément la plage CGNAT 100.64.0.0/10', () => {
    expect(validerUrlLien('http://100.127.255.254/')).toEqual({
      statut: 'invalide',
      raison: 'hote_prive',
    });
    expect(validerUrlLien('http://100.128.0.1/')).toMatchObject({
      statut: 'valide',
      hote: '100.128.0.1',
    });
  });

  it.each([
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fd12::1]/',
    'http://[fe80::1]/',
  ])('refuse l’adresse IPv6 locale ou privée %s', (url) => {
    expect(validerUrlLien(url)).toEqual({
      statut: 'invalide',
      raison: 'hote_prive',
    });
  });

  it('refuse un port inhabituel', () => {
    expect(validerUrlLien('https://example.com:8443/lieu')).toEqual({
      statut: 'invalide',
      raison: 'port_interdit',
    });
  });

  it('accepte les ports standards explicitement écrits', () => {
    expect(validerUrlLien('https://example.com:443/lieu')).toMatchObject({
      statut: 'valide',
      url: 'https://example.com/lieu',
    });
    expect(validerUrlLien('http://example.com:80/lieu')).toMatchObject({
      statut: 'valide',
      url: 'http://example.com/lieu',
    });
  });

  it('refuse une URL invalide', () => {
    expect(validerUrlLien('pas une URL')).toEqual({
      statut: 'invalide',
      raison: 'url_invalide',
    });
  });
});

describe('hôte et frontière de domaine', () => {
  it('extrait et normalise l’hôte et le domaine observé', () => {
    const url = 'https://BILLETTERIE.Example.COM./evenement';
    expect(extraireHote(url)).toBe('billetterie.example.com');
    expect(extraireDomaine(url)).toBe('billetterie.example.com');
  });

  it('reconnaît un vrai sous-domaine', () => {
    expect(estHoteDansDomaine('billets.example.com', 'example.com')).toBe(true);
    expect(estHoteDansDomaine('example.com', 'example.com')).toBe(true);
  });

  it('respecte la frontière et la direction du domaine attendu', () => {
    expect(estHoteDansDomaine('fakeexample.com', 'example.com')).toBe(false);
    expect(estHoteDansDomaine('example.com', 'tickets.example.com')).toBe(false);
  });

  it.each([
    ['billetterie-officielle.com.malicious.example', 'billetterie-officielle.com'],
    ['official-example.com.evil.test', 'official-example.com'],
  ])('refuse le domaine trompeur %s pour %s', (hote, domaine) => {
    expect(estHoteDansDomaine(hote, domaine)).toBe(false);
  });
});

describe('recherche générique et paramètres', () => {
  it.each([
    'https://www.google.com/search?q=festival',
    'https://www.bing.com/search?q=festival',
    'https://example.com/search?q=festival',
    'https://example.com/recherche?query=festival',
    'https://example.com/searchresults?city=Bordeaux',
  ])('détecte l’URL de recherche générique %s', (url) => {
    expect(estUrlRechercheGenerique(url)).toBe(true);
  });

  it('ne confond pas une fiche exacte avec une recherche', () => {
    expect(
      estUrlRechercheGenerique('https://example.com/evenements/festival-du-port?lang=fr')
    ).toBe(false);
  });

  it('retire uniquement les paramètres de tracking connus', () => {
    const url = retirerParametresTracking(
      'https://example.com/evenement?id=42&utm_source=lettre&UTM_Campaign=ete&gclid=abc&fbclid=def'
    );
    expect(url).toBe('https://example.com/evenement?id=42');
  });

  it('conserve les paramètres fonctionnels', () => {
    const url = retirerParametresTracking(
      'https://tickets.example.com/reserver?eventId=42&date=2026-09-04&places=2'
    );
    expect(url).toBe(
      'https://tickets.example.com/reserver?eventId=42&date=2026-09-04&places=2'
    );
  });

  it('conserve exactement eventId, date et lang', () => {
    const url = retirerParametresTracking(
      'https://tickets.example.com/reserver?eventId=123&date=2026-08-10&lang=fr'
    );
    expect(url).toBe(
      'https://tickets.example.com/reserver?eventId=123&date=2026-08-10&lang=fr'
    );
  });
});

describe('absence d’effet réseau', () => {
  it('reste entièrement déterministe', () => {
    const requeteReseau = vi.fn();
    vi.stubGlobal('fetch', requeteReseau);

    validerUrlLien('https://example.com/evenement');
    extraireHote('https://example.com/evenement');
    extraireDomaine('https://example.com/evenement');
    estHoteDansDomaine('tickets.example.com', 'example.com');
    estUrlRechercheGenerique('https://example.com/search?q=festival');
    retirerParametresTracking('https://example.com/?utm_source=test&id=42');

    expect(requeteReseau).not.toHaveBeenCalled();
  });
});
