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

function blockedDetail(status: SupplierPurchaseStatus): string {
  const boletos = status.overdueCount === 1 ? '1 boleto vencido' : `${status.overdueCount} boletos vencidos`
  const atraso = status.oldestOverdueDays === 1 ? 'há 1 dia' : `há ${status.oldestOverdueDays} dias`
  return `${boletos} · ${formatBRL(status.overdueTotal)} · o mais antigo venceu ${atraso}`
}

/**
 * Responde a pergunta de antes da compra: este fornecedor está liberado para
 * pedido ou travado por boleto vencido? Nasce recolhido para não atrapalhar
 * quem usa a tela para lançar e baixar contas.
 */
export default function PayableSupplierStatus({ suppliers, purchases }: PayableSupplierStatusProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const statuses = useMemo(
    () => summarizeSupplierPurchaseStatus(suppliers, purchases),
    [suppliers, purchases],
  )
  const blocked = statuses.filter(status => status.overdueCount > 0)
  const term = search.trim().toLocaleLowerCase('pt-BR')
  const visible = term
    ? statuses.filter(status => status.name.toLocaleLowerCase('pt-BR').includes(term))
    : statuses

  const summary = statuses.length === 0
    ? 'Nenhum fornecedor cadastrado ainda.'
    : blocked.length === 0
      ? `Todos os ${statuses.length} fornecedores estão liberados.`
      : `${blocked.length} travado${blocked.length === 1 ? '' : 's'} · ${statuses.length - blocked.length} liberado${statuses.length - blocked.length === 1 ? '' : 's'}`

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
          {visible.length === 0 ? (
            <div className="ps-empty" style={{ marginTop: 8 }}>Nenhum fornecedor com esse nome.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }}>
              {visible.map(status => (
                <li key={status.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span aria-hidden style={{ flex: 'none', width: 10, height: 10, borderRadius: '50%', background: status.overdueCount > 0 ? 'var(--berry)' : 'var(--basil)', transform: 'translateY(1px)' }} />
                  <span>
                    <b>{status.name}</b>
                    <small style={{ display: 'block' }}>
                      {status.overdueCount > 0 ? blockedDetail(status) : 'Liberado — nada vencido.'}
                    </small>
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
