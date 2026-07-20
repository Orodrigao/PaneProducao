import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('relatório responsivo de sobras e descartes', () => {
  it('organiza cabeçalho, filtros, indicadores e tabela em regiões próprias', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

    expect(source).toContain('className="ps-report-heading"')
    expect(source).toContain('className="ps-filters ps-report-filter-grid"')
    expect(source).toContain('className="ps-report-kpi-grid"')
    expect(source).toContain('className="ps-report-table-region"')
    expect(source).toContain('renderMobileCard={renderMobileCard}')
  })

  it('mantém cards no celular e tabela com cabeçalho fixo no desktop', () => {
    const css = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8')

    expect(css).toContain('.ps-report-kpi-grid{ display:grid;')
    expect(css).toContain('.ps-report-table-region .ps-table th{ position:sticky;')
    expect(css).toContain('@media (max-width:640px)')
    expect(css).toContain('@media (min-width:1200px)')
  })
})
