'use client'

import { useEffect, useState } from 'react'
import { Save, Scale } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { parseBreadWeightKg } from '@/lib/breadWeight'
import { showToast } from '@/lib/utils'

interface WeightBread {
  id: string
  name: string
  avg_unit_weight_kg: number | null
}

// Pão vendido por unidade que já teve pedido PJ cobrado por peso (kg)
// precisa de um peso médio cadastrado para o Forno converter kg em peças
// no previsto do dia. Sem isso o Forno avisa "falta peso médio" em vez de
// somar uma fração quebrada. Ver supabase/migrations/20260915002304_*.
export default function BreadWeightManager() {
  const [breads, setBreads] = useState<WeightBread[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const [kgOrdersResult, breadsResult] = await Promise.all([
        supabase.from('orders').select('bread_id').eq('pricing_unit', 'kg').not('bread_id', 'is', null),
        supabase.from('breads').select('id,name,avg_unit_weight_kg').eq('unit', 'un').eq('active', true).order('name'),
      ])
      if (kgOrdersResult.error) throw kgOrdersResult.error
      if (breadsResult.error) throw breadsResult.error

      const kgBreadIds = new Set((kgOrdersResult.data ?? []).map(row => row.bread_id as string))
      const relevant = ((breadsResult.data ?? []) as WeightBread[])
        .filter(bread => kgBreadIds.has(bread.id) || bread.avg_unit_weight_kg !== null)

      setBreads(relevant)
      setDrafts(Object.fromEntries(relevant.map(bread => [bread.id, bread.avg_unit_weight_kg?.toString() ?? ''])))
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os pesos médios.')
    } finally {
      setLoading(false)
    }
  }

  async function saveWeight(breadId: string) {
    const raw = drafts[breadId] ?? ''
    const weight = parseBreadWeightKg(raw)
    if (weight === null) {
      showToast('Informe um peso em kg maior que zero, com até 3 casas decimais.')
      return
    }
    setSaving(current => ({ ...current, [breadId]: true }))
    try {
      const { error } = await supabase.from('breads').update({ avg_unit_weight_kg: weight }).eq('id', breadId)
      if (error) throw error
      setBreads(current => current.map(bread => bread.id === breadId ? { ...bread, avg_unit_weight_kg: weight } : bread))
      showToast('Peso médio salvo.')
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Não foi possível salvar o peso médio.')
    } finally {
      setSaving(current => ({ ...current, [breadId]: false }))
    }
  }

  if (loading) return null
  if (loadError) {
    return <div className="ps-warning"><Scale size={16} style={{flexShrink:0, marginTop:1}}/><span>{loadError}</span></div>
  }
  if (breads.length === 0) return null

  return (
    <div className="ps-card" style={{marginBottom:16, padding:14}}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
        <Scale size={16} />
        <b style={{fontSize:14}}>Peso médio para pedido PJ por peso</b>
      </div>
      <p style={{fontSize:12.5, color:'var(--ink-faint)', margin:'0 0 12px'}}>
        Só usado quando um cliente PJ compra este pão por quilo, em vez de por unidade — converte o pedido em peças para o previsto do Forno.
      </p>
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {breads.map(bread => (
          <div key={bread.id} style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
            <span style={{flex:'1 1 180px', fontSize:13}}>
              {bread.name}
              {bread.avg_unit_weight_kg === null && (
                <span style={{color:'var(--danger, #b3261e)', fontSize:11.5, marginLeft:6}}>sem peso cadastrado</span>
              )}
            </span>
            <input
              className="ps-input"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.001}
              placeholder="kg por unidade"
              style={{width:120, padding:'6px 8px', fontSize:13}}
              disabled={saving[bread.id]}
              value={drafts[bread.id] ?? ''}
              onChange={event => setDrafts(current => ({ ...current, [bread.id]: event.target.value }))}
            />
            <button
              type="button"
              className="ps-btn ghost"
              disabled={saving[bread.id]}
              onClick={() => void saveWeight(bread.id)}
            >
              <Save size={14}/> Salvar
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
