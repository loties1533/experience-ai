// ?? '' évite undefined si str est null/undefined
export function encoderURL(str: string): string {
  return encodeURIComponent(str?.trim() ?? '');
}

// Lien « Carte » (localisation Google Maps). Les liens de site officiel /
// billetterie, eux, relèvent du résolveur unique services/liens.ts.
export function lienGoogleMaps(name: string, city: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encoderURL(name + ' ' + city)}`;
}

/**
 * Lien Booking.com pré-rempli pour un hébergement — repris de TripGenie
 * (construireUrlHotel) : dates + voyageurs posés en paramètres, Booking
 * affiche alors le VRAI prix pour les vraies chambres. C'est Booking, pas
 * nous, qui connaît les prix réels — on ne fait que l'ouvrir bien configuré.
 */
export function construireLienHotel(
  nomHotel: string,
  ville: string,
  options?: { checkin?: string; checkout?: string; voyageurs?: number }
): string {
  const terme = nomHotel.toLowerCase().includes(ville.toLowerCase())
    ? nomHotel
    : `${nomHotel} ${ville}`;
  const params = new URLSearchParams({ ss: terme });
  const checkin = options?.checkin?.slice(0, 10);
  const checkout = options?.checkout?.slice(0, 10);
  if (checkin) params.set('checkin', checkin);
  if (checkout) params.set('checkout', checkout);
  if (options?.voyageurs && options.voyageurs > 0) {
    params.set('group_adults', String(options.voyageurs));
    params.set('no_rooms', String(Math.max(1, Math.ceil(options.voyageurs / 2))));
    params.set('group_children', '0');
  }
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}
