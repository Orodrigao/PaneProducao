import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('trajetória do fechamento de sobras', () => {
  // As invariantes de banco deste fluxo são guardadas contra o schema
  // versionado em src/lib/schemaInvariants.test.ts.
  const registerSource = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
  const pendingSource = readFileSync(new URL('./pendencias/page.tsx', import.meta.url), 'utf8')

  it('monta a lista pelo pedido da loja e não bloqueia a tela sem Forno', () => {
    expect(registerSource).toContain(".eq('order_date', closingDate)")
    expect(registerSource).toContain('Adicionar pão que não está na lista')
    expect(registerSource).not.toContain('Confirme primeiro a saída dos pães no Forno.')
  })

  it('leva o fechamento salvo para a Central e mantém a conciliação visível', () => {
    expect(registerSource).toContain('router.push(leftoverPendingPath(')
    expect(pendingSource).toContain("reconciliation_status.eq.awaiting_oven")
    expect(pendingSource).toContain('A contagem e os destinos estão preservados')
  })

})
