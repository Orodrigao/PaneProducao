import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LIMITE_SCRIPTS,
  NOME_CHECK_APONTAR,
  bancosDoPreview,
  decidirBundle,
  decidirCheckApontar,
  esperarPreviewPronto,
  fetchDoGithub,
  refsSupabaseNoTexto,
  scriptsDaPagina,
  validarUrlBancoDaPr,
} from './preview-pr-pronto.mjs'

const REPO = 'dono/repo'
const HEAD = 'a'.repeat(40)
const OUTRO_SHA = 'b'.repeat(40)
const PRODUCAO = 'gohluceldchoitihrimw'
const COMPARTILHADO = 'tuqzhjsbodoycjbmwuqm'
const DA_PR = 'mbpemdsytixovtvyiyro'
const URL_DA_PR = `https://${DA_PR}.supabase.co`
const PREVIEW = 'https://pane-producao-3enx5z0yg-orodrigaos-projects.vercel.app'
const TOKEN = 'ghs_tokenFalsoQueNaoPodeSairDoGithub'

const checkApontar = (extra = {}) => ({
  name: NOME_CHECK_APONTAR,
  app: { slug: 'github-actions' },
  head_sha: HEAD,
  status: 'completed',
  conclusion: 'success',
  ...extra,
})
const lista = (...checks) => ({ total_count: checks.length, check_runs: checks })

describe('validarUrlBancoDaPr', () => {
  it('aceita so o formato exato de um projeto Supabase', () => {
    assert.deepEqual(validarUrlBancoDaPr(URL_DA_PR), { ok: true, ref: DA_PR, url: URL_DA_PR })
    for (const ruim of [undefined, '', `${URL_DA_PR}/`, `http://${DA_PR}.supabase.co`, `https://${DA_PR}.supabase.co.evil.com`,
      `https://${DA_PR}x.supabase.co`, `https://${DA_PR.toUpperCase()}.supabase.co`, ` ${URL_DA_PR}`]) {
      assert.equal(validarUrlBancoDaPr(ruim).ok, false, String(ruim))
    }
  })

  it('recusa producao e o banco compartilhado', () => {
    assert.match(validarUrlBancoDaPr(`https://${PRODUCAO}.supabase.co`).motivo, /PRODUCAO/)
    assert.match(validarUrlBancoDaPr(`https://${COMPARTILHADO}.supabase.co`).motivo, /compartilhado/)
  })
})

describe('decidirCheckApontar', () => {
  it('aprova so o check do Actions, com esse nome e neste commit', () => {
    assert.equal(decidirCheckApontar(lista(checkApontar()), HEAD).situacao, 'aprovado')
  })

  it('lista ausente ou truncada recusa na hora', () => {
    assert.equal(decidirCheckApontar({}, HEAD).situacao, 'recusar')
    assert.equal(decidirCheckApontar(undefined, HEAD).situacao, 'recusar')
    assert.equal(decidirCheckApontar({ total_count: 2, check_runs: [checkApontar()] }, HEAD).situacao, 'recusar')
  })

  it('lista vazia, check de outro commit (antigo) ou homonimo de outro app e espera, nunca aprova', () => {
    assert.equal(decidirCheckApontar(lista(), HEAD).situacao, 'aguardar')
    assert.equal(decidirCheckApontar(lista(checkApontar({ head_sha: OUTRO_SHA })), HEAD).situacao, 'aguardar')
    assert.equal(decidirCheckApontar(lista(checkApontar({ app: { slug: 'impostor' } })), HEAD).situacao, 'aguardar')
    assert.equal(decidirCheckApontar(lista(checkApontar({ app: undefined })), HEAD).situacao, 'aguardar')
  })

  it('rodando espera; falha, cancelado ou concluido sem conclusao recusa', () => {
    assert.equal(decidirCheckApontar(lista(checkApontar({ status: 'in_progress', conclusion: null })), HEAD).situacao, 'aguardar')
    for (const conclusion of ['failure', 'cancelled', 'timed_out', null, undefined]) {
      assert.equal(decidirCheckApontar(lista(checkApontar({ conclusion })), HEAD).situacao, 'recusar', String(conclusion))
    }
  })

  it('reprovacao vence sucesso na mesma lista', () => {
    assert.equal(decidirCheckApontar(lista(checkApontar(), checkApontar({ conclusion: 'failure' })), HEAD).situacao, 'recusar')
  })
})

describe('decidirBundle', () => {
  it('aprova so quando o bundle cita o banco desta PR e nenhum outro', () => {
    assert.equal(decidirBundle(new Set([DA_PR]), DA_PR).situacao, 'aprovado')
  })

  it('producao recusa na hora, mesmo ao lado do banco certo', () => {
    assert.equal(decidirBundle(new Set([PRODUCAO]), DA_PR).situacao, 'recusar')
    assert.equal(decidirBundle(new Set([DA_PR, PRODUCAO]), DA_PR).situacao, 'recusar')
  })

  it('bundle vazio, compartilhado ou banco de outra PR espera o redeploy', () => {
    assert.equal(decidirBundle(new Set(), DA_PR).situacao, 'aguardar')
    assert.equal(decidirBundle(undefined, DA_PR).situacao, 'aguardar')
    assert.match(decidirBundle(new Set([COMPARTILHADO]), DA_PR).motivo, /compartilhado/)
    assert.equal(decidirBundle(new Set([DA_PR, 'zzzzzzzzzzzzzzzzzzzz']), DA_PR).situacao, 'aguardar')
  })
})

describe('refsSupabaseNoTexto e scriptsDaPagina', () => {
  it('acha todos os projetos citados, sem repetir', () => {
    const texto = `a="https://${DA_PR}.supabase.co";b="https://${DA_PR}.supabase.co/rest";c="https://${COMPARTILHADO}.supabase.co"`
    assert.deepEqual([...refsSupabaseNoTexto(texto)].sort(), [DA_PR, COMPARTILHADO].sort())
    assert.equal(refsSupabaseNoTexto(undefined).size, 0)
  })

  it('so devolve scripts do proprio preview sob /_next/static/', () => {
    const html = [
      '<script src="/_next/static/chunks/a.js" async=""></script>',
      `<script src="${PREVIEW}/_next/static/chunks/b.js"></script>`,
      '<script src="https://vercel.live/_next-live/feedback.js"></script>',
      '<script src="/outra/c.js"></script>',
      '<script src="/_next/static/chunks/a.js"></script>',
    ].join('')
    assert.deepEqual(scriptsDaPagina(html, PREVIEW), [
      `${PREVIEW}/_next/static/chunks/a.js`,
      `${PREVIEW}/_next/static/chunks/b.js`,
    ])
  })

  it('pagina com scripts demais e anomalia e reprova', () => {
    const html = Array.from({ length: LIMITE_SCRIPTS + 1 }, (_, i) => `<script src="/_next/static/chunks/${i}.js"></script>`).join('')
    assert.throws(() => scriptsDaPagina(html, PREVIEW), /acima do limite/)
  })
})

describe('fetchDoGithub', () => {
  it('manda o token so para a API do GitHub', async () => {
    const pedidos = []
    const github = fetchDoGithub({ githubToken: TOKEN, fetchImpl: async (url, init) => { pedidos.push({ url, init }); return { ok: true } } })
    await github('https://api.github.com/repos/x', { headers: { Accept: 'x' } })
    assert.equal(pedidos[0].init.headers.Authorization, `Bearer ${TOKEN}`)
    assert.equal(pedidos[0].init.headers.Accept, 'x')
    assert.throws(() => github(`${PREVIEW}/login`), /recusado/)
    assert.throws(() => github('https://api.github.com.evil.com/x'), /recusado/)
    assert.equal(pedidos.length, 1)
  })
})

/**
 * GitHub e Vercel de mentira. `voltas` e a sequencia de estados que cada volta
 * enxerga: check de apontar, deployments do commit e o bundle publicado.
 */
function mundoFalso(voltas) {
  let volta = 0
  const pedidos = []
  const responder = (corpo, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
    text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
  })
  const atual = () => voltas[Math.min(volta, voltas.length - 1)]
  const fetchImpl = async (url, init = {}) => {
    pedidos.push({ url: String(url), auth: init.headers?.Authorization })
    const u = new URL(url)
    const estado = atual()
    if (u.hostname === 'api.github.com') {
      if (u.pathname.endsWith('/check-runs')) return responder(estado.checks)
      if (u.pathname.endsWith('/deployments')) return responder(estado.deployments ?? [])
      if (/\/deployments\/1\/statuses$/.test(u.pathname)) return responder(estado.statuses)
      return responder({}, 404)
    }
    if (u.origin === PREVIEW) {
      if (u.pathname === '/login') return responder('<script src="/_next/static/chunks/app.js"></script>')
      if (u.pathname === '/_next/static/chunks/app.js') return responder(estado.bundle)
    }
    return responder('', 404)
  }
  return {
    pedidos,
    esperar: (extra = {}) => esperarPreviewPronto({
      repositorio: REPO,
      prNumber: '7',
      headSha: HEAD,
      supabaseUrl: URL_DA_PR,
      githubToken: TOKEN,
      fetchImpl,
      now: () => volta * 20_000,
      sleep: async () => { volta += 1 },
      timeoutMs: 100_000,
      log: () => {},
      ...extra,
    }),
  }
}

const deployVerde = {
  deployments: [{ id: 1, sha: HEAD }],
  statuses: [{ state: 'success', environment_url: PREVIEW, creator: { login: 'vercel[bot]' } }],
}
const bundle = (ref) => `const u="https://${ref}.supabase.co";`

describe('esperarPreviewPronto', () => {
  it('espera check, deploy e redeploy, e so aprova com o banco desta PR no bundle', async () => {
    const mundo = mundoFalso([
      { checks: lista() },
      { checks: lista(checkApontar({ status: 'in_progress', conclusion: null })) },
      { checks: lista(checkApontar()), deployments: [{ id: 1, sha: HEAD }], statuses: [{ state: 'in_progress' }] },
      { checks: lista(checkApontar()), ...deployVerde, bundle: bundle(COMPARTILHADO) },
      { checks: lista(checkApontar()), ...deployVerde, bundle: bundle(DA_PR) },
    ])
    assert.deepEqual(await mundo.esperar(), { baseUrl: PREVIEW, supabaseUrl: URL_DA_PR })
    // O token do GitHub nunca vai para o preview.
    const aoPreview = mundo.pedidos.filter((p) => p.url.startsWith(PREVIEW))
    assert.ok(aoPreview.length > 0)
    assert.ok(aoPreview.every((p) => p.auth === undefined))
    assert.ok(mundo.pedidos.filter((p) => p.url.startsWith('https://api.github.com/')).every((p) => p.auth === `Bearer ${TOKEN}`))
  })

  it('bundle com banco errado ate o fim do prazo reprova com o motivo', async () => {
    const mundo = mundoFalso([{ checks: lista(checkApontar()), ...deployVerde, bundle: bundle(COMPARTILHADO) }])
    await assert.rejects(mundo.esperar(), /nao ficou pronto.*compartilhado/)
  })

  it('check que nunca aparece reprova no prazo', async () => {
    const mundo = mundoFalso([{ checks: lista() }])
    await assert.rejects(mundo.esperar(), /ainda nao apareceu/)
  })

  it('producao no bundle reprova na primeira volta, sem esperar', async () => {
    const mundo = mundoFalso([{ checks: lista(checkApontar()), ...deployVerde, bundle: bundle(PRODUCAO) }])
    await assert.rejects(mundo.esperar(), /PRODUCAO/)
    assert.equal(mundo.pedidos.filter((p) => p.url.includes('/check-runs?')).length, 1)
  })

  it('check de apontar reprovado ou lista truncada reprova na hora', async () => {
    await assert.rejects(mundoFalso([{ checks: lista(checkApontar({ conclusion: 'failure' })) }]).esperar(), /failure/)
    await assert.rejects(mundoFalso([{ checks: { total_count: 101, check_runs: [checkApontar()] } }]).esperar(), /incompleta/)
  })

  it('link fora do padrao da Vercel nunca e aceito', async () => {
    const mundo = mundoFalso([{
      checks: lista(checkApontar()),
      deployments: [{ id: 1, sha: HEAD }],
      statuses: [{ state: 'success', environment_url: 'https://pane-producao-x-outro-time.vercel.app', creator: { login: 'vercel[bot]' } }],
      bundle: bundle(DA_PR),
    }])
    await assert.rejects(mundo.esperar(), /nao ficou pronto/)
    assert.ok(mundo.pedidos.every((p) => !p.url.includes('outro-time')))
  })

  it('entrada invalida reprova antes de qualquer pedido', async () => {
    for (const extra of [
      { supabaseUrl: `https://${PRODUCAO}.supabase.co` },
      { supabaseUrl: `https://${COMPARTILHADO}.supabase.co` },
      { supabaseUrl: '' },
      { headSha: 'abc' },
      { prNumber: '7 ' },
      { githubToken: '' },
      { repositorio: '' },
    ]) {
      const mundo = mundoFalso([{ checks: lista(checkApontar()), ...deployVerde, bundle: bundle(DA_PR) }])
      await assert.rejects(mundo.esperar(extra), undefined, JSON.stringify(extra))
      assert.equal(mundo.pedidos.length, 0, JSON.stringify(extra))
    }
  })
})

describe('bancosDoPreview', () => {
  it('script do app que nao responde reprova em vez de ignorar', async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/login')) return { ok: true, status: 200, text: async () => '<script src="/_next/static/chunks/x.js"></script>' }
      return { ok: false, status: 404, text: async () => '' }
    }
    await assert.rejects(bancosDoPreview({ baseUrl: PREVIEW, fetchImpl }), /respondeu 404/)
  })

  it('pagina sem nenhum script do app reprova', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html></html>' })
    await assert.rejects(bancosDoPreview({ baseUrl: PREVIEW, fetchImpl }), /nenhum script/)
  })
})
