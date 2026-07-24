import { searchWeb } from './tools/webSearch.js';
import { callAI, parseJSON } from './claude/core.js';
import { predictHQEventsSearch } from './predictHQ.js';
import type { TravelMode } from '../lib/types.js';

// Recherche d'événements réels : PredictHQ en priorité (données structurées),
// repli sur une recherche web + extraction LLM. Sert de connecteur événementiel
// à la génération (via l'outil du modèle). Les recherches de vols et d'hôtels de
// l'ancien TripGenie ont été retirées : le produit ne réserve rien (invariant 4).

export interface EventSearchResult {
  title: string;
  category: string;
  start: string;
  venue: string;
  description: string;
}

interface SmartEventsParams {
  location: string;
  dateFrom?: string;
  dateTo?: string;
  mode: TravelMode;
}

export async function smartEventsSearch({
  location, dateFrom, dateTo, mode,
}: SmartEventsParams): Promise<EventSearchResult[]> {
  // ── 1. PredictHQ en priorité : données structurées réelles, pas de LLM parsing ──
  try {
    const phqEvents = await predictHQEventsSearch(
      location,
      dateFrom ?? new Date().toISOString().slice(0, 10),
      dateTo  ?? dateFrom ?? new Date().toISOString().slice(0, 10),
      mode
    );
    if (phqEvents.length > 0) return phqEvents;
  } catch (err) {
    console.warn('Repli PredictHQ :', (err as Error).message);
  }

  // ── 2. Repli : recherche web + extraction LLM si PredictHQ ne retourne rien ──
  try {
    const query = mode === 'party'
      ? `soirées clubs vie nocturne incontournables ${location} ${dateFrom ?? ''}`
      : `événements spectacles concerts incontournables ${location} ${dateFrom ?? ''}`;

    const contexteWeb = await searchWeb(query);
    if (!contexteWeb) return [];

    const prompt = `
Voici des résultats web pour des événements à ${location} :
${contexteWeb}

Extrais les 3 meilleurs événements. "category" et "description" rédigés EN FRANÇAIS. Retourne UNIQUEMENT un tableau JSON :
[
  {
    "title": "Nom",
    "category": "Nightlife",
    "start": "${dateFrom ?? 'Pendant le séjour'}",
    "venue": "Lieu",
    "description": "Description courte."
  }
]`;

    const reponseIABrute = await callAI(prompt, undefined, 'destinations');
    const donneesParsees = parseJSON(reponseIABrute);
    return Array.isArray(donneesParsees) ? (donneesParsees as EventSearchResult[]) : [];
  } catch (err) {
    console.error('Erreur recherche événements :', (err as Error).message);
    return [];
  }
}
