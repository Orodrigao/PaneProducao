import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PLANNING_ORDER_OBS } from '@/lib/storeOrderNote'
import { StoreOrderNotes } from './StoreOrderNotes'

describe('observações das lojas na folha da produção', () => {
  it('mostra o recado de cada loja com a sigla, sem a marca do Planejamento', () => {
    const html = renderToStaticMarkup(createElement(StoreOrderNotes, {
      stores: ['ex', 'jc', 'ja'],
      orders: {
        ex: { forma: { obs: 'Pão de forma: 4 inteiros e 4 fatiados' } },
        jc: { forma: { obs: PLANNING_ORDER_OBS } },
        ja: { forma: { obs: 'Reforçar baguete' } },
      },
    }))
    expect(html).toContain('aria-label="Observações das lojas"')
    expect(html).toContain('<strong>EX:</strong> Pão de forma: 4 inteiros e 4 fatiados')
    expect(html).toContain('<strong>JA:</strong> Reforçar baguete')
    expect(html).not.toContain('JC:')
    expect(html).not.toContain(PLANNING_ORDER_OBS)
    // Sem `no-print`: o quadro sai no papel junto com a folha.
    expect(html).not.toContain('no-print')
  })

  it('não desenha nada quando nenhuma loja escreveu', () => {
    const html = renderToStaticMarkup(createElement(StoreOrderNotes, {
      stores: ['ex', 'jc', 'ja'],
      orders: { jc: { forma: { obs: PLANNING_ORDER_OBS } }, ex: { forma: { obs: '' } } },
    }))
    expect(html).toBe('')
  })
})
