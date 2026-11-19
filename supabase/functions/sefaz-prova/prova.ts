// Sem conexao externa: leitura limitada e projecao fechada de dados fiscais.
export type Empresa = 'rgf' | 'sf'
export type Entrada = {
  empresas: Empresa[]
  modo: 'distNSU' | 'consNSU'
  numero: string
  adn_nsu: string
  evento_homologacao: boolean
}
export type Objeto = Record<string, unknown>

function objeto(value: unknown): Objeto {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Objeto : {}
}

export function validarEntrada(value: unknown): Entrada | null {
  const o = objeto(value)
  if (Object.keys(o).some(k => !['empresas', 'modo', 'numero', 'adn_nsu', 'evento_homologacao'].includes(k))
    || !Array.isArray(o.empresas) || o.empresas.length < 1 || o.empresas.length > 2
    || o.empresas.some(e => e !== 'rgf' && e !== 'sf') || new Set(o.empresas).size !== o.empresas.length
    || (o.modo !== 'distNSU' && o.modo !== 'consNSU')
    || typeof o.numero !== 'string' || !/^\d{15}$/.test(o.numero)
    || typeof o.adn_nsu !== 'string' || !/^\d{1,15}$/.test(o.adn_nsu)
    || typeof o.evento_homologacao !== 'boolean') return null
  return o as Entrada
}

// Comparar digests de tamanho fixo, sem saida antecipada por caractere/tamanho.
export async function conferirToken(recebido: string | null, esperado: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(recebido ?? '')),
    crypto.subtle.digest('SHA-256', encoder.encode(esperado)),
  ])
  const aa = new Uint8Array(a), bb = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < 32; i++) diff |= aa[i] ^ bb[i]
  return diff === 0 && recebido !== null && esperado.length > 0
}

type NoXml = { nome: string; atributos: Record<string, string>; texto: string; filhos: NoXml[] }
const MAX_XML = 2 * 1024 * 1024
const MAX_TOTAL = 16 * 1024 * 1024

function desescapar(value: string): string {
  return value.replace(/&(lt|gt|amp|quot|apos);/g, (_, entity: string) =>
    ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[entity] ?? '')
}

// Leitor pequeno, sem entidades externas, limites de profundidade/tamanho/nos.
// Mantem estrutura para nao confundir cStat de lote com cStat de evento.
function lerXml(xml: string): NoXml {
  if (xml.length > MAX_XML || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('xml_invalido')
  const root: NoXml = { nome: '', atributos: {}, texto: '', filhos: [] }
  const stack = [root]
  const tokens = xml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g) ?? []
  if (tokens.join('') !== xml) throw new Error('xml_invalido')
  let count = 0
  for (const token of tokens) {
    const parent = stack[stack.length - 1]
    if (token.startsWith('<?') || token.startsWith('<!--')) continue
    if (token.startsWith('<![CDATA[')) { parent.texto += token.slice(9, -3); continue }
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim()
      if (stack.length === 1 || parent.nome !== name) throw new Error('xml_invalido')
      stack.pop()
    } else if (token.startsWith('<')) {
      const match = /^<([\w:.-]+)((?:\s+[\s\S]*?)?)\s*\/?\s*>$/.exec(token)
      if (!match || ++count > 20000 || stack.length > 64) throw new Error('xml_invalido')
      const node: NoXml = { nome: match[1], atributos: {}, texto: '', filhos: [] }
      for (const attr of match[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        node.atributos[attr[1]] = desescapar(attr[2] ?? attr[3])
      }
      parent.filhos.push(node)
      if (!/\/\s*>$/.test(token)) stack.push(node)
    } else parent.texto += desescapar(token)
  }
  if (stack.length !== 1 || root.filhos.length !== 1) throw new Error('xml_invalido')
  return root.filhos[0]
}

function local(node: NoXml): string { return node.nome.split(':').pop() ?? '' }
function achar(node: NoXml, name: string): NoXml | undefined {
  if (local(node) === name) return node
  for (const child of node.filhos) { const found = achar(child, name); if (found) return found }
}
function filho(node: NoXml | undefined, name: string): string | undefined {
  return node?.filhos.find(n => local(n) === name)?.texto.trim()
}
const codigo = (value: unknown): string | undefined => typeof value === 'string' && /^\d{3}$/.test(value) ? value : undefined
const nsu = (value: unknown): string | undefined => typeof value === 'string' && /^\d{15}$/.test(value) ? value : undefined
const tiposDfe = ['resNFe', 'procNFe', 'resEvento', 'procEventoNFe']
const tiposDocumento = [...tiposDfe, 'NFSe', 'Nfse', 'CompNfse', 'procNFSe', 'outro', 'ilegivel']
const motivos: Record<string, string> = {
  '138': 'Documento localizado', '137': 'Nenhum documento localizado',
  '656': 'Consumo indevido. Aguardar uma hora',
}

export async function abrirGzip(base64: string): Promise<string> {
  const compact = base64.replace(/\s/g, '')
  if (compact.length > MAX_XML || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error('gzip_invalido')
  const binary = atob(compact)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_XML) throw new Error('gzip_limite')
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(result)
}

async function contarDocumento(base64: string, docs: Record<string, number>, schema?: string): Promise<number> {
  try {
    const xml = await abrirGzip(base64)
    const raiz = local(lerXml(xml))
    // Na distribuicao, procNFe tem raiz nfeProc; o tipo vem do schema.
    const tipo = schema === undefined ? raiz : schema.split('_')[0]
    const permitidos = schema === undefined ? tiposDocumento : tiposDfe
    const key = permitidos.includes(tipo) ? tipo : 'outro'
    docs[key] = (docs[key] ?? 0) + 1
    return new TextEncoder().encode(xml).byteLength
  } catch {
    docs.ilegivel = (docs.ilegivel ?? 0) + 1
    return 0
  }
}

export async function resumirDfe(xml: string): Promise<Objeto> {
  const ret = achar(lerXml(xml), 'retDistDFeInt')
  const cStat = codigo(filho(ret, 'cStat'))
  if (!ret || !cStat) throw new Error('dfe_invalido')
  const docs: Record<string, number> = {}
  const lote = ret.filhos.find(n => local(n) === 'loteDistDFeInt')
  const zips = lote?.filhos.filter(n => local(n) === 'docZip') ?? []
  if (zips.length > 50 || (cStat === '138' && zips.length === 0) || (cStat !== '138' && zips.length)) throw new Error('dfe_invalido')
  let bytes = 0
  for (const zip of zips) {
    bytes += await contarDocumento(zip.texto, docs, zip.atributos.schema ?? '')
    if (bytes > MAX_TOTAL) throw new Error('documentos_limite')
  }
  return {
    status: 'ok', cStat, xMotivo: motivos[cStat] ?? 'Resposta SEFAZ',
    ultNSU: nsu(filho(ret, 'ultNSU')), maxNSU: nsu(filho(ret, 'maxNSU')), docs, bytes,
  }
}

// MOC, Anexo I: validacao XML, certificado e assinatura. Falhar fechado em
// codigos desconhecidos: somente rejeicoes de negocio conhecidas provam a etapa.
export const REJEICOES_TECNICAS = [215, 225, 242, 243, 280, 281, 282, 283, 284, 285, 286,
  290, 291, 292, 293, 294, 295, 296, 297, 298, 299]
const EVENTOS_NEGOCIO = ['135', '136', '155', '217', '494', '573']
export function resumirEvento(xml: string): Objeto {
  const ret = achar(lerXml(xml), 'retEnvEvento')
  const lote = codigo(filho(ret, 'cStat'))
  const evento = codigo(filho(ret && achar(ret, 'infEvento'), 'cStat'))
  if (!lote) throw new Error('evento_invalido')
  return {
    status: 'ok', lote_cStat: lote, evento_cStat: evento,
    assinatura_e_certificado_aceitos: lote === '128' && !!evento
      && !REJEICOES_TECNICAS.includes(Number(evento)) && EVENTOS_NEGOCIO.includes(evento),
  }
}

const CHAVES_ADN = ['StatusProcessamento', 'LoteDFe', 'UltimoNSU', 'MaximoNSU', 'Erros', 'Avisos',
  'statusProcessamento', 'loteDFe', 'ultimoNSU', 'maximoNSU', 'erros', 'avisos',
  'TipoAmbiente', 'VersaoAplicativo', 'DataHoraProcessamento', 'tipoAmbiente', 'versaoAplicativo',
  'dataHoraProcessamento', 'documentos', 'Documentos', 'data', 'items', 'DFe', 'dfe']

export async function resumirAdn(body: string, http: number): Promise<Objeto> {
  const docs: Record<string, number> = {}
  let value: unknown
  try { value = JSON.parse(body) } catch { return { status: 'falhou', http, motivo: 'adn_sem_json', docs } }
  const keys = Object.keys(objeto(value))
  let nodes = 0, zipped = 0, bytes = 0
  async function visitar(v: unknown, depth: number, campo = ''): Promise<void> {
    if (++nodes > 10000 || depth > 32) throw new Error('adn_limite')
    if (typeof v === 'string' && (/xml|arquivo/i.test(campo) || v.trim().startsWith('H4sI'))) {
      if (++zipped > 50) throw new Error('adn_limite')
      bytes += await contarDocumento(v, docs)
      if (bytes > MAX_TOTAL) throw new Error('adn_limite')
    } else if (Array.isArray(v)) { for (const item of v) await visitar(item, depth + 1, campo) }
    else if (v && typeof v === 'object') { for (const [nome, item] of Object.entries(v)) await visitar(item, depth + 1, nome) }
  }
  await visitar(value, 0)
  return {
    status: http >= 200 && http < 300 ? 'ok' : 'falhou', http,
    chaves_json: keys.filter(k => CHAVES_ADN.includes(k)),
    chaves_omitidas: keys.filter(k => !CHAVES_ADN.includes(k)).length, docs, bytes,
  }
}

const MOTIVOS = ['certificado nao guardado', 'falha_banco_ou_transporte', 'tempo_banco',
  'entrada_invalida', 'falha_cofre', 'certificado_invalido', 'chave_invalida', 'chave_cifrada',
  'assinatura_falhou', 'tls_indisponivel', 'falha_transporte', 'redirecionado',
  'falha_rpc', 'resposta_invalida', 'adn_sem_json', 'http_recusado', 'prova_falhou']
function numero(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e10 ? Math.round(value * 100) / 100 : undefined
}
function sanearProva(value: unknown): Objeto {
  const o = objeto(value), out: Objeto = {}
  out.status = ['ok', 'falhou', 'sem_certificado'].includes(String(o.status)) ? o.status : 'falhou'
  if (MOTIVOS.includes(String(o.motivo))) out.motivo = o.motivo
  for (const k of ['http', 'bytes', 'ms_banco', 'ms_total', 'dias_para_vencer', 'chaves_omitidas']) {
    const n = numero(o[k]); if (n !== undefined) out[k] = n
  }
  for (const k of ['cStat', 'lote_cStat', 'evento_cStat']) { const c = codigo(o[k]); if (c) out[k] = c }
  for (const k of ['ultNSU', 'maxNSU']) { const n = nsu(o[k]); if (n) out[k] = n }
  if (out.cStat) out.xMotivo = motivos[String(out.cStat)] ?? 'Resposta SEFAZ'
  if (typeof o.assinatura_e_certificado_aceitos === 'boolean') {
    out.assinatura_e_certificado_aceitos = o.assinatura_e_certificado_aceitos === true
      && out.lote_cStat === '128' && EVENTOS_NEGOCIO.includes(String(out.evento_cStat))
  }
  if (Array.isArray(o.chaves_json)) out.chaves_json = o.chaves_json.filter(k => typeof k === 'string' && CHAVES_ADN.includes(k))
  if (o.docs) {
    const docs = objeto(o.docs), safe: Objeto = {}
    for (const k of tiposDocumento) { const n = numero(docs[k]); if (n !== undefined && n >= 0) safe[k] = n }
    out.docs = safe
  }
  return out
}

// Ultima fronteira antes de HTTP/console: nunca repassar JSON/XML/erros crus.
export function sanearResumo(value: unknown): Objeto {
  const source = objeto(value), out: Objeto = {}
  for (const empresa of ['rgf', 'sf']) {
    if (!source[empresa]) continue
    const item = objeto(source[empresa]), safe: Objeto = {}
    for (const k of ['dfe', 'adn', 'evento_homologacao', 'certificado']) if (item[k]) safe[k] = sanearProva(item[k])
    out[empresa] = safe
  }
  const metrics = objeto(source.funcao), safe: Objeto = {}
  for (const k of ['memoria_rss_mb', 'heap_mb', 'ms_total']) { const n = numero(metrics[k]); if (n !== undefined) safe[k] = n }
  out.funcao = safe
  return out
}

export type Rpc = (name: string, args: Objeto) => Promise<unknown>
export async function executarProva(entrada: Entrada, rpc: Rpc): Promise<Objeto> {
  const out: Objeto = {}
  for (const empresa of entrada.empresas) {
    const company: Objeto = {}; out[empresa] = company
    const provas: [string, string, Objeto][] = [
      ['dfe', 'sefaz_prova_dfe', { p_empresa: empresa, p_modo: entrada.modo, p_numero: entrada.numero }],
      ['adn', 'sefaz_prova_adn', { p_empresa: empresa, p_nsu: entrada.adn_nsu }],
    ]
    if (entrada.evento_homologacao) provas.push(['evento_homologacao', 'sefaz_prova_evento', { p_empresa: empresa }])
    for (const [key, name, args] of provas) {
      const start = performance.now()
      try {
        const raw = objeto(await rpc(name, args))
        if (raw.status === 'sem_certificado') {
          company[key] = { status: 'sem_certificado', motivo: 'certificado nao guardado' }
          company.certificado = company[key]
          break // Seguir com a outra empresa sem RPCs redundantes.
        }
        if (raw.status !== 'ok') { company[key] = sanearProva(raw); continue }
        company.certificado = { status: 'ok', dias_para_vencer: numero(raw.dias_para_vencer) }
        if (typeof raw.body !== 'string' || raw.body.length > MAX_TOTAL || typeof raw.http !== 'number') throw new Error('resposta_invalida')
        const parsed = key === 'adn' ? await resumirAdn(raw.body, raw.http)
          : raw.http !== 200 ? { status: 'falhou', motivo: 'http_recusado', http: raw.http }
          : key === 'dfe' ? await resumirDfe(raw.body) : resumirEvento(raw.body)
        company[key] = { ...parsed, ms_banco: numero(raw.ms_banco), ms_total: performance.now() - start }
      } catch {
        company[key] = { status: 'falhou', motivo: 'prova_falhou', ms_total: performance.now() - start }
      }
    }
  }
  return sanearResumo(out)
}

export function criarHandler(config: {
  token: () => string | undefined
  rpc: Rpc
  memoria: () => { rss: number; heapUsed: number }
}): (request: Request) => Promise<Response> {
  return async request => {
    const start = performance.now()
    const responder = (value: unknown, status: number) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
    const token = config.token()
    if (!token) return responder({ status: 'desligada' }, 503)
    if (request.method !== 'POST') return responder({ status: 'metodo_invalido' }, 405)
    if (!await conferirToken(request.headers.get('x-sefaz-prova-token'), token)) return responder({ status: 'nao_autorizada' }, 401)
    // Limite antes do JSON: ler por fluxo evita aceitar um corpo sem Content-Length enorme.
    let input: unknown
    try {
      const reader = request.body?.getReader()
      if (!reader) return responder({ status: 'entrada_invalida' }, 400)
      let text = '', size = 0
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.length
          if (size > 4096) return responder({ status: 'entrada_invalida' }, 400)
          text += decoder.decode(value, { stream: true })
        }
        input = JSON.parse(text + decoder.decode())
      } finally { await reader.cancel() }
    } catch { return responder({ status: 'entrada_invalida' }, 400) }
    const entrada = validarEntrada(input)
    if (!entrada) return responder({ status: 'entrada_invalida' }, 400)
    try {
      const result = await executarProva(entrada, config.rpc)
      const metrics: Objeto = {}
      try {
        const memory = config.memoria()
        metrics.memoria_rss_mb = memory.rss / 1048576
        metrics.heap_mb = memory.heapUsed / 1048576
      } catch { /* Medida opcional: runtime sem memoria nao invalida a prova. */ }
      result.funcao = { ...metrics, ms_total: performance.now() - start }
      return responder(sanearResumo(result), 200)
    } catch { return responder({ status: 'falhou', motivo: 'prova_falhou' }, 200) }
  }
}
