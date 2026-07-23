// ?? '' évite undefined si str est null/undefined
export function encoderURL(str: string): string {
  return encodeURIComponent(str?.trim() ?? '');
}

// Lien « Carte » (localisation Google Maps). Les liens de RÉSERVATION, eux,
// relèvent du résolveur unique services/liens.ts.
export function lienGoogleMaps(name: string, city: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encoderURL(name + ' ' + city)}`;
}
