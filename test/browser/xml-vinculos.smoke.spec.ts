import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { entrarComSessaoGuardada } from './apoio/sessao'

test.use({ browserName: 'chromium', channel: 'chrome' })

test('Financeiro JC consulta o uso do cadastro e escolhe categoria controlada na NF fictícia', async ({ page }) => {
  await entrarComSessaoGuardada(page, 'rodrigao+teste-financeiro-jc@gmail.com')

  await page.goto('/contas-pagar')
  await page.getByRole('button', { name: 'Importar XML da NF-e' }).click()
  const xml = readFileSync(resolve(process.cwd(), 'test/fixtures/nfe/sem-acrescimos.xml'), 'utf8')
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
