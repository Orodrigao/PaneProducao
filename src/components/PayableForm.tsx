'use client'

import { useRef, useState } from 'react'
import { Plus, Save, Trash2, X } from 'lucide-react'
import { showToast, todayKey } from '@/lib/utils'
import {
  buildInstallments,
  createManualPayable,
  formatBRL,
  actualPaymentMethodLabel,
  totalItems,
  validateDraft,
  type PayableActualPaymentMethod,
  type PayableDraft,
  type PayableInstallmentDraft,
  type PayableProduct,
} from '@/lib/payables'

interface SupplierOption { id: string; name: string }

interface PayableFormProps {
  suppliers: SupplierOption[]
  products: PayableProduct[]
  onSaved: () => Promise<void> | void
  onCancel: () => void
}

function newItem(): PayableDraft['items'][number] {
  return { productId: '', itemName: '', unit: 'un', quantity: '', unitPrice: '' }
}

function initialDraft(): PayableDraft {
  const date = todayKey()
  return {
    supplierId: '',
    purchaseDate: date,
    documentType: 'sem_nota',
    paymentMethod: 'dinheiro',
    paid: true,
    notes: '',
    items: [newItem()],
    installments: [{ number: 1, dueDate: date, amount: '0.00' }],
    paidDetails: { paidDate: date, paidAmount: '0.00', paidMethod: 'dinheiro', currentDueDate: '' },
  }
}

export default function PayableForm({ suppliers, products, onSaved, onCancel }: PayableFormProps) {
  const [draft, setDraft] = useState<PayableDraft>(initialDraft)
  const [installmentCount, setInstallmentCount] = useState(1)
  const [saving, setSaving] = useState(false)
  const requestIdRef = useRef<string>(crypto.randomUUID())
  const total = totalItems(draft.items)

  function updateDraft<K extends keyof PayableDraft>(field: K, value: PayableDraft[K]) {
    setDraft(previous => ({ ...previous, [field]: value }))
  }

  function updateItem(index: number, field: keyof PayableDraft['items'][number], value: string) {
    setDraft(previous => {
      const items = previous.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)
      return {
        ...previous,
        items,
        paidDetails: previous.paid && previous.paidDetails
          ? { ...previous.paidDetails, paidAmount: totalItems(items).toFixed(2) }
          : previous.paidDetails,
        installments: !previous.paid && previous.installments.length === 1
          ? [{ ...previous.installments[0], amount: totalItems(items).toFixed(2) }]
          : previous.installments,
      }
    })
  }

  function selectProduct(index: number, productId: string) {
    const product = products.find(item => item.id === productId)
    setDraft(previous => ({
      ...previous,
      items: previous.items.map((item, itemIndex) => itemIndex === index
        ? {
            ...item,
            productId,
            itemName: product?.name ?? '',
            unit: product?.unit ?? 'un',
          }
        : item),
    }))
  }

  function updateInstallment(index: number, field: keyof PayableInstallmentDraft, value: string) {
    setDraft(previous => ({
      ...previous,
      installments: previous.installments.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }))
  }

  function recalculateInstallments(count: number) {
    const nextCount = Math.max(1, Math.min(12, Math.trunc(count) || 1))
    setInstallmentCount(nextCount)
    if (draft.paid) return
    setDraft(previous => ({
      ...previous,
      installments: buildInstallments(totalItems(previous.items), nextCount, previous.purchaseDate),
    }))
  }

  function setPaid(paid: boolean) {
    setDraft(previous => ({
      ...previous,
      paid,
      paidDetails: paid
        ? {
            paidDate: previous.paidDetails?.paidDate ?? todayKey(),
            paidAmount: totalItems(previous.items).toFixed(2),
            paidMethod: previous.paidDetails?.paidMethod ?? 'dinheiro',
            currentDueDate: previous.paidDetails?.currentDueDate ?? '',
          }
        : previous.paidDetails,
      installments: paid
        ? [{ number: 1, dueDate: previous.purchaseDate, amount: totalItems(previous.items).toFixed(2) }]
        : buildInstallments(totalItems(previous.items), installmentCount, previous.purchaseDate),
    }))
  }

  async function save() {
    const payload: PayableDraft = draft.paid
      ? {
          ...draft,
          installments: [{ number: 1, dueDate: draft.purchaseDate, amount: total.toFixed(2) }],
        }
      : draft
    const validationError = validateDraft(payload)
    if (validationError) { showToast(validationError); return }

    setSaving(true)
    try {
      await createManualPayable(payload, requestIdRef.current)
      showToast('Conta registrada na JC.')
      await onSaved()
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : 'Não foi possível registrar a conta.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ps-card" style={{ marginTop: 14 }}>
      <div className="ps-card-head">
        <div>
          <b>Novo lançamento da JC</b>
          <small>Compra manual · não altera o estoque nesta fase</small>
        </div>
        <button className="ps-iconbtn" onClick={onCancel} aria-label="Fechar lançamento"><X size={16} /></button>
      </div>

      <div className="ps-fieldgroup">
        <div className="ps-fieldlabel">Fornecedor *</div>
        <select className="ps-select" value={draft.supplierId} onChange={event => updateDraft('supplierId', event.target.value)}>
          <option value="">Selecione o fornecedor</option>
          {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        {suppliers.length === 0 && <small className="ps-help">Cadastre o fornecedor antes de lançar a compra.</small>}
      </div>

      <div className="ps-fieldrow">
        <div className="ps-fieldgroup">
          <div className="ps-fieldlabel">Data da compra *</div>
          <input className="ps-input" type="date" value={draft.purchaseDate}
            onChange={event => updateDraft('purchaseDate', event.target.value)} />
        </div>
        <div className="ps-fieldgroup">
          <div className="ps-fieldlabel">Documento</div>
          <select className="ps-select" value={draft.documentType} onChange={event => updateDraft('documentType', event.target.value as PayableDraft['documentType'])}>
            <option value="sem_nota">Sem nota</option>
            <option value="recibo">Recibo</option>
          </select>
        </div>
      </div>

      <div className="ps-fieldrow">
        <div className="ps-fieldgroup">
          <div className="ps-fieldlabel">Pagamento</div>
          <select className="ps-select" value={draft.paymentMethod} onChange={event => updateDraft('paymentMethod', event.target.value as PayableDraft['paymentMethod'])}>
            <option value="dinheiro">Dinheiro</option>
            <option value="pix">PIX</option>
            <option value="transferencia">Transferência</option>
            <option value="boleto">Boleto</option>
            <option value="cartao">Cartão</option>
            <option value="outro">Outro</option>
          </select>
        </div>
        <div className="ps-fieldgroup" style={{ justifyContent: 'end' }}>
          <label className="ps-checkrow">
            <input type="checkbox" checked={draft.paid} onChange={event => setPaid(event.target.checked)} />
            <span>Já foi paga</span>
          </label>
        </div>
      </div>

      <div className="ps-label">Itens da compra</div>
      {draft.items.map((item, index) => (
        <div className="ps-card" key={`${index}-${item.productId}`} style={{ padding: 10, marginBottom: 8, background: 'var(--cream-raise)' }}>
          <div className="ps-fieldgroup">
            <div className="ps-fieldlabel">Produto do cadastro ou outro item</div>
            <select className="ps-select" value={item.productId} onChange={event => selectProduct(index, event.target.value)}>
              <option value="">Outro item — digitar abaixo</option>
              {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </div>
          <div className="ps-fieldrow">
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Nome *</div>
              <input className="ps-input" value={item.itemName} disabled={!!item.productId}
                onChange={event => updateItem(index, 'itemName', event.target.value)} placeholder="Ex.: Manjericão" />
            </div>
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Unidade *</div>
              <input className="ps-input" value={item.unit} onChange={event => updateItem(index, 'unit', event.target.value)} placeholder="kg, un..." />
            </div>
          </div>
          <div className="ps-fieldrow">
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Quantidade *</div>
              <input className="ps-input" type="number" min="0" step="0.001" inputMode="decimal" value={item.quantity}
                onChange={event => updateItem(index, 'quantity', event.target.value)} />
            </div>
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Preço unitário *</div>
              <input className="ps-input" type="number" min="0" step="0.01" inputMode="decimal" value={item.unitPrice}
                onChange={event => updateItem(index, 'unitPrice', event.target.value)} />
            </div>
            <button className="ps-iconbtn" onClick={() => updateDraft('items', draft.items.filter((_, itemIndex) => itemIndex !== index))}
              aria-label="Remover item" disabled={draft.items.length === 1}><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
      <button className="ps-btn ghost sm" onClick={() => updateDraft('items', [...draft.items, newItem()])}><Plus size={14} /> Adicionar item</button>

      <div className="ps-banner honey" style={{ marginTop: 14 }}>
        <b>Total da compra · {formatBRL(total)}</b>
      </div>

      {!draft.paid && (
        <>
          <div className="ps-fieldrow" style={{ marginTop: 14 }}>
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Número de parcelas</div>
              <input className="ps-input" type="number" min="1" max="12" value={installmentCount}
                onChange={event => recalculateInstallments(Number(event.target.value))} />
            </div>
            <div className="ps-fieldgroup" style={{ justifyContent: 'end' }}>
              <button className="ps-btn ghost sm" onClick={() => recalculateInstallments(installmentCount)}>Recalcular parcelas</button>
            </div>
          </div>
          <div className="ps-label">Vencimentos</div>
          {draft.installments.map((installment, index) => (
            <div className="ps-fieldrow" key={installment.number}>
              <div className="ps-fieldgroup"><div className="ps-fieldlabel">Parcela {installment.number}</div><input className="ps-input" type="date" value={installment.dueDate} onChange={event => updateInstallment(index, 'dueDate', event.target.value)} /></div>
              <div className="ps-fieldgroup"><div className="ps-fieldlabel">Valor</div><input className="ps-input" type="number" min="0" step="0.01" value={installment.amount} onChange={event => updateInstallment(index, 'amount', event.target.value)} /></div>
            </div>
          ))}
        </>
      )}

      {draft.paid && draft.paidDetails && (
        <div className="ps-card" style={{ marginTop: 14, padding: 10, background: 'var(--cream-raise)' }}>
          <b>Dados do pagamento real</b>
          <small style={{ display: 'block', marginTop: 3 }}>A compra entra como paga. Confira a data, o valor e a forma que realmente foram usados.</small>
          <div className="ps-fieldrow" style={{ marginTop: 10 }}>
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="manual-paid-date">Data do pagamento *</label>
              <input id="manual-paid-date" className="ps-input" type="date" min={draft.purchaseDate} max={todayKey()} value={draft.paidDetails.paidDate}
                onChange={event => setDraft(previous => ({ ...previous, paidDetails: previous.paidDetails ? { ...previous.paidDetails, paidDate: event.target.value } : previous.paidDetails }))} />
            </div>
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="manual-paid-amount">Valor realmente pago *</label>
              <input id="manual-paid-amount" className="ps-input" type="number" min={total.toFixed(2)} step="0.01" inputMode="decimal" value={draft.paidDetails.paidAmount}
                onChange={event => setDraft(previous => ({ ...previous, paidDetails: previous.paidDetails ? { ...previous.paidDetails, paidAmount: event.target.value } : previous.paidDetails }))} />
            </div>
          </div>
          <div className="ps-fieldrow">
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="manual-paid-method">Forma real de pagamento *</label>
              <select id="manual-paid-method" className="ps-select" value={draft.paidDetails.paidMethod}
                onChange={event => setDraft(previous => ({ ...previous, paidDetails: previous.paidDetails ? { ...previous.paidDetails, paidMethod: event.target.value as PayableActualPaymentMethod } : previous.paidDetails }))}>
                {(['dinheiro', 'pix', 'transferencia', 'boleto'] as PayableActualPaymentMethod[]).map(method => <option key={method} value={method}>{actualPaymentMethodLabel(method)}</option>)}
              </select>
            </div>
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="manual-current-due-date">Vencimento atualizado</label>
              <input id="manual-current-due-date" className="ps-input" type="date" min={draft.purchaseDate} value={draft.paidDetails.currentDueDate ?? ''}
                onChange={event => setDraft(previous => ({ ...previous, paidDetails: previous.paidDetails ? { ...previous.paidDetails, currentDueDate: event.target.value } : previous.paidDetails }))} />
              <small className="ps-help">Use apenas se recebeu um boleto atualizado.</small>
            </div>
          </div>
        </div>
      )}

      <div className="ps-fieldgroup" style={{ marginTop: 14 }}>
        <div className="ps-fieldlabel">Observação</div>
        <input className="ps-input" value={draft.notes} onChange={event => updateDraft('notes', event.target.value)} placeholder="Ex.: compra semanal do CEASA" />
      </div>

      <div className="ps-totalbar">
        <div className="ps-total-num"><b>{formatBRL(total)}</b><span>{draft.paid ? 'paga à vista' : `${draft.installments.length} parcela(s)`}</span></div>
        <button className="ps-save" disabled={saving || total <= 0} onClick={save}><Save size={16} /> {saving ? 'Salvando...' : 'Registrar conta'}</button>
      </div>
    </div>
  )
}
