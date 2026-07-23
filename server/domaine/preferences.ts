import { z } from 'zod';

// Mémoire simple (capacité MVP, doc 07) : ce que l'utilisateur renseigne une
// fois et qu'on réinjecte à chaque génération. Des préférences SOUPLES :
// elles orientent l'orchestrateur, elles n'excluent jamais (l'intention prime).

export const PreferencesParcoursSchema = z.object({
  ambiances: z.array(z.string().min(1)).max(10).default([]),
  rythme: z.enum(['detendu', 'equilibre', 'intense']).optional(),
  contraintes: z.array(z.string().min(1)).max(10).default([]),
  lieuxFavoris: z.array(z.string().min(1)).max(10).default([]),
  budgetHabituel: z.number().positive().optional(),
});

export type PreferencesParcours = z.infer<typeof PreferencesParcoursSchema>;
