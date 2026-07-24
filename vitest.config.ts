import { defineConfig, configDefaults } from 'vitest/config'

// Les worktrees Git (.claude/worktrees/*) contiennent des copies des fichiers de test.
// Sans cette exclusion, vitest les compte en double et gonfle le total (ex. 1800 au lieu
// des ~300 réels). On ne garde que la vraie suite du dépôt.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    // Aucun test n'appelle une vraie API. Le poste de dev a un .env rempli, et
    // dotenv n'écrase pas une variable déjà posée : en la vidant ici, les clés
    // du .env n'entrent jamais dans la suite. Un test qui a besoin d'une clé la
    // pose lui-même (cf. tests/services/foursquare.test.ts).
    env: {
      ANTHROPIC_API_KEY: '',
      GEMINI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      FOURSQUARE_API_KEY: '',
      PREDICTHQ_API_KEY: '',
      TAVILY_API_KEY: '',
      AI_PROVIDER: '',
    },
  },
})
