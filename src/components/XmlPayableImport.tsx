'use client'

import { useMemo, useRef, useState } from 'react'
import { FileClock, FileUp, Plus, Save, X } from 'lucide-react'
import {
  findLatestSupplierMapping,
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
import {
  applyInstallmentDecisions,
  applyItemDecisions,
  clearProduct,
  confirmXmlImportDraft,
  findPendingXmlImportDraft,
  formatDraftSavedAt,
  loadXmlImportDraft,
  saveXmlImportDraft,
  withProduct,
  withoutProduct,
  type XmlImportDraftContent,
  type XmlImportDraftRow,
} from '@/lib/xmlImportDrafts'
import { showToast } from '@/lib/utils'
import { composeNfe, compositionBlockReason, compositionCloses, formatCompositionMoney, type NfeComposition } from '@/lib/nfeComposition'
import { ConversionEditor, ProductSelector, conversionNeedsAttention } from '@/components/XmlConversionEditor'

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
  factor_confirmed: boolean
  updated_at: string
}

interface NonCatalogMapping {
  supplier_product_code: string | null
  supplier_ean: string | null
  supplier_description: string
  purchase_unit: string
  updated_at: string
}

interface XmlPayableImportProps {
  suppliers: XmlSupplierOption[]
  products: PayableProduct[]
  /** Importação salva pela metade para retomar; a nota é relida do XML guardado. */
  initialDraft?: XmlImportDraftContent | null
  onSaved: () => Promise<void> | void
  onCancel: () => void
}

function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

interface ResumedImport {
  draft: NfeDraft
  xmlText: string
  supplierId: string
  lostLines: number[]
}

/**
 * Retomar é reler o XML com o leitor de hoje e reaplicar só as decisões da
 * pessoa. Fornecedor salvo vence; sem ele, vale o CNPJ da nota, como na leitura
 * de um arquivo novo.
 */
function resumeImport(content: XmlImportDraftContent, suppliers: readonly XmlSupplierOption[], catalog: readonly PayableProduct[]): ResumedImport {
  const parsed = parseNfeXml(content.xml_content)
  const applied = applyItemDecisions(parsed, content.item_decisions, catalog)
  const draft = applyInstallmentDecisions(applied.draft, content.installments)
  const matched = suppliers.find(supplier => digits(supplier.cnpj) === digits(draft.supplierCnpj) && digits(draft.supplierCnpj) !== '')
  const supplierId = content.supplier_id && suppliers.some(supplier => supplier.id === content.supplier_id)
    ? content.supplier_id
    : matched?.id ?? ''
  return { draft, xmlText: content.xml_content, supplierId, lostLines: applied.lostLines }
}

/**
 * A Elis confere a nota contra a DANFE olhando um e outro: produtos, cada
 * acréscimo com seu nome, descontos e total, como estão na nota. Resumo na
 * frente, detalhe atrás de um toque. Nunca há botão que feche a diferença.
 */
function CompositionCard({ composition }: { composition: NfeComposition }) {
  const closes = compositionCloses(composition)
  const summary = [
    `produtos ${formatCompositionMoney(composition.products)}`,
    composition.discounts > 0 ? `descontos −${formatCompositionMoney(composition.discounts)}` : null,
    composition.surchargesTotal > 0 ? `acréscimos ${formatCompositionMoney(composition.surchargesTotal)}` : null,
    composition.exemptionDeducted > 0 ? `ICMS desonerado −${formatCompositionMoney(composition.exemptionDeducted)}` : null,
    `total ${formatCompositionMoney(composition.total)}`,
  ].filter(Boolean).join(' · ')
  const lineStyle = { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 } as const
  return (
    <div className="ps-card" style={{ marginTop: 10, padding: 10, background: 'var(--cream-raise)', borderLeft: `4px solid ${closes ? 'var(--teal)' : 'var(--berry)'}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ flex: 1 }}>Composição da nota</b>
        <small style={{ color: closes ? 'var(--teal)' : 'var(--berry)', fontWeight: 650 }}>
          {closes ? 'fecha até o centavo' : composition.blockers.length > 0 ? 'caso sem regra' : `${formatCompositionMoney(Math.abs(composition.unexplained))} sem explicação`}
        </small>
      </div>
      <small style={{ display: 'block', marginTop: 3 }}>{summary}</small>
      <details style={{ marginTop: 6 }}>
        <summary><small>Ver a conta da nota</small></summary>
        <small style={lineStyle}><span>Produtos</span><span>{formatCompositionMoney(composition.products)}</span></small>
        {composition.discounts > 0 && <small style={lineStyle}><span>Descontos</span><span>−{formatCompositionMoney(composition.discounts)}</span></small>}
        {composition.surcharges.map(line => (
          <small key={line.key} style={lineStyle}><span>{line.label}</span><span>{formatCompositionMoney(line.amount)}</span></small>
        ))}
        {composition.exemptionDeducted > 0 && <small style={lineStyle}><span>ICMS desonerado abatido</span><span>−{formatCompositionMoney(composition.exemptionDeducted)}</span></small>}
        <small style={{ ...lineStyle, fontWeight: 650 }}><span>Soma do que foi lido</span><span>{formatCompositionMoney(composition.expectedTotal)}</span></small>
        <small style={{ ...lineStyle, fontWeight: 650 }}><span>Total declarado na nota</span><span>{formatCompositionMoney(composition.total)}</span></small>
      </details>
      {composition.blockers.length > 0 && (
        <div role="alert" className="ps-card" style={{ marginTop: 8, borderColor: 'var(--berry)', background: 'var(--berry-tint)' }}>
          <b>Esta nota traz um caso que o ERP ainda não sabe conferir</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {composition.blockers.map(reason => <li key={reason}><small>{reason}</small></li>)}
          </ul>
          <small style={{ display: 'block', marginTop: 4 }}>Lance esta compra à mão até esse caso ser liberado. Não invente item para fechar a conta.</small>
        </div>
      )}
      {composition.blockers.length === 0 && composition.unexplained !== 0 && (
        <div role="alert" className="ps-card" style={{ marginTop: 8, borderColor: 'var(--berry)', background: 'var(--berry-tint)' }}>
          <b>{formatCompositionMoney(Math.abs(composition.unexplained))} da nota ficaram sem explicação</b>
          <small style={{ display: 'block', marginTop: 4 }}>
            Produtos, descontos e acréscimos lidos somam {formatCompositionMoney(composition.expectedTotal)}, mas a nota declara {formatCompositionMoney(composition.total)}.
          </small>
          <small style={{ display: 'block', marginTop: 4 }}>
            Confira o arquivo com o fornecedor. Se o XML estiver correto, é a leitura do ERP que está falhando: avise a equipe técnica.
          </small>
        </div>
      )}
      {closes && composition.surchargesTotal > 0 && (
        <div role="alert" className="ps-card" style={{ marginTop: 8, borderColor: 'var(--berry)', background: 'var(--berry-tint)' }}>
          <b>{formatCompositionMoney(composition.surchargesTotal)} de acréscimos ainda não entram pelo XML</b>
          <small style={{ display: 'block', marginTop: 4 }}>
            A nota fecha, mas o ERP ainda não importa imposto por fora nem despesa acessória. Lance esta compra à mão, somando o imposto e a despesa como itens, até a próxima fase entrar.
          </small>
        </div>
      )}
    </div>
  )
}

function itemStatus(item: NfeItemDraft): { label: string; color: string } {
  if (item.mappingStatus === 'nao_aplicavel') return { label: item.recognized ? 'uso/despesa reconhecido' : 'uso/despesa', color: 'var(--teal)' }
  if (!item.baseProductId) return { label: 'item novo', color: 'var(--red)' }
  if (conversionNeedsAttention(item)) return { label: 'confira a embalagem', color: 'var(--red)' }
  if (item.recognized) return { label: 'reconhecido', color: 'var(--teal)' }
  return { label: 'vinculado agora', color: 'var(--teal)' }
}

function lostLinesMessage(lines: readonly number[]): string {
  const list = lines.join(', ')
  return lines.length === 1
    ? `O item-base da linha ${list} saiu do catálogo desde que a importação foi salva. Classifique essa linha de novo.`
    : `Os itens-base das linhas ${list} saíram do catálogo desde que a importação foi salva. Classifique essas linhas de novo.`
}

export default function XmlPayableImport({ suppliers, products, initialDraft = null, onSaved, onCancel }: XmlPayableImportProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(crypto.randomUUID())
  // A retomada acontece uma vez, na montagem; depois disso a pessoa é dona do
  // rascunho e nenhuma recarga de lista pode sobrescrever o que ela mudou.
  const [initial] = useState<{ resumed: ResumedImport | null; error: string | null }>(() => {
    if (!initialDraft) return { resumed: null, error: null }
    try {
      const resumed = resumeImport(initialDraft, suppliers, products)
      return { resumed, error: resumed.lostLines.length > 0 ? lostLinesMessage(resumed.lostLines) : null }
    } catch (resumeError) {
      return { resumed: null, error: getPayableErrorMessage(resumeError, 'Não foi possível reabrir a importação pendente.') }
    }
  })
  const [draft, setDraft] = useState<NfeDraft | null>(initial.resumed?.draft ?? null)
  const [supplierId, setSupplierId] = useState(initial.resumed?.supplierId ?? '')
  const [xmlText, setXmlText] = useState(initial.resumed?.xmlText ?? '')
  const [resumedDraft, setResumedDraft] = useState<XmlImportDraftContent | null>(initial.resumed ? initialDraft : null)
  // Arquivo lido cuja NF-e já tem importação pendente: a pessoa escolhe entre
  // continuar de onde parou ou recomeçar do XML.
  const [pendingDraft, setPendingDraft] = useState<XmlImportDraftRow | null>(null)
  // As listas vêm da página e continuam chegando depois da montagem. Guardá-las
  // em useState congelava a versão vazia: quem abria a importação antes de o
  // cadastro carregar ficava sem nenhum insumo para escolher e ia criar um novo.
  const [createdSuppliers, setCreatedSuppliers] = useState<XmlSupplierOption[]>([])
  const [createdProducts, setCreatedProducts] = useState<PayableProduct[]>([])
  const availableSuppliers = useMemo(
    () => [...suppliers, ...createdSuppliers.filter(extra => !suppliers.some(known => known.id === extra.id))]
      .sort((left, right) => left.name.localeCompare(right.name)),
    [suppliers, createdSuppliers],
  )
  const catalog = useMemo(
    () => [...products, ...createdProducts.filter(extra => !products.some(known => known.id === extra.id))],
    [products, createdProducts],
  )
  const [error, setError] = useState<string | null>(initial.error)
  const [saving, setSaving] = useState(false)
  const [creatingLine, setCreatingLine] = useState<number | null>(null)
  const [creatingSupplier, setCreatingSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState({ name: '', cnpj: '' })
  const [newProduct, setNewProduct] = useState({ name: '', category: 'Insumos', unit: 'un', useNfeName: true })
  const [autoMappedCount, setAutoMappedCount] = useState(0)
  const [duplicateNfe, setDuplicateNfe] = useState(false)

  async function readFile(file: File) {
    setError(null)
    setDuplicateNfe(false)
    try {
      const text = await file.text()
      const nextDraft = parseNfeXml(text)
      const { supabase } = await import('@/lib/supabase')
      const { data: existingPurchase, error: duplicateError } = await supabase
        .from('payable_purchases')
        .select('id')
        .eq('nfe_key', nextDraft.accessKey)
        .maybeSingle()
      if (duplicateError) throw new Error('Não foi possível verificar se esta NF-e já foi importada.')
      // Nota já importada não tem rascunho pendente por regra do banco; só vale
      // procurar quando a conta ainda não existe.
      const savedDraft = existingPurchase ? null : await findPendingXmlImportDraft(nextDraft.accessKey)
      setDraft(nextDraft)
      setXmlText(text)
      setResumedDraft(null)
      setPendingDraft(savedDraft)
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
    const { supabase } = await import('@/lib/supabase')
    const [productResult, nonCatalogResult] = await Promise.all([
      supabase
        .from('payable_product_mappings')
        .select('supplier_product_code,supplier_ean,supplier_description,purchase_unit,base_product_id,base_unit,conversion_basis,conversion_factor,factor_confirmed,updated_at')
        .eq('supplier_id', nextSupplierId)
        .eq('active', true),
      supabase
        .from('payable_non_catalog_mappings')
        .select('supplier_product_code,supplier_ean,supplier_description,purchase_unit,updated_at')
        .eq('supplier_id', nextSupplierId)
        .eq('active', true),
    ])
    if (productResult.error || nonCatalogResult.error) { setAutoMappedCount(0); setError('Não foi possível carregar as classificações anteriores deste fornecedor.'); return }
    const nextMappings = (productResult.data ?? []) as ProductMapping[]
    const nonCatalogMappings = (nonCatalogResult.data ?? []) as NonCatalogMapping[]
    let appliedCount = 0
    const mappedItems = nextDraft.items.map(item => {
      const mapping = findLatestSupplierMapping(item, nextMappings)
      const nonCatalog = findLatestSupplierMapping(item, nonCatalogMappings)
      if (nonCatalog && (!mapping || nonCatalog.updated_at >= mapping.updated_at)) {
        appliedCount += 1
        return withoutProduct(item, true)
      }
      const product = mapping ? catalog.find(candidate => candidate.id === mapping.base_product_id) : undefined
      if (!product) return item
      appliedCount += 1
      const factor = Number(mapping?.conversion_factor) || 1
      return withProduct(item, product, factor, true, Boolean(mapping?.factor_confirmed) || factor !== 1)
    })
    setAutoMappedCount(appliedCount)
    setDraft({ ...nextDraft, items: mappedItems })
  }

  function updateItem(index: number, next: NfeItemDraft) {
    setDraft(previous => previous ? { ...previous, items: previous.items.map((item, itemIndex) => itemIndex === index ? next : item) } : previous)
  }

  function openProductForm(index: number) {
    if (!draft) return
    setNewProduct({ name: draft.items[index].description, category: 'Insumos', unit: 'un', useNfeName: true })
    setCreatingLine(index)
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

  function markWithoutProduct(index: number) {
    if (draft) updateItem(index, withoutProduct(draft.items[index]))
  }

  async function saveNewProduct(index: number) {
    if (!newProduct.name.trim() || !newProduct.unit.trim()) { showToast('Informe nome e unidade do item novo.'); return }
    setSaving(true)
    try {
      const id = await createPayableCatalogProduct(newProduct.name, newProduct.category, newProduct.unit)
      const product: PayableProduct = { id, name: newProduct.name.trim(), category: newProduct.category, unit: newProduct.unit.trim() }
      setCreatedProducts(previous => [...previous, product])
      if (draft) updateItem(index, withProduct(draft.items[index], product))
      setCreatingLine(null)
      setNewProduct({ name: '', category: 'Insumos', unit: 'un', useNfeName: true })
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
      setCreatedSuppliers(previous => previous.some(item => item.id === supplier.id) ? previous : [...previous, supplier])
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
    if (draft.installments.some(item => item.dueDate < draft.issueDate)) { showToast('Há vencimento anterior à emissão da nota. Confira a data digitada.'); return }
    if (draft.installments.some(item => item.amount <= 0)) { showToast('A NF-e não tem parcelas válidas para o financeiro.'); return }
    if (draft.items.some(conversionNeedsAttention)) { showToast('Confira quanto vem na embalagem dos itens marcados em vermelho.'); return }
    const compositionReason = compositionBlockReason(composeNfe(draft))
    if (compositionReason) { showToast(compositionReason); return }
    setSaving(true)
    try {
      // Importação retomada passa pelo banco com o id e a versão abertos na
      // tela: descarte, confirmação ou salvamento de outra pessoa nesse
      // meio-tempo fazem o banco recusar, e nada vira conta.
      if (resumedDraft) await confirmXmlImportDraft(draft, supplierId, requestIdRef.current, resumedDraft)
      else await createXmlPayable(draft, supplierId, requestIdRef.current)
      showToast(draft.items.some(item => item.mappingStatus === 'pendente') ? 'Conta importada. Há itens aguardando classificação.' : 'NF-e importada e custo atualizado.')
      await onSaved()
    } catch (saveError) {
      showToast(getPayableErrorMessage(saveError, 'Não foi possível importar a NF-e.'))
    } finally { setSaving(false) }
  }

  // Salvar para depois guarda a nota e as decisões feitas até aqui. Nada vira
  // conta a pagar, parcela ou custo: o banco só aceita isso pela confirmação.
  async function saveForLater() {
    if (!draft) return
    if (duplicateNfe) { showToast('Esta NF-e já foi importada. Não há o que salvar.'); return }
    setSaving(true)
    try {
      await saveXmlImportDraft(draft, supplierId || null, xmlText)
      showToast('Importação salva para conferir depois. Nada entrou no financeiro nem no custo.')
      await onSaved()
    } catch (saveError) {
      showToast(getPayableErrorMessage(saveError, 'Não foi possível salvar a importação pendente.'))
    } finally { setSaving(false) }
  }

  async function resumePending() {
    if (!pendingDraft) return
    setSaving(true)
    try {
      const content = await loadXmlImportDraft(pendingDraft.id)
      const resumed = resumeImport(content, availableSuppliers, catalog)
      setDraft(resumed.draft)
      setXmlText(resumed.xmlText)
      setSupplierId(resumed.supplierId)
      setResumedDraft(content)
      setPendingDraft(null)
      setAutoMappedCount(0)
      setError(resumed.lostLines.length > 0 ? lostLinesMessage(resumed.lostLines) : null)
    } catch (resumeError) {
      showToast(getPayableErrorMessage(resumeError, 'Não foi possível reabrir a importação pendente.'))
    } finally { setSaving(false) }
  }

  const mappedCount = draft?.items.filter(item => item.mappingStatus !== 'pendente').length ?? 0
  // Os totais são fato do XML e não mudam com a classificação; a composição
  // só precisa ser refeita quando entra outra nota.
  const composition = useMemo(() => draft ? composeNfe(draft) : null, [draft])
  const compositionReason = composition ? compositionBlockReason(composition) : null
  // A origem do vencimento é fato do XML e não muda; o aviso na tela precisa
  // acompanhar o que está digitado agora, senão continua cobrando o que já foi feito.
  const missingDueDate = draft?.installments.some(item => !item.dueDate) ?? false
  const unconfirmedFactors = draft?.items.filter(conversionNeedsAttention).length ?? 0
  const dueDateBeforeIssue = draft?.installments.some(item => item.dueDate && item.dueDate < draft.issueDate) ?? false
  const filledByHand = draft?.dueDateSource === 'ausente' && !missingDueDate
  const assumedOnIssueDate = draft?.dueDateSource === 'a-vista'
    && draft.installments.every(item => item.dueDate === draft.issueDate)
  // A composição vem antes dos outros motivos: nota que o banco vai recusar não
  // deve fazer a pessoa classificar tudo para descobrir no fim. A explicação
  // inteira fica no cartão da composição; aqui só o encaminhamento.
  const blockingReason = compositionReason
    ? 'Esta NF-e não pode ser confirmada. Veja o motivo em "Composição da nota", no alto da importação.'
    : missingDueDate
      ? 'Falta o vencimento. Preencha a data acima para liberar a confirmação.'
      : dueDateBeforeIssue
        ? 'Há vencimento anterior à emissão da nota. Confira a data digitada.'
        : unconfirmedFactors > 0
          ? `${unconfirmedFactors} item(ns) esperam a conferência da embalagem. Sem isso o custo do insumo entra errado.`
          : ''

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
          {composition && <CompositionCard composition={composition} />}
          {duplicateNfe && (
            <div role="alert" className="ps-card" style={{ marginTop: 10, borderColor: 'var(--berry)', background: 'var(--berry-tint)' }}>
              <b>NF-e já importada</b>
              <small style={{ display: 'block', marginTop: 4 }}>
                Esta chave de acesso já está registrada no Contas a pagar. A importação foi bloqueada para evitar duplicidade.
              </small>
            </div>
          )}
          {pendingDraft && (
            <div role="alert" className="ps-card" style={{ marginTop: 10, borderColor: 'var(--honey-deep)', background: 'var(--cream-raise)' }}>
              <b><FileClock size={15} style={{ verticalAlign: '-2px' }} /> Esta NF-e já tem uma importação pendente</b>
              <small style={{ display: 'block', marginTop: 4 }}>
                Salva em {formatDraftSavedAt(pendingDraft.updated_at)}, sem virar conta a pagar. Continue de onde parou para não refazer a classificação. Se recomeçar e salvar de novo, o que estava guardado é substituído.
              </small>
              <div style={{ marginTop: 8 }}>
                <button type="button" className="ps-btn primary sm" disabled={saving} onClick={() => void resumePending()}>Continuar de onde parou</button>{' '}
                <button type="button" className="ps-btn ghost sm" disabled={saving} onClick={() => setPendingDraft(null)}>Recomeçar do XML</button>
              </div>
            </div>
          )}
          {resumedDraft && !pendingDraft && (
            <div className="ps-banner" style={{ marginTop: 10 }}>
              <b>Importação retomada</b>
              <small style={{ display: 'block', marginTop: 3 }}>Salva em {formatDraftSavedAt(resumedDraft.updated_at)}. A nota foi relida do XML e as decisões guardadas foram reaplicadas. Ainda não existe conta a pagar.</small>
            </div>
          )}
          {autoMappedCount > 0 && (
            <div className="ps-banner" style={{ marginTop: 10 }}>
              <b>{autoMappedCount} {autoMappedCount === 1 ? 'classificação reaproveitada' : 'classificações reaproveitadas'} automaticamente</b>
              <small style={{ display: 'block', marginTop: 3 }}>O ERP lembrou o item-base e o fator, ou que a compra é de uso/despesa. Confira abaixo e altere somente se necessário.</small>
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
            <div
              className="ps-card"
              key={`${item.lineNumber}-${item.description}`}
              style={{
                marginBottom: 8,
                padding: 10,
                background: 'var(--cream-raise)',
                borderLeft: `4px solid ${itemStatus(item).color}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ flex: 1 }}>{item.lineNumber}. {item.description}</b>
                <small style={{ color: itemStatus(item).color, fontWeight: 650 }}>{itemStatus(item).label}</small>
              </div>
              <small style={{ display: 'block', marginTop: 3 }}>{item.quantity} {item.purchaseUnit} · {formatBRL(item.lineTotal)}{item.discountValue > 0 ? ` · bruto ${formatBRL(item.grossLineTotal)} · desconto ${formatBRL(item.discountValue)}` : ''}{item.supplierCode ? ` · código ${item.supplierCode}` : ''}</small>
              <ProductSelector item={item} products={catalog} onChange={productId => selectProduct(index, productId)} onCreate={() => openProductForm(index)} onWithoutProduct={() => markWithoutProduct(index)} />
              {creatingLine === index && (
                <div className="ps-banner" style={{ marginTop: 8 }}>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Nome do novo item-base</div>
                    <input
                      className="ps-input"
                      value={newProduct.name}
                      disabled={newProduct.useNfeName}
                      onChange={event => setNewProduct(previous => ({ ...previous, name: event.target.value }))}
                      placeholder="Ex.: Creme de confeiteiro insumo"
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={newProduct.useNfeName}
                        onChange={event => setNewProduct(previous => ({
                          ...previous,
                          useNfeName: event.target.checked,
                          name: event.target.checked ? item.description : previous.name,
                        }))}
                      />
                      <small>Usar o mesmo nome da NF-e</small>
                    </label>
                    <small className="ps-help">
                      Desmarque quando o insumo for genérico e puder vir de outra marca — a receita pede &quot;creme de confeiteiro&quot;, não a marca da nota.
                    </small>
                  </div>
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
            {draft.dueDateSource === 'ausente' && missingDueDate && (
              <div role="alert" className="ps-card" style={{ marginTop: 8, borderColor: 'var(--berry)', background: 'var(--berry-tint)' }}>
                <b>Esta NF-e não informou o vencimento</b>
                <small style={{ display: 'block', marginTop: 4 }}>
                  O XML traz o valor, mas não a data. Confira o vencimento no papel da nota, no campo Fatura/Duplicatas, e digite abaixo.
                </small>
              </div>
            )}
            {filledByHand && (
              <small style={{ display: 'block', marginTop: 4 }}>
                Vencimento informado à mão, porque o XML desta NF-e não trouxe a data.
              </small>
            )}
            {assumedOnIssueDate && (
              <small style={{ display: 'block', marginTop: 4 }}>
                O XML não informou vencimento e o pagamento é em {draft.paymentMethod === 'pix' ? 'pix' : 'dinheiro'}. Lançamos como à vista, na data de emissão. Corrija abaixo se não for isso.
              </small>
            )}
            {draft.installments.map((installment, index) => (
              <div className="ps-fieldgroup" key={index} style={{ marginTop: 8 }}>
                <label className="ps-fieldlabel" htmlFor={`xml-due-date-${index}`}>Parcela {installment.number} · {formatBRL(installment.amount)} · vence em</label>
                <input
                  id={`xml-due-date-${index}`}
                  className="ps-input"
                  type="date"
                  min={draft.issueDate}
                  value={installment.dueDate}
                  onChange={event => updateInstallmentDueDate(index, event.target.value)}
                />
              </div>
            ))}
          </div>
          {blockingReason && (
            <small role="alert" style={{ display: 'block', marginTop: 10, color: 'var(--berry)' }}>{blockingReason}</small>
          )}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="ps-btn ghost block" disabled={saving || duplicateNfe} onClick={() => void saveForLater()}>
              <FileClock size={16} /> Salvar para conferir depois
            </button>
            <small className="ps-help" style={{ display: 'block', marginTop: 4 }}>
              Guarda a nota e a classificação feita até aqui. Não cria conta a pagar nem mexe no custo; você continua de onde parou.
            </small>
          </div>
          <div className="ps-totalbar">
            <div className="ps-total-num"><b>{formatBRL(draft.total)}</b><span>{mappedCount === draft.items.length ? 'itens classificados' : `${draft.items.length - mappedCount} item(ns) pendente(s)`}</span></div>
            <button className="ps-save" disabled={saving || !supplierId || duplicateNfe || Boolean(blockingReason)} onClick={() => void confirmImport()}><Save size={16} /> {saving ? 'Importando...' : 'Confirmar NF-e'}</button>
          </div>
        </>
      )}
    </div>
  )
}
