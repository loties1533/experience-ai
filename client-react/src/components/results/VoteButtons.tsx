// Vote « pour / contre » sur un élément du pack — un compteur de consensus
// partagé : chaque invité d'un voyage voit les votes des autres.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { saveVote, getVotes } from '../../lib/api'

interface TripVote { item_id: string; vote_type: boolean } // vote_type : true = pour, false = contre

// Icône pouce (SVG) — pivotée de 180° pour le pouce vers le bas
function ThumbIcon({ down = false }: { down?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={down ? 'rotate-180' : ''}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  )
}

const VoteButtons = ({ packId, itemId }: { packId: string, itemId: string }) => {
  const [voteUtilisateur, setVoteUtilisateur] = useState<boolean | null>(null)
  const desactive = !packId // pas de packId = pack pas encore sauvegardé → vote impossible
  const queryClient = useQueryClient()

  // On relit les votes toutes les 10s pour afficher ceux des autres invités presque en direct
  const { data } = useQuery({
    queryKey: ['votes', packId],
    queryFn: () => getVotes(packId),
    enabled: !!packId,
    refetchInterval: 10000,
  })

  const votes = (data?.votes ?? []) as TripVote[]
  const votesItem = votes.filter(v => v.item_id === itemId)
  const totalPositifs = votesItem.filter(v => v.vote_type === true).length
  const totalNegatifs = votesItem.filter(v => v.vote_type === false).length

  const gererVote = async (estPositif: boolean) => {
    if (desactive) return
    try {
      await saveVote(packId, itemId, estPositif, '')
      setVoteUtilisateur(estPositif)
      // On invalide le cache pour rafraîchir les compteurs sans attendre le prochain refetch
      queryClient.invalidateQueries({ queryKey: ['votes', packId] })
    } catch (err) { console.error(err) }
  }

  const baseBtn = 'w-7 h-7 rounded-sm flex items-center justify-center border transition-colors'
  const neutre  = 'border-gray-300 text-muted hover:border-ink hover:text-ink'

  return (
    <div className="flex items-center gap-2" data-testid="vote-container" title={desactive ? 'Connectez-vous pour voter' : ''}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => gererVote(true)}
          disabled={desactive}
          aria-label="Vote positif"
          className={`${baseBtn} ${desactive ? 'opacity-30 cursor-not-allowed' : ''} ${voteUtilisateur === true ? 'bg-sage/10 border-sage text-sage' : neutre}`}
        >
          <ThumbIcon />
        </button>
        {totalPositifs > 0 && (
          <span className="text-xs text-muted font-medium">{totalPositifs}</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => gererVote(false)}
          disabled={desactive}
          aria-label="Vote négatif"
          className={`${baseBtn} ${desactive ? 'opacity-30 cursor-not-allowed' : ''} ${voteUtilisateur === false ? 'bg-coral/10 border-coral text-coral' : neutre}`}
        >
          <ThumbIcon down />
        </button>
        {totalNegatifs > 0 && (
          <span className="text-xs text-muted font-medium">{totalNegatifs}</span>
        )}
      </div>
    </div>
  )
}

export default VoteButtons
