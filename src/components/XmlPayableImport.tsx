'use client'

import { useRef, useState } from 'react'
import { FileUp, Plus, Save, X } from 'lucide-react'
import {
  calculateUsableQuantity,
  parseNfeXml,
  type NfeConversionBasis,
  type NfeDraft,
  type NfeItemDraft,
} from '@/lib/nfeXml'
import {
  createPayableCatalogProduct,
  createPayableSupplier,
  createXmlPayable,
  formatBRL,
  getPayableErrorMessage,
  type PayableProduct,
} from '@/lib/payables'
import { showToast } from '@/lib/utils'
import { ConversionEditor, ProductSelector } from '@/components/XmlConversionEditor'

export interface XmlSupplierOption { id: string; name: string; cnpj: string | null }

interface ProductMapping {
  supplier_product_code: string | null
  supplier_ean: string | null
  supplier_description: string
  purchase_unit: string
  base_product_id: string
  base_unit: string
  conversion_basis: NfeConversionBasis
  conversion_factor: number
}

interface XmlPayableImportProps {
  suppliers: XmlSupplierOption[]
  products: PayableProduct[]
  onSaved: () => Promise<void> | void
  onCancel: () => void
}

function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

function initialFactor(item: NfeItemDraft): number {
  return item.conversionBasis === 'simple' ? 1 : 1
}

function withProduct(item: NfeItemDraft, product: PayableProduct, factor = initialFactor(item)): NfeItemDraft {
  return {
    ...item,
    baseProductId: product.id,
    baseProductName: product.name,
    baseUnit: product.unit ?? 'un',
    category: product.category ?? null,
    conversionFactor: factor,
    usableQuantity: calculateUsableQuantity(item.quantity, factor),
    mappingStatus: 'mapeado',
  }
}

function clearProduct(item: NfeItemDraft): NfeItemDraft {
  return {
    ...item,
    baseProductId: null,
    baseProductName: null,
    baseUnit: null,
    category: null,
    conversionFactor: null,
    usableQuantity: null,
    mappingStatus: 'pendente',
  }
}

function findMapping(item: NfeItemDraft, mappings: ProductMapping[]): ProductMapping | undefined {
  return mappings.find(mapping => (
    mapping.purchase_unit === item.purchaseUnit
      && ((item.supplierCode && mapping.supplier_product_code === item.supplierCode)
        || (item.ean && mapping.supplier_ean === item.ean)
        || (!item.supplierCode && !item.ean && mapping.supplier_description.trim().toLowerCase() === item.description.trim().toLowerCase()))
  ))
}

export default function XmlPayableImport({ suppliers, products, onSaved, onCancel }: XmlPayableImportProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(crypto.randomUUID())
  const [draft, setDraft] = useState<NfeDraft | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [availableSuppliers, setAvailableSuppliers] = useState(suppliers)
  const [catalog, setCatalog] = useState(products)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creatingLine, setCreatingLine] = useState<number | null>(null)
  const [creatingSupplier, setCreatingSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState({ name: '', cnpj: '' })
  const [newProduct, setNewProduct] = useState({ name: '', category: 'Insumos', unit: 'un' })
  const [autoMappedCount, setAutoMappedCount] = useState(0)
  const [duplicateNfe, setDuplicateNfe] = useState(false)

  async function readFile(file: File) {
    setError(null)
    setDuplicateNfe(false)
    try {
      const nextDraft = parseNfeXml(await file.text())
      const { supabase } = await import('@/lib/supabase')
      const { data: existingPurchase, error: duplicateError } = await supabase
        .from('payable_purchases')
        .select('id')
        .eq('nfe_key', nextDraft.accessKey)
        .maybeSingle()
      if (duplicateError) throw new Error('Não foi possível verificar se esta NF-e já foi importada.')
      setDraft(nextDraft)
      setDuplicateNfe(Boolean(existingPurchase))
      setAutoMappedCount(0)
      setCreatingSupplier(false)
      const matched = availableSuppliers.find(supplier => digits(supplier.cnpj) === digits(nextDraft.supplierCnpj) && digits(nextDraft.supplierCnpj) !== '')
      setSupplierId(matched?.id ?? '')
      if (!matched) setError(`Fornecedor do XML: ${nextDraft.supplierName}. Cadastre-o aqui ou selecione um cadastro correspondente.`)
      if (matched) await loadMappings(matched.id, nextDraft)
    } catch (readError) {
      setDraft(null)
      setError(getPayableErrorMessage(readError, 'Não foi possível ler o XML.'))
    }
  }

  async function loadMappings(nextSupplierId: string, nextDraft = draft) {
    if (!nextDraft || !nextSupplierId) return
    const { data, error: mappingError } = await (await import('@/lib/supabase')).supabase
      .from('payable_product_mappings')
      .select('supplier_product_code,supplier_ean,supplier_description,purchase_unit,base_product_id,base_unit,conversion_basis,conversion_factor')
      .eq('supplier_id', nextSupplierId)
      .eq('active', true)
    if (mappingError) { setAutoMappedCount(0); setError('Não foi possível carregar os últimos fatores deste fornecedor.'); return }
    const nextMappings = (data ?? []) as ProductMapping[]
    let appliedCount = 0
    const mappedItems = nextDraft.items.map(item => {
      const mapping = findMapping(item, nextMappings)
      const product = mapping ? catalog.find(candidate => candidate.id === mapping.base_product_id) : undefined
      if (!product) return item
      appliedCount += 1
      return withProduct(item, product, Number(mapping?.conversion_factor) || 1)
    })
    setAutoMappedCount(appliedCount)
    setDraft({ ...nextDraft, items: mappedItems })
  }

  function updateItem(index: number, next: NfeItemDraft) {
    setDraft(previous => previous ? { ...previous, items: previous.items.map((item, itemIndex) => itemIndex === index ? next : item) } : previous)
  }

  function updateInstallmentDueDate(index: number, dueDate: string) {
    setDraft(previous => previous
      ? { ...previous, installments: previous.installments.map((item, itemIndex) => itemIndex === index ? { ...item, dueDate } : item) }
      : previous)
  }

  function selectProduct(index: number, productId: string) {
    const product = catalog.find(candidate => candidate.id === productId)
    if (!product) {
      if (draft) updateItem(index, clearProduct(draft.items[index]))
      return
    }
    if (draft) updateItem(index, withProduct(draft.items[index], product))
  }

  async function saveNewProduct(index: number) {
    if (!newProduct.name.trim() || !newProduct.unit.trim()) { showToast('Informe nome e unidade do item novo.'); return }
    setSaving(true)
    try {
      const id = await createPayableCatalogProduct(newProduct.name, newProduct.category, newProduct.unit)
      const product: PayableProduct = { id, name: newProduct.name.trim(), category: newProduct.category, unit: newProduct.unit.trim() }
      setCatalog(previous => [...previous, product])
      if (draft) updateItem(index, withProduct(draft.items[index], product))
      setCreatingLine(null)
      setNewProduct({ name: '', category: 'Insumos', unit: 'un' })
      showToast('Item criado e vinculado à NF-e.')
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : 'Não foi possível criar o item.')
    } finally { setSaving(false) }
  }

  function openSupplierForm() {
    if (!draft) return
    setNewSupplier({ name: draft.supplierName, cnpj: draft.supplierCnpj })
    setCreatingSupplier(true)
  }

  async function saveNewSupplier() {
    if (!newSupplier.name.trim()) { showToast('Informe o nome do fornecedor.'); return }
    setSaving(true)
    try {
      const supplier = await createPayableSupplier(newSupplier.name, newSupplier.cnpj)
      setAvailableSuppliers(previous => previous.some(item => item.id === supplier.id)
        ? previous
        : [...previous, supplier].sort((left, right) => left.name.localeCompare(right.name)))
      setSupplierId(supplier.id)
      setCreatingSupplier(false)
      await loadMappings(supplier.id)
      showToast('Fornecedor cadastrado e vinculado à NF-e.')
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : 'Não foi possível cadastrar o fornecedor.')
    } finally { setSaving(false) }
  }

  async function confirmImport() {
    if (!draft) return
    if (duplicateNfe) { showToast('Esta NF-e já foi importada. Não é necessário cadastrá-la novamente.'); return }
    if (!supplierId) { showToast('Selecione o fornecedor desta NF-e.'); return }
    if (draft.installments.some(item => !item.dueDate)) { showToast('Informe o vencimento de cada parcela antes de confirmar.'); return }
    if (draft.installments.some(item => item.amount <= 0)) { showToast('A NF-e não tem parcelas válidas para o financeiro.'); return }
    setSaving(true)
    try {
      await createXmlPayable(draft, supplierId, requestIdRef.current)
      showToast(draft.items.some(item => item.mappingStatus === 'pendente') ? 'Conta importada. Há itens aguardando classificação.' : 'NF-e importada e custo atualizado.')
      await onSaved()
    } catch (saveError) {
      showToast(getPayableErrorMessage(saveError, 'Não foi possível importar a NF-e.'))
    } finally { setSaving(false) }
  }

  const mappedCount = draft?.items.filter(item => item.mappingStatus === 'mapeado').length ?? 0
  const missingDueDate = draft?.installments.some(item => !item.dueDate) ?? false

  return (
    <div className="ps-card" style={{ marginTop: 14 }}>
      <div className="ps-card-head">
        <div><b>Importar NF-e</b><small>O financeiro pode ser confirmado mesmo se algum item ficar pendente.</small></div>
        <button className="ps-iconbtn" onClick={onCancel} aria-label="Fechar importação"><X size={16} /></button>
      </div>

      <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file) }} />
      {!draft && <button className="ps-btn primary block" onClick={() => fileRef.current?.click()}><FileUp size={16} /> Escolher arquivo XML</button>}
      {error && <div className="ps-card" style={{ marginTop: 10, borderColor: 'var(--berry)' }}><b>Revise antes de continuar</b><small style={{ display: 'block', marginTop: 4 }}>{error}</small></div>}

      {draft && (
        <>
          <div className="ps-banner honey" style={{ marginTop: 10 }}>
            <b>{draft.supplierName}</b>
            <small>NF {draft.number}{draft.series ? ` · série ${draft.series}` : ''} · emitida em {draft.issueDate} · {formatBRL(draft.total)}</small>
            <small style={{ display: 'block' }}>Chave: {draft.accessKey}</small>
          </div>
          {duplicateNfe && (
            <div role="alert" className="ps-card" style={{ marginTop: 10, borderColor: 'var(--berry)', background: 'var(--berry-tint)' }}>
              <b>NF-e já importada</b>
              <small style={{ display: 'block', marginTop: 4 }}>
                Esta chave de acesso já está registrada no Contas a pagar. A importação foi bloqueada para evitar duplicidade.
              </small>
            </div>
          )}
          {autoMappedCount > 0 && (
            <div className="ps-banner" style={{ marginTop: 10 }}>
              <b>{autoMappedCount} {autoMappedCount === 1 ? 'conversão reaproveitada' : 'conversões reaproveitadas'} automaticamente</b>
              <small style={{ display: 'block', marginTop: 3 }}>O ERP encontrou fornecedor, item-base e fator já confirmados. Confira os itens abaixo e altere somente se necessário.</small>
            </div>
          )}
          <div className="ps-fieldgroup" style={{ marginTop: 10 }}>
            <div className="ps-fieldlabel">Fornecedor no ERP *</div>
            <select className="ps-select" value={supplierId} onChange={event => { setSupplierId(event.target.value); if (!event.target.value) setAutoMappedCount(0); void loadMappings(event.target.value) }}>
              <option value="">Selecione o fornecedor</option>
              {availableSuppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.cnpj ? ` · ${supplier.cnpj}` : ''}</option>)}
            </select>
            {!supplierId && <button className="ps-btn ghost sm" style={{ marginTop: 8 }} onClick={openSupplierForm}><Plus size={14} /> Cadastrar fornecedor com dados da NF-e</button>}
          </div>

          {creatingSupplier && (
            <div className="ps-banner" style={{ marginTop: 10 }}>
              <b>Cadastro rápido do fornecedor</b>
              <small style={{ display: 'block', marginTop: 3 }}>Confira os dados lidos da NF-e. Depois de salvar, ele ficará selecionado nesta importação.</small>
              <div className="ps-fieldrow" style={{ marginTop: 8 }}>
                <div className="ps-fieldgroup"><div className="ps-fieldlabel">Nome do fornecedor *</div><input className="ps-input" placeholder="Nome do fornecedor" value={newSupplier.name} onChange={event => setNewSupplier(previous => ({ ...previous, name: event.target.value }))} /></div>
                <div className="ps-fieldgroup"><div className="ps-fieldlabel">CNPJ/CPF</div><input className="ps-input" placeholder="CNPJ ou CPF" value={newSupplier.cnpj} onChange={event => setNewSupplier(previous => ({ ...previous, cnpj: event.target.value }))} /></div>
              </div>
              <div style={{ marginTop: 8 }}>
                <button className="ps-btn primary sm" disabled={saving} onClick={() => void saveNewSupplier()}><Save size={14} /> {saving ? 'Salvando...' : 'Cadastrar e usar fornecedor'}</button>{' '}
                <button className="ps-btn ghost sm" disabled={saving} onClick={() => setCreatingSupplier(false)}>Cancelar</button>
              </div>
            </div>
          )}

          <div className="ps-label" style={{ marginTop: 14 }}>Itens da NF-e · {mappedCount}/{draft.items.length} classificados</div>
          {draft.items.map((item, index) => (
            <div className="ps-card" key={`${item.lineNumber}-${item.description}`} style={{ marginBottom: 8, padding: 10, background: 'var(--cream-raise)' }}>
              <b>{item.lineNumber}. {item.description}</b>
              <small style={{ display: 'block', marginTop: 3 }}>{item.quantity} {item.purchaseUnit} · {formatBRL(item.lineTotal)}{item.discountValue > 0 ? ` · bruto ${formatBRL(item.grossLineTotal)} · desconto ${formatBRL(item.discountValue)}` : ''}{item.supplierCode ? ` · código ${item.supplierCode}` : ''}</small>
              <ProductSelector item={item} products={catalog} onChange={productId => selectProduct(index, productId)} onCreate={() => setCreatingLine(index)} />
              {creatingLine === index && (
                <div className="ps-banner" style={{ marginTop: 8 }}>
                  <div className="ps-fieldgroup"><div className="ps-fieldlabel">Nome do novo item-base</div><input className="ps-input" value={newProduct.name} onChange={event => setNewProduct(previous => ({ ...previous, name: event.target.value }))} placeholder="Ex.: Saco de papel 2 kg" /></div>
                  <div className="ps-fieldrow" style={{ marginTop: 8 }}>
                    <div className="ps-fieldgroup"><div className="ps-fieldlabel">Categoria</div><input className="ps-input" value={newProduct.category} onChange={event => setNewProduct(previous => ({ ...previous, category: event.target.value }))} /></div>
                    <div className="ps-fieldgroup"><div className="ps-fieldlabel">Unidade da receita</div><input className="ps-input" value={newProduct.unit} onChange={event => setNewProduct(previous => ({ ...previous, unit: event.target.value }))} /></div>
                  </div>
                  <div style={{ marginTop: 8 }}><button className="ps-btn primary sm" disabled={saving} onClick={() => void saveNewProduct(index)}><Save size={14} /> Criar e vincular</button> <button className="ps-btn ghost sm" onClick={() => setCreatingLine(null)}>Cancelar</button></div>
                </div>
              )}
              <ConversionEditor item={item} onChange={next => updateItem(index, next)} />
            </div>
          ))}
          <div className="ps-banner" style={{ marginTop: 10 }}>
            <b>Parcelas do financeiro</b>
            {draft.dueDateSource === 'ausente' && (
              <div role="alert" className="ps-card" style={{ marginTop: 8, borderColor: 'var(--berry)', background: 'var(--berry-tint)' }}>
                <b>Esta NF-e não informou o vencimento</b>
                <small style={{ display: 'block', marginTop: 4 }}>
                  O XML traz o valor, mas não a data. Confira o vencimento no papel da nota, no campo Fatura/Duplicatas, e digite abaixo.
                </small>
              </div>
            )}
            {draft.dueDateSource === 'a-vista' && (
              <small style={{ display: 'block', marginTop: 4 }}>
                O XML não informou vencimento e o pagamento é em {draft.paymentMethod === 'pix' ? 'pix' : 'dinheiro'}. Lançamos como à vista, na data de emissão. Corrija abaixo se não for isso.
              </small>
            )}
            {draft.installments.map((installment, index) => (
              <div className="ps-fieldgroup" key={installment.number} style={{ marginTop: 8 }}>
                <label className="ps-fieldlabel" htmlFor={`xml-due-date-${installment.number}`}>Parcela {installment.number} · {formatBRL(installment.amount)} · vence em</label>
                <input
                  id={`xml-due-date-${installment.number}`}
                  className="ps-input"
                  type="date"
                  min={draft.issueDate}
                  value={installment.dueDate}
                  onChange={event => updateInstallmentDueDate(index, event.target.value)}
                />
              </div>
            ))}
          </div>
          {missingDueDate && (
            <small style={{ display: 'block', marginTop: 10, color: 'var(--berry)' }}>
              Falta o vencimento. Preencha a data acima para liberar a confirmação.
            </small>
          )}
          <div className="ps-totalbar">
            <div className="ps-total-num"><b>{formatBRL(draft.total)}</b><span>{mappedCount === draft.items.length ? 'itens classificados' : `${draft.items.length - mappedCount} item(ns) pendente(s)`}</span></div>
            <button className="ps-save" disabled={saving || !supplierId || duplicateNfe || missingDueDate} onClick={() => void confirmImport()}><Save size={16} /> {saving ? 'Importando...' : 'Confirmar NF-e'}</button>
          </div>
        </>
      )}
    </div>
  )
}
