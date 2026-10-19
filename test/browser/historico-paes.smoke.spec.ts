import { expect, test } from '@playwright/test'

// Prova de apresentação com sessão e dados fictícios, totalmente interceptados.
// Não comprova RLS nem altera contas ou registros no banco.
for (const store of ['ex', 'jc'] as const) {
  test(`Histórico ${store} conserva pães de sábado e desativados ao consultar outra data`, async ({ page }) => {
    const userId = '00000000-0000-4000-8000-000000000099'
    const breads = [
      { id: 'daily', name: '[TESTE] Pão diário', days: [1, 2, 3, 4, 5, 6], active: true, is_pj: false },
      { id: 'saturday', name: '[TESTE] Pão de sábado', days: [6], active: true, is_pj: false },
      { id: 'inactive', name: '[TESTE] Pão desativado', days: [6], active: false, is_pj: false },
    ]
    const writes: string[] = []
    await page.clock.setFixedTime(new Date('2026-10-17T20:24:00Z'))
    await page.addInitScript(({ userId }) => {
      localStorage.setItem('sb-tuqzhjsbodoycjbmwuqm-auth-token', JSON.stringify({
        access_token: 'sessao-ficticia', refresh_token: 'renovacao-ficticia', expires_at: 2_000_000_000,
        token_type: 'bearer', user: { id: userId, email: 'teste@example.invalid', aud: 'authenticated' },
      }))
    }, { userId })
    await page.route('https://*.supabase.co/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() !== 'GET') writes.push(request.method())
      if (url.pathname.endsWith('/app_profiles')) return route.fulfill({ json: {
        user_id: userId, display_name: 'Pessoa fictícia', role: 'expedicao', active: true,
        allowed_routes: ['/'], store,
      } })
      if (url.pathname.endsWith('/breads')) return route.fulfill({ json: breads })
      if (url.pathname.endsWith('/orders')) {
        const selectedDate = url.searchParams.get('order_date')
        return route.fulfill({ json: selectedDate === 'eq.2026-10-17'
          ? breads.map((bread, i) => ({ store, bread_id: bread.id, quantity: [3, 7, 2][i], obs: '', order_date: '2026-10-17' }))
          : [] })
      }
      return route.fulfill({ json: [] })
    })
    await page.goto('/')
    await page.getByRole('tab', { name: 'Histórico', exact: true }).click()
    const date = page.locator('input[type="date"]')
    await date.fill('2026-10-17')
    for (const bread of breads) await expect(page.locator('.report-table')).toContainText(bread.name)
    await expect(page.locator('.report-table tbody tr').last()).toHaveText('Total12')
    await page.getByRole('button', { name: '↻ Atualizar' }).click()
    await expect(page.locator('.report-table tbody tr').last()).toHaveText('Total12')
    await date.fill('2026-10-16')
    await expect(page.getByText('Nenhum pedido nesta data.', { exact: true })).toBeVisible()
    await date.fill('2026-10-17')
    await expect(page.locator('.report-table tbody tr').last()).toHaveText('Total12')
    expect(writes).toEqual([])
  })
}
