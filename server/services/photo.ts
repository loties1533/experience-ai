const PHOTO_PAR_DEFAUT =
  'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=1200&q=80';

interface ReponseUnsplash {
  results: Array<{ urls: { regular: string } }>;
}

interface ReponsePexels {
  photos: Array<{ src: { large2x: string } }>;
}

export async function getDestinationPhoto(query: string): Promise<string> {
  // 1️⃣ — Unsplash API (photos de voyage curatées, haute qualité)
  const cleUnsplash = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (cleUnsplash) {
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query + ' landscape destination')}&per_page=3&orientation=landscape`;
      const res = await fetch(url, {
        headers: { Authorization: `Client-ID ${cleUnsplash}` },
        signal:  AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = (await res.json()) as ReponseUnsplash;
        const photo = data.results?.[0]?.urls?.regular;
        if (photo) {
          console.log(`Unsplash OK: ${query}`);
          return photo;
        }
      } else {
        console.warn(`Unsplash ${res.status} pour "${query}" — repli Wikipedia`);
      }
    } catch (err) {
      console.warn(`Unsplash timeout pour "${query}":`, (err as Error).message);
    }
  }

  // 2️⃣ — Pexels API (si clé valide)
  const clePexels = process.env.PEXELS_API_KEY?.trim();
  if (clePexels) {
    try {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query + ' travel')}&per_page=1&orientation=landscape`;
      const res = await fetch(url, {
        headers: { Authorization: clePexels },
        signal:  AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = (await res.json()) as ReponsePexels;
        const photo = data.photos?.[0]?.src?.large2x;
        if (photo) {
          console.log(`Pexels OK: ${query}`);
          return photo;
        }
      }
    } catch (err) {
      console.warn(`Erreur Pexels pour "${query}":`, (err as Error).message);
    }
  }

  // 3️⃣ — Repli générique
  console.warn(`Repli générique pour "${query}"`);
  return PHOTO_PAR_DEFAUT;
}
