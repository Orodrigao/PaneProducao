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

describe('navegação responsiva', () => {
  it('mantém navegação mobile e lateral a partir da mesma lista de rotas', () => {
    const navSource = readFileSync(new URL('./Nav.tsx', import.meta.url), 'utf8')

    expect(navSource).toContain('<aside className="ps-sidebar"')
    expect(navSource).toContain('<nav className="ps-nav">')
    expect(navSource).toContain("primary.map(l => navLink(l, 'sidebar'))")
    expect(navSource).toContain("primary.map(l => navLink(l, 'primary'))")
    expect(navSource).toContain('moreGroups.map(g =>')
  })

  it('marca a rota atual para tecnologias assistivas', () => {
    const navSource = readFileSync(new URL('./Nav.tsx', import.meta.url), 'utf8')

    expect(navSource).toContain("aria-current={isActive(l.href) ? 'page' : undefined}")
  })

  it('define os três comportamentos de navegação nos breakpoints estruturais', () => {
    const cssSource = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

    expect(cssSource).toContain('.ps-sidebar{ display:none; }')
    expect(cssSource).toContain('@media (min-width:600px)')
    expect(cssSource).toContain('@media (min-width:1200px)')
    expect(cssSource).toContain('.ps-nav{ display:none; }')
    expect(cssSource).toContain('--app-sidebar-w:248px')
    expect(cssSource).toContain('.app-body:has(.ps-sidebar){ padding-left:var(--app-sidebar-w); }')
  })
})
