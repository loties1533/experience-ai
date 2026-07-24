import type { Element, Parcours } from '../lib/api'

// Ce que le groupe pense d'un élément. Un avis qui ÉCLAIRE : aucun total ne
// décide à la place de l'organisateur (invariant 8), on montre juste qui a dit
// quoi. Le vote formel est explicitement V2.

export default function AvisGroupe({ parcours, element }: { parcours: Parcours; element: Element }) {
  if (element.reactions.length === 0) return null

  // Le nom se résout contre les participants : un participant retiré disparaît.
  const nomDe = (id: string) => parcours.participants.find((p) => p.id === id)?.nom
  const pour = element.reactions.filter((r) => r.avis === 'pour').map((r) => nomDe(r.participantId)).filter(Boolean)
  const contre = element.reactions.filter((r) => r.avis === 'contre').map((r) => nomDe(r.participantId)).filter(Boolean)

  return (
    <p className="text-xs text-brume mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {pour.length > 0 && (
        <span>
          <span className="font-semibold text-lagon-dark">Pour</span> · {pour.join(', ')}
        </span>
      )}
      {contre.length > 0 && (
        <span>
          <span className="font-semibold text-corail">Contre</span> · {contre.join(', ')}
        </span>
      )}
    </p>
  )
}
