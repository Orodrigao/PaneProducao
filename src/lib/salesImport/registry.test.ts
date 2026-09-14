import { describe, expect, it } from 'vitest'
import { adapterForSalesFile } from './registry'

describe('adapterForSalesFile', () => {
  it('seleciona o adaptador CNM sem transformar CNM no formato interno', () => {
    expect(adapterForSalesFile('CNM_JC_2026-09-12.xls')?.id).toBe('cnm')
    expect(adapterForSalesFile('CNM_2026-09-12_JC.xls')?.id).toBe('cnm')
  })

  it('não tenta adivinhar formato desconhecido', () => {
    expect(adapterForSalesFile('exportacao-novo-pdv.csv')).toBeNull()
  })
})
