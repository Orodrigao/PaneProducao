import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Guarda do harness: invariantes especificas da memoria canonica.
// Nao substitui auditoria; impede regressoes documentais ja cometidas.

const root = path.resolve(__dirname, '..', '..')

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function countLines(content: string): number {
  return content.replace(/\n$/, '').split('\n').length
}

const REGRAS_DIR = 'docs/regras'

function regrasFiles(): string[] {
  return readdirSync(path.join(root, REGRAS_DIR))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${REGRAS_DIR}/${name}`)
    .sort()
}

function skillFiles(): string[] {
  const skillsDir = path.join(root, '.claude', 'skills')
  return readdirSync(skillsDir)
    .filter((name) => existsSync(path.join(skillsDir, name, 'SKILL.md')))
    .map((name) => `.claude/skills/${name}/SKILL.md`)
    .sort()
}

// Teto de linhas das regras: passou disso, consolide antes de acrescentar.
const TETO_AGENTS = 420
const TETO_REGRA = 200
const TETO_LESSONS = 40
const TETO_CLAUDE = 10

// Somente caminhos que comecam por uma pasta versionada contam como ponteiro;
// o resto entre crases (comandos, nomes de tabela, prefixos) nao e caminho.
const PASTAS_DO_REPOSITORIO = ['docs/', 'src/', 'scripts/', 'supabase/', 'test/', '.claude/', '.github/']

// Lugares que o contrato de arquivos preve, mas que so nascem com o primeiro
// arquivo. Entrada aqui e decisao consciente, nunca atalho para ponteiro quebrado.
const LUGARES_PREVISTOS_AINDA_VAZIOS = ['docs/examples/']

function extractPointers(markdown: string): string[] {
  const candidates = [
    ...Array.from(markdown.matchAll(/`([^`\s]+)`/g), (match) => match[1]),
    ...Array.from(markdown.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g), (match) => match[1]),
  ]
  const pointers = candidates.filter(
    (candidate) =>
      PASTAS_DO_REPOSITORIO.some((pasta) => candidate.startsWith(pasta)) && !/[<>*{}$]/.test(candidate),
  )
  return Array.from(new Set(pointers))
}

function triggerTableTargets(agents: string): string[] {
  const start = agents.indexOf('## Tabela de gatilhos')
  const end = agents.indexOf('\n## ', start + 1)
  const table = agents.slice(start, end === -1 ? undefined : end)
  return Array.from(table.matchAll(/^\|[^|\n]*\|\s*`([^`]+)`\s*\|$/gm), (match) => match[1])
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

describe('regras: ponteiros e teto de tamanho', () => {
  const arquivosDeRegra = ['AGENTS.md', 'CLAUDE.md', 'lessons.md', ...regrasFiles(), ...skillFiles()]

  it('reconhece como ponteiro so caminho de pasta versionada, sem padrao', () => {
    const texto = [
      'Leia `docs/regras/BANCO.md` e [o estado](docs/CURRENT_STATE.md#riscos).',
      'Ignora `npm test`, `tipo/<descricao-curta>`, `NOTES.md`, `origin/main`,',
      '`.next/types`, `docs/*.md`, `C:\\Users\\x` e [site](https://exemplo.com).',
    ].join('\n')
    expect(extractPointers(texto)).toEqual(['docs/regras/BANCO.md', 'docs/CURRENT_STATE.md'])
  })

  it('todo caminho citado nas regras existe no repositorio', () => {
    const quebrados = arquivosDeRegra.flatMap((arquivo) =>
      extractPointers(read(arquivo))
        .filter((ponteiro) => !LUGARES_PREVISTOS_AINDA_VAZIOS.includes(ponteiro))
        .filter((ponteiro) => !existsSync(path.join(root, ponteiro)))
        .map((ponteiro) => `${arquivo} -> ${ponteiro}`),
    )
    expect(quebrados).toEqual([])
  })

  it('lugar previsto ainda vazio sai da lista quando nasce', () => {
    for (const lugar of LUGARES_PREVISTOS_AINDA_VAZIOS) {
      expect(existsSync(path.join(root, lugar)), lugar).toBe(false)
    }
  })

  it('toda regra de docs/regras tem linha na tabela de gatilhos do AGENTS.md', () => {
    const alvos = triggerTableTargets(read('AGENTS.md'))
    expect(alvos.length).toBeGreaterThan(0)
    for (const regra of regrasFiles()) {
      expect(alvos, regra).toContain(regra)
    }
    for (const alvo of alvos) {
      expect(existsSync(path.join(root, alvo)), alvo).toBe(true)
    }
  })

  it('regras respeitam o teto de linhas', () => {
    expect(countLines(read('AGENTS.md')), 'AGENTS.md').toBeLessThanOrEqual(TETO_AGENTS)
    expect(countLines(read('CLAUDE.md')), 'CLAUDE.md').toBeLessThanOrEqual(TETO_CLAUDE)
    expect(countLines(read('lessons.md')), 'lessons.md').toBeLessThanOrEqual(TETO_LESSONS)
    for (const regra of regrasFiles()) {
      expect(countLines(read(regra)), regra).toBeLessThanOrEqual(TETO_REGRA)
    }
  })
})
