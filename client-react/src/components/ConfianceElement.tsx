import type { Element } from '../../../server/domaine/parcours'

const PRESENTATION = {
  verifie: {
    libelle: 'Vérifié',
    classe: 'bg-lagon/10 text-lagon-dark',
  },
  estime: {
    libelle: 'Estimé',
    classe: 'bg-soleil/10 text-soleil-dark',
  },
  suggestion: {
    libelle: 'Suggestion',
    classe: 'bg-encre/5 text-brume',
  },
} as const

export function BadgeConfiance({ element }: { element: Element }) {
  const presentation = PRESENTATION[element.confiance.niveau]
  const detail =
    element.confiance.niveau === 'verifie'
      ? `Source : ${element.confiance.source}. Fournisseur : ${
          element.confiance.fournisseur
        }. Récupérée le ${new Date(element.confiance.recupereLe).toLocaleDateString('fr-FR')}`
      : element.confiance.niveau === 'estime'
        ? 'Information approximative, à confirmer'
        : 'Idée générique, aucun établissement précis n’est confirmé'

  return (
    <span
      className={`badge-statut ${presentation.classe}`}
      title={detail}
      aria-label={`${presentation.libelle}. ${detail}`}
    >
      {presentation.libelle}
    </span>
  )
}

const LIBELLES_LIEN = {
  officiel: 'Voir le site officiel',
  billetterie: 'Voir la billetterie',
  recherche: 'Consulter les résultats actuels',
  carte: 'Voir sur la carte',
} as const

export function libelleLien(element: Element) {
  return element.reservation ? LIBELLES_LIEN[element.reservation.typeLien] : ''
}

export function LibelleLien({ element }: { element: Element }) {
  if (!element.reservation) return null
  return <>{libelleLien(element)}</>
}

// Raccourci de recherche transport : présent seulement quand le serveur a
// résolu les deux extrémités du trajet. C'est une recherche externe, jamais un
// billet ni une réservation — le libellé vient du serveur et le dit clairement.
export function LienRechercheTransport({ element }: { element: Element }) {
  const lien = element.lienRechercheTransport
  if (!lien) return null
  return (
    <a href={lien.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center min-h-[44px] text-xs text-lagon-dark underline underline-offset-2 hover:text-lagon"
      aria-label={`${lien.libelle} pour « ${element.nom} » (recherche externe, nouvel onglet)`}>
      {lien.libelle}
    </a>
  )
}
