import 'dotenv/config';

const CLE_TAVILY = process.env.TAVILY_API_KEY;

interface ResultatTavily {
  title: string;
  url: string;
  content: string;
}

interface ReponseTavily {
  results: ResultatTavily[];
}

export async function searchWeb(query: string, maxResults = 3): Promise<string> {
  if (!CLE_TAVILY) {
    console.warn('Recherche Web ignorée (Pas de clé Tavily).');
    return '';
  }

  try {
    const controleurAbort = new AbortController();
    const minuterie = setTimeout(() => controleurAbort.abort(), 15000);

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controleurAbort.signal,
      body: JSON.stringify({
        api_key: CLE_TAVILY,
        query,
        search_depth: 'basic',
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        max_results: maxResults,
        include_domains: [],
        exclude_domains: [],
      }),
    });

    clearTimeout(minuterie);

    if (!response.ok) {
      throw new Error(`Erreur Tavily: ${response.status}`);
    }

    const donneesTavily = (await response.json()) as ReponseTavily;

    let contexteWeb = '==== CONTEXTE WEB RECENT ====\n';
    if (donneesTavily.results && donneesTavily.results.length > 0) {
      donneesTavily.results.forEach((r, idx) => {
        contexteWeb += `[Source ${idx + 1}: ${r.title}] (URL: ${r.url}) : ${r.content}\n`;
      });
    } else {
      contexteWeb += 'Pas de résultats récents.\n';
    }
    contexteWeb += '=============================\n';
    return contexteWeb;
  } catch (err) {
    console.error('Échec de la recherche web :', (err as Error).message);
    return ''; // On ne crashe pas l'application si internet bug
  }
}
