import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./PjProductionPlanningPanel.tsx', import.meta.url), 'utf8')

describe('painel de programação PJ', () => {
  it('permite escolher linhas, dividir quantidade e informar congelados', () => {
    expect(source).toContain('Selecionar ${item.productName}')
    expect(source).toContain('Quantidade para produzir de ${item.productName}')
    expect(source).toContain('Congelados para ${item.productName}')
    expect(source).toContain('Produzir tudo')
  })

  it('explica as duas regras operacionais que não podem ficar implícitas', () => {
    expect(source).toContain('Sobras das lojas não atendem PJ')
    expect(source).toContain('pedidos por entrega mais próxima')
  })

  it('mantém o mesmo identificador quando uma tentativa de rede falha', () => {
    expect(source).toContain('requestIds[groupKey] ?? requestId()')
    expect(source).toContain("setRequestIds(current => ({ ...current, [groupKey]: stableRequestId }))")
  })

  it('pede uma conferência explícita antes de tornar a programação definitiva', () => {
    expect(source).toContain('Confira a programação de hoje')
    expect(source).toContain('esta programação não poderá ser alterada hoje')
    expect(source).toContain('window.confirm')
  })
})
