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

// Lista de bloqueio dos agentes (.claude/settings.json). O casamento abaixo
// imita a regra do Claude Code: o `*` cobre qualquer texto e o padrao cobre o
// nome da ferramenta ou o comando inteiro. Nao imita a separacao de comando
// composto nem a remocao de `timeout`/variavel na frente, que o Claude Code faz
// antes de comparar; por isso cada caso de Bash e um comando so. A prova real
// fica na sessao de teste da PR.
function bloqueiaPor(regras: string[], alvo: string): string | undefined {
  const escapar = (texto: string) => texto.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  const comoRegex = (padrao: string) => new RegExp(`^${padrao.split('*').map(escapar).join('.*')}$`, 's')
  return regras.find((regra) => {
    const bash = /^Bash\((.*)\)$/.exec(regra)
    if (bash) return alvo.startsWith('$ ') && comoRegex(bash[1]).test(alvo.slice(2))
    return !alvo.startsWith('$ ') && comoRegex(regra).test(alvo)
  })
}

// Ferramentas de escrita e as que entregam segredo ou acesso, no conector da
// Vercel em 2026-10-11.
const VERCEL_BLOQUEADAS = [
  'accept_project_transfer_request', 'activate_kms_signing_key', 'add_project_domain', 'add_route',
  'approve_rolling_release_stage', 'assign_alias', 'buy_domain', 'cancel_deployment',
  'change_toolbar_thread_resolve_status', 'complete_rolling_release', 'create_deployment',
  'create_project_env', 'create_or_transfer_domain', 'create_sandboxes_v4', 'edit_project_env',
  'extend_session_timeout', 'generate_route', 'import-claude-design-from-url', 'invalidate_by_tags',
  'issue_cert', 'kill_session_command', 'patch_url_protection_bypass', 'pause_project',
  'put_firewall_config', 'record_events', 'replace_domain_dns_records', 'reply_to_toolbar_thread',
  'request_promote', 'request_rollback', 'rerequest_check', 'restore_edge_config_backup',
  'retry_vercel_ci_invocation', 'revoke_kms_signing_key', 'run_session_command', 'stage_routes',
  'start_rolling_release', 'stop_session', 'test_drain', 'unpause_project', 'update_firewall_config',
  'update_project', 'upload_file', 'upsert_connector_project_connection', 'verify_project_domain',
  'write_session_files', 'get_access_to_vercel_url', 'get_drain', 'get_edge_config_item',
  'get_edge_config_items', 'get_edge_config_token', 'get_edge_config_tokens',
  'get_project_deletion_link', 'get_project_env', 'get_shared_env_var', 'get_webhooks',
  'filter_project_envs', 'list_feature_flag_sdk_keys',
]

// Verbos de escrita sem ferramenta hoje: a lista ja barra quando a Vercel criar.
const VERCEL_FUTURAS = [
  'connect_git_repository', 'delete_project', 'deploy_project', 'disable_protection',
  'enable_protection', 'link_project', 'merge_branch_alias', 'move_project', 'promote_deployment',
  'publish_project', 'purge_cache', 'remove_domain', 'rename_project', 'reset_project',
  'rollback_deployment', 'set_env', 'transfer_domain',
]

describe('trava dos agentes', () => {
  const settings = JSON.parse(read('.claude/settings.json')) as Record<string, unknown>
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>
  const denyBruto: unknown[] = Array.isArray(permissions.deny) ? permissions.deny : []
  const deny = denyBruto.filter((regra): regra is string => typeof regra === 'string')

  it('so tem regra deny: nada de allow, hook, modo de permissao ou variavel', () => {
    expect(Object.keys(settings).sort()).toEqual(['$schema', 'permissions'])
    expect(Object.keys(permissions)).toEqual(['deny'])
    expect(deny.length).toBeGreaterThan(0)
    expect(deny.length).toBe(denyBruto.length)
    expect(deny.every((regra) => regra.trim() === regra)).toBe(true)
    expect(new Set(deny).size).toBe(deny.length)
  })

  // Conectores do claude.ai chegam como `mcp__<Nome>__` na nuvem e como
  // `mcp__claude_ai_<Nome>__` na maquina local. `OutroBanco` e nome inventado:
  // prova a regra generica, que vale para qualquer conector.
  const bloqueados = [
    'mcp__Supabase__execute_sql',
    'mcp__claude_ai_Supabase__apply_migration',
    'mcp__plugin_supabase_supabase__execute_sql',
    'mcp__OutroBanco__apply_migration',
    'mcp__OutroBanco__deploy_edge_function',
    'mcp__OutroBanco__create_edge_function_secret',
    'mcp__OutroBanco__merge_branch',
    'mcp__OutroBanco__reset_branch',
    'mcp__OutroBanco__rebase_branch',
    'mcp__OutroBanco__restore_project',
    ...VERCEL_BLOQUEADAS.map((nome) => `mcp__Vercel__${nome}`),
    ...VERCEL_FUTURAS.map((nome) => `mcp__Vercel__${nome}`),
    'mcp__claude_ai_Vercel__create_deployment',
    '$ supabase db push --include-all',
    '$ supabase --debug db push',
    '$ supabase db query --linked --file supabase/migrations/x.sql',
    '$ supabase migration up --db-url postgresql://exemplo',
    '$ supabase migration repair --status applied 20260722190516',
    '$ supabase config push',
    '$ supabase functions deploy daily-payable-due-report',
    '$ supabase functions delete daily-payable-due-report',
    '$ supabase secrets set RESEND_API_KEY=x',
    '$ supabase backups restore --timestamp 1',
    '$ supabase branches delete exemplo',
    '$ supabase projects delete exemplo',
    '$ npx supabase@2.109.1 db push',
    '$ npx supabase db query --linked -f x.sql',
    '$ npx supabase migration down --db-url postgresql://exemplo',
    '$ npx supabase migration repair --status reverted 1',
    '$ npx -y supabase config push',
    '$ npx supabase functions deploy x',
    '$ npx supabase functions delete x',
    '$ npx supabase secrets unset X',
    '$ npx supabase backups list',
    '$ npx supabase branches create x',
    '$ npx supabase projects api-keys',
    '$ vercel',
    '$ vercel --prebuilt --prod',
    '$ vercel --target=production',
    '$ vercel alias set dpl exemplo.com',
    '$ vercel api /v9/projects -X POST',
    '$ vercel logs https://exemplo.vercel.app',
    '$ npx vercel@latest deploy --prod',
    '$ npx -y vercel --prod',
    '$ npx --yes vercel pull --environment=production',
    '$ npx --no-install vercel@latest deploy',
    '$ ./node_modules/.bin/vercel',
    '$ ./node_modules/.bin/vercel deploy --prod',
  ]

  const liberados = [
    'mcp__Supabase_Leitura__execute_sql',
    'mcp__Supabase_Leitura__list_migrations',
    'mcp__claude_ai_Supabase_Leitura__execute_sql',
    'mcp__Vercel__get_deployment',
    'mcp__Vercel__get_project',
    'mcp__Vercel__get_edge_config',
    'mcp__Vercel__list_deployments',
    'mcp__Vercel__list_deployment_events',
    'mcp__Vercel__get_runtime_logs',
    'mcp__Vercel__web_fetch_vercel_url',
    'mcp__Vercel__search_vercel_documentation',
    'mcp__github__create_pull_request',
    'mcp__github__merge_pull_request',
    '$ supabase db start',
    '$ supabase db reset --local',
    '$ npx supabase db reset --local',
    '$ supabase migration new remove_trigger_kit',
    '$ supabase migration list',
    '$ supabase test db',
    '$ supabase stop',
    '$ node scripts/supabase-api-config.mjs',
    '$ git commit -m "nunca rode supabase db push"',
    '$ gh pr create --body "vercel deploy e proibido"',
    '$ rg "vercel deploy" docs',
    '$ npx vitest run src/lib/harness.test.ts',
    '$ npx vitest run src/lib/vercelConfig.test.ts',
    '$ npm test',
    '$ git push -u origin feat/exemplo',
  ]

  it.each(bloqueados)('bloqueia %s', (alvo) => {
    expect(bloqueiaPor(deny, alvo)).toBeDefined()
  })

  it.each(liberados)('deixa passar %s', (alvo) => {
    expect(bloqueiaPor(deny, alvo)).toBeUndefined()
  })

  // Apagar qualquer regra precisa reprovar: cada uma barra um caso que so ela barra.
  it('cada regra e a unica a barrar algum caso conhecido', () => {
    const semCasoProprio = deny.filter(
      (regra) =>
        !bloqueados.some((alvo) => {
          const quemBarra = deny.filter((outra) => bloqueiaPor([outra], alvo))
          return quemBarra.length === 1 && quemBarra[0] === regra
        }),
    )
    expect(semCasoProprio).toEqual([])
  })
})
