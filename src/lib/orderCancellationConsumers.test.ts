import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

describe('pedidos cancelados fora da operação', () => {
  it('filtra as três fontes do Forno', () => {
    const source = read('../app/forno/page.tsx')
    expect(source.match(/\.is\('cancelled_at', null\)/g)).toHaveLength(3)
  })

  it('filtra as três leituras REST da tela raiz', () => {
    const source = read('../app/page.tsx')
    expect(source.match(/sbGet\('orders', ?`cancelled_at=is\.null&/g)).toHaveLength(3)
  })

  it('filtra Romaneio, Sobras e Relatório PJ', () => {
    expect(read('../app/romaneio/page.tsx')).toContain(
      "sbGet('orders',`cancelled_at=is.null&order_date=eq.${date}",
    )
    expect(read('../app/sobras/page.tsx')).toContain(".is('cancelled_at', null)")
    expect(read('../app/sobras/pendencias/page.tsx')).toContain(".is('cancelled_at', null)")
    expect(read('../app/relatorios/pj/page.tsx')).toContain(".is('cancelled_at', null)")
  })
})
