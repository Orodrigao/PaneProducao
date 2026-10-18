import { expect, test, type Page } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

// O defeito da issue 438 só aparece entre meia-noite e 05:59: fora dessa faixa
// voltar 6 horas ainda cai no mesmo dia, e a tela abre certo por acidente.
// Rodar este arquivo de dia, sem mexer no relógio, não prova nada — por isso
// aqui o relógio do navegador é fixado na madrugada com `page.clock`.
//
// O fuso do contexto também é fixado. É o fuso do aparelho que dispara o
// defeito: em UTC a conta antiga acertava, e é exatamente por isso que o CI
// nunca reclamou.

// Navegador e fuso ficam no topo: o Playwright recusa trocá-los dentro de um
// `describe`, porque isso obrigaria um worker novo. Só a sessão muda por bloco.
test.use({
  browserName: 'chromium',
  channel: 'chrome',
  timezoneId: 'America/Sao_Paulo',
})

const previewAccounts = {
  admin: 'rodrigao+teste@gmail.com',
  romaneioEx: 'rodrigao+teste-romaneio-ex@gmail.com',
} as const

// Cada caso começa com a sessão guardada da conta (test/browser/apoio/sessao.ts):
// seis logins de senha seguidos contra o Preview compartilhado esbarravam no
// limite de tentativas do Supabase Auth, e a suíte falhava na porta em vez de
// falhar no que ela prova.

// Quarta-feira, 01:30 da manhã em São Paulo. Com a conta antiga o sistema
// respondia terça, 22/09 — e o romaneio nascia com a data de ontem.
const MADRUGADA = new Date('2026-09-23T04:30:00.000Z')
const HOJE_NA_PADARIA = '2026-09-23'
const ONTEM = '2026-09-22'

async function abrirComRelogioNaMadrugada(page: Page, rota: string) {
  // `setFixedTime` congela `Date.now()` sem congelar os timers, então o React
  // continua rodando normalmente enquanto o aplicativo acha que é 01:30.
  await page.clock.setFixedTime(MADRUGADA)
  await page.goto(rota)
}

test.describe('o dia padrão das telas que gravam registro', () => {
  test.beforeEach(({ page }) => entrarComSessaoGuardada(page, previewAccounts.admin))

  test('Romaneio abre o dia de hoje, e não o de ontem', async ({ page }) => {
    await abrirComRelogioNaMadrugada(page, '/romaneio')

    // O cabeçalho diz que dia a tela considera "hoje".
    await expect(page.getByText('Hoje · 23/09/2026').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Hoje · 22/09/2026')).toHaveCount(0)

    // E o romaneio novo nasce com essa data no campo, que é o valor gravado.
    await page.getByRole('button', { name: /Novo romaneio/i }).first().click()
    const campoData = page.locator('input[type="date"]').first()
    await expect(campoData).toHaveValue(HOJE_NA_PADARIA, { timeout: 30_000 })
    await expect(campoData).not.toHaveValue(ONTEM)
  })

  test('Sobras abre o fechamento no dia de hoje', async ({ page }) => {
    await abrirComRelogioNaMadrugada(page, '/sobras')

    // O cabeçalho da tela vem de `todayLabel()`. Com o relógio antigo ele diria
    // "terça, 22/09" às 01:30 de uma quarta.
    await expect(page.getByText('quarta, 23/09').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('terça, 22/09')).toHaveCount(0)

    await page.getByRole('button', { name: /Registrar Sobras/i }).first().click()

    const campoData = page.locator('#leftover-closing-date')
    await expect(campoData).toHaveValue(HOJE_NA_PADARIA, { timeout: 30_000 })
    // O campo também não deixa escolher depois de hoje; o limite tem de andar junto.
    await expect(campoData).toHaveAttribute('max', HOJE_NA_PADARIA)
  })

  test('Fechamento de Caixa abre no dia de hoje', async ({ page }) => {
    await abrirComRelogioNaMadrugada(page, '/fechamento-caixa')

    const campoData = page.locator('input[type="date"]').first()
    await expect(campoData).toHaveValue(HOJE_NA_PADARIA, { timeout: 30_000 })
  })

  // A tela inicial não mostra data, mostra o aviso de prazo — e ele saía de
  // `nowBrasilia` do mesmo jeito. Sem este caso, o "Menos de 0h" da madrugada
  // passa com toda a suíte verde.
  test('a tela inicial não anuncia prazo estourado de madrugada', async ({ page }) => {
    await abrirComRelogioNaMadrugada(page, '/')

    // 01:30 → faltam 2h30 para as 4h, o que arredonda para 3 e fica fora da
    // faixa de alerta. O card diz "Pedido aberto", que é a verdade: o
    // `checkDeadline` deste sistema nunca fecha pedido.
    await expect(page.getByText('Pedido aberto').first()).toBeVisible({ timeout: 30_000 })
    // "Menos de 0h" era o texto do defeito e não pode voltar.
    await expect(page.getByText('Menos de 0h')).toHaveCount(0)
    await expect(page.getByText('Prazo encerrando')).toHaveCount(0)
  })

  // Campo com a data certa na tela ainda não é a data que chega ao banco. Este
  // caso não grava nada: ele escuta a conversa com o banco e confere o dia que
  // o aplicativo pede. Gravar de verdade exigiria marcar um produto como de
  // prateleira no Banco Preview compartilhado, que serve todas as PRs, e essa
  // marca ficaria lá depois do teste.
  test('a consulta ao banco pergunta pelo dia de hoje', async ({ page }) => {
    const consultas: string[] = []
    page.on('request', request => {
      if (request.url().includes('/rest/v1/')) consultas.push(request.url())
    })

    await abrirComRelogioNaMadrugada(page, '/sobras')
    await expect(page.getByText('quarta, 23/09').first()).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /Prateleira \(fim do dia\)/i }).click()

    // A tela consulta `record_date=eq.<hoje>` e, de propósito, também
    // `eq.<ontem>` — o baseline do dia anterior. Por isso a prova é a presença
    // de HOJE, não a ausência de ontem: com o relógio antigo, às 01:30 o par
    // viraria 22/09 e 21/09, e 23/09 não apareceria em consulta nenhuma.
    await expect
      .poll(
        () => consultas.filter(url => url.includes(`record_date=eq.${HOJE_NA_PADARIA}`)).length,
        { timeout: 30_000, message: 'Nenhuma consulta ao banco pediu o dia de hoje.' },
      )
      .toBeGreaterThan(0)
  })
})

// A matriz de docs/regras/FECHAMENTO.md pede ao menos um perfil restrito, não só administrador.
// Quem monta romaneio da Exposição de madrugada é justamente quem sofria o defeito.
test.describe('perfil restrito', () => {
  test.beforeEach(({ page }) => entrarComSessaoGuardada(page, previewAccounts.romaneioEx))

  test('Romaneio da Exposição também abre no dia de hoje', async ({ page }) => {
    await abrirComRelogioNaMadrugada(page, '/romaneio')

    await expect(page.getByText('Hoje · 23/09/2026').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Hoje · 22/09/2026')).toHaveCount(0)
  })
})
