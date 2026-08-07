import { supabase } from '@/lib/supabase'
import type { NfeDraft, NfeItemDraft } from '@/lib/nfeXml'

export type PayableStatus = 'aberta' | 'paga' | 'cancelada'
export type PayablePaymentMethod = 'dinheiro' | 'pix' | 'transferencia' | 'boleto' | 'cartao' | 'outro'
export type PayableDocumentType = 'sem_nota' | 'recibo' | 'nfe'

export interface PayableProduct {
  id: string
  name: string
  unit: string | null
  category?: string | null
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

export interface PayableSupplierOption {
  id: string
  name: string
  cnpj: string | null
}

export interface PayableInstallmentRow {
  id: string
  installment_number: number
  due_date: string
  amount: number | string
  status: 'pendente' | 'paga' | 'cancelada'
  paid_at?: string | null
}

export interface PayablePurchaseRow {
  id: string
  purchase_date: string
  document_type: PayableDocumentType
  payment_method: PayablePaymentMethod
  status: PayableStatus
  total_value: number | string
  notes: string | null
  origin?: 'manual' | 'xml'
  nfe_key?: string | null
  nfe_number?: string | null
  nfe_series?: string | null
  classification_status?: 'completa' | 'pendente'
  suppliers: PayableSupplier | PayableSupplier[] | null
  payable_installments: PayableInstallmentRow[]
}

export interface PendingPayableItemRow {
  id: string
  purchase_id: string
  item_name: string
  unit: string
  quantity: number | string
  unit_price: number | string
  line_total: number | string
  source_description: string | null
  source_unit: string | null
  source_quantity: number | string | null
  source_product_code: string | null
  source_ean: string | null
  conversion_basis: NfeItemDraft['conversionBasis'] | null
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
    .select('id,purchase_date,document_type,payment_method,status,total_value,notes,origin,nfe_key,nfe_number,nfe_series,classification_status,suppliers(name),payable_installments(id,installment_number,due_date,amount,status,paid_at)')
    .order('purchase_date', { ascending: false })

  if (error) throw error
  return (data ?? []) as PayablePurchaseRow[]
}

export async function loadPendingPayableItems(purchaseId: string): Promise<PendingPayableItemRow[]> {
  const { data, error } = await supabase
    .from('payable_purchase_items')
    .select('id,purchase_id,item_name,unit,quantity,unit_price,line_total,source_description,source_unit,source_quantity,source_product_code,source_ean,conversion_basis')
    .eq('purchase_id', purchaseId)
    .eq('mapping_status', 'pendente')
    .order('source_line_number')

  if (error) throw error
  return (data ?? []) as PendingPayableItemRow[]
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

export async function createPayableCatalogProduct(name: string, category: string, unit: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_payable_catalog_product', {
    p_name: name.trim(),
    p_category: category.trim(),
    p_unit: unit.trim(),
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('O banco não devolveu o item cadastrado.')
  return data
}

export async function createPayableSupplier(name: string, cnpj: string): Promise<PayableSupplierOption> {
  const { data, error } = await supabase.rpc('create_payable_supplier', {
    p_name: name.trim(),
    p_cnpj: cnpj.trim() || null,
  })
  if (error) throw error
  const supplier = Array.isArray(data) ? data[0] : data
  if (!supplier || typeof supplier.id !== 'string' || typeof supplier.name !== 'string') {
    throw new Error('O banco nÃ£o devolveu o fornecedor cadastrado.')
  }
  return {
    id: supplier.id,
    name: supplier.name,
    cnpj: typeof supplier.cnpj === 'string' ? supplier.cnpj : null,
  }
}

export async function createXmlPayable(draft: NfeDraft, supplierId: string, requestId: string, notes = ''): Promise<string> {
  const { data, error } = await supabase.rpc('create_xml_payable', {
    p_request_id: requestId,
    p_access_key: draft.accessKey,
    p_supplier_id: supplierId,
    p_nfe_number: draft.number,
    p_nfe_series: draft.series,
    p_issue_date: draft.issueDate,
    p_payment_method: draft.paymentMethod,
    p_total_value: draft.total,
    p_notes: notes,
    p_items: draft.items.map(item => ({
      line_number: item.lineNumber,
      supplier_product_code: item.supplierCode,
      supplier_ean: item.ean,
      source_description: item.description,
      source_unit: item.purchaseUnit,
      source_quantity: item.quantity,
      product_id: item.baseProductId,
      conversion_basis: item.conversionBasis,
      conversion_factor: item.conversionFactor,
      usable_quantity: item.usableQuantity,
      unit_price: item.unitPrice,
      line_total: item.lineTotal,
      remember_conversion: item.rememberConversion,
    })),
    p_installments: draft.installments.map(item => ({
      installment_number: item.number,
      due_date: item.dueDate,
      amount: item.amount,
    })),
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('O banco não devolveu a conta importada.')
  return data
}

export async function classifyPayableItem(
  itemId: string,
  productId: string,
  basis: NfeItemDraft['conversionBasis'],
  factor: number,
  usableQuantity: number,
  rememberConversion: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('classify_payable_item', {
    p_item_id: itemId,
    p_product_id: productId,
    p_conversion_basis: basis,
    p_conversion_factor: factor,
    p_usable_quantity: usableQuantity,
    p_remember_conversion: rememberConversion,
  })
  if (error) throw error
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
