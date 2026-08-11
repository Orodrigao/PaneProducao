'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import PendingPayableItems from '@/components/PendingPayableItems'
import {
  formatBRL,
  formatDate,
  actualPaymentMethodLabel,
  installmentLabel,
  isDueSoon,
  isOverdue,
  statusLabel,
  type PayableProduct,
  type PayableInstallmentRow,
  type PayablePurchaseRow,
  type PendingPayableItemRow,
} from '@/lib/payables'

interface PayablePurchaseListProps {
  purchases: PayablePurchaseRow[]
  products: PayableProduct[]
  pendingPurchaseId: string | null
  pendingItems: PendingPayableItemRow[]
  busyId: string | null
  onOpenPending: (purchaseId: string) => void
  onRefreshPending: () => void
  onClosePending: () => void
  onPay: (installment: PayableInstallmentRow, purchase: PayablePurchaseRow) => void
  onCorrect: (installment: PayableInstallmentRow, purchase: PayablePurchaseRow) => void
  onCancel: (purchaseId: string) => void
}

type StatusFilter = PayablePurchaseRow['status'] | 'todas'

function paymentLabel(value: PayablePurchaseRow['payment_method']): string {
  return ({
    dinheiro: 'Dinheiro',
    pix: 'PIX',
    transferencia: 'Transferência',
    boleto: 'Boleto',
    cartao: 'Cartão',
    outro: 'Outro',
  } as Record<PayablePurchaseRow['payment_method'], string>)[value]
}

function supplierName(purchase: PayablePurchaseRow): string {
  const related = purchase.suppliers
  return (Array.isArray(related) ? related[0]?.name : related?.name) ?? 'Fornecedor não identificado'
}

function documentLabel(purchase: PayablePurchaseRow): string {
  if (purchase.origin === 'xml') return `NF-e ${purchase.nfe_number ?? 'sem número'}`
  return purchase.document_type === 'sem_nota' ? 'Sem nota' : 'Recibo'
}

function purchaseSearchText(purchase: PayablePurchaseRow): string {
  return [
    supplierName(purchase),
    purchase.nfe_number,
    purchase.nfe_key,
    purchase.notes,
    documentLabel(purchase),
  ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR')
}

function statusClass(status: PayablePurchaseRow['status']): string {
  return status === 'paga' ? 'conferido' : status === 'cancelada' ? 'cancelado' : 'separado'
}

export default function PayablePurchaseList({
  purchases,
  products,
  pendingPurchaseId,
  pendingItems,
  busyId,
  onOpenPending,
  onRefreshPending,
  onClosePending,
  onPay,
  onCorrect,
  onCancel,
}: PayablePurchaseListProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas')
  const [expandedPurchaseId, setExpandedPurchaseId] = useState<string | null>(null)

  const filteredPurchases = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR')
    return purchases.filter(purchase => (
      (statusFilter === 'todas' || purchase.status === statusFilter)
      && (!normalizedSearch || purchaseSearchText(purchase).includes(normalizedSearch))
    ))
  }, [purchases, search, statusFilter])

  const summary = useMemo(() => ({
    total: purchases.length,
    abertas: purchases.filter(purchase => purchase.status === 'aberta').length,
    pendentes: purchases.reduce((count, purchase) => count + (purchase.payable_installments ?? []).filter(installment => installment.status === 'pendente').length, 0),
  }), [purchases])

  function togglePurchase(purchaseId: string) {
    setExpandedPurchaseId(current => current === purchaseId ? null : purchaseId)
  }

  return (
    <>
      <div className="ps-card" style={{ marginTop: 14, padding: 10 }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)', pointerEvents: 'none' }} />
          <input
            className="ps-input"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar fornecedor, NF-e ou observação"
            aria-label="Buscar contas a pagar"
            style={{ width: '100%', paddingLeft: 32 }}
          />
        </div>
        <div className="ps-fieldrow" style={{ marginTop: 8, alignItems: 'center' }}>
          <div className="ps-fieldgroup" style={{ flex: '0 1 220px' }}>
            <label className="ps-fieldlabel" htmlFor="payables-status-filter">Situação</label>
            <select id="payables-status-filter" className="ps-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="todas">Todas</option>
              <option value="aberta">Em aberto</option>
              <option value="paga">Pagas</option>
              <option value="cancelada">Canceladas</option>
            </select>
          </div>
          <small style={{ color: 'var(--ink-soft)', marginLeft: 'auto' }}>
            {filteredPurchases.length} de {summary.total} conta(s) · {summary.abertas} em aberto · {summary.pendentes} parcela(s) pendente(s)
          </small>
        </div>
      </div>

      {filteredPurchases.length === 0 ? (
        <div className="ps-empty" style={{ marginTop: 12 }}>
          {purchases.length === 0 ? 'Nenhuma conta registrada ainda.' : 'Nenhuma conta encontrada com esses filtros.'}
          {purchases.length === 0 && <><br /><small>Comece pela compra semanal do CEASA.</small></>}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {filteredPurchases.map(purchase => {
            const installments = purchase.payable_installments ?? []
            const pending = installments.filter(installment => installment.status === 'pendente')
            const overdue = pending.some(installment => isOverdue(installment))
            const dueSoon = !overdue && pending.some(installment => isDueSoon(installment))
            const expanded = expandedPurchaseId === purchase.id || pendingPurchaseId === purchase.id

            return (
              <div className="ps-card" key={purchase.id} style={{ marginBottom: 8, padding: 0, overflow: 'hidden' }}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => togglePurchase(purchase.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 12px', border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{supplierName(purchase)}</b>
                      <span className={`ps-status ${statusClass(purchase.status)}`}>{statusLabel(purchase.status)}</span>
                      {overdue && <span style={{ color: 'var(--berry)', fontSize: 11, fontWeight: 700 }}>VENCIDA</span>}
                      {!overdue && dueSoon && <span style={{ color: 'var(--honey-deep)', fontSize: 11, fontWeight: 700 }}>VENCE EM BREVE</span>}
                    </div>
                    <small style={{ display: 'block', marginTop: 3 }}>{documentLabel(purchase)} · {formatDate(purchase.purchase_date)} · {paymentLabel(purchase.payment_method)}</small>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <strong style={{ display: 'block', fontSize: 16 }}>{formatBRL(purchase.total_value)}</strong>
                    <small>{pending.length ? `${pending.length} pendente(s)` : `${installments.length} parcela(s)`}</small>
                  </div>
                  <ChevronDown size={17} style={{ flexShrink: 0, color: 'var(--ink-faint)', transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 120ms ease' }} />
                </button>

                {expanded && (
                  <div style={{ borderTop: '1px solid var(--line-soft)', padding: '10px 12px 12px' }}>
                    {purchase.notes && <small style={{ display: 'block', color: 'var(--ink-soft)', marginBottom: 8 }}>{purchase.notes}</small>}
                    {purchase.origin === 'xml' && purchase.nfe_key && <small style={{ display: 'block', color: 'var(--ink-soft)', marginBottom: 8 }}>Chave da NF-e: {purchase.nfe_key}</small>}
                    {purchase.classification_status === 'pendente' && (
                      pendingPurchaseId === purchase.id
                        ? <PendingPayableItems items={pendingItems} products={products} onChanged={onRefreshPending} onClose={onClosePending} />
                        : <button type="button" className="ps-btn ghost sm" style={{ marginBottom: 8 }} disabled={busyId === purchase.id} onClick={() => { setExpandedPurchaseId(purchase.id); onOpenPending(purchase.id) }}>{busyId === purchase.id ? 'Abrindo...' : 'Classificar itens pendentes'}</button>
                    )}
                    {(pending.length > 0 || installments.some(installment => installment.status === 'paga')) && <div style={{ borderTop: purchase.classification_status === 'pendente' ? '1px solid var(--line-soft)' : undefined, paddingTop: purchase.classification_status === 'pendente' ? 4 : 0 }}>
                      {pending.map(installment => (
                        <div key={installment.id} className="ps-list-row" style={{ gap: 8 }}>
                          <span style={{ flex: 1 }}>
                            Parcela {installment.installment_number} · {formatDate(installment.due_date)} · {installmentLabel(installment.status)}
                            {(isOverdue(installment) || isDueSoon(installment)) && <small style={{ display: 'block', color: isOverdue(installment) ? 'var(--berry)' : 'var(--honey-deep)' }}>{isOverdue(installment) ? 'Vencida' : 'Vence em até 7 dias'}</small>}
                          </span>
                          <b>{formatBRL(installment.amount)}</b>
                          <button type="button" className="ps-btn success sm" disabled={busyId === installment.id} onClick={() => onPay(installment, purchase)}>{busyId === installment.id ? '...' : 'Baixar'}</button>
                        </div>
                      ))}
                      {installments.filter(installment => installment.status === 'paga').map(installment => {
                        const paidAmount = Number(installment.paid_amount ?? installment.amount)
                        const extra = Math.max(0, paidAmount - Number(installment.amount))
                        const dueDate = installment.current_due_date && installment.current_due_date !== installment.due_date
                          ? ` · boleto atualizado ${formatDate(installment.current_due_date)}`
                          : ''
                        return (
                          <div key={installment.id} className="ps-list-row" style={{ gap: 8, alignItems: 'flex-start' }}>
                            <span style={{ flex: 1 }}>
                              Parcela {installment.installment_number} · paga em {installment.paid_date ? formatDate(installment.paid_date) : 'data não informada'}{dueDate}
                              <small style={{ display: 'block', color: 'var(--ink-soft)' }}>
                                {actualPaymentMethodLabel(installment.paid_method ?? 'boleto')} · original {formatBRL(installment.amount)} · pago {formatBRL(paidAmount)}{extra > 0 ? ` · juros/multa ${formatBRL(extra)}` : ''}
                              </small>
                            </span>
                            <button type="button" className="ps-btn ghost sm" disabled={busyId === installment.id} onClick={() => onCorrect(installment, purchase)}>{busyId === installment.id ? '...' : 'Corrigir baixa'}</button>
                          </div>
                        )
                      })}
                    </div>}
                    {purchase.status === 'aberta' && <button type="button" className="ps-btn ghost sm" style={{ marginTop: 10, color: 'var(--berry)' }} disabled={busyId === purchase.id} onClick={() => onCancel(purchase.id)}>Cancelar lançamento</button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
