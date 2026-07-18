import { describe, expect, it } from 'vitest'
import { COMPRAS_COTACOES_PAUSADAS, isComprasCotacoesPath } from './features'

describe('pausa de compras e cotações', () => {
  it('mantém o módulo pausado e reconhece todas as rotas legadas', () => {
    expect(COMPRAS_COTACOES_PAUSADAS).toBe(true)
    expect(isComprasCotacoesPath('/compras')).toBe(true)
    expect(isComprasCotacoesPath('/cotacoes')).toBe(true)
    expect(isComprasCotacoesPath('/cotacoes/detalhe')).toBe(true)
    expect(isComprasCotacoesPath('/cotacoes/comparativo')).toBe(true)
    expect(isComprasCotacoesPath('/fornecedores')).toBe(false)
  })
})
