import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Guarda do harness: invariantes especificas da memoria canonica.
// Nao substitui auditoria; impede regressoes documentais ja cometidas.

const root = path.resolve(__dirname, '..', '..')

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

describe('harness canonico', () => {
  it('CLAUDE.md importa AGENTS.md como fonte unica de regras', () => {
    expect(read('CLAUDE.md')).toMatch(/^@AGENTS\.md$/m)
  })

  it('fontes canonicas nao afirmam que o login por PIN esta disponivel', () => {
    for (const file of ['AGENTS.md', 'README.md', 'docs/CURRENT_STATE.md']) {
      const content = read(file)
      expect(content, file).not.toMatch(/em paralelo ao login legado por PIN/i)
      expect(content, file).not.toMatch(/PIN[^.\n]*ainda dispon/i)
    }
  })

  it('bootstraps apontam para o AGENTS.md e nao para docs legados', () => {
    for (const file of ['scripts/codex-bootstrap.sh', 'scripts/codex-bootstrap.ps1']) {
      const content = read(file)
      expect(content, file).toContain('AGENTS.md')
      expect(content, file).not.toContain('docs/TASKS.md')
    }
  })

  it('nao renasce indice paralelo de onboarding', () => {
    expect(existsSync(path.join(root, 'tasks', 'todo.md'))).toBe(false)
    expect(existsSync(path.join(root, 'docs', 'README.md'))).toBe(false)
  })
})
