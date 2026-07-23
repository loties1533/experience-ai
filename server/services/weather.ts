export interface WeatherData {
  temp: string;
  conditions: string;
}

interface ResultatGeo {
  latitude: number;
  longitude: number;
  name: string;
}

interface ReponseGeo {
  results?: ResultatGeo[];
}

interface ReponsePrevision {
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weathercode?: number[];
  };
}

interface ReponseClimat {
  daily?: {
    temperature_2m_mean?: number[];
    precipitation_sum?: number[];
  };
}

function codeMeteoEnTexte(code: number): string {
  if (code === 0)               return 'Ciel dégagé';
  if (code <= 2)                return 'Partiellement nuageux';
  if (code === 3)               return 'Couvert';
  if (code >= 51 && code <= 55) return 'Bruine';
  if (code >= 61 && code <= 65) return 'Pluie';
  if (code >= 71 && code <= 77) return 'Neige';
  if (code >= 80 && code <= 82) return 'Averses';
  if (code >= 95 && code <= 99) return 'Orages';
  return 'Variable';
}

async function geocoderVille(city: string): Promise<ResultatGeo | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = (await res.json()) as ReponseGeo;
  return data.results?.[0] ?? null;
}

// prévision météo réelle (Open-Meteo, ≤ 16 jours)
async function getMeteoPrevision(lat: number, lon: number, date: string): Promise<WeatherData | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&start_date=${date}&end_date=${date}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const data = (await res.json()) as ReponsePrevision;

  const maxT = data.daily?.temperature_2m_max?.[0] ?? 20;
  const minT = data.daily?.temperature_2m_min?.[0] ?? 15;
  const avgT = Math.round((maxT + minT) / 2);
  const code = data.daily?.weathercode?.[0] ?? 0;

  return {
    temp:       `${avgT}°C`,
    conditions: codeMeteoEnTexte(code),
  };
}

// pas de prévision possible > 16j — on prend le même mois l'an dernier
async function getMeteoClimat(lat: number, lon: number, date: string): Promise<WeatherData | null> {
  const dateRef         = new Date(date);
  const anneeReference  = dateRef.getFullYear() - 1;
  const moisRef         = String(dateRef.getMonth() + 1).padStart(2, '0');
  const startRef = `${anneeReference}-${moisRef}-01`;
  const endRef   = `${anneeReference}-${moisRef}-${String(new Date(anneeReference, dateRef.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

  const url = `https://climate-api.open-meteo.com/v1/climate?latitude=${lat}&longitude=${lon}&start_date=${startRef}&end_date=${endRef}&daily=temperature_2m_mean,precipitation_sum&models=EC_Earth3P_HR`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = (await res.json()) as ReponseClimat;

  const temps = data.daily?.temperature_2m_mean?.filter((v): v is number => v != null) ?? [];
  const precs = data.daily?.precipitation_sum?.filter((v): v is number => v != null) ?? [];
  if (!temps.length) return null;

  const avgT = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
  const avgP = precs.length ? precs.reduce((a, b) => a + b, 0) / precs.length : 0;
  const conditions = avgP > 3 ? 'Pluies fréquentes' : avgP > 1 ? 'Quelques averses' : avgT > 25 ? 'Chaud et ensoleillé' : avgT > 15 ? 'Doux et agréable' : 'Frais';

  return {
    temp:       `${avgT}°C`,
    conditions,
  };
}

async function getMeteoActuelle(lat: number, lon: number): Promise<WeatherData | null> {
  const today = new Date().toISOString().slice(0, 10);
  return getMeteoPrevision(lat, lon, today);
}

export async function getRealWeather(city: string, departureDate?: string): Promise<WeatherData | null> {
  try {
    const donneesGeo = await geocoderVille(city);
    if (!donneesGeo) {
      console.warn(`Météo : géocodage échoué pour "${city}"`);
      return null;
    }

    const { latitude: lat, longitude: lon } = donneesGeo;

    if (!departureDate) {
      return await getMeteoActuelle(lat, lon);
    }

    const departure = new Date(departureDate);
    if (isNaN(departure.getTime())) {
      return await getMeteoActuelle(lat, lon);
    }

    const joursAvantDepart = Math.round((departure.getTime() - Date.now()) / 86400000);

    if (joursAvantDepart <= 0) {
      return await getMeteoActuelle(lat, lon);
    } else if (joursAvantDepart <= 16) {
      console.log(`Météo prévisions J+${joursAvantDepart} pour ${city}`);
      return await getMeteoPrevision(lat, lon, departureDate.slice(0, 10));
    } else {
      console.log(`Météo climatique (J+${joursAvantDepart}) pour ${city}`);
      return await getMeteoClimat(lat, lon, departureDate.slice(0, 10));
    }
  } catch (err) {
    console.error('Erreur météo :', (err as Error).message);
    return null;
  }
}
