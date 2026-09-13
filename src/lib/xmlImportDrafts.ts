import { supabase } from '@/lib/supabase'
import {
  calculateUsableQuantity,
  type NfeConversionBasis,
  type NfeDraft,
  type NfeItemDraft,
  type NfeMappingStatus,
} from '@/lib/nfeXml'
import { xmlPayablePayload, type PayableProduct } from '@/lib/payables'

/**
 * Importação pendente de conferência (fase 2 das compras por XML).
 *
 * O rascunho guarda o XML original e as decisões da pessoa por linha; a nota
 * em si é sempre relida do XML com o leitor atual. Salvar um rascunho nunca
 * cria conta a pagar, parcela, custo nem memória de fornecedor: isso continua
 * sendo papel exclusivo da confirmação (`create_xml_payable`).
 */

export type XmlImportDraftStatus = 'pendente' | 'confirmada' | 'descartada'

export interface XmlImportDraftRow {
  id: string
  nfe_key: string
  status: XmlImportDraftStatus
  supplier_id: string | null
  supplier_name: string
  nfe_number: string | null
  nfe_series: string | null
  nfe_issued_at: string
  total_value: number | string
  updated_at: string
}

export interface XmlImportItemDecision {
  line_number: number
  product_id: string | null
  conversion_basis: NfeConversionBasis | null
  conversion_factor: number | null
  mapping_status: NfeMappingStatus
  factor_confirmed: boolean
  remember_conversion: boolean
}

export interface XmlImportInstallmentDecision {
  installment_number: number
  due_date: string | null
}

export interface XmlImportDraftContent extends XmlImportDraftRow {
  xml_content: string
  item_decisions: XmlImportItemDecision[]
  installments: XmlImportInstallmentDecision[]
}

const DRAFT_LIST_COLUMNS = 'id,nfe_key,status,supplier_id,supplier_name,nfe_number,nfe_series,nfe_issued_at,total_value,updated_at'

/** "Salva em 12/09/2026 20:45", no horário da padaria; carimbo ilegível vira vazio. */
export function formatDraftSavedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(date)
}

// --- Item do rascunho: vincular, marcar uso/despesa e limpar -----------------
// Estas três funções são a única forma de mudar a classificação de um item na
// importação; a tela e a retomada usam as mesmas, para que o item retomado seja
// idêntico ao item classificado na hora.

function initialFactor(item: NfeItemDraft): number {
  return item.conversionBasis === 'simple' ? 1 : 1
}

export function withProduct(
  item: NfeItemDraft,
  product: PayableProduct,
  factor = initialFactor(item),
  recognized = false,
  factorConfirmed = factor !== 1,
): NfeItemDraft {
  return {
    ...item,
    factorConfirmed,
    recognized,
    baseProductId: product.id,
    baseProductName: product.name,
    baseUnit: product.unit ?? 'un',
    category: product.category ?? null,
    conversionFactor: factor,
    usableQuantity: calculateUsableQuantity(item.quantity, factor),
    mappingStatus: 'mapeado',
  }
}

export function withoutProduct(item: NfeItemDraft, recognized = false): NfeItemDraft {
  return {
    ...clearProduct(item),
    mappingStatus: 'nao_aplicavel',
    recognized,
  }
}

export function clearProduct(item: NfeItemDraft): NfeItemDraft {
  return {
    ...item,
    baseProductId: null,
    baseProductName: null,
    baseUnit: null,
    category: null,
    conversionFactor: null,
    usableQuantity: null,
    mappingStatus: 'pendente',
    factorConfirmed: false,
    recognized: false,
  }
}

// --- Decisões: o que vai para o rascunho e o que volta dele -----------------

/** Só as decisões da pessoa viajam; os fatos da nota são relidos do XML. */
export function extractItemDecisions(draft: NfeDraft): XmlImportItemDecision[] {
  return draft.items.map(item => ({
    line_number: item.lineNumber,
    product_id: item.mappingStatus === 'mapeado' ? item.baseProductId : null,
    conversion_basis: item.mappingStatus === 'mapeado' ? item.conversionBasis : null,
    conversion_factor: item.mappingStatus === 'mapeado' ? item.conversionFactor : null,
    mapping_status: item.mappingStatus === 'mapeado' && !item.baseProductId ? 'pendente' : item.mappingStatus,
    factor_confirmed: item.mappingStatus === 'mapeado' && item.factorConfirmed,
    remember_conversion: item.rememberConversion,
  }))
}

/** Vencimento vazio viaja como nulo: o banco guarda "ainda não digitado", não uma data inventada. */
export function extractInstallmentDecisions(draft: NfeDraft): XmlImportInstallmentDecision[] {
  return draft.installments.map(installment => ({
    installment_number: installment.number,
    due_date: installment.dueDate || null,
  }))
}

export interface AppliedItemDecisions {
  draft: NfeDraft
  /** Linhas cujo item-base sumiu do catálogo desde que o rascunho foi salvo: voltam a pendente. */
  lostLines: number[]
}

/**
 * Reaplica as decisões guardadas sobre a nota relida do XML. Linha sem decisão
 * fica pendente; decisão de linha que não existe mais é ignorada; item-base
 * que saiu do catálogo volta a pendente e é apontado, para a pessoa refazer
 * só aquela linha em vez de descobrir na confirmação.
 */
export function applyItemDecisions(
  draft: NfeDraft,
  decisions: readonly XmlImportItemDecision[],
  catalog: readonly PayableProduct[],
): AppliedItemDecisions {
  const byLine = new Map(decisions.map(decision => [decision.line_number, decision]))
  const lostLines: number[] = []
  const items = draft.items.map(item => {
    const decision = byLine.get(item.lineNumber)
    if (!decision) return clearProduct(item)
    const base = { ...item, rememberConversion: Boolean(decision.remember_conversion) }
    if (decision.mapping_status === 'nao_aplicavel') return withoutProduct(base)
    if (decision.mapping_status !== 'mapeado' || !decision.product_id) return clearProduct(base)
    const product = catalog.find(candidate => candidate.id === decision.product_id)
    if (!product) {
      lostLines.push(item.lineNumber)
      return clearProduct(base)
    }
    const factor = decision.conversion_factor && decision.conversion_factor > 0 ? decision.conversion_factor : 1
    return withProduct(
      { ...base, conversionBasis: decision.conversion_basis ?? item.conversionBasis },
      product,
      factor,
      false,
      Boolean(decision.factor_confirmed),
    )
  })
  return { draft: { ...draft, items }, lostLines }
}

export function applyInstallmentDecisions(draft: NfeDraft, decisions: readonly XmlImportInstallmentDecision[]): NfeDraft {
  const byNumber = new Map(decisions.map(decision => [decision.installment_number, decision]))
  return {
    ...draft,
    installments: draft.installments.map(installment => {
      const decision = byNumber.get(installment.number)
      return decision?.due_date ? { ...installment, dueDate: decision.due_date } : installment
    }),
  }
}

// --- Banco --------------------------------------------------------------------

export async function loadPendingXmlImportDrafts(): Promise<XmlImportDraftRow[]> {
  const { data, error } = await supabase
    .from('payable_import_drafts')
    .select(DRAFT_LIST_COLUMNS)
    .eq('status', 'pendente')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as XmlImportDraftRow[]
}

export async function findPendingXmlImportDraft(nfeKey: string): Promise<XmlImportDraftRow | null> {
  const { data, error } = await supabase
    .from('payable_import_drafts')
    .select(DRAFT_LIST_COLUMNS)
    .eq('nfe_key', nfeKey)
    .eq('status', 'pendente')
    .maybeSingle()
  if (error) throw error
  return (data as XmlImportDraftRow | null) ?? null
}

export async function loadXmlImportDraft(draftId: string): Promise<XmlImportDraftContent> {
  const { data, error } = await supabase
    .from('payable_import_drafts')
    .select(`${DRAFT_LIST_COLUMNS},xml_content,item_decisions,installments`)
    .eq('id', draftId)
    .eq('status', 'pendente')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Esta importação pendente não está mais disponível. Alguém pode tê-la confirmado ou descartado.')
  const content = data as XmlImportDraftContent
  return {
    ...content,
    item_decisions: Array.isArray(content.item_decisions) ? content.item_decisions : [],
    installments: Array.isArray(content.installments) ? content.installments : [],
  }
}

export async function saveXmlImportDraft(draft: NfeDraft, supplierId: string | null, xmlContent: string): Promise<string> {
  const { data, error } = await supabase.rpc('save_xml_import_draft', {
    p_access_key: draft.accessKey,
    p_supplier_id: supplierId || null,
    p_supplier_name: draft.supplierName,
    p_nfe_number: draft.number,
    p_nfe_series: draft.series,
    p_issue_date: draft.issueDate,
    p_total_value: draft.total,
    p_xml_content: xmlContent,
    p_item_decisions: extractItemDecisions(draft),
    p_installments: extractInstallmentDecisions(draft),
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('O banco não devolveu a importação pendente.')
  return data
}

/**
 * Confirmar um rascunho retomado passa pelo banco com o id e a versão
 * (`updated_at`) que a tela abriu: se outra pessoa descartou, confirmou ou
 * salvou por cima nesse meio-tempo, o banco recusa e nada vira conta.
 */
export async function confirmXmlImportDraft(
  draft: NfeDraft,
  supplierId: string,
  requestId: string,
  resumed: Pick<XmlImportDraftContent, 'id' | 'updated_at'>,
): Promise<string> {
  const { data, error } = await supabase.rpc('confirm_xml_import_draft', {
    p_draft_id: resumed.id,
    p_expected_updated_at: resumed.updated_at,
    ...xmlPayablePayload(draft, supplierId, requestId),
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('O banco não devolveu a conta importada.')
  return data
}

export async function discardXmlImportDraft(draftId: string): Promise<void> {
  const { error } = await supabase.rpc('discard_xml_import_draft', { p_draft_id: draftId })
  if (error) throw error
}
