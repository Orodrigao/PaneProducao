import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

// Guarda do check "Navegador no preview desta PR". A senha das contas
// ficticias roda com codigo da PR; o que segura o estrago e ela existir num
// lugar so e o roteiro nunca poder fingir aprovacao. Estas conferencias leem
// os arquivos de verdade.

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const PASTA_ROTEIROS = join(RAIZ, 'test', 'preview-pr')
const AJUDANTE = 'test/preview-pr/apoio/entrar.ts'
const WORKFLOW = join(RAIZ, '.github', 'workflows', 'usuarios-banco-por-pr.yml')
const NOME_DO_JOB = 'Navegador no preview desta PR'
const SENHA = 'SUPABASE_TEST_USER_PASSWORD'

function arquivosDe(pasta) {
  const saida = []
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) saida.push(...arquivosDe(caminho))
    else saida.push(caminho)
  }
  return saida
}

const roteiros = arquivosDe(PASTA_ROTEIROS).map((caminho) => ({
  nome: relative(RAIZ, caminho).split('\\').join('/'),
  texto: readFileSync(caminho, 'utf8'),
}))

describe('roteiros de test/preview-pr', () => {
  it('existe ao menos um roteiro e o ajudante de login', () => {
    assert.ok(roteiros.some((r) => r.nome.endsWith('.spec.ts')))
    assert.ok(roteiros.some((r) => r.nome === AJUDANTE))
  })

  it('so o ajudante de login cita a senha', () => {
    const citam = roteiros.filter((r) => r.texto.includes(SENHA)).map((r) => r.nome)
    assert.deepEqual(citam, [AJUDANTE])
    const config = readFileSync(join(RAIZ, 'playwright.preview-pr.config.ts'), 'utf8')
    assert.ok(!config.includes(SENHA), 'a configuracao nao pode citar a senha')
  })

  it('a cerca de rede nao segue redirecionamento e service worker fica bloqueado', () => {
    const ajudante = roteiros.find((r) => r.nome === AJUDANTE).texto
    assert.match(ajudante, /route\.fetch\(\{ maxRedirects: 0 \}\)/)
    assert.match(ajudante, /resposta\.status\(\) >= 300 && resposta\.status\(\) < 400\) \{\r?\n\s+await route\.abort\('blockedbyclient'\)/)
    assert.match(ajudante, /route\.abort\('blockedbyclient'\)/)
    // So o erro de pagina encerrada e descartado; o resto sobe e reprova.
    assert.match(ajudante, /if \(erro instanceof Error && \/Test ended\|has been closed\/\.test\(erro\.message\)\) return\r?\n\s+throw erro/)
    const config = readFileSync(join(RAIZ, 'playwright.preview-pr.config.ts'), 'utf8')
    assert.match(config, /serviceWorkers: 'block'/)
    assert.match(config, /trace: 'off'/)
    assert.match(config, /video: 'off'/)
    assert.match(config, /screenshot: 'off'/)
  })

  it('o ajudante falha sem senha, nunca pula', () => {
    const ajudante = roteiros.find((r) => r.nome === AJUDANTE).texto
    assert.match(ajudante, /if \(!senha\) throw new Error\(/)
    assert.doesNotMatch(ajudante, /\.skip\s*\(|\.fixme\s*\(|console\./)
  })

  for (const roteiro of roteiros.filter((r) => r.nome !== AJUDANTE)) {
    describe(roteiro.nome, () => {
      it('nao pula, nao isola e nao marca teste como falha esperada', () => {
        assert.doesNotMatch(roteiro.texto, /\.(skip|fixme|only|fail)\s*\(/)
      })

      it('nao le o ambiente nem imprime nada', () => {
        assert.doesNotMatch(roteiro.texto, /process\.env|console\./)
      })

      it('nao preenche campo de senha (quem entra e o ajudante)', () => {
        assert.doesNotMatch(roteiro.texto, /senha|password/i)
      })
    })
  }
})

/** Recorta do YAML o bloco de um job pelo recuo. */
function blocoDoJob(texto, chave) {
  const linhas = texto.split(/\r?\n/)
  const inicio = linhas.indexOf(`  ${chave}:`)
  assert.ok(inicio >= 0, `job ${chave} nao encontrado`)
  const bloco = [linhas[inicio]]
  for (let i = inicio + 1; i < linhas.length; i += 1) {
    if (/^ {0,2}\S/.test(linhas[i])) break
    bloco.push(linhas[i])
  }
  return bloco.join('\n')
}

/** Divide o bloco de um job em passos (`      - name: ...`). */
function passosDoJob(bloco) {
  const passos = []
  for (const linha of bloco.split('\n')) {
    if (/^ {6}- /.test(linha)) passos.push({ nome: linha.replace(/^ {6}- (name: )?/, '').trim(), texto: '' })
    if (passos.length > 0) passos[passos.length - 1].texto += `${linha}\n`
  }
  return passos
}

describe(`job "${NOME_DO_JOB}" no workflow real`, () => {
  const texto = readFileSync(WORKFLOW, 'utf8')
  const job = blocoDoJob(texto, 'navegador-preview-pr')
  const passos = passosDoJob(job)
  const passo = (nome) => {
    const achado = passos.find((p) => p.nome === nome)
    assert.ok(achado, `passo "${nome}" sumiu`)
    return achado
  }

  it('depende do provisionamento e nunca fica pulado', () => {
    assert.match(job, new RegExp(`\\n    name: ${NOME_DO_JOB}\\n`))
    assert.match(job, /\n    needs: provisionar\n/)
    assert.match(job, /\n    if: always\(\)\n/)
    const guarda = passos[0]
    assert.equal(guarda.nome, 'Falhar se as contas ficticias nao ficaram prontas')
    assert.match(guarda.texto, /if: needs\.provisionar\.result != 'success'/)
    assert.match(guarda.texto, /exit 1/)
  })

  it('permissoes so de leitura', () => {
    const permissoes = job.match(/\n    permissions:\n((?: {6}.*\n| *#.*\n)+)/)?.[1] ?? ''
    const concedidas = permissoes.split('\n').filter((l) => /^ {6}[a-z-]+:/.test(l)).map((l) => l.trim())
    assert.deepEqual(concedidas.sort(), ['checks: read', 'contents: read', 'deployments: read', 'pull-requests: read'])
  })

  it('nao recebe token do Supabase nem da Vercel, e o unico segredo e a senha', () => {
    assert.doesNotMatch(job, /SUPABASE_ACCESS_TOKEN|VERCEL|service_role|SERVICE_ROLE/i)
    assert.deepEqual(job.match(/secrets\.[A-Z_]+/g), [`secrets.${SENHA}`])
  })

  it('a senha so existe no passo do Playwright, depois do npm ci', () => {
    const comSenha = passos.filter((p) => p.texto.includes(SENHA)).map((p) => p.nome)
    assert.deepEqual(comSenha, ['Rodar os roteiros no preview desta PR'])
    assert.ok(passos.findIndex((p) => p.nome === 'Instalar dependencias') < passos.findIndex((p) => p.nome === comSenha[0]))
    assert.match(passo('Rodar os roteiros no preview desta PR').texto, /npx playwright test --config playwright\.preview-pr\.config\.ts/)
  })

  it('o token do GitHub so existe no passo que espera o preview', () => {
    const comToken = passos.filter((p) => /github\.token|GITHUB_TOKEN/.test(p.texto)).map((p) => p.nome)
    assert.deepEqual(comToken, ['Esperar o preview desta PR apontar para o banco dela'])
    assert.match(passo('Buscar o codigo desta PR').texto, /persist-credentials: false/)
  })

  it('o resumo roda mesmo com falha e o artefato leva so o error-context.md', () => {
    assert.match(passo('Resumir perfis e resultados').texto, /if: always\(\) && steps\.pronto\.outcome == 'success'/)
    const artefato = passo('Guardar a foto da tela quando o navegador falhar').texto
    assert.match(artefato, /if: failure\(\)/)
    assert.match(artefato, /path: test-results\/preview-pr\/saida\/\*\*\/error-context\.md\n/)
    assert.match(artefato, /retention-days: 7/)
  })

  it('o provisionamento publica endereco e commit para o navegador', () => {
    const provisionar = blocoDoJob(texto, 'provisionar')
    assert.match(provisionar, /supabase_url: \$\{\{ steps\.banco\.outputs\.url \}\}/)
    assert.match(provisionar, /head_sha: \$\{\{ steps\.banco\.outputs\.head_sha \}\}/)
    assert.match(job, /ref: \$\{\{ needs\.provisionar\.outputs\.head_sha \}\}/)
  })
})

// O passo "Publicar o endereco do banco desta PR" decide o que sai do job que
// tem o token do Supabase. Aqui o bloco `run` DE VERDADE e recortado do YAML e
// executado no bash, com um `supabase` falso no PATH. So a fonte muda.
const PASSO_DO_BANCO = 'Publicar o endereco do banco desta PR'
const REF_DA_PR = 'mbpemdsytixovtvyiyro'
const CHAVE_FALSA = 'sb_secret_chaveFalsaQueNaoPodeSair'
const SHA = 'c'.repeat(40)

function blocoRun(nomeDoPasso) {
  const linhas = readFileSync(WORKFLOW, 'utf8').split(/\r?\n/)
  const recuo = (linha) => linha.length - linha.trimStart().length
  const inicio = linhas.findIndex((linha) => linha.trim() === `- name: ${nomeDoPasso}`)
  assert.ok(inicio >= 0, `passo "${nomeDoPasso}" nao encontrado`)
  let i = inicio + 1
  while (i < linhas.length && linhas[i].trim() !== 'run: |') i += 1
  assert.ok(i < linhas.length, 'passo sem bloco run')
  const recuoDoRun = recuo(linhas[i])
  const corpo = []
  for (i += 1; i < linhas.length; i += 1) {
    if (linhas[i].trim() && recuo(linhas[i]) <= recuoDoRun) break
    corpo.push(linhas[i])
  }
  const base = Math.min(...corpo.filter((linha) => linha.trim()).map(recuo))
  return corpo.map((linha) => linha.slice(base)).join('\n').trimEnd() + '\n'
}

function publicarBanco({ saidaDaCli, falhaDaCli = false, sha = SHA }) {
  const pasta = mkdtempSync(join(tmpdir(), 'supabase-falso-'))
  try {
    const saidaFalsa = join(pasta, 'saida.env')
    writeFileSync(saidaFalsa, saidaDaCli)
    const registro = join(pasta, 'chamadas.txt')
    const falso = join(pasta, 'supabase')
    writeFileSync(falso, [
      '#!/usr/bin/env bash',
      'printf "%s\\n" "$*" >> "$SUPABASE_FALSO_REGISTRO"',
      '[ -n "${SUPABASE_FALSO_FALHA:-}" ] && { echo "erro da cli" >&2; exit 1; }',
      'cat "$SUPABASE_FALSO_SAIDA"',
      '',
    ].join('\n'))
    chmodSync(falso, 0o755)
    const saidaDoPasso = join(pasta, 'github_output')
    writeFileSync(saidaDoPasso, '')

    const env = {}
    for (const [chave, valor] of Object.entries(process.env)) {
      if (chave.toUpperCase() !== 'PATH') env[chave] = valor
    }
    Object.assign(env, {
      PATH: `${pasta}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
      GIT_BRANCH: 'test/canario',
      PR_HEAD_SHA: sha,
      GITHUB_OUTPUT: saidaDoPasso,
      SUPABASE_FALSO_REGISTRO: registro,
      SUPABASE_FALSO_SAIDA: saidaFalsa,
      SUPABASE_FALSO_FALHA: falhaDaCli ? '1' : '',
    })
    const execucao = spawnSync('bash', ['-c', blocoRun(PASSO_DO_BANCO)], { env, encoding: 'utf8' })
    assert.ifError(execucao.error)
    return {
      status: execucao.status,
      log: `${execucao.stdout}${execucao.stderr}`,
      saida: readFileSync(saidaDoPasso, 'utf8'),
      chamadas: existsSync(registro) ? readFileSync(registro, 'utf8').split('\n').filter(Boolean) : [],
    }
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

const envDaCli = (url) => [
  'POSTGRES_URL="postgresql://postgres.x:senhaFalsa@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"',
  `SUPABASE_SERVICE_ROLE_KEY="${CHAVE_FALSA}"`,
  url,
  '',
].join('\n')

describe(`passo "${PASSO_DO_BANCO}" executado`, () => {
  it('publica so o endereco e o commit, sem credencial em saida nem log', () => {
    for (const linha of [`SUPABASE_URL="https://${REF_DA_PR}.supabase.co"`, `SUPABASE_URL=https://${REF_DA_PR}.supabase.co`, `SUPABASE_URL='https://${REF_DA_PR}.supabase.co'`]) {
      const r = publicarBanco({ saidaDaCli: envDaCli(linha) })
      assert.equal(r.status, 0, r.log)
      assert.equal(r.saida, `url=https://${REF_DA_PR}.supabase.co\nhead_sha=${SHA}\n`)
      assert.doesNotMatch(`${r.saida}${r.log}`, /senhaFalsa|chaveFalsa/)
      assert.deepEqual(r.chamadas, ['--experimental branches get test/canario --project-ref gohluceldchoitihrimw -o env'])
    }
  })

  it('recusa producao, compartilhado, formato estranho e ausencia sem publicar nada', () => {
    for (const linha of [
      'SUPABASE_URL="https://gohluceldchoitihrimw.supabase.co"',
      'SUPABASE_URL="https://tuqzhjsbodoycjbmwuqm.supabase.co"',
      `SUPABASE_URL="https://${REF_DA_PR}.supabase.co.evil.com"`,
      `SUPABASE_URL="http://${REF_DA_PR}.supabase.co"`,
      `SUPABASE_URL="https://${REF_DA_PR}.supabase.co/"`,
      'SUPABASE_URL=""',
      '',
    ]) {
      const r = publicarBanco({ saidaDaCli: envDaCli(linha) })
      assert.equal(r.status, 1, linha)
      assert.equal(r.saida, '', linha)
      assert.doesNotMatch(r.log, /senhaFalsa|chaveFalsa/, linha)
    }
  })

  it('falha da CLI ou commit invalido nao publica nada', () => {
    const falha = publicarBanco({ saidaDaCli: envDaCli(`SUPABASE_URL=https://${REF_DA_PR}.supabase.co`), falhaDaCli: true })
    assert.notEqual(falha.status, 0)
    assert.equal(falha.saida, '')
    for (const sha of ['', 'abc', 'C'.repeat(40)]) {
      const r = publicarBanco({ saidaDaCli: envDaCli(`SUPABASE_URL=https://${REF_DA_PR}.supabase.co`), sha })
      assert.equal(r.status, 1, sha)
      assert.equal(r.saida, '', sha)
    }
  })
})
