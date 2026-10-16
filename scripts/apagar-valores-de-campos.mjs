import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// O Playwright guarda, em falha, o error-context.md: a arvore de acessibilidade
// da tela mais o erro e o registro das chamadas. Ali aparece o que foi digitado,
// inclusive a senha das contas ficticias: o artefato do run 38425196586
// (13/10/2026) ficou 3 dias aberto, num repositorio publico, para qualquer
// conta do GitHub baixar.
//
// Medido com o Playwright real (ensaio de 16/10/2026), a senha escapa por tres
// lugares, e este script fecha os tres antes do upload:
//   1. a linha do campo na tela:        - textbox "Senha": <valor>
//   2. o registro de chamadas:          - fill("<valor>")        (fill com timeout)
//   3. o eco de uma asercao de valor:   Received: "<valor>"
//
// Tres camadas, nesta ordem (a revisao independente de 16/10/2026 mostrou que a
// ordem importa: com a estrutural primeiro, um nome de campo com ": " dentro era
// cortado e deixava um pedaco do segredo para tras):
//   1. literal: o valor exato dos segredos do ambiente, em qualquer lugar do
//      arquivo e nas formas em que um registro o reescreve (JSON, aspas simples
//      do YAML, URL);
//   2. estrutural: o valor de todo campo de texto vira um marcador. Apaga a mais
//      de proposito (e-mail, data tambem): o diagnostico vive da estrutura da
//      tela, nao do que estava digitado;
//   3. rede de seguranca: se sobrar qualquer pedaco de 8 caracteres de um
//      segredo (valor dividido, truncado ou reescrito de um jeito que a camada 1
//      nao conhece), a limpeza FALHA. Sem artefato e melhor que artefato com
//      senha; o limite honesto e que uma recodificacao que destrua todos os
//      pedacos (escapar cada caractere) nao e vista.
//
// Se algo sobrar ou o arquivo nao puder ser regravado, sai com erro e o
// workflow nao sobe o artefato. Protege contra publicacao ACIDENTAL: o codigo da
// PR roda com a senha e poderia publica-la por outros meios.
//
// Uso: node scripts/apagar-valores-de-campos.mjs <pasta> [<pasta>...]
// Segredos lidos do ambiente: SEGREDOS_NO_AMBIENTE (outro segredo no contexto
// do navegador entra aqui).

export const MARCADOR = '[valor apagado]'
export const MARCADOR_SEGREDO = '[segredo apagado]'
export const SEGREDOS_NO_AMBIENTE = ['SUPABASE_TEST_USER_PASSWORD']
const TAMANHO_DO_PEDACO = 8

const PAPEIS_COM_VALOR = 'textbox|searchbox|combobox|spinbutton|slider'
// `- textbox: valor`, `- textbox "nome": valor` e a forma com a chave entre
// aspas simples ou duplas quando o nome tem caracteres especiais
// (`- 'textbox "a: b": valor`, `- "textbox \"a\"": valor`).
// O ponto preguicoso para no PRIMEIRO ": " depois do papel: se o nome da tela
// tiver ": " dentro, perde-se o resto da linha, nunca fica valor para tras.
const LINHA_COM_VALOR = new RegExp(`^(\\s*-\\s+['"]?(?:${PAPEIS_COM_VALOR})\\b.*?:)\\s+(\\S.*)$`)
const JA_LIMPO = new Set(['[valor apagado]', '[segredo apagado]'])
const ARQUIVO_DE_CONTEXTO = /^error-context.*\.md$/

/** Camada 2. Devolve o texto sem o valor dos campos e quantas linhas foram trocadas. */
export function apagarValoresDeCampos(texto) {
  let apagados = 0
  // Linha a linha, separando o \r final: com o flag `m`, `.` nao casa \r e um
  // arquivo CRLF passaria inteiro sem ser tocado.
  const linhas = texto.split('\n').map((linha) => {
    const cr = linha.endsWith('\r') ? '\r' : ''
    const nucleo = cr ? linha.slice(0, -1) : linha
    const achado = LINHA_COM_VALOR.exec(nucleo)
    if (!achado || JA_LIMPO.has(achado[2])) return linha
    apagados += 1
    return `${achado[1]} ${MARCADOR}${cr}`
  })
  const resultado = linhas.join('\n')
  const restante = valoresRestantes(resultado)
  if (restante > 0) {
    throw new Error(`Sobraram ${restante} linha(s) de campo com valor depois da limpeza.`)
  }
  return { texto: resultado, apagados }
}

/** Conta as linhas de campo que ainda trazem valor (deve ser sempre zero). */
export function valoresRestantes(texto) {
  return texto.split('\n').filter((linha) => {
    const nucleo = linha.endsWith('\r') ? linha.slice(0, -1) : linha
    const achado = LINHA_COM_VALOR.exec(nucleo)
    return achado !== null && !JA_LIMPO.has(achado[2])
  }).length
}

/** As formas em que um registro de erro pode reescrever o mesmo texto, da maior para a menor. */
export function variantesDoSegredo(segredo) {
  if (typeof segredo !== 'string' || segredo === '') return []
  const formas = new Set([
    segredo,
    JSON.stringify(segredo).slice(1, -1),
    segredo.replaceAll("'", "''"),
    encodeURIComponent(segredo),
  ])
  return [...formas].filter((forma) => forma !== '').sort((a, b) => b.length - a.length)
}

/** Camada 1. Troca cada ocorrencia literal dos segredos; falha se alguma sobrar. */
export function apagarSegredos(texto, segredos) {
  const variantes = [...new Set(segredos.flatMap(variantesDoSegredo))].sort((a, b) => b.length - a.length)
  let apagados = 0
  let resultado = texto
  for (const variante of variantes) {
    const partes = resultado.split(variante)
    apagados += partes.length - 1
    resultado = partes.join(MARCADOR_SEGREDO)
  }
  if (variantes.some((variante) => resultado.includes(variante))) {
    throw new Error('Sobrou uma ocorrencia de segredo depois da limpeza.')
  }
  return { texto: resultado, apagados }
}

/** Todos os pedacos de 8 caracteres (ou o segredo inteiro, se menor) de cada forma do segredo. */
export function pedacosDoSegredo(segredos, tamanho = TAMANHO_DO_PEDACO) {
  const pedacos = new Set()
  for (const variante of segredos.flatMap(variantesDoSegredo)) {
    const janela = Math.min(tamanho, variante.length)
    for (let inicio = 0; inicio + janela <= variante.length; inicio += 1) {
      pedacos.add(variante.slice(inicio, inicio + janela))
    }
  }
  return [...pedacos]
}

/** Camada 3. Falha se restar qualquer pedaco de segredo; nunca mostra o pedaco. */
export function conferirSemPedacosDeSegredo(texto, segredos) {
  const sobrou = pedacosDoSegredo(segredos).some((pedaco) => texto.includes(pedaco))
  if (sobrou) {
    throw new Error('Sobrou um pedaco de segredo depois da limpeza (valor dividido, truncado ou reescrito); o artefato nao pode subir.')
  }
}

/** As tres camadas sobre o texto de um arquivo. */
export function limparTexto(texto, segredos = []) {
  const doSegredo = apagarSegredos(texto, segredos)
  const doCampo = apagarValoresDeCampos(doSegredo.texto)
  conferirSemPedacosDeSegredo(doCampo.texto, segredos)
  return { texto: doCampo.texto, campos: doCampo.apagados, segredos: doSegredo.apagados }
}

function arquivosDeContexto(pasta) {
  const saida = []
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) saida.push(...arquivosDeContexto(caminho))
    else if (ARQUIVO_DE_CONTEXTO.test(entrada.name)) saida.push(caminho)
  }
  return saida
}

/**
 * Limpa todos os error-context.md da pasta (inclusive das repeticoes do teste).
 * Pasta inexistente nao e erro: a falha pode ter vindo antes de o navegador
 * rodar, e entao nao ha o que guardar.
 */
export function limparPasta(pasta, segredos = []) {
  let existe = false
  try {
    existe = statSync(pasta).isDirectory()
  } catch {
    existe = false
  }
  if (!existe) return { arquivos: 0, campos: 0, segredos: 0 }
  const arquivos = arquivosDeContexto(pasta)
  let campos = 0
  let achadosDeSegredo = 0
  for (const arquivo of arquivos) {
    try {
      const limpo = limparTexto(readFileSync(arquivo, 'utf8'), segredos)
      writeFileSync(arquivo, limpo.texto)
      campos += limpo.campos
      achadosDeSegredo += limpo.segredos
    } catch (erro) {
      throw new Error(`${arquivo}: ${erro instanceof Error ? erro.message : String(erro)}`)
    }
  }
  return { arquivos: arquivos.length, campos, segredos: achadosDeSegredo }
}

function principal(argumentos, ambiente) {
  if (argumentos.length === 0) {
    console.error('Uso: node scripts/apagar-valores-de-campos.mjs <pasta> [<pasta>...]')
    return 2
  }
  const segredos = SEGREDOS_NO_AMBIENTE.map((nome) => ambiente[nome]).filter((valor) => typeof valor === 'string' && valor !== '')
  let arquivos = 0
  let campos = 0
  let achadosDeSegredo = 0
  for (const pasta of argumentos) {
    const resultado = limparPasta(pasta, segredos)
    arquivos += resultado.arquivos
    campos += resultado.campos
    achadosDeSegredo += resultado.segredos
  }
  console.log(
    `Limpeza dos artefatos: ${arquivos} arquivo(s) conferido(s), ${campos} valor(es) de campo e ${achadosDeSegredo} ocorrencia(s) de segredo apagado(s).`,
  )
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = principal(process.argv.slice(2), process.env)
  } catch (erro) {
    console.error(`Nao consegui limpar os artefatos: ${erro instanceof Error ? erro.message : String(erro)}`)
    process.exitCode = 1
  }
}
