import { expect, test } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

const financeiroJc = 'rodrigao+teste-financeiro-jc@gmail.com'
const vendasJa = 'rodrigao+teste-vendas-ja@gmail.com'

const slowPreviewDataTimeoutMs = 15_000

// Fase 2 de contas a receber: somente leitura, para o cenario compartilhado do
// Preview sobreviver a duas execucoes seguidas sem reconstruir o banco. Lancar
// e baixar sao testados por supabase/tests/contas_a_receber.test.sql, que roda
// dentro de uma transacao e nao suja o Preview.
test('Financeiro JC ve as cobrancas semeadas, com atrasada e a vencer separadas', async ({ page }) => {
  await entrarComSessaoGuardada(page, financeiroJc)

  await page.goto('/contas-receber')

  await expect(page.getByText('Quem deve para a padaria')).toBeVisible({
    timeout: slowPreviewDataTimeoutMs,
  })

  const atrasada = page.locator('article', { hasText: 'cobranca atrasada' })
  await expect(atrasada).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(atrasada).toContainText('Atrasada')
  await expect(atrasada).toContainText('1.240,00')

  const aVencer = page.locator('article', { hasText: 'cobranca a vencer' })
  await expect(aVencer).toBeVisible()
  await expect(aVencer).toContainText('Vence em')

  // A atrasada vem antes da que ainda vai vencer: e a ordem em que a cobranca
  // precisa ser feita.
  const descricoes = await page.locator('article .ps-card-head small').allTextContents()
  const posicaoAtrasada = descricoes.findIndex(texto => texto.includes('cobranca atrasada'))
  const posicaoAVencer = descricoes.findIndex(texto => texto.includes('cobranca a vencer'))
  expect(posicaoAtrasada).toBeGreaterThanOrEqual(0)
  expect(posicaoAtrasada).toBeLessThan(posicaoAVencer)

  // A Elis encontra o que acabou de faturar sem perder a prioridade dos
  // atrasados na visualizacao completa.
  const busca = page.getByLabel('Buscar contas a receber')
  await busca.fill('cobranca a vencer')
  await expect(atrasada).toBeHidden()
  await expect(aVencer).toBeVisible()
  await expect(page.getByText(/1 de \d+ cobrança\(s\)/)).toBeVisible()

  await page.getByRole('button', { name: 'Limpar filtros' }).click()
  await expect(atrasada).toBeVisible()

  await page.getByLabel('Situação').selectOption('atrasadas')
  await expect(atrasada).toBeVisible()
  await expect(aVencer).toBeHidden()

  await page.getByRole('button', { name: 'Limpar filtros' }).click()
  await page.getByLabel('Faturamento').selectOption('ultimos_7_dias')
  await expect(aVencer).toBeVisible()
  await expect(atrasada).toBeHidden()

  await page.getByLabel('Faturamento').selectOption('hoje')
  const cobrancasDeHoje = page.locator('article')
  const quantidadeDeHoje = await cobrancasDeHoje.count()
  if (quantidadeDeHoje === 0) {
    await expect(page.getByText('Nenhuma cobrança encontrada com esses filtros.')).toBeVisible()
  } else {
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    for (let indice = 0; indice < quantidadeDeHoje; indice += 1) {
      await expect(cobrancasDeHoje.nth(indice)).toContainText(`Faturado em ${hoje}`)
    }
  }

  // O menu leva a tela: rota, permissao e RLS nao bastam se o link nao existe.
  await expect(page.locator('a[href="/contas-receber"]').first()).toBeAttached()
})

test('Vendas JA nao chega em Contas a receber', async ({ page }) => {
  await entrarComSessaoGuardada(page, vendasJa)
  await page.goto('/')

  // O menu do perfil ja montou (o Romaneio e dele): so entao a ausencia do link prova algo.
  await expect(page.locator('a[href="/romaneio"]').first()).toBeAttached({ timeout: slowPreviewDataTimeoutMs })
  await expect(page.locator('a[href="/contas-receber"]')).toHaveCount(0)

  await page.goto('/contas-receber')

  // Sem a permissao, a rota nao abre: o app devolve o usuario para a tela
  // inicial dele em vez de mostrar a lista.
  await expect(page).toHaveURL(/\/romaneio$/, { timeout: slowPreviewDataTimeoutMs })
  await expect(page.getByText('cobranca atrasada')).toHaveCount(0)
})
