import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('trajetória do fechamento de sobras', () => {
  // As invariantes de banco deste fluxo são guardadas contra o schema
  // versionado em supabase/tests/ (pgTAP, executado pelo CI Banco).
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

  // 2026-07-22: o fechamento da JC foi recusado por uma sobra de ontem sem
  // destino; a tela trocou na mesma hora e levou junto a contagem já digitada,
  // sem tempo de ler o motivo. A pessoa achou que tinha salvo.
  it('recusa por pendência guarda a contagem e explica sem trocar de tela', () => {
    expect(registerSource).toContain('writeLeftoverDraft(')
    expect(registerSource).toContain('setClosingBlocked(true)')
    expect(registerSource).toContain('O fechamento não foi salvo')
    expect(registerSource).not.toContain('Abrindo a Central de Pendências')
  })

  it('a Central aponta o lote que trava e devolve a pessoa ao fechamento', () => {
    expect(pendingSource).toContain('blocksClosing(')
    expect(pendingSource).toContain('está preso')
    expect(pendingSource).toContain('Trava o fechamento de')
    expect(pendingSource).toContain('closingResumePath(')
  })

})
