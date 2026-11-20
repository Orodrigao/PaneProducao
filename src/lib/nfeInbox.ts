import { supabase } from '@/lib/supabase'
import type { AppUser } from '@/lib/auth'

export interface NfeInboxRow {
  id: string
  nfe_key: string
  recipient_cnpj: string
  recipient_label: string
  emitter_cnpj: string
  emitter_name: string | null
  number: string
  series: string
  issued_at: string | null
  total_value: number | string | null
  source: string
  document_state: string
  has_xml: boolean
  original_file_name: string | null
  received_at: string
  status: string
  draft_id: string | null
  purchase_id: string | null
  purchase_status: string | null
}

export interface NfeInboxReceiveResult {
  resultado: string
  motivo: string | null
  mensagem: string
  id: string | null
  chave: string | null
  numero: string | null
  emitente: string | null
  ja_no_erp: boolean
}
export interface NfeInboxFileResult extends NfeInboxReceiveResult { fileName: string }
export interface InboxProgress { current: number; total: number }

export function canUseNfeInbox(user: Pick<AppUser, 'role' | 'permissions'> | null | undefined): boolean {
  return Boolean(user && (user.role === 'admin' || user.permissions?.some(permission =>
    permission.permission_key === 'contas_pagar.importar_xml' && (permission.scope === '*' || permission.scope === 'jc'),
  )))
}

export function nfeInboxStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    esperando_conferencia: 'Esperando conferência', conferencia_comecada: 'Conferência começada',
    ja_no_erp: 'Já estava no ERP', lancada: 'Lançada', ilegivel: 'Ilegível', aguardando_xml: 'Esperando o XML',
  }
  return labels[status] ?? status
}
export function nfeInboxResultLabel(result: Pick<NfeInboxReceiveResult, 'resultado' | 'ja_no_erp'>): string {
  const labels: Record<string, string> = {
    entrou: result.ja_no_erp ? 'Entrou, já estava lançada no ERP' : 'Entrou',
    ja_existia: 'Já estava na caixa', completou: 'XML anexado', recusada: 'Recusada',
    nao_enviado: 'Não enviado, tente de novo',
  }
  return labels[result.resultado] ?? result.resultado
}
export function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length === 14 ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : value
}

export async function loadNfeInbox(): Promise<NfeInboxRow[]> {
  const { data, error } = await supabase.rpc('list_nfe_inbox')
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(row =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/^inbox_/, ''), value])) as unknown as NfeInboxRow,
  )
}
export async function receiveNfeInboxXml(text: string, fileName: string): Promise<NfeInboxReceiveResult> {
  const { data, error } = await supabase.rpc('receive_nfe_inbox_xml', { p_xml_content: text, p_file_name: fileName })
  if (error) throw error
  if (!data || typeof data !== 'object' || !('resultado' in data)) throw new Error('O banco não devolveu o resultado do envio.')
  return data as NfeInboxReceiveResult
}
export async function loadNfeInboxXml(id: string): Promise<string> {
  const { data, error } = await supabase.from('payable_nfe_inbox').select('xml_content').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data?.xml_content) throw new Error('O XML desta nota não está disponível para conferência. Recarregue a caixa.')
  return data.xml_content as string
}

class XmlFileReadError extends Error {}

export async function readXmlFileText(file: Pick<File, 'text'>): Promise<string> {
  let raw: string
  try { raw = await file.text() }
  catch { throw new XmlFileReadError('Não foi possível ler este arquivo. Tente de novo.') }
  const text = raw.replace(/^\uFEFF/, '')
  if (text.length > 2_000_000) throw new XmlFileReadError('O arquivo passa do limite de 2.000.000 de caracteres.')
  return text
}

/** Um arquivo por vez; erro de leitura, rede ou recusa não perde o restante do lote. */
export async function sendInboxFiles(
  files: readonly Pick<File, 'name' | 'text'>[],
  send: (text: string, fileName: string) => Promise<NfeInboxReceiveResult>,
  onProgress: (progress: InboxProgress) => void = () => {},
): Promise<NfeInboxFileResult[]> {
  const results: NfeInboxFileResult[] = []
  for (const [index, file] of files.entries()) {
    onProgress({ current: index + 1, total: files.length })
    try {
      const text = await readXmlFileText(file)
      results.push({ ...await send(text, file.name), fileName: file.name })
    } catch (error) {
      results.push({ fileName: file.name, resultado: 'nao_enviado', motivo: null,
        mensagem: error instanceof XmlFileReadError ? error.message : 'Não foi possível enviar este arquivo. Tente de novo.',
        id: null, chave: null, numero: null, emitente: null, ja_no_erp: false })
    }
  }
  return results
}

export function inboxBatchSummary(results: readonly NfeInboxFileResult[]): string {
  const count = (state: string) => results.filter(result => result.resultado === state).length
  return [
    count('entrou') ? count('entrou') + (count('entrou') === 1 ? ' entrou' : ' entraram') : '',
    count('ja_existia') ? count('ja_existia') + (count('ja_existia') === 1 ? ' já estava na caixa' : ' já estavam na caixa') : '',
    count('completou') ? count('completou') + (count('completou') === 1 ? ' XML anexado' : ' XML anexados') : '',
    count('recusada') ? count('recusada') + (count('recusada') === 1 ? ' recusada' : ' recusadas') : '',
    count('nao_enviado') ? count('nao_enviado') + (count('nao_enviado') === 1 ? ' não enviado' : ' não enviados') : '',
  ].filter(Boolean).join(', ')
}
