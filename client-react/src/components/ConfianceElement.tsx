import type { Element, TypeLienExterne } from '../../../server/domaine/parcours'
import { BadgeStatutMetier } from './ui/StatutMetier'

// La palette et les libellés viennent de StatutMetier (source unique des cinq
// statuts métier). Ce composant garde ce qui lui est propre : le détail au
// niveau élément (source, fournisseur, date de récupération).
export function BadgeConfiance({ element }: { element: Element }) {
  const detail =
    element.confiance.niveau === 'verifie'
      ? `Source : ${element.confiance.source}. Fournisseur : ${
          element.confiance.fournisseur
        }. Récupérée le ${new Date(element.confiance.recupereLe).toLocaleDateString('fr-FR')}`
      : undefined

  return <BadgeStatutMetier statut={element.confiance.niveau} detail={detail} />
}

const LIBELLES_LIEN: Record<TypeLienExterne, string> = {
  officiel: 'Voir le site officiel',
  billetterie: 'Voir la billetterie',
  reservation: 'Voir la réservation',
  recherche: 'Consulter les résultats actuels',
  carte: 'Voir sur la carte',
}

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
