import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./XmlPayableImport.tsx', import.meta.url), 'utf8')
const selectorSource = readFileSync(new URL('./XmlConversionEditor.tsx', import.meta.url), 'utf8')

describe('classificação durante a importação da NF-e', () => {
  it('oferece uma classificação sem produto para material de uso ou despesa', () => {
    expect(selectorSource).toContain('Uso ou despesa — não entra em receita')
    expect(source).toContain("mappingStatus: 'nao_aplicavel'")
  })

  it('reaproveita tanto vínculos de produto quanto decisões sem produto', () => {
    expect(source).toContain("from('payable_non_catalog_mappings')")
    expect(source).toContain('factor_confirmed')
    expect(source).toContain("mappingStatus: 'nao_aplicavel'")
  })
})
