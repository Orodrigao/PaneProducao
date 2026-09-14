import { expect, test } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

// O smoke obrigatório do repositório roda no banco Preview compartilhado, que
// espelha a main e ainda não recebeu a migration desta PR. A separação nova
// entre operador e planejador é provada no pgTAP contra a história da branch;
// aqui confirmamos a tela real para um perfil autorizado e a rota negada.
const authorizedEmail = 'rodrigao+teste@gmail.com'
const blockedEmail = 'rodrigao+teste-vendas-ja@gmail.com'

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

test('perfil autorizado carrega a programacao do Forno', async ({ page }) => {
  await enterWithPreviewAccount(page, authorizedEmail)
  await page.goto('/forno')

  await expect(page.locator('.ps-loading')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText('Pane & Salute', { exact: true })).toBeVisible()
  await expect(page.getByText('Forno', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Não foi possível carregar o forno.', { exact: true })).toHaveCount(0)
})

test('perfil sem permissao continua fora do Forno', async ({ page }) => {
  await enterWithPreviewAccount(page, blockedEmail)
  await page.goto('/forno')

  await expect(page).not.toHaveURL(/\/forno(?:[?#]|$)/, { timeout: 15_000 })
  await expect(page.getByText('Forno', { exact: true })).toHaveCount(0)
})
