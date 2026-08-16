import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
import { EtatChargement, EtatErreur } from '../components/ui/Etats'
import { Bouton } from '../components/ui/Bouton'
import { chargerPreferences, sauvegarderPreferences, type PreferencesParcours } from '../lib/api'

// Mémoire simple : ce qu'on retient d'un parcours à l'autre. Des préférences
// SOUPLES — elles orientent la construction, l'envie du moment prime toujours.

const RYTHMES = [
  { valeur: 'detendu', libelle: 'Détendu', aide: 'peu d’éléments, de la respiration' },
  { valeur: 'equilibre', libelle: 'Équilibré', aide: 'un bon compromis' },
  { valeur: 'intense', libelle: 'Intense', aide: 'dense, on ne s’arrête pas' },
] as const

const VIDE: PreferencesParcours = { ambiances: [], contraintes: [], lieuxFavoris: [] }

/** Champ de liste : saisie séparée par des virgules → tableau. */
function ChampListe({ id, libelle, aide, valeurs, onChange }: {
  id: string; libelle: string; aide: string; valeurs: string[]; onChange: (v: string[]) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-encre">{libelle}</label>
      <p className="text-xs text-brume mb-1.5">{aide}</p>
      <input
        id={id}
        value={valeurs.join(', ')}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10))}
        className="champ"
      />
    </div>
  )
}

export default function Preferences() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['preferences'], queryFn: chargerPreferences })

  return (
    <PageLayout>
      <Seo title="Préférences" noindex path="/preferences" />
      <div className="max-w-xl mx-auto">
        <p className="label-champ">Ta mémoire</p>
        <h1 className="titre-page mt-1">Mes préférences</h1>
        <p className="text-brume text-sm mt-2">
          Ce qu'on retient d'un parcours à l'autre. Ces préférences orientent les propositions —
          ton envie du moment reste prioritaire.
        </p>

        {isLoading ? (
          <div className="mt-6"><EtatChargement nombre={3} hauteur="h-16" /></div>
        ) : isError ? (
          // Une panne n'est jamais montée comme des préférences vides : sinon un
          // enregistrement écraserait les vraies données par du vide.
          <div className="mt-6">
            <EtatErreur
              titre="Impossible de charger tes préférences"
              description="Un souci technique passager. Réessaie dans un instant."
              action={<Bouton variante="secondaire" onClick={() => refetch()}>Réessayer</Bouton>}
            />
          </div>
        ) : (
          // Monté seulement après un chargement réussi : `preferences: null` produit
          // légitimement un formulaire vide, une panne jamais.
          <Formulaire initiales={{ ...VIDE, ...(data?.preferences ?? {}) }} />
        )}
      </div>
    </PageLayout>
  )
}

function Formulaire({ initiales }: { initiales: PreferencesParcours }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<PreferencesParcours>(initiales)

  const enregistrement = useMutation({
    mutationFn: sauvegarderPreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
      toast.success('Préférences enregistrées')
    },
    onError: () => toast.error('Impossible d’enregistrer tes préférences. Réessaie dans un instant.'),
  })

  return (
    <form
      className="mt-8 space-y-6 border-t border-sable pt-6"
      onSubmit={(e) => { e.preventDefault(); enregistrement.mutate(form) }}
    >
      <ChampListe
        id="ambiances" libelle="Ambiances que j'aime"
        aide="séparées par des virgules — ex. : festif, nature, gastronomique"
        valeurs={form.ambiances}
        onChange={(ambiances) => setForm((f) => ({ ...f, ambiances }))}
      />

      <fieldset>
        <legend className="text-sm font-semibold text-encre">Rythme préféré</legend>
        <p className="text-xs text-brume mb-1.5">la densité des moments</p>
        <div className="flex flex-wrap gap-2">
          {RYTHMES.map((r) => (
            <button
              key={r.valeur} type="button" title={r.aide}
              aria-pressed={form.rythme === r.valeur}
              onClick={() => setForm((f) => ({ ...f, rythme: f.rythme === r.valeur ? undefined : r.valeur }))}
              className={`min-h-[44px] px-4 rounded-xl text-sm font-medium border transition-colors cursor-pointer ${
                form.rythme === r.valeur
                  ? 'bg-terracotta-dark text-white border-terracotta-dark'
                  : 'bg-white text-encre border-sable hover:border-laiton'
              }`}
            >
              {r.libelle}
            </button>
          ))}
        </div>
      </fieldset>

      <ChampListe
        id="contraintes" libelle="Contraintes récurrentes"
        aide="ex. : végétarien, mobilité réduite, pas de vol de nuit"
        valeurs={form.contraintes}
        onChange={(contraintes) => setForm((f) => ({ ...f, contraintes }))}
      />

      <ChampListe
        id="lieux" libelle="Lieux favoris"
        aide="villes ou régions où tu aimes retourner"
        valeurs={form.lieuxFavoris}
        onChange={(lieuxFavoris) => setForm((f) => ({ ...f, lieuxFavoris }))}
      />

      <div>
        <label htmlFor="budget" className="block text-sm font-semibold text-encre">Budget habituel</label>
        <p className="text-xs text-brume mb-1.5">en euros, laissé vide si ça dépend</p>
        <input
          id="budget" type="number" min={1} inputMode="numeric"
          value={form.budgetHabituel ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, budgetHabituel: e.target.value ? Number(e.target.value) : undefined }))}
          className="champ"
        />
      </div>

      <button type="submit" className="btn-primaire w-full" disabled={enregistrement.isPending}>
        {enregistrement.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  )
}
