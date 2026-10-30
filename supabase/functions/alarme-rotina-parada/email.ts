// Texto do e-mail do alarme de rotina parada. Sem dependência do Deno: o
// teste em src/lib/alarmeRotinaEmail.test.ts roda este arquivo no Vitest.
// A classificação (novo, continua, resolvido) vem pronta do banco; aqui só se
// decide o que aparece primeiro e como se lê.

export type EstadoAlarme = 'atrasada' | 'em_dia' | 'informativo'
export type ClasseAlarme = 'novo' | 'continua' | 'em_dia' | 'informativo'

export type LinhaAlarme = {
  rotina: string
  loja: string
  estado: EstadoAlarme
  detalhe: string
  bloco: string
  classe: ClasseAlarme
  desde: string | null
  ultimo_registro?: string | null
  faltas?: number
  datas_faltando?: string[]
}

export type ResolvidoAlarme = {
  rotina: string
  loja: string
  bloco: string
  detalhe: string
  desde: string | null
}

export type BlocoAlarme = {
  bloco: string
  verificado: boolean
  erro?: string
}

export type FotografiaAlarme = {
  dia: string
  base: string | null
  blocos: BlocoAlarme[]
  linhas: LinhaAlarme[]
  resolvidos: ResolvidoAlarme[]
  em_espera: LinhaAlarme[]
  segunda: boolean
  motivos: string[]
  deve_enviar: boolean
}

export type ClaimAlarmePronto = {
  state: 'pronto_para_enviar'
  envio_id: string
  report_date: string
  attempt_token: string
  recipient: string
  fotografia: FotografiaAlarme
}

export type ClaimAlarme =
  | { state: 'domingo' | 'aguardando_horario' | 'concluido' | 'em_tentativa' }
  | ClaimAlarmePronto

type Rotina = { nome: string; tela: string; semLoja?: boolean }

const ROTINAS: Record<string, Rotina> = {
  caixa: { nome: 'Fechamento de caixa', tela: '/fechamento-caixa' },
  sobras: { nome: 'Sobras', tela: '/sobras' },
  prateleira: { nome: 'Contagem de prateleira', tela: '/sobras' },
  forno: { nome: 'Forno', tela: '/forno' },
  romaneio: { nome: 'Romaneio', tela: '/romaneio' },
  cozinha: { nome: 'Produção da cozinha', tela: '/producao-cozinha' },
  venda_balcao: { nome: 'Venda do balcão', tela: '/relatorios/vendas-balcao' },
  contagem_semanal: { nome: 'Contagem semanal', tela: '/estoque/contagem' },
  nfe_rascunho: { nome: 'NF-e em rascunho', tela: '/contas-pagar' },
  nfe_entrada: { nome: 'Entrada de NF-e', tela: '/contas-pagar' },
  nfe_atraso_emissao: { nome: 'NF-e lançada com atraso', tela: '/contas-pagar' },
  pj_liberacao: { nome: 'Pedidos PJ sem liberar', tela: '/pedidos-pj', semLoja: true },
  recorrencia_pendente: { nome: 'Contas recorrentes', tela: '/financeiro' },
  recebimento_parado: { nome: 'Recebimentos', tela: '/contas-receber' },
  parcela_vencida: { nome: 'Parcelas a pagar', tela: '/contas-pagar' },
}

const BLOCOS: Record<string, string> = {
  operacao: 'rotinas da operação',
  financeiro: 'avisos do financeiro',
}

const LOJAS = new Set(['jc', 'ja', 'ex'])

export function nomeDaRotina(rotina: string, loja: string): string {
  const conhecida = ROTINAS[rotina]
  const nome = conhecida?.nome ?? rotina
  if (conhecida?.semLoja || !LOJAS.has(loja)) return nome
  return `${nome} ${loja.toUpperCase()}`
}

export function linkDaRotina(rotina: string, appUrl: string): string {
  return new URL(ROTINAS[rotina]?.tela ?? '/', appUrl).toString()
}

function nomeDoBloco(bloco: string): string {
  return BLOCOS[bloco] ?? bloco
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character] ?? character))
}

/** "2026-10-30" vira "30/10"; com ano, "30/10/2026". */
export function formatarDia(dia: string, comAno = false): string {
  const [ano, mes, diaDoMes] = dia.split('-')
  return comAno ? `${diaDoMes}/${mes}/${ano}` : `${diaDoMes}/${mes}`
}

function listaCurta(nomes: string[], maximo = 3): string {
  if (nomes.length <= maximo) return nomes.join(', ')
  return `${nomes.slice(0, maximo).join(', ')} e mais ${nomes.length - maximo}`
}

function plural(quantidade: number, singular: string, pluralizado: string): string {
  return quantidade === 1 ? singular : pluralizado
}

type Partes = {
  novos: LinhaAlarme[]
  continuam: LinhaAlarme[]
  informativos: LinhaAlarme[]
  emDia: LinhaAlarme[]
  naoVerificados: BlocoAlarme[]
}

function separar(fotografia: FotografiaAlarme): Partes {
  return {
    novos: fotografia.linhas.filter(linha => linha.classe === 'novo'),
    continuam: fotografia.linhas.filter(linha => linha.classe === 'continua'),
    informativos: fotografia.linhas.filter(linha => linha.classe === 'informativo'),
    emDia: fotografia.linhas.filter(linha => linha.classe === 'em_dia'),
    naoVerificados: fotografia.blocos.filter(bloco => !bloco.verificado),
  }
}

/** O assunto diz o que atrasou: o que é novo vem primeiro, pelo nome. */
export function assuntoDoAlarme(fotografia: FotografiaAlarme): string {
  const { novos, continuam, naoVerificados } = separar(fotografia)
  const resolvidos = fotografia.resolvidos
  const nome = (linha: { rotina: string; loja: string }) => nomeDaRotina(linha.rotina, linha.loja)
  const partes: string[] = []

  if (novos.length > 0) partes.push(`NOVO: ${listaCurta(novos.map(nome))}`)
  if (continuam.length > 0) {
    partes.push(novos.length > 0
      ? `${continuam.length} ${plural(continuam.length, 'continua', 'continuam')}`
      : `${plural(continuam.length, 'continua', 'continuam')}: ${listaCurta(continuam.map(nome))}`)
  }
  if (naoVerificados.length > 0) {
    partes.push(`sem conferência: ${naoVerificados.map(bloco => nomeDoBloco(bloco.bloco)).join(' e ')}`)
  }
  if (resolvidos.length > 0) {
    partes.push(novos.length + continuam.length > 0
      ? `${resolvidos.length} ${plural(resolvidos.length, 'resolvida', 'resolvidas')}`
      : `em dia de novo: ${listaCurta(resolvidos.map(nome))}`)
  }

  const dia = formatarDia(fotografia.dia)
  if (partes.length === 0) return `Resumo de segunda: rotinas em dia (${dia})`
  const prefixo = novos.length + continuam.length > 0 ? 'Rotina parada' : 'Alarme do ERP'
  return `${prefixo} ${dia}: ${partes.join('; ')}`
}

function linkTela(rotina: string, appUrl: string, texto: string): string {
  return `<a href="${escapeHtml(linkDaRotina(rotina, appUrl))}" style="color:#7f2b42;font-weight:700">${escapeHtml(texto)}</a>`
}

function secao(titulo: string, cor: string, corpo: string): string {
  return `<section style="margin:20px 0">
      <h2 style="font-size:16px;margin:0 0 8px;color:${cor}">${escapeHtml(titulo)}</h2>
      ${corpo}
    </section>`
}

function item(conteudo: string): string {
  return `<li style="margin:0 0 10px">${conteudo}</li>`
}

function lista(itens: string[]): string {
  return `<ul style="margin:0;padding-left:18px">${itens.join('')}</ul>`
}

export function htmlDoAlarme(fotografia: FotografiaAlarme, appUrl: string): string {
  const { novos, continuam, informativos, emDia, naoVerificados } = separar(fotografia)
  const nome = (linha: { rotina: string; loja: string }) => nomeDaRotina(linha.rotina, linha.loja)
  const secoes: string[] = []

  if (naoVerificados.length > 0) {
    const blocos = naoVerificados.map(bloco => item(
      `<strong>${escapeHtml(nomeDoBloco(bloco.bloco))}</strong>: não foi possível verificar hoje` +
      (bloco.erro ? ` <span style="color:#6b6258">(${escapeHtml(bloco.erro)})</span>` : '') +
      '. Isso não quer dizer que está tudo em dia.'))
    const espera = fotografia.em_espera.map(linha => item(
      `${linkTela(linha.rotina, appUrl, nome(linha))}: estava atrasada${linha.desde ? ` desde ${formatarDia(linha.desde)}` : ''}; sem conferência hoje.`))
    secoes.push(secao('Não foi possível verificar', '#9a2f1f', lista([...blocos, ...espera])))
  }

  if (novos.length > 0) {
    secoes.push(secao(`${plural(novos.length, 'Novo atraso', 'Novos atrasos')}`, '#9a2f1f', lista(novos.map(linha => item(
      `${linkTela(linha.rotina, appUrl, nome(linha))}<br><span style="color:#342d28">${escapeHtml(linha.detalhe)}</span>`)))))
  }

  if (continuam.length > 0) {
    secoes.push(secao('Continuam atrasadas', '#7f2b42', lista(continuam.map(linha => item(
      `${linkTela(linha.rotina, appUrl, nome(linha))}${linha.desde ? `, desde ${formatarDia(linha.desde)}` : ''}: ` +
      `<span style="color:#5f574e">${escapeHtml(linha.detalhe)}</span>`)))))
  }

  if (fotografia.resolvidos.length > 0) {
    secoes.push(secao('Em dia de novo', '#2f6b3a', lista(fotografia.resolvidos.map(linha => item(
      `${linkTela(linha.rotina, appUrl, nome(linha))}: voltou ao normal` +
      `${linha.desde ? ` (estava atrasada desde ${formatarDia(linha.desde)})` : ''}.`)))))
  }

  if (informativos.length > 0) {
    secoes.push(secao('Para saber', '#5f574e', lista(informativos.map(linha => item(
      `${linkTela(linha.rotina, appUrl, nome(linha))}: <span style="color:#5f574e">${escapeHtml(linha.detalhe)}</span>`)))))
  }

  if (emDia.length > 0) {
    secoes.push(secao('Em dia', '#2f6b3a',
      `<p style="margin:0;color:#5f574e">${escapeHtml(emDia.map(nome).join(', '))}.</p>`))
  }

  const atrasadas = novos.length + continuam.length
  const lede = atrasadas > 0
    ? `${atrasadas} ${plural(atrasadas, 'rotina atrasada', 'rotinas atrasadas')} hoje. Toque no nome para abrir a tela que resolve.`
    : naoVerificados.length > 0
      ? 'O alarme não conseguiu conferir tudo hoje. Veja abaixo o que ficou sem conferência.'
      : fotografia.resolvidos.length > 0
        ? 'Nenhuma rotina atrasada hoje.'
        : 'Resumo de segunda: nenhuma rotina atrasada.'

  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f8f3eb;font-family:Arial,sans-serif;color:#342d28">
    <main style="max-width:620px;margin:0 auto;padding:24px 16px">
      <article style="background:#fffdf9;border:1px solid #eadfce;border-radius:12px;padding:24px">
        <p style="margin:0 0 8px;color:#7f2b42;font-weight:700">Pane&amp;Salute · Alarme de rotina</p>
        <h1 style="font-size:23px;margin:0">Situação de ${formatarDia(fotografia.dia, true)}</h1>
        <p style="color:#5f574e">${escapeHtml(lede)}</p>
        ${secoes.join('')}
        <hr style="border:0;border-top:1px solid #eadfce;margin:22px 0">
        <p style="margin:0;color:#6b6258;font-size:12px">Este e-mail sai de segunda a sábado às 8h quando uma rotina atrasa ou volta ao normal, e toda segunda com o resumo. Se um dia ele não chegar, o vigia do GitHub avisa.</p>
      </article>
    </main>
  </body></html>`
}

function ehTexto(valor: unknown): valor is string {
  return typeof valor === 'string'
}

function ehLinha(valor: unknown): valor is LinhaAlarme {
  if (!valor || typeof valor !== 'object') return false
  const linha = valor as Record<string, unknown>
  return ehTexto(linha.rotina) && ehTexto(linha.loja) && ehTexto(linha.detalhe) && ehTexto(linha.bloco)
    && (linha.estado === 'atrasada' || linha.estado === 'em_dia' || linha.estado === 'informativo')
    && (linha.classe === 'novo' || linha.classe === 'continua' || linha.classe === 'em_dia' || linha.classe === 'informativo')
    && (linha.desde === null || ehTexto(linha.desde))
}

function ehResolvido(valor: unknown): valor is ResolvidoAlarme {
  if (!valor || typeof valor !== 'object') return false
  const linha = valor as Record<string, unknown>
  return ehTexto(linha.rotina) && ehTexto(linha.loja) && ehTexto(linha.detalhe) && ehTexto(linha.bloco)
    && (linha.desde === null || ehTexto(linha.desde))
}

function ehBloco(valor: unknown): valor is BlocoAlarme {
  if (!valor || typeof valor !== 'object') return false
  const bloco = valor as Record<string, unknown>
  return ehTexto(bloco.bloco) && typeof bloco.verificado === 'boolean'
    && (bloco.erro === undefined || ehTexto(bloco.erro))
}

export function ehFotografia(valor: unknown): valor is FotografiaAlarme {
  if (!valor || typeof valor !== 'object') return false
  const fotografia = valor as Record<string, unknown>
  return ehTexto(fotografia.dia) && /^\d{4}-\d{2}-\d{2}$/.test(fotografia.dia)
    && Array.isArray(fotografia.blocos) && fotografia.blocos.every(ehBloco)
    && Array.isArray(fotografia.linhas) && fotografia.linhas.every(ehLinha)
    && Array.isArray(fotografia.resolvidos) && fotografia.resolvidos.every(ehResolvido)
    && Array.isArray(fotografia.em_espera) && fotografia.em_espera.every(ehLinha)
    && typeof fotografia.segunda === 'boolean'
}

export function ehClaimAlarme(valor: unknown): valor is ClaimAlarme {
  if (!valor || typeof valor !== 'object') return false
  const claim = valor as Record<string, unknown>
  if (claim.state === 'domingo' || claim.state === 'aguardando_horario'
    || claim.state === 'concluido' || claim.state === 'em_tentativa') return true
  return claim.state === 'pronto_para_enviar'
    && ehTexto(claim.envio_id)
    && ehTexto(claim.report_date)
    && ehTexto(claim.attempt_token)
    && ehTexto(claim.recipient)
    && ehFotografia(claim.fotografia)
}
