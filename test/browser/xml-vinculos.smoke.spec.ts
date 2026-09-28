import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test.use({ browserName: 'chromium', channel: 'chrome' })

test('Financeiro JC consulta o uso do cadastro e escolhe categoria controlada na NF fictícia', async ({ page }) => {
  const password = process.env.SUPABASE_TEST_USER_PASSWORD
  test.skip(!password, 'A senha das contas fictícias existe somente no secret do GitHub.')

  await page.goto('/login')
  await page.getByPlaceholder('nome@paneesalute.com.br').fill('rodrigao+teste-financeiro-jc@gmail.com')
  await page.locator('input[type="password"]').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 })

  await page.goto('/contas-pagar')
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()
  const xml = readFileSync(new URL('../../fixtures/nfe/sem-acrescimos.xml', import.meta.url), 'utf8')
    .replace('INSUMO FICTICIO A', 'MANJERICAO')
  await page.locator('input[type="file"]').setInputFiles({ name: 'nota-ficticia.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) })

  const search = page.getByLabel('Procurar item-base para MANJERICAO')
  await expect(search).toBeVisible({ timeout: 15_000 })
  await search.fill('Manjericão')
  await page.getByRole('button', { name: /\[TESTE\] Manjericão/ }).first().click()
  await expect(page.getByText('Nenhuma ficha técnica atual usa este cadastro.').first()).toBeVisible()

  await page.getByRole('button', { name: 'Trocar' }).first().click()
  await search.fill('CADASTRO NOVO FICTICIO')
  await page.getByRole('button', { name: 'Cadastrar item novo' }).last().click()
  const category = page.getByText('Categoria', { exact: true }).last().locator('..').locator('select')
  await expect(category).toBeEnabled({ timeout: 15_000 })
  await expect(category.locator('option', { hasText: 'Insumos' })).toHaveCount(1)
  await expect(category.locator('option', { hasText: 'Revenda' })).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Categoria' })).toHaveCount(0)
})
