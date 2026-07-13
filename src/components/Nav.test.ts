import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('navegação de sobras', () => {
  it('abre a tela de lançamentos pelo item Sobras do menu', () => {
    const navSource = readFileSync(new URL('./Nav.tsx', import.meta.url), 'utf8')
    const sobrasMenuItem = navSource
      .split('\n')
      .find(line => line.includes("label: 'Sobras'"))

    expect(sobrasMenuItem).toContain("href: '/sobras'")
    expect(sobrasMenuItem).not.toContain('/sobras/pendencias')
  })
})
