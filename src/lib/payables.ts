import { supabase } from '@/lib/supabase'

export type PayableStatus = 'aberta' | 'paga' | 'cancelada'
export type PayablePaymentMethod = 'dinheiro' | 'pix' | 'transferencia' | 'boleto' | 'cartao' | 'outro'
export type PayableDocumentType = 'sem_nota' | 'recibo'

export interface PayableProduct {
  id: string
  name: string
  unit: string | null
}

export interface PayableItemDraft {
  productId: string
  itemName: string
  unit: string
  quantity: string
  unitPrice: string
}

export interface PayableInstallmentDraft {
  number: number
  dueDate: string
  amount: string
}

export interface PayableDraft {
  supplierId: string
  purchaseDate: string
  documentType: PayableDocumentType
  paymentMethod: PayablePaymentMethod
  paid: boolean
  notes: string
  items: PayableItemDraft[]
  installments: PayableInstallmentDraft[]
}

export interface PayableSupplier {
  name: string
}

export interface PayableInstallmentRow {
  id: string
  installment_number: number
  due_date: string
  amount: number | string
  status: 'pendente' | 'paga' | 'cancelada'
}

export interface PayablePurchaseRow {
  id: string
  purchase_date: string
  document_type: PayableDocumentType
  payment_method: PayablePaymentMethod
  status: PayableStatus
  total_value: number | string
  notes: string | null
  suppliers: PayableSupplier | PayableSupplier[] | null
  payable_installments: PayableInstallmentRow[]
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function formatBRL(value: number | string): string {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}

export function statusLabel(status: PayableStatus): string {
  return ({ aberta: 'Em aberto', paga: 'Paga', cancelada: 'Cancelada' } as Record<PayableStatus, string>)[status]
}

export function installmentLabel(status: PayableInstallmentRow['status']): string {
  return ({ pendente: 'Pendente', paga: 'Paga', cancelada: 'Cancelada' } as Record<PayableInstallmentRow['status'], string>)[status]
}

export function totalItems(items: PayableItemDraft[]): number {
  return roundMoney(items.reduce((total, item) => total + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0))
}

export function totalInstallments(installments: PayableInstallmentDraft[]): number {
  return roundMoney(installments.reduce((total, installment) => total + (Number(installment.amount) || 0), 0))
}

export function buildInstallments(total: number, count: number, firstDueDate: string): PayableInstallmentDraft[] {
  const safeCount = Math.max(1, Math.min(12, Math.trunc(count) || 1))
  const base = roundMoney(total / safeCount)
  const installments: PayableInstallmentDraft[] = []

  for (let index = 0; index < safeCount; index += 1) {
    const dueDate = new Date(`${firstDueDate}T12:00:00Z`)
    dueDate.setUTCMonth(dueDate.getUTCMonth() + index)
    const amount = index === safeCount - 1 ? roundMoney(total - base * (safeCount - 1)) : base
    installments.push({
      number: index + 1,
      dueDate: dueDate.toISOString().slice(0, 10),
      amount: amount.toFixed(2),
    })
  }
  return installments
}

export function validateDraft(draft: PayableDraft): string | null {
  if (!draft.supplierId) return 'Selecione o fornecedor.'
  if (!draft.purchaseDate) return 'Informe a data da compra.'
  if (draft.items.length === 0) return 'Adicione pelo menos um item.'
  if (draft.items.some(item => !item.itemName.trim() || !item.unit.trim() || Number(item.quantity) <= 0 || Number(item.unitPrice) <= 0)) {
    return 'Preencha nome, unidade, quantidade e preço de todos os itens.'
  }
  if (draft.installments.length === 0 || draft.installments.some(item => !item.dueDate || Number(item.amount) <= 0)) {
    return 'Preencha os vencimentos e valores das parcelas.'
  }
  if (totalItems(draft.items) !== totalInstallments(draft.installments)) {
    return 'A soma das parcelas precisa ser igual à soma dos itens.'
  }
  return null
}

export function isDueSoon(installment: PayableInstallmentRow, today = new Date()): boolean {
  if (installment.status !== 'pendente') return false
  const due = new Date(`${installment.due_date}T12:00:00Z`).getTime()
  const current = new Date(today.toISOString().slice(0, 10) + 'T12:00:00Z').getTime()
  const days = (due - current) / 86_400_000
  return days >= 0 && days <= 7
}

export function isOverdue(installment: PayableInstallmentRow, today = new Date()): boolean {
  if (installment.status !== 'pendente') return false
  const due = new Date(`${installment.due_date}T12:00:00Z`).getTime()
  const current = new Date(today.toISOString().slice(0, 10) + 'T12:00:00Z').getTime()
  return due < current
}

export async function loadPayablePurchases(): Promise<PayablePurchaseRow[]> {
  const { data, error } = await supabase
    .from('payable_purchases')
    .select('id,purchase_date,document_type,payment_method,status,total_value,notes,suppliers(name),payable_installments(id,installment_number,due_date,amount,status)')
    .order('purchase_date', { ascending: false })

  if (error) throw error
  return (data ?? []) as PayablePurchaseRow[]
}

export async function createManualPayable(draft: PayableDraft, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_manual_payable', {
    p_request_id: requestId,
    p_supplier_id: draft.supplierId,
    p_purchase_date: draft.purchaseDate,
    p_document_type: draft.documentType,
    p_payment_method: draft.paymentMethod,
    p_notes: draft.notes,
    p_paid: draft.paid,
    p_items: draft.items.map(item => ({
      product_id: item.productId || null,
      item_name: item.itemName.trim(),
      unit: item.unit.trim(),
      quantity: Number(item.quantity),
      unit_price: Number(item.unitPrice),
    })),
    p_installments: draft.installments.map(item => ({
      installment_number: item.number,
      due_date: item.dueDate,
      amount: Number(item.amount),
    })),
  })

  if (error) throw error
  if (typeof data !== 'string') throw new Error('O banco não devolveu o lançamento criado.')
  return data
}

export async function payInstallment(installmentId: string): Promise<void> {
  const { error } = await supabase.rpc('pay_manual_payable_installment', { p_installment_id: installmentId })
  if (error) throw error
}

export async function cancelPayable(purchaseId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_manual_payable', {
    p_purchase_id: purchaseId,
    p_reason: reason,
  })
  if (error) throw error
}
