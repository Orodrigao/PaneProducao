'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import type { NfeDraft } from '@/lib/nfeXml'
import { formatDateBR } from '@/lib/utils'
import {
  compareWithLastPurchase,
  formatPercent,
  formatUnitCost,
  formatVariation,
  noteProductCosts,
  packagingLabel,
  type CostChange,
  type CostPoint,
} from '@/lib/purchaseCostChange'
import { loadCostHistory } from '@/lib/purchaseCostChangeClient'

/** O que a tela sabe da comparação de um cadastro desta nota. */
export type NoteCostState =
  | { status: 'carregando' }
  | { status: 'erro' }
  | { status: 'aguardando_embalagem' }
  | { status: 'pronto'; change: CostChange }

function describePrevious(previous: CostPoint, unit: string | null): string {
  const packaging = packagingLabel(previous.packaging, unit)
  return [
    `${formatUnitCost(previous.unitCost, unit)} na NF ${previous.nfeNumber ?? 'sem número'} de ${formatDateBR(previous.issueDate)}`,
    previous.supplierName,
    packaging ? `embalagem ${packaging}` : null,
  ].filter(Boolean).join(' · ')
}

/**
 * Uma linha por item ligado a cadastro, logo abaixo do fator de conversão. Só
 * a alta e a diferença grande chamam atenção; o resto é informação miúda, para
 * o aviso não virar ruído que ninguém lê.
 */
export function CostChangeLine({ state, unit }: { state: NoteCostState; unit: string | null }) {
  if (state.status === 'carregando') return <small className="ps-help" style={{ display: 'block', marginTop: 6 }}>Comparando com a última compra deste cadastro...</small>
  if (state.status === 'erro') return <small className="ps-help" style={{ display: 'block', marginTop: 6 }}>Não foi possível comparar com a última compra agora. A importação segue normal.</small>
  if (state.status === 'aguardando_embalagem') return <small className="ps-help" style={{ display: 'block', marginTop: 6 }}>Confira a embalagem para comparar o custo com a última compra.</small>
  const { change } = state
  const current = formatUnitCost(change.unitCost, unit)
  if (change.kind === 'primeira') {
    return <small className="ps-help" style={{ display: 'block', marginTop: 6 }}>{`Primeira compra deste cadastro por NF-e: ${current}. Não há custo anterior para comparar.`}</small>
  }
  if (change.kind === 'nota_antiga' && change.newer) {
    return (
      <small className="ps-help" style={{ display: 'block', marginTop: 6 }}>
        {`Já existe nota mais recente deste cadastro (NF ${change.newer.nfeNumber ?? 'sem número'} de ${formatDateBR(change.newer.issueDate)}): esta nota entra no financeiro, mas não muda o custo.`}
      </small>
    )
  }
  const previous = change.previous
  if (!previous) return null
  const variation = change.ratio === null ? null : formatVariation(change.ratio)
  const size = change.ratio === null ? null : formatPercent(change.ratio)
  if (change.kind === 'muito_diferente') {
    const direction = change.ratio === null ? 'muito diferente da' : change.ratio > 1 ? `${size} acima da` : `${size} abaixo da`
    return (
      <div role="alert" className="ps-card" style={{ marginTop: 8, padding: 10, borderColor: 'var(--berry)', background: 'var(--berry-tint)' }}>
        <b>{`Custo ${direction} última compra: confira a quantidade por embalagem`}</b>
        <small style={{ display: 'block', marginTop: 3 }}>{`Nesta nota: ${current}. Última compra: ${describePrevious(previous, unit)}.`}</small>
        <small style={{ display: 'block', marginTop: 3 }}>Diferença desse tamanho costuma ser quantidade por embalagem lida errada. Confira a quantidade por embalagem desta nota; se ela estiver certa, confira a compra anterior em Vínculos NF-e.</small>
      </div>
    )
  }
  if (change.kind === 'subiu') {
    return (
      <div role="alert" className="ps-card" style={{ marginTop: 8, padding: 10, borderColor: 'var(--honey-deep)', background: 'var(--cream-raise)' }}>
        <b><TrendingUp size={15} aria-hidden style={{ verticalAlign: '-2px' }} />{` Custo subiu ${size} desde a última compra`}</b>
        <small style={{ display: 'block', marginTop: 3 }}>{`Nesta nota: ${current}. Última compra: ${describePrevious(previous, unit)}.`}</small>
        <small style={{ display: 'block', marginTop: 3 }}>O preço de venda não muda sozinho. Confirmada a nota, a alta fica no quadro “Altas e variações grandes de custo”, no alto do Contas a pagar, por 30 dias contados da emissão.</small>
      </div>
    )
  }
  return (
    <small className="ps-help" style={{ display: 'block', marginTop: 6 }}>
      {`Custo desta nota: ${current} (${variation} sobre a última compra: ${describePrevious(previous, unit)}).`}
    </small>
  )
}

/** Resumo no alto da lista de itens, para quem confere a nota não precisar rolar item por item. */
export function CostChangeSummary({ changes, names }: { changes: CostChange[]; names: ReadonlyMap<string, string> }) {
  const increases = changes.filter(change => change.kind === 'subiu')
  const large = changes.filter(change => change.kind === 'muito_diferente')
  if (increases.length === 0 && large.length === 0) return null
  const label = (change: CostChange) => `${names.get(change.productId) ?? 'Cadastro'}${change.ratio === null ? '' : ` ${formatVariation(change.ratio)}`}`
  return (
    <div role="status" className="ps-card" style={{ marginTop: 10, padding: 10, borderLeft: `4px solid ${large.length > 0 ? 'var(--berry)' : 'var(--honey-deep)'}`, background: 'var(--cream-raise)' }}>
      {increases.length > 0 && (
        <>
          <b>{increases.length === 1 ? '1 cadastro desta nota subiu de custo' : `${increases.length} cadastros desta nota subiram de custo`}</b>
          <small style={{ display: 'block', marginTop: 3 }}>{increases.map(label).join(' · ')}</small>
        </>
      )}
      {large.length > 0 && (
        <>
          <b style={{ display: 'block', marginTop: increases.length > 0 ? 6 : 0 }}>{large.length === 1 ? '1 cadastro com custo muito diferente da última compra' : `${large.length} cadastros com custo muito diferente da última compra`}</b>
          <small style={{ display: 'block', marginTop: 3 }}>{`${large.map(label).join(' · ')}. Confira a quantidade por embalagem desses itens antes de confirmar.`}</small>
        </>
      )}
    </div>
  )
}

/**
 * Lê a última compra de cada cadastro ligado nesta nota e devolve a comparação
 * por cadastro. A leitura vale para a nota aberta (chave de acesso mais
 * cadastro): trocar o vínculo de um item lê só o cadastro novo, e outra nota
 * lê tudo de novo, sem reaproveitar histórico de antes.
 */
export function useNoteCostChanges(draft: NfeDraft | null, acquisitionByLine: ReadonlyMap<number, number> | null): Map<string, NoteCostState> {
  const [history, setHistory] = useState<Map<string, CostPoint[]>>(() => new Map())
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const requested = useRef<Set<string>>(new Set())
  const mounted = useRef(true)
  const noteKey = draft?.accessKey ?? ''
  const costs = useMemo(() => noteProductCosts(draft, acquisitionByLine), [draft, acquisitionByLine])
  const missing = useMemo(
    () => [...costs.keys()].map(productId => `${noteKey}|${productId}`).filter(key => !history.has(key) && !failed.has(key)).sort().join(','),
    [costs, history, failed, noteKey],
  )

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Pedido em voo continua valendo quando a pessoa liga outro item; a resposta
  // fica presa à nota que pediu, e só a saída da tela a descarta.
  useEffect(() => {
    const keys = missing ? missing.split(',').filter(key => !requested.current.has(key)) : []
    if (keys.length === 0) return
    for (const key of keys) requested.current.add(key)
    const productIds = keys.map(key => key.slice(key.indexOf('|') + 1))
    void loadCostHistory(productIds).then(loaded => {
      if (!mounted.current) return
      setHistory(previous => {
        const next = new Map(previous)
        for (const key of keys) next.set(key, loaded.get(key.slice(key.indexOf('|') + 1)) ?? [])
        return next
      })
    }).catch(error => {
      console.error(error)
      if (mounted.current) setFailed(previous => new Set([...previous, ...keys]))
    }).finally(() => {
      for (const key of keys) requested.current.delete(key)
    })
  }, [missing])

  return useMemo(() => {
    const states = new Map<string, NoteCostState>()
    if (!draft) return states
    for (const cost of costs.values()) {
      const key = `${noteKey}|${cost.productId}`
      if (cost.unitCost === null) states.set(cost.productId, { status: 'aguardando_embalagem' })
      else if (failed.has(key)) states.set(cost.productId, { status: 'erro' })
      else if (!history.has(key)) states.set(cost.productId, { status: 'carregando' })
      else states.set(cost.productId, {
        status: 'pronto',
        change: compareWithLastPurchase(history.get(key), { issueDate: draft.issueDate, issuedAt: draft.issuedAt, createdAt: null, nfeKey: draft.accessKey }, cost.productId, cost.unitCost),
      })
    }
    return states
  }, [draft, costs, history, failed, noteKey])
}
