import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./pjProductionPlanningClient.ts', import.meta.url), 'utf8')

describe('cliente da programação PJ', () => {
  it('lê a fila e grava somente pelas ações protegidas do banco', () => {
    expect(source).toContain("supabase.rpc('list_pj_production_queue')")
    expect(source).toContain("supabase.rpc('schedule_pj_production'")
    expect(source).not.toContain(".from('pj_production_schedules')")
  })

  it('envia a quantidade programada e a parte congelada por linha', () => {
    expect(source).toContain('order_id: selection.orderId')
    expect(source).toContain('frozen_quantity: selection.frozenQuantity')
    expect(source).toContain('p_request_id: requestId')
  })
})
