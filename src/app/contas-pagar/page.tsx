'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, WalletCards } from 'lucide-react'
import { useRouter } from 'next/navigation'
import PayableForm from '@/components/PayableForm'
import PendingPayableItems from '@/components/PendingPayableItems'
import XmlPayableImport, { type XmlSupplierOption } from '@/components/XmlPayableImport'
import { supabase } from '@/lib/supabase'
import {
  cancelPayable,
  formatBRL,
  formatDate,
  installmentLabel,
  isDueSoon,
  isOverdue,
  loadPayablePurchases,
  payInstallment,
  statusLabel,
  type PayableProduct,
  type PayablePurchaseRow,
  loadPendingPayableItems,
  type PendingPayableItemRow,
} from '@/lib/payables'
import { showToast } from '@/lib/utils'

type SupplierOption = XmlSupplierOption

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

export default function ContasPagarPage() {
  const router = useRouter()
  const [purchases, setPurchases] = useState<PayablePurchaseRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [products, setProducts] = useState<PayableProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showXmlImport, setShowXmlImport] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingPurchaseId, setPendingPurchaseId] = useState<string | null>(null)
  const [pendingItems, setPendingItems] = useState<PendingPayableItemRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, suppliersResponse, productsResponse] = await Promise.all([
        loadPayablePurchases(),
        supabase.from('suppliers').select('id,name,cnpj').eq('active', true).order('name'),
        supabase.from('products').select('id,name,unit,category').eq('active', true).or('kind.eq.insumo,is_revenda.eq.true').order('name'),
      ])
      if (suppliersResponse.error) throw suppliersResponse.error
      if (productsResponse.error) throw productsResponse.error
      setPurchases(rows)
      setSuppliers((suppliersResponse.data ?? []) as SupplierOption[])
      setProducts((productsResponse.data ?? []) as PayableProduct[])
    } catch (loadError) {
      console.error(loadError)
      setError('Não foi possível carregar as contas da JC. Confira sua permissão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [])

  async function openPendingItems(purchaseId: string) {
    setBusyId(purchaseId)
    try {
      setPendingItems(await loadPendingPayableItems(purchaseId))
      setPendingPurchaseId(purchaseId)
    } catch (loadError) {
      console.error(loadError)
      showToast('Não foi possível abrir os itens pendentes.')
    } finally { setBusyId(null) }
  }

  async function refreshPendingItems() {
    if (!pendingPurchaseId) return
    const items = await loadPendingPayableItems(pendingPurchaseId)
    setPendingItems(items)
    if (items.length === 0) setPendingPurchaseId(null)
    await load()
  }

  useEffect(() => { void load() }, [load])

  const reminders = useMemo(() => {
    const installments = purchases.flatMap(purchase => purchase.payable_installments ?? [])
    return {
      overdue: installments.filter(installment => isOverdue(installment)).length,
      dueSoon: installments.filter(installment => isDueSoon(installment)).length,
    }
  }, [purchases])

  async function handlePay(installmentId: string) {
    if (!window.confirm('Confirmar que esta parcela foi paga?')) return
    setBusyId(installmentId)
    try {
      await payInstallment(installmentId)
      showToast('Parcela baixada.')
      await load()
    } catch (payError) {
      console.error(payError)
      showToast(payError instanceof Error ? payError.message : 'Não foi possível baixar a parcela.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleCancel(purchaseId: string) {
    const reason = window.prompt('Por que esta conta será cancelada?')?.trim()
    if (!reason) return
    setBusyId(purchaseId)
    try {
      await cancelPayable(purchaseId, reason)
      showToast('Conta cancelada e preservada no histórico.')
      await load()
    } catch (cancelError) {
      console.error(cancelError)
      showToast(cancelError instanceof Error ? cancelError.message : 'Não foi possível cancelar a conta.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark"><WalletCards size={18} /></div>
            <div className="ps-brand"><b>Contas a pagar</b><span>JC · manual e NF-e</span></div>
          </div>
          <button className="ps-iconbtn" onClick={() => void load()} aria-label="Atualizar contas" title="Atualizar"><RefreshCw size={17} /></button>
        </header>

        <div className="ps-scroll ps-pad">
          <div className="ps-banner honey">
            <b>Financeiro da JC</b>
            <small>Registre compras sem nota ou importe NF-e. O financeiro fica rastreado; o estoque será integrado depois.</small>
          </div>

          {(reminders.overdue > 0 || reminders.dueSoon > 0) && (
            <div className="ps-card" style={{ marginTop: 12, borderColor: reminders.overdue > 0 ? 'var(--berry)' : 'var(--honey-deep)' }}>
              <b>{reminders.overdue > 0 ? `Atenção: ${reminders.overdue} vencimento(s) atrasado(s).` : `Lembrete: ${reminders.dueSoon} vencimento(s) nos próximos 7 dias.`}</b>
              <small style={{ display: 'block', marginTop: 4 }}>Confira as parcelas abaixo e registre a baixa somente depois do pagamento.</small>
            </div>
          )}

          {showForm ? (
            <PayableForm
              suppliers={suppliers}
              products={products}
              onCancel={() => setShowForm(false)}
              onSaved={async () => { setShowForm(false); await load() }}
            />
          ) : showXmlImport ? (
            <XmlPayableImport
              suppliers={suppliers}
              products={products}
              onCancel={() => setShowXmlImport(false)}
              onSaved={async () => { setShowXmlImport(false); await load() }}
            />
          ) : (
            <div className="ps-fieldrow" style={{ marginTop: 14 }}>
              <button className="ps-btn primary block" onClick={() => setShowForm(true)}><Plus size={16} /> Nova compra manual</button>
              <button className="ps-btn ghost block" onClick={() => setShowXmlImport(true)}>Importar XML da NF-e</button>
            </div>
          )}

          {error && (
            <div className="ps-card" style={{ marginTop: 14, borderColor: 'var(--berry)' }}>
              <b>Não carregou</b><p style={{ margin: '6px 0 10px' }}>{error}</p>
              <button className="ps-btn ghost sm" onClick={() => void load()}>Tentar novamente</button>
            </div>
          )}

          <div className="ps-label">Lançamentos da JC</div>
          {loading ? <div className="ps-empty">Carregando contas...</div> : purchases.length === 0 ? (
            <div className="ps-empty">Nenhuma conta registrada ainda.<br /><small>Comece pela compra semanal do CEASA.</small></div>
          ) : purchases.map(purchase => {
            const installments = purchase.payable_installments ?? []
            const pending = installments.filter(installment => installment.status === 'pendente')
            return (
              <div className="ps-card" key={purchase.id} style={{ marginBottom: 10 }}>
                <div className="ps-card-head">
                  <div>
                    <b>{supplierName(purchase)}</b>
                    <small>{formatDate(purchase.purchase_date)} · {purchase.document_type === 'sem_nota' ? 'Sem nota' : 'Recibo'} · {paymentLabel(purchase.payment_method)}</small>
                  </div>
                  <span className={`ps-status ${purchase.status === 'paga' ? 'conferido' : purchase.status === 'cancelada' ? 'cancelado' : 'separado'}`}>{statusLabel(purchase.status)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '12px 0 8px' }}>
                  <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{installments.length} parcela(s)</span>
                  <strong style={{ fontSize: 18 }}>{formatBRL(purchase.total_value)}</strong>
                </div>
                {purchase.notes && <small style={{ display: 'block', color: 'var(--ink-soft)', marginBottom: 8 }}>{purchase.notes}</small>}
                {purchase.origin === 'xml' && purchase.nfe_key && <small style={{ display: 'block', color: 'var(--ink-soft)', marginBottom: 8 }}>NF-e {purchase.nfe_number ?? ''}{purchase.nfe_series ? ` · série ${purchase.nfe_series}` : ''} · chave {purchase.nfe_key}</small>}
                {purchase.classification_status === 'pendente' && (
                  pendingPurchaseId === purchase.id
                    ? <PendingPayableItems items={pendingItems} products={products} onChanged={refreshPendingItems} onClose={() => setPendingPurchaseId(null)} />
                    : <button className="ps-btn ghost sm" style={{ marginBottom: 8 }} disabled={busyId === purchase.id} onClick={() => void openPendingItems(purchase.id)}>{busyId === purchase.id ? 'Abrindo...' : 'Classificar itens pendentes'}</button>
                )}
                {pending.map(installment => (
                  <div key={installment.id} className="ps-list-row" style={{ gap: 8 }}>
                    <span style={{ flex: 1 }}>
                      Parcela {installment.installment_number} · {formatDate(installment.due_date)} · {installmentLabel(installment.status)}
                      {(isOverdue(installment) || isDueSoon(installment)) && <small style={{ display: 'block', color: isOverdue(installment) ? 'var(--berry)' : 'var(--honey-deep)' }}>{isOverdue(installment) ? 'Vencida' : 'Vence em até 7 dias'}</small>}
                    </span>
                    <b>{formatBRL(installment.amount)}</b>
                    <button className="ps-btn success sm" disabled={busyId === installment.id} onClick={() => void handlePay(installment.id)}>{busyId === installment.id ? '...' : 'Baixar'}</button>
                  </div>
                ))}
                {purchase.status === 'aberta' && <button className="ps-btn ghost sm" style={{ marginTop: 10, color: 'var(--berry)' }} disabled={busyId === purchase.id} onClick={() => void handleCancel(purchase.id)}>Cancelar lançamento</button>}
              </div>
            )
          })}

          <div className="ps-card" style={{ marginTop: 14, background: 'var(--cream-raise)' }}>
            <small>Fornecedor novo? <button className="ps-link" onClick={() => router.push('/fornecedores')}>Cadastre em Fornecedores</button>. A compra permanece somente financeira nesta fase.</small>
          </div>
        </div>
      </div>
    </div>
  )
}
