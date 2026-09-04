import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./XmlPayableImport.tsx', import.meta.url), 'utf8')
const selectorSource = readFileSync(new URL('./XmlConversionEditor.tsx', import.meta.url), 'utf8')

describe('classificação durante a importação da NF-e', () => {
  it('mantém o cadastro acessível sem depender do resultado da busca', () => {
    const conditionalResults = selectorSource.indexOf('{query.trim() && results.length > 0 && (')
    const alwaysAvailableCreate = selectorSource.indexOf('className="ps-btn ghost sm block" onClick={onCreate}')
    const noResults = selectorSource.indexOf('{query.trim() && products.length > 0 && results.length === 0 && (')
    const noResultsSource = selectorSource.slice(noResults)

    expect(selectorSource).toContain('1. Insumo de receita já cadastrado')
    expect(selectorSource).toContain('2. Produto novo da padaria')
    expect(selectorSource).toContain('3. Uso ou despesa')
    expect(alwaysAvailableCreate).toBeGreaterThanOrEqual(0)
    expect(alwaysAvailableCreate).toBeLessThan(conditionalResults)
    expect(noResults).toBeGreaterThan(conditionalResults)
    expect(noResultsSource).toContain('className="ps-btn ghost sm" style={{ marginTop: 8 }} onClick={onCreate}')

    // Terceiro ponto, e o mais facil de perder: quem buscou, viu resultados e
    // nao reconheceu nenhum precisa da saida de cadastro ali mesmo. O smoke de
    // navegador importa uma NF-e cujo item acha um parente e exige este texto;
    // ele reprovou em 03/09/2026 quando o bloco foi removido daqui.
    const resultsBlock = selectorSource.slice(conditionalResults, noResults)
    expect(resultsBlock).toContain('Nenhum desses serve?')
    expect(resultsBlock).toContain('onClick={onCreate}')
    expect(selectorSource).toContain('className="ps-btn ghost sm block" onClick={onWithoutProduct}')
    expect(source).toContain('onCreate={() => openProductForm(index)}')
    expect(source).toContain('onWithoutProduct={() => markWithoutProduct(index)}')
  })

  it('explica a memória por fornecedor antes de marcar uso ou despesa', () => {
    const reminder = selectorSource.indexOf('Esta decisão fica memorizada para este fornecedor.')
    const expenseAction = selectorSource.indexOf('onClick={onWithoutProduct}')

    expect(reminder).toBeGreaterThanOrEqual(0)
    expect(expenseAction).toBeGreaterThan(reminder)
    expect(source).toContain("mappingStatus: 'nao_aplicavel'")
  })

  it('reaproveita tanto vínculos de produto quanto decisões sem produto', () => {
    expect(source).toContain("from('payable_non_catalog_mappings')")
    expect(source).toContain('factor_confirmed')
    expect(source).toContain("mappingStatus: 'nao_aplicavel'")
  })
})
