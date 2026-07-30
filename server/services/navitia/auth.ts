/**
 * Navitia n'échange aucun jeton : le token est directement l'identifiant d'une
 * authentification HTTP Basic, avec un mot de passe vide.
 *
 * L'en-tête est construit ici et nulle part ailleurs, pour que le secret ne
 * circule jamais dans une URL, un paramètre de requête ou un message d'erreur.
 */
export function enTeteAuthentificationNavitia(jeton: string): string {
  return `Basic ${Buffer.from(`${jeton}:`, 'utf8').toString('base64')}`;
}
