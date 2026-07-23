import { defineConfig, configDefaults } from 'vitest/config'

// Les worktrees Git (.claude/worktrees/*) contiennent des copies des fichiers de test.
// Sans cette exclusion, vitest les compte en double et gonfle le total (ex. 1800 au lieu
// des ~300 réels). On ne garde que la vraie suite du dépôt.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
})
