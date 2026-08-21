import { expect, test } from '@playwright/test'

test.use({
  browserName: 'chromium',
  channel: 'chrome',
})

// Login espelhado de auth.smoke.spec.ts de propósito: aquele arquivo pertence
// à frente de contas a pagar e importar de um spec acoplaria os dois.
const financeiroJc = 'rodrigao+teste-financeiro-jc@gmail.com'

const slowPreviewDataTimeoutMs = 15_000

async function enterWithPreviewAccount(
  page: import('@playwright/test').Page,
  email: string,
) {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas ficticias existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill(email)
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })
}

// Fase 0 de contas a receber: somente leitura, para o cenario compartilhado do
// Preview sobreviver a duas execucoes seguidas sem reconstruir o banco.
test('Financeiro JC ve o cenario semeado de Pedidos PJ e o total do relatorio', async ({ page }) => {
  await enterWithPreviewAccount(page, financeiroJc)

  await page.goto('/pedidos-pj')

  // Aba "Em aberto" e a padrao: os dois pedidos abertos do seed, com valor.
  const bistroAberto = page.locator('.pj-order-row', { hasText: '[TESTE] Bistro Cliente PJ' })
  await expect(bistroAberto).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(bistroAberto).toContainText('R$ 403.20')

  const cafeAberto = page.locator('.pj-order-row', { hasText: '[TESTE] Cafe Cliente PJ' })
  await expect(cafeAberto).toBeVisible()
  await expect(cafeAberto).toContainText('R$ 400.50')

  // O Historico guarda o enviado e o cancelado, cada um com seu selo.
  await page.getByRole('button', { name: /Histórico/ }).click()

  const enviado = page.locator('.pj-order-row.is-dispatched', { hasText: '[TESTE] Bistro Cliente PJ' })
  await expect(enviado).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  await expect(enviado).toContainText('R$ 76.80')

  await expect(
    page.locator('.pj-order-row.is-cancelled', { hasText: '[TESTE] Cafe Cliente PJ' }),
  ).toBeVisible()

  // Abrir o enviado mostra selo e itens: o dado que entrou volta a aparecer.
  await enviado.click()
  await expect(page.getByRole('heading', { name: /Bistro Cliente PJ/ })).toBeVisible()
  await expect(page.getByText('ENVIADO', { exact: true })).toBeVisible()
  await expect(page.getByText('[TESTE] Brioche PJ').first()).toBeVisible()

  // Relatorio de Vendas PJ: o preset padrao vai de 29 dias atras ate hoje e
  // soma pela data de entrega. Os pedidos em aberto entregam DEPOIS DE AMANHA —
  // de proposito, e nao amanha: a janela deste relatorio nasce do relogio do
  // NAVEGADOR, que no CI conta em UTC, enquanto o seed conta na hora da
  // padaria. Depois das 21h os dois discordam por um dia, e um pedido de
  // "amanha" cairia dentro da janela (licao seed-com-hoje-vence-a-meia-noite). Sobram o enviado (76,80) e o entregue de
  // cliente sem prazo (96,00) = 172,80; o cancelado nunca entra.
  await page.goto('/relatorios/pj')
  await expect(page.getByRole('heading', { name: /Vendas PJ/ })).toBeVisible()
  await expect(page.getByText('Vendas totais')).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
  // O total aparece no cartao, no resumo e na tabela: basta encontra-lo uma vez.
  await expect(page.getByText(/172,80/).first()).toBeVisible({ timeout: slowPreviewDataTimeoutMs })
})
