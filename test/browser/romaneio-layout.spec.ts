import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('o ultimo card da conferencia fica inteiro acima das barras inferiores', async ({ page }) => {
  const css = await readFile('src/app/globals.css', 'utf8')
  await page.setViewportSize({ width: 360, height: 800 })
  await page.setContent(`
    <style>${css}</style>
    <main class="ps-canvas">
      <section class="ps-shell">
        <header class="ps-header"><div class="ps-brand"><b>Romaneios</b><span>Conferência</span></div></header>
        <div class="ps-scroll ps-pad">
          <div class="ps-card" style="margin-top:16px"><div class="ps-pname">Viagem de teste</div></div>
          <div class="ps-label">Confirme o que chegou (4 itens)</div>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div class="ps-card" style="min-height:220px"><div class="ps-pname">Pão 1</div></div>
            <div class="ps-card" style="min-height:220px"><div class="ps-pname">Pão 2</div></div>
            <div class="ps-card" style="min-height:220px"><div class="ps-pname">Pão 3</div></div>
            <div class="ps-card" data-last-card style="min-height:220px"><div class="ps-pname">Último pão</div></div>
          </div>
        </div>
        <div class="ps-totalbar"><div class="ps-total-num"><b>4</b><span>itens p/ conferir</span></div><button class="ps-save">Salvar Conferência</button></div>
      </section>
    </main>
    <nav class="ps-nav"><button class="ps-navitem"><span class="nic">●</span><span>Produção</span></button><button class="ps-navitem"><span class="nic">●</span><span>Romaneio</span></button><button class="ps-navitem"><span class="nic">●</span><span>Relatórios</span></button><button class="ps-navitem"><span class="nic">●</span><span>Mais</span></button></nav>
  `)

  const scroll = page.locator('.ps-scroll')
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight })

  const geometry = await page.locator('[data-last-card]').evaluate(card => {
    const lastCard = card.getBoundingClientRect()
    const totalbar = document.querySelector('.ps-totalbar')!.getBoundingClientRect()
    const nav = document.querySelector('.ps-nav')!.getBoundingClientRect()
    return { cardBottom: lastCard.bottom, totalbarTop: totalbar.top, navTop: nav.top }
  })

  expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.totalbarTop)
  expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.navTop)
})
