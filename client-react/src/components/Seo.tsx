import { Helmet } from 'react-helmet-async'

const SITE_URL = 'https://tripgenie-api.onrender.com'
const DEFAULT_TITLE = 'TripGenie — Voyages sur-mesure par IA'

type SeoProps = {
  /** Titre de l'onglet. Suffixé avec « — TripGenie » sauf pour l'accueil. */
  title?: string
  description?: string
  /** Chemin de la page (ex. « /trips ») pour l'URL canonique. */
  path?: string
  /** true sur les pages privées : on demande aux moteurs de ne pas indexer. */
  noindex?: boolean
}

/**
 * Balises <head> par page : titre d'onglet, description, URL canonique,
 * et noindex sur les pages privées. Les valeurs par défaut sont dans index.html.
 */
export default function Seo({ title, description, path, noindex }: SeoProps) {
  const fullTitle = title ? `${title} — TripGenie` : DEFAULT_TITLE

  return (
    <Helmet>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      {path && <link rel="canonical" href={`${SITE_URL}${path}`} />}
      {noindex && <meta name="robots" content="noindex, nofollow" />}
    </Helmet>
  )
}
