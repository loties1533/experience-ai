import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PageLayout } from '../components/layout'
import Seo from '../components/Seo'
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
        className="w-full bg-white border border-encre/15 rounded-xl px-4 py-3 text-sm text-encre
                   placeholder:text-brume focus:outline-none focus:border-soleil transition-colors"
      />
    </div>
  )
}

export default function Preferences() {
  const { data, isLoading } = useQuery({ queryKey: ['preferences'], queryFn: chargerPreferences })

  return (
    <PageLayout>
      <Seo title="Préférences" noindex path="/preferences" />
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold text-encre">Mes préférences</h1>
        <p className="text-brume text-sm mt-1">
          Ce qu'on retient d'un parcours à l'autre. Ces préférences orientent les propositions —
          ton envie du moment reste prioritaire.
        </p>

        {isLoading ? (
          <div className="mt-6 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}</div>
        ) : (
          // Monté une fois les données là : le formulaire part directement des
          // bonnes valeurs, sans synchronisation après coup.
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
    onError: (e) => toast.error((e as Error).message),
  })

  return (
          <form
            className="carte p-6 mt-6 space-y-5"
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
                        ? 'bg-soleil text-white border-soleil'
                        : 'bg-white text-encre border-encre/15 hover:border-soleil'
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
                className="w-full bg-white border border-encre/15 rounded-xl px-4 py-3 text-sm text-encre
                           focus:outline-none focus:border-soleil transition-colors"
              />
            </div>

            <button type="submit" className="btn-primaire w-full" disabled={enregistrement.isPending}>
              {enregistrement.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </form>
  )
}
