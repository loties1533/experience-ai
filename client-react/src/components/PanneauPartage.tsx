import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  chargerPartage, changerVisibilite, ajouterParticipant, retirerParticipant,
  type Role, type Visibilite, type EtatPartage, type ReponsePartage,
} from '../lib/api'

// « Tant qu'on est en groupe, on doit pouvoir partager pour pouvoir modifier
// notre parcours. » Un lien PAR participant : c'est lui qui dit qui consulte,
// donc ce qu'il a le droit de voir — et le héros d'une surprise n'en a aucun.

const VISIBILITES: { valeur: Visibilite; titre: string; explication: string }[] = [
  { valeur: 'prive', titre: 'Privé', explication: 'Vous seul y avez accès. Les liens déjà envoyés cessent de fonctionner.' },
  { valeur: 'partage', titre: 'Partagé', explication: 'Chaque participant reçoit son lien et peut donner son avis.' },
  { valeur: 'surprise', titre: 'Surprise', explication: 'Le groupe voit le parcours, sauf celui pour qui vous le préparez.' },
]

const LIBELLES_ROLE: Record<Role, string> = {
  organisateur: 'Organisateur',
  participant: 'Participant',
  heros: 'Pour qui c’est',
}

export default function PanneauPartage({ parcoursId }: { parcoursId: string }) {
  const queryClient = useQueryClient()
  const [nom, setNom] = useState('')
  const [role, setRole] = useState<Role>('participant')

  const { data, isLoading } = useQuery({
    queryKey: ['partage', parcoursId],
    queryFn: () => chargerPartage(parcoursId),
  })

  // Toute action renvoie le parcours ET l'état de partage : on rafraîchit les
  // deux d'un coup, sans second aller-retour.
  const apresAction = (reponse: ReponsePartage) => {
    queryClient.setQueryData(['partage', parcoursId], reponse.partage)
    queryClient.setQueryData(['parcours', parcoursId], { parcours: reponse.parcours })
  }
  const echec = (e: unknown) => toast.error((e as Error).message)

  const visibilite = useMutation({
    mutationFn: (v: Visibilite) => changerVisibilite(parcoursId, v),
    onSuccess: (r) => { apresAction(r); toast.success('Visibilité mise à jour') },
    onError: echec,
  })

  const ajout = useMutation({
    mutationFn: () => ajouterParticipant(parcoursId, { nom: nom.trim(), role }),
    onSuccess: (r) => { apresAction(r); setNom(''); toast.success('Participant ajouté') },
    onError: echec,
  })

  const retrait = useMutation({
    mutationFn: (participantId: string) => retirerParticipant(parcoursId, participantId),
    onSuccess: (r) => { apresAction(r); toast.success('Participant retiré') },
    onError: echec,
  })

  const copier = async (chemin: string) => {
    const url = `${window.location.origin}${chemin}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Lien copié')
    } catch {
      // Presse-papiers refusé (http, permission) : on montre le lien à la main.
      window.prompt('Copiez ce lien :', url)
    }
  }

  if (isLoading || !data) return <div className="skeleton h-40 mt-8" />
  const partage: EtatPartage = data

  return (
    <section className="carte p-5 mt-8">
      <h2 className="font-heading font-semibold text-lg text-encre">Partager au groupe</h2>
      <p className="text-sm text-brume mt-1">
        Chacun reçoit son propre lien : il pourra voir le parcours et dire ce qu'il en pense. Vous gardez la décision.
      </p>

      {/* Visibilité */}
      <fieldset className="mt-4">
        <legend className="text-xs font-bold uppercase tracking-wide text-brume mb-2">Qui peut voir</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {VISIBILITES.map((v) => (
            <label
              key={v.valeur}
              className={`rounded-xl border p-3 cursor-pointer transition-colors ${
                partage.visibilite === v.valeur ? 'border-laiton bg-laiton/5' : 'border-encre/10 hover:border-encre/25'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="visibilite"
                  value={v.valeur}
                  checked={partage.visibilite === v.valeur}
                  onChange={() => visibilite.mutate(v.valeur)}
                  disabled={visibilite.isPending}
                  className="accent-terracotta"
                />
                <span className="font-semibold text-encre text-sm">{v.titre}</span>
              </span>
              <span className="block text-xs text-brume mt-1">{v.explication}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Les participants et leurs liens */}
      <ul className="mt-5 space-y-2">
        {partage.liens.map((lien) => (
          <li key={lien.participantId} className="flex flex-wrap items-center gap-2 rounded-xl border border-encre/10 p-3">
            <span className="flex-1 min-w-0">
              <span className="font-semibold text-encre text-sm">{lien.nom}</span>
              <span className="text-xs text-brume"> · {LIBELLES_ROLE[lien.role]}</span>
              {lien.chemin === null && (
                <span className="block text-xs text-brume mt-0.5">
                  {partage.visibilite === 'prive'
                    ? 'Aucun lien tant que le parcours est privé'
                    : 'Pas de lien : la surprise est pour lui'}
                </span>
              )}
            </span>
            {lien.chemin && (
              <button className="btn-secondaire min-h-[44px] text-xs" onClick={() => copier(lien.chemin as string)}>
                Copier le lien
              </button>
            )}
            {lien.role !== 'organisateur' && (
              <button
                className="btn-secondaire min-h-[44px] text-xs !text-corail hover:!border-corail"
                onClick={() => { if (window.confirm(`Retirer « ${lien.nom} » du parcours ?`)) retrait.mutate(lien.participantId) }}
                disabled={retrait.isPending}
              >
                Retirer
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Constituer le groupe */}
      <form
        className="mt-4 flex flex-wrap gap-2 items-end"
        onSubmit={(e) => { e.preventDefault(); if (nom.trim()) ajout.mutate() }}
      >
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor="nom-participant" className="block text-xs font-bold uppercase tracking-wide text-brume mb-1">
            Ajouter quelqu'un
          </label>
          <input
            id="nom-participant"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            maxLength={60}
            placeholder="Son prénom"
            className="w-full px-4 py-2.5 rounded-xl border border-encre/15 bg-white text-encre
                       placeholder:text-brume transition-colors
                       focus:border-laiton-dark focus:outline-none focus:ring-2 focus:ring-laiton/30"
          />
        </div>
        <div>
          <label htmlFor="role-participant" className="block text-xs font-bold uppercase tracking-wide text-brume mb-1">
            Son rôle
          </label>
          <select
            id="role-participant"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="px-4 py-2.5 rounded-xl border border-encre/15 bg-white text-encre transition-colors focus:border-laiton-dark focus:outline-none focus:ring-2 focus:ring-laiton/30"
          >
            <option value="participant">Participant</option>
            <option value="heros">Pour qui c'est</option>
          </select>
        </div>
        <button type="submit" className="btn-primaire !py-2.5" disabled={ajout.isPending || !nom.trim()}>
          Ajouter
        </button>
      </form>
    </section>
  )
}
