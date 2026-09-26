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

function skillDirs(): string[] {
  return readdirSync(path.join(root, '.claude', 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function skillFiles(): string[] {
  return skillDirs()
    .filter((name) => existsExactCase(`.claude/skills/${name}/SKILL.md`))
    .map((name) => `.claude/skills/${name}/SKILL.md`)
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

// Caminho entre crases e relativo a raiz do repositorio; link Markdown e
// relativo a pasta do documento, como o GitHub resolve.
function extractPointers(markdown: string, documento: string): string[] {
  const deCrase = Array.from(markdown.matchAll(/`([^`]*)`/g), (match) => match[1]).filter(
    (candidate) =>
      !/\s/.test(candidate) &&
      PASTAS_DO_REPOSITORIO.some((pasta) => candidate.startsWith(pasta)) &&
      !/[<>*{}$]/.test(candidate),
  )
  const deLink = Array.from(
    markdown.matchAll(/\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g),
    (match) => match[1].split('#')[0],
  )
    .filter((alvo) => alvo !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(alvo))
    .map((alvo) => {
      const resolvido = path.posix.normalize(path.posix.join(path.posix.dirname(documento), alvo))
      return alvo.endsWith('/') && !resolvido.endsWith('/') ? `${resolvido}/` : resolvido
    })
  return Array.from(new Set([...deCrase, ...deLink]))
}

// existsSync ignora maiusculas no Windows e no macOS; o CI roda em Linux.
function existsExactCase(relativePath: string): boolean {
  let atual = root
  for (const segmento of relativePath.split('/').filter((parte) => parte !== '')) {
    if (segmento === '..' || !existsSync(atual) || !readdirSync(atual).includes(segmento)) return false
    atual = path.join(atual, segmento)
  }
  return true
}

function triggerTableTargets(agents: string): string[] {
  const start = agents.indexOf('## Tabela de gatilhos')
  if (start === -1) return []
  const end = agents.indexOf('\n## ', start + 1)
  const linhas = agents.slice(start, end === -1 ? undefined : end).split('\n')
  const separador = linhas.findIndex((linha) => /^\|\s*-{3,}/.test(linha.trim()))
  if (separador === -1) return []
  return linhas.slice(separador + 1).flatMap((linha) => {
    if (!linha.trim().startsWith('|')) return []
    const celulas = linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
    const destino = celulas[celulas.length - 1] ?? ''
    return Array.from(destino.matchAll(/`([^`]+)`/g), (match) => match[1])
  })
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
      'Leia `docs/regras/BANCO.md` e [o estado](../CURRENT_STATE.md#riscos).',
      'Com titulo: [banco](../BANCO_INEXISTENTE.md "Detalhes").',
      'Ignora `npm test`, `tipo/<descricao-curta>`, `NOTES.md`, `origin/main`,',
      '`.next/types`, `docs/*.md`, `C:\\Users\\x` e [site](https://exemplo.com).',
      'Crases coladas: `a b`/`docs/NAO_EXISTE.md`.',
    ].join('\n')
    expect(extractPointers(texto, 'docs/regras/X.md')).toEqual([
      'docs/regras/BANCO.md',
      'docs/NAO_EXISTE.md',
      'docs/CURRENT_STATE.md',
      'docs/BANCO_INEXISTENTE.md',
    ])
  })

  it('confere maiusculas e minusculas do caminho', () => {
    expect(existsExactCase('docs/regras/BANCO.md')).toBe(true)
    expect(existsExactCase('docs/regras/banco.md')).toBe(false)
    expect(existsExactCase('docs/regras/')).toBe(true)
  })

  it('le a tabela de gatilhos por celula, com mais de um alvo na linha', () => {
    const agents = [
      '## Tabela de gatilhos',
      '',
      '| Gatilho | Leia |',
      '| --- | --- |',
      '| Tocar `supabase/` | `docs/regras/BANCO.md` |  ',
      '| Mexer em CI | `docs/regras/FECHAMENTO.md` e `docs/regras/BANCO.md` |',
      '',
      '## Outra secao',
      '| x | `docs/fora.md` |',
    ].join('\n')
    expect(triggerTableTargets(agents)).toEqual([
      'docs/regras/BANCO.md',
      'docs/regras/FECHAMENTO.md',
      'docs/regras/BANCO.md',
    ])
  })

  it('todo caminho citado nas regras existe no repositorio', () => {
    const quebrados = arquivosDeRegra.flatMap((arquivo) =>
      extractPointers(read(arquivo), arquivo)
        .filter((ponteiro) => !LUGARES_PREVISTOS_AINDA_VAZIOS.includes(ponteiro))
        .filter((ponteiro) => !existsExactCase(ponteiro))
        .map((ponteiro) => `${arquivo} -> ${ponteiro}`),
    )
    expect(quebrados).toEqual([])
  })

  it('toda pasta de skill versionada tem SKILL.md com caixa exata', () => {
    const semSkill = skillDirs().filter((name) => !existsExactCase(`.claude/skills/${name}/SKILL.md`))
    expect(skillDirs().length).toBeGreaterThan(0)
    expect(semSkill).toEqual([])
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
      expect(existsExactCase(alvo), alvo).toBe(true)
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
