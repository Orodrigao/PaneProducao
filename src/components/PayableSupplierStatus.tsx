'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  formatBRL,
  summarizeSupplierPurchaseStatus,
  type PayablePurchaseRow,
  type PayableSupplierOption,
  type SupplierPurchaseStatus,
} from '@/lib/payables'

interface PayableSupplierStatusProps {
  suppliers: Pick<PayableSupplierOption, 'id' | 'name'>[]
  purchases: PayablePurchaseRow[]
}

type SupplierLight = 'travado' | 'liberado' | 'sem-historico'

function lightOf(status: SupplierPurchaseStatus): SupplierLight {
  if (status.overdueCount > 0) return 'travado'
  return status.purchaseCount > 0 ? 'liberado' : 'sem-historico'
}

const DOT_COLOR: Record<SupplierLight, string> = {
  travado: 'var(--berry)',
  liberado: 'var(--sage)',
  'sem-historico': 'var(--honey-deep)',
}

function detailOf(status: SupplierPurchaseStatus): string {
  const light = lightOf(status)
  if (light === 'liberado') {
    const compras = status.purchaseCount === 1 ? '1 compra conferida' : `${status.purchaseCount} compras conferidas`
    return `Liberado — ${compras}, nada vencido.`
  }
  if (light === 'sem-historico') {
    // Cadastro sem compra não prova nada: pode ser fornecedor novo ou o mesmo
    // fornecedor cadastrado duas vezes, com a dívida guardada no outro nome.
    return 'Sem compra registrada — confira o nome completo antes de pedir.'
  }
  const boletos = status.overdueCount === 1 ? '1 boleto vencido' : `${status.overdueCount} boletos vencidos`
  const atraso = status.oldestOverdueDays === 1 ? 'há 1 dia' : `há ${status.oldestOverdueDays} dias`
  return `${boletos} · ${formatBRL(status.overdueTotal)} · o mais antigo venceu ${atraso}`
}

/**
 * Responde a pergunta de antes da compra: este fornecedor está liberado para
 * pedido ou travado por boleto vencido? Nasce recolhido para não atrapalhar
 * quem usa a tela para lançar e baixar contas.
 *
 * Verde só para quem tem compra conferida sem nada vencido. Cadastro sem
 * compra nenhuma fica em amarelo: ele não responde à pergunta, e pintá-lo de
 * verde já mandou comprar de fornecedor com boleto atrasado guardado sob o
 * nome completo da empresa.
 */
export default function PayableSupplierStatus({ suppliers, purchases }: PayableSupplierStatusProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const statuses = useMemo(
    () => summarizeSupplierPurchaseStatus(suppliers, purchases),
    [suppliers, purchases],
  )
  const blocked = statuses.filter(status => lightOf(status) === 'travado')
  const free = statuses.filter(status => lightOf(status) === 'liberado')
  const unknown = statuses.filter(status => lightOf(status) === 'sem-historico')
  const term = search.trim().toLocaleLowerCase('pt-BR')
  const visible = term
    ? statuses.filter(status => status.name.toLocaleLowerCase('pt-BR').includes(term))
    : statuses

  const partes = [
    blocked.length > 0 ? `${blocked.length} travado${blocked.length === 1 ? '' : 's'}` : '',
    `${free.length} liberado${free.length === 1 ? '' : 's'}`,
    unknown.length > 0 ? `${unknown.length} sem compra registrada` : '',
  ].filter(Boolean)
  const summary = statuses.length === 0 ? 'Nenhum fornecedor cadastrado ainda.' : partes.join(' · ')

  return (
    <div className="ps-card" style={{ marginTop: 12, borderColor: blocked.length > 0 ? 'var(--berry)' : undefined }}>
      <button
        className="ps-link"
        style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left' }}
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
      >
        <span>
          <b>Fornecedores: liberado para pedido?</b>
          <small style={{ display: 'block', marginTop: 2, color: blocked.length > 0 ? 'var(--berry)' : undefined }}>{summary}</small>
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && statuses.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <input
            className="ps-input"
            placeholder="Buscar fornecedor pelo nome"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          {unknown.length > 0 && (
            <small style={{ display: 'block', marginTop: 8, color: 'var(--honey-deep)' }}>
              Amarelo é cadastro sem compra nenhuma. O mesmo fornecedor pode estar cadastrado
              duas vezes — busque pelo nome curto e pelo nome completo antes de fechar o pedido.
            </small>
          )}
          {visible.length === 0 ? (
            <div className="ps-empty" style={{ marginTop: 8 }}>Nenhum fornecedor com esse nome.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }}>
              {visible.map(status => (
                <li key={status.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span aria-hidden style={{ flex: 'none', width: 10, height: 10, borderRadius: '50%', background: DOT_COLOR[lightOf(status)], transform: 'translateY(1px)' }} />
                  <span>
                    <b>{status.name}</b>
                    <small style={{ display: 'block' }}>{detailOf(status)}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
