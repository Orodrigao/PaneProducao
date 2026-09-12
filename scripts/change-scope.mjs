import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Classifica se um conjunto de arquivos alterados e "somente documental":
 * nenhum arquivo fora da lista abaixo foi tocado, nem antes nem depois de uma
 * renomeacao. Usado pelo CI (ci.yml), pelo ignoreCommand da Vercel
 * (ignore-documentation-build.mjs), pelos workflows de banco de teste e pela
 * Portaria (fora deste repositorio) para dispensar verificacao completa em
 * mudanca que so toca texto.
 *
 * Na duvida, a resposta e SEMPRE "nao documental": quem consome esta funcao
 * roda a bateria completa quando nao consegue provar o contrario.
 */

export const CAMINHOS_DOCUMENTAIS_FIXOS = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'lessons.md']

/**
 * Barreiras de seguranca contra caminho corrompido ou hostil antes de
 * comparar contra a lista documental: barra invertida (nao e separador POSIX
 * e pode mascarar segmentos), dois-pontos (fluxo alternativo de NTFS ou
 * unidade do Windows), caractere de controle/NUL, caminho absoluto e
 * qualquer segmento vazio, `.` ou `..` (duplicidade de barra, travessia de
 * diretorio ou segmento sem sentido escondendo o alvo real). Mesma familia de
 * verificacao usada pela Portaria para caminho de arquivo. Nenhum desses pode
 * legitimamente aparecer na saida de `git diff --name-status`, mas a API do
 * GitHub e uma fonte externa e nao deve ser confiada sem conferencia.
 */
function caminhoSeguro(caminho) {
  if (typeof caminho !== 'string' || caminho.length === 0) return false
  if (caminho.includes('\\')) return false
  if (caminho.includes(':')) return false
  if (caminho.startsWith('/')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(caminho)) return false
  const segmentos = caminho.split('/')
  if (segmentos.some((segmento) => segmento === '' || segmento === '.' || segmento === '..')) return false
  return true
}

/** Caminho POSIX, comparacao exata de maiusculas/minusculas. */
export function ehCaminhoDocumental(caminho) {
  if (!caminhoSeguro(caminho)) return false
  if (CAMINHOS_DOCUMENTAIS_FIXOS.includes(caminho)) return true
  return caminho.startsWith('docs/') && caminho.endsWith('.md')
}

/**
 * Lista positiva e fechada dos arquivos que IMPLEMENTAM o mecanismo de CI
 * proporcional (o proprio classificador, os workflows que o chamam e o
 * ignoreCommand da Vercel). Espelho exato de `Get-CiMechanismPaths` no
 * seletor local (`~/.ai-team/scripts/verification-plan.ps1`): mudar um dos
 * dois sem o outro quebra a paridade entre a Portaria e este repositorio.
 * Nao e prefixo nem glob — cada entrada e um caminho exato, porque o risco
 * de alterar o proprio mecanismo de verificacao nao se generaliza para
 * "qualquer coisa dentro de .github/workflows/" ou "qualquer script novo".
 */
export const CAMINHOS_MECANISMO_CI = [
  '.github/workflows/ci.yml',
  '.github/workflows/banco-preview.yml',
  '.github/workflows/banco-por-pr.yml',
  '.github/workflows/usuarios-banco-por-pr.yml',
  'scripts/change-scope.mjs',
  'scripts/change-scope.test.mjs',
  'scripts/ignore-documentation-build.mjs',
  'vercel.json',
]

/** Caminho POSIX, comparacao exata: lista fechada, sem glob nem prefixo. */
export function ehCaminhoMecanismoCi(caminho) {
  if (!caminhoSeguro(caminho)) return false
  return CAMINHOS_MECANISMO_CI.includes(caminho)
}

/** Status que este contrato sabe interpretar; qualquer outro reprova o arquivo. */
const STATUS_CONHECIDOS = new Set(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'])

/**
 * Classifica uma entrada de arquivo (formato comum entre a API de PRs do
 * GitHub e a saida de `git diff --name-status`): `{ filename, previous_filename?, status }`.
 *
 * Uma renomeacao so e documental quando o caminho ANTERIOR e o NOVO sao os
 * dois documentais. Renomear codigo para dentro de docs/ apaga um arquivo de
 * codigo; renomear um documento para fora tambem precisa de build. Status
 * ausente ou desconhecido (a API mudou, ou o parser local encontrou algo
 * novo) reprova: nunca decidimos "documental" sobre um tipo de mudanca que
 * nao entendemos. Este contrato acabou de ser criado — nao existe consumidor
 * legado com entrada sem status que justifique abrir excecao para o campo
 * ausente.
 */
export function classificarArquivo(arquivo) {
  if (!arquivo || typeof arquivo.filename !== 'string' || arquivo.filename.length === 0) {
    return { documental: false, motivo: 'campo-ausente' }
  }
  if (!STATUS_CONHECIDOS.has(arquivo.status)) {
    return { documental: false, motivo: 'status-desconhecido' }
  }
  if (
    (arquivo.status === 'renamed' || arquivo.status === 'copied') &&
    (typeof arquivo.previous_filename !== 'string' || arquivo.previous_filename.length === 0)
  ) {
    return { documental: false, motivo: 'renomeacao-sem-caminho-anterior' }
  }
  if (!ehCaminhoDocumental(arquivo.filename)) {
    return { documental: false, motivo: 'caminho-nao-documental' }
  }
  if (arquivo.previous_filename != null) {
    if (typeof arquivo.previous_filename !== 'string' || arquivo.previous_filename.length === 0) {
      return { documental: false, motivo: 'campo-ausente' }
    }
    if (!ehCaminhoDocumental(arquivo.previous_filename)) {
      return { documental: false, motivo: 'caminho-anterior-nao-documental' }
    }
  }
  return { documental: true, motivo: null }
}

/** Categoria de um caminho isolado: 'documento', 'mecanismo' ou null (produto). */
function categoriaCaminho(caminho) {
  if (ehCaminhoDocumental(caminho)) return 'documento'
  if (ehCaminhoMecanismoCi(caminho)) return 'mecanismo'
  return null
}

/**
 * Classifica um arquivo por categoria (documento/mecanismo/produto), mesmas
 * defesas de `classificarArquivo` mas com o vocabulario mais largo do
 * mecanismo de CI cadastrado.
 *
 * Paridade com o seletor local da Portaria (`Get-VerificationPlan` em
 * `~/.ai-team/scripts/verification-plan.ps1`): a UNIAO das duas listas
 * (documento + mecanismo) e o universo aprovado, e uma renomeacao/copia so
 * reprova quando alguma das pontas cai FORA dessa uniao. Dentro da uniao,
 * qualquer ponta sendo mecanismo torna o par inteiro mecanismo — documento
 * vira mecanismo virando documento (ou o contrario) continua sendo uma
 * mudanca inteiramente coberta pelo mesmo mecanismo de verificacao isolada,
 * nao codigo de produto. Documento-para-documento continua documento. Uma
 * ponta fora da uniao (produto) sempre reprova o par inteiro, dos dois
 * lados: mover algo de dentro do produto para documentos ou para o
 * mecanismo de CI ainda precisa da bateria completa, porque o lado de
 * produto e o que importa provar.
 */
export function classificarPerfilArquivo(arquivo) {
  if (!arquivo || typeof arquivo.filename !== 'string' || arquivo.filename.length === 0) {
    return { categoria: null, motivo: 'campo-ausente' }
  }
  if (!STATUS_CONHECIDOS.has(arquivo.status)) {
    return { categoria: null, motivo: 'status-desconhecido' }
  }
  if (
    (arquivo.status === 'renamed' || arquivo.status === 'copied') &&
    (typeof arquivo.previous_filename !== 'string' || arquivo.previous_filename.length === 0)
  ) {
    return { categoria: null, motivo: 'renomeacao-sem-caminho-anterior' }
  }
  const categoriaAtual = categoriaCaminho(arquivo.filename)
  if (categoriaAtual === null) {
    return { categoria: null, motivo: 'caminho-fora-das-listas' }
  }
  if (arquivo.previous_filename == null) {
    return { categoria: categoriaAtual, motivo: null }
  }
  if (typeof arquivo.previous_filename !== 'string' || arquivo.previous_filename.length === 0) {
    return { categoria: null, motivo: 'campo-ausente' }
  }
  const categoriaAnterior = categoriaCaminho(arquivo.previous_filename)
  if (categoriaAnterior === null) {
    return { categoria: null, motivo: 'caminho-anterior-fora-das-listas' }
  }
  if (categoriaAtual === 'mecanismo' || categoriaAnterior === 'mecanismo') {
    return { categoria: 'mecanismo', motivo: null }
  }
  return { categoria: categoriaAtual, motivo: null }
}

function contadorValido(valor) {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0
}

/**
 * Decide sobre o conjunto inteiro. `recebidos`/`declarados` sao opcionais e
 * servem para detectar listagem truncada quando a fonte for uma API paginada
 * (a REST do GitHub para de listar arquivos de PR em 3000, sem avisar).
 *
 * Quando informado, cada contador precisa ser um inteiro nao-negativo — um
 * contador invalido (fracionario, negativo, string) nao prova nada e nao
 * pode virar dispensa por omissao. `recebidos` tambem precisa bater com o
 * tamanho real da lista: ele afirma "quantos itens eu efetivamente
 * recebi", e se o chamador passar um numero que nao corresponde a lista que
 * ele proprio construiu, o contador nao e confiavel para provar ausencia de
 * truncamento.
 */
export function classificarMudancas(arquivos, { recebidos, declarados } = {}) {
  if (!Array.isArray(arquivos)) {
    return { documental: false, motivo: 'lista-invalida' }
  }
  if (recebidos !== undefined || declarados !== undefined) {
    if (!contadorValido(recebidos) || !contadorValido(declarados)) {
      return { documental: false, motivo: 'contador-invalido' }
    }
    if (recebidos !== arquivos.length) {
      return { documental: false, motivo: 'contador-nao-bate-com-lista' }
    }
    if (recebidos !== declarados) {
      return { documental: false, motivo: 'lista-truncada' }
    }
  }
  if (arquivos.length === 0) {
    return { documental: false, motivo: 'lista-vazia' }
  }
  for (const arquivo of arquivos) {
    const resultado = classificarArquivo(arquivo)
    if (!resultado.documental) {
      return { documental: false, motivo: resultado.motivo, arquivo: arquivo?.filename }
    }
  }
  return { documental: true, motivo: null }
}

/**
 * Classifica o conjunto inteiro em tres perfis: 'documentation' (so os
 * caminhos documentais fixos), 'ci-mechanism' (mistura os oito caminhos do
 * mecanismo de CI cadastrado com documentos aprovados, sem nenhum arquivo de
 * produto) ou 'product' (qualquer outra coisa, inclusive duvida — mesma
 * postura fail-closed de `classificarMudancas`). Mesmas defesas contra lista
 * truncada/invalida.
 *
 * `vercel.json` tem uma restricao extra: so entra em 'ci-mechanism' quando o
 * CONTEUDO alterado se resume a `ignoreCommand` (ver
 * `vercelJsonSomenteIgnoreCommand`) — qualquer outra chave e configuracao de
 * deployment de verdade e exige a bateria de produto. Por isso esta funcao
 * precisa de `base`/`head`/`execImpl` quando `vercel.json` estiver entre os
 * arquivos: sem uma referencia git valida para comparar o conteudo, a
 * resposta segura e 'product'.
 */
export function classificarPerfilMudancas(arquivos, { recebidos, declarados, base, head, execImpl = execFileSync } = {}) {
  if (!Array.isArray(arquivos)) {
    return { perfil: 'product', motivo: 'lista-invalida' }
  }
  if (recebidos !== undefined || declarados !== undefined) {
    if (!contadorValido(recebidos) || !contadorValido(declarados)) {
      return { perfil: 'product', motivo: 'contador-invalido' }
    }
    if (recebidos !== arquivos.length) {
      return { perfil: 'product', motivo: 'contador-nao-bate-com-lista' }
    }
    if (recebidos !== declarados) {
      return { perfil: 'product', motivo: 'lista-truncada' }
    }
  }
  if (arquivos.length === 0) {
    return { perfil: 'product', motivo: 'lista-vazia' }
  }
  let temMecanismo = false
  let temVercelJson = false
  for (const arquivo of arquivos) {
    const resultado = classificarPerfilArquivo(arquivo)
    if (resultado.categoria === null) {
      return { perfil: 'product', motivo: resultado.motivo, arquivo: arquivo?.filename }
    }
    if (resultado.categoria === 'mecanismo') {
      temMecanismo = true
      if (arquivo.filename === 'vercel.json' || arquivo.previous_filename === 'vercel.json') {
        temVercelJson = true
      }
    }
  }
  if (!temMecanismo) {
    return { perfil: 'documentation', motivo: null }
  }
  if (temVercelJson) {
    if (!referenciaGitValida(base) || !referenciaGitValida(head)) {
      return { perfil: 'product', motivo: 'vercel-sem-referencia-para-conferir-conteudo' }
    }
    if (!vercelJsonSomenteIgnoreCommand({ base, head, execImpl })) {
      return { perfil: 'product', motivo: 'vercel-json-alem-do-ignorecommand' }
    }
  }
  return { perfil: 'ci-mechanism', motivo: null }
}

function mapearStatusGit(codigo) {
  switch (codigo[0]) {
    case 'A': return 'added'
    case 'D': return 'removed'
    case 'M': return 'modified'
    case 'T': return 'changed'
    default: return 'unknown'
  }
}

/**
 * Interpreta a saida de `git diff --name-status -z -M`. O `-z` separa por
 * NUL em vez de quebra de linha e caminho sem aspas, o que evita o escape de
 * caracteres especiais que o git aplica por padrao (`core.quotePath`) e que
 * quebraria um parser ingenuo baseado em linhas e tabs.
 *
 * O formato com `-z` e sequencial, nao 1 linha = 1 registro: uma renomeacao
 * emite tres tokens (`Rxxx`, caminho antigo, caminho novo) e as demais
 * emitem dois (status, caminho), e o `git` termina TODO registro (inclusive
 * o ultimo) com um NUL. Um `.filter(token => token.length > 0)` ingenuo
 * escondia dois problemas ao mesmo tempo: descartava o NUL final legitimo
 * (perdendo o unico sinal de que o registro fechou) e aceitava, de forma
 * indistinguivel, uma saida cortada sem NUL final (processo morto, buffer
 * truncado) — as duas produziam a mesma lista de tokens. Por isso a saida
 * PRECISA terminar em NUL para ser aceita, e nenhum token vazio pode
 * aparecer no meio (NUL duplicado tambem e estrutura corrompida). Uma
 * renomeacao/copia ou um status sem os caminhos que lhe cabem lanca em vez
 * de produzir uma entrada com campo faltando silenciosamente.
 */
export function interpretarNameStatus(saida) {
  if (typeof saida !== 'string' || saida.length === 0) return []
  if (!saida.endsWith('\0')) {
    throw new Error('Saida de "git diff --name-status -z" truncada: nao termina em NUL.')
  }
  const tokens = saida.slice(0, -1).split('\0')
  if (tokens.some((token) => token.length === 0)) {
    throw new Error('Saida de "git diff --name-status -z" corrompida: token vazio inesperado entre NULs.')
  }
  const resultado = []
  let indice = 0
  while (indice < tokens.length) {
    const status = tokens[indice]
    indice += 1
    if (status.startsWith('R') || status.startsWith('C')) {
      const previous_filename = tokens[indice]
      const filename = tokens[indice + 1]
      if (typeof previous_filename !== 'string' || typeof filename !== 'string') {
        throw new Error('Saida de "git diff --name-status -z" truncada: renomeacao/copia sem os dois caminhos.')
      }
      indice += 2
      resultado.push({
        status: status.startsWith('R') ? 'renamed' : 'copied',
        previous_filename,
        filename,
      })
    } else {
      const filename = tokens[indice]
      if (typeof filename !== 'string') {
        throw new Error('Saida de "git diff --name-status -z" truncada: status sem caminho.')
      }
      indice += 1
      resultado.push({ status: mapearStatusGit(status), filename })
    }
  }
  return resultado
}

export const SHA_VAZIO = '0000000000000000000000000000000000000000'

/**
 * Uma referencia invalida (ausente, o SHA-zero que o GitHub manda quando nao
 * ha commit anterior, algo que comeca com "-" e poderia ser confundido com
 * opcao de linha de comando pelo git, ou que carrega um NUL) nao permite
 * provar nada sobre o diff. Falha fechado: nao documental.
 */
export function referenciaGitValida(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return false
  if (ref === SHA_VAZIO) return false
  if (ref.startsWith('-')) return false
  if (ref.includes('\0')) return false
  return true
}

/**
 * Ancestral comum entre base e head. Uma PR cuja base (main) andou depois que
 * a branch foi criada nao tem em `base.sha` o ancestral real: tem a ponta
 * atual de main, que pode incluir commits que a PR nunca viu. Diferenciar
 * pelo merge-base evita contar como "mudanca da PR" algo que so aconteceu em
 * paralelo na base. Quando nao ha ancestral alcancavel (historico raso,
 * branches sem relacao), o git falha e isto propaga o erro: o chamador trata
 * como "nao documental", nunca como dispensa.
 */
export function calcularMergeBase({ base, head, execImpl = execFileSync } = {}) {
  const saida = execImpl('git', ['merge-base', String(base), String(head)], { encoding: 'utf8' })
  const mergeBase = typeof saida === 'string' ? saida.trim() : ''
  if (!mergeBase) {
    throw new Error(`git merge-base nao encontrou ancestral comum entre ${base} e ${head}.`)
  }
  return mergeBase
}

/**
 * Decide a base REAL do diff conforme o evento do GitHub que disparou a
 * classificacao. PR (ou qualquer evento que nao seja push) usa merge-base:
 * a base declarada pode ter andado depois que a branch nasceu, e o ponto de
 * bifurcacao e o que importa (ver `calcularMergeBase`).
 *
 * Push e diferente: `before`/`after` sao os dois estados LITERAIS da
 * referencia, e e exatamente essa comparacao (nao o ancestral comum) que
 * decide se o codigo que estava no ar mudou. Cenario real que o merge-base
 * escondia: ancestral A; B parte de A e altera codigo (`before`, ja
 * implantado); C tambem parte de A, nao de B, e so altera documentacao
 * (`after`). `merge-base(B, C)` devolve A, e o diff A..C parece "so
 * documental" — mas o push de B para C troca o codigo de B por nada, uma
 * mudanca real que nunca passou pela comparacao. Comparar B..C direto expoe
 * essa remocao (arquivo de codigo com status "removed"), que `classificarArquivo`
 * ja reprova por caminho nao documental. Diff literal nao exige ancestralidade
 * comprovada: compara as duas arvores como estao, entao a recusa conservadora
 * fica a cargo do proprio git diff falhar (historico raso demais) e propagar
 * o erro, nunca de uma dispensa silenciosa.
 */
function basePorEvento({ base, head, eventName, execImpl }) {
  if (eventName === 'push') return String(base)
  return calcularMergeBase({ base, head, execImpl })
}

/** Roda `git diff` local entre a base decidida por `basePorEvento` e o head, e devolve os arquivos alterados. */
export function arquivosPorGitDiff({ base, head, eventName, execImpl = execFileSync } = {}) {
  const baseReal = basePorEvento({ base, head, eventName, execImpl })
  const saida = execImpl(
    'git',
    ['diff', '--no-color', '-M', '--name-status', '-z', baseReal, String(head)],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 },
  )
  return interpretarNameStatus(saida)
}

/**
 * Classifica um push (ou fechamento de PR) a partir de duas referencias Git
 * locais. `eventName` (o `GITHUB_EVENT_NAME` do proprio evento) decide entre
 * merge-base e comparacao literal — ver `basePorEvento`. Sem `eventName`
 * (chamador fora de um workflow, como o ignoreCommand da Vercel) mantem o
 * comportamento historico de merge-base.
 */
export function classificarPorReferencias({ base, head, execImpl, eventName } = {}) {
  if (!referenciaGitValida(base) || !referenciaGitValida(head)) {
    return { documental: false, motivo: 'sem-base' }
  }
  const arquivos = arquivosPorGitDiff({ base, head, eventName, execImpl })
  return classificarMudancas(arquivos)
}

/**
 * Confere se a UNICA diferenca de conteudo entre o `vercel.json` da base e o
 * do head e a chave `ignoreCommand`. Qualquer outra chave adicionada,
 * removida ou com valor diferente (rotas, framework, outputDirectory etc.) e
 * configuracao real de deployment — falha fechado (retorna false) tambem
 * quando o JSON e invalido, nao e um objeto, ou o arquivo nao existe num dos
 * dois lados (por exemplo, `vercel.json` acabou de ser criado).
 */
export function vercelJsonSomenteIgnoreCommand({ base, head, execImpl = execFileSync } = {}) {
  try {
    const brutoBase = execImpl('git', ['show', `${base}:vercel.json`], { encoding: 'utf8' })
    const brutoHead = execImpl('git', ['show', `${head}:vercel.json`], { encoding: 'utf8' })
    const antes = JSON.parse(brutoBase)
    const depois = JSON.parse(brutoHead)
    if (typeof antes !== 'object' || antes === null || Array.isArray(antes)) return false
    if (typeof depois !== 'object' || depois === null || Array.isArray(depois)) return false
    const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)])
    for (const chave of chaves) {
      if (chave === 'ignoreCommand') continue
      if (!(chave in antes) || !(chave in depois)) return false
      if (JSON.stringify(antes[chave]) !== JSON.stringify(depois[chave])) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Variante de `classificarPorReferencias` que devolve o perfil tri-estado
 * ('documentation' | 'ci-mechanism' | 'product') em vez do booleano
 * `documental` historico. Usada pelo CLI (main, abaixo) e pelo ignoreCommand
 * da Vercel — os dois unicos consumidores deste modulo que precisam
 * distinguir mecanismo de CI de produto de verdade.
 */
export function classificarPerfilPorReferencias({ base, head, execImpl = execFileSync, eventName } = {}) {
  if (!referenciaGitValida(base) || !referenciaGitValida(head)) {
    return { perfil: 'product', motivo: 'sem-base' }
  }
  const arquivos = arquivosPorGitDiff({ base, head, eventName, execImpl })
  const baseReal = basePorEvento({ base, head, eventName, execImpl })
  return classificarPerfilMudancas(arquivos, { base: baseReal, head: String(head), execImpl })
}

async function pedirJson(url, { token, fetchImpl = fetch } = {}) {
  const resposta = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '')
    throw new Error(`GET ${url} respondeu ${resposta.status}. ${detalhe}`.trim())
  }
  return resposta.json()
}

/**
 * Ate quantas paginas de 100 arquivos ler antes de desistir. A REST do
 * GitHub para de listar arquivos de PR em 3000 sem avisar (documentado em
 * `banco-por-pr.yml`); 35 paginas cobrem 3500, uma margem confortavel acima
 * do teto conhecido sem arriscar um loop sem fim.
 */
export const LIMITE_PAGINAS_ARQUIVOS_PR = 35

/**
 * Lista os arquivos de uma PR pela API REST do GitHub, com duas defesas
 * contra dado incompleto:
 *
 * - truncamento: compara quantos arquivos a paginacao devolveu contra
 *   `changed_files`, que a propria PR declara;
 * - corrida: a paginacao de uma PR grande demora, e um commit novo pode
 *   chegar no meio dela. Conferir o SHA do head antes E depois garante que a
 *   listagem inteira corresponde a UM unico estado da PR; se o head mudou no
 *   meio, o resultado e de um commit que ja nao e mais o atual e e descartado.
 */
export async function buscarArquivosDaPr({
  repositorio,
  prNumber,
  token,
  fetchImpl = fetch,
} = {}) {
  if (!repositorio) throw new Error('Repositorio ausente.')
  if (!prNumber) throw new Error('Numero da PR ausente.')
  if (!token) throw new Error('Token de acesso ao GitHub ausente.')

  const urlPr = `https://api.github.com/repos/${repositorio}/pulls/${prNumber}`
  const pr = await pedirJson(urlPr, { token, fetchImpl })
  const declarados = pr?.changed_files
  if (typeof declarados !== 'number') {
    throw new Error('A PR nao informou changed_files; nao da para confirmar que a listagem esta completa.')
  }
  const headEsperado = pr?.head?.sha
  if (typeof headEsperado !== 'string' || headEsperado.length === 0) {
    throw new Error('A PR nao informou o SHA do head; nao da para confirmar contra qual commit a listagem vale.')
  }

  const arquivos = []
  for (let pagina = 1; pagina <= LIMITE_PAGINAS_ARQUIVOS_PR; pagina += 1) {
    const lote = await pedirJson(
      `${urlPr}/files?per_page=100&page=${pagina}`,
      { token, fetchImpl },
    )
    if (!Array.isArray(lote)) throw new Error('A listagem de arquivos da PR nao veio como lista.')
    arquivos.push(...lote)
    if (lote.length < 100) break
  }

  const prDepois = await pedirJson(urlPr, { token, fetchImpl })
  const headObtido = prDepois?.head?.sha
  if (headObtido !== headEsperado) {
    throw new Error(
      `A PR recebeu commit novo durante a listagem de arquivos (head mudou de ${headEsperado} para ${headObtido ?? 'desconhecido'}); resultado descartado.`,
    )
  }

  return { arquivos, recebidos: arquivos.length, declarados, headSha: headEsperado }
}

/** Classifica uma PR a partir da API REST do GitHub. */
export async function classificarPorPr({ repositorio, prNumber, token, fetchImpl } = {}) {
  const { arquivos, recebidos, declarados } = await buscarArquivosDaPr({ repositorio, prNumber, token, fetchImpl })
  return classificarMudancas(arquivos, { recebidos, declarados })
}

/**
 * Verificacao leve dos documentos alterados numa mudanca ja classificada
 * como documental (ver AGENTS.md, secao Verificacao). Nao e um parser
 * Markdown: confere so tres coisas, todas baratas e objetivas.
 *
 * - `git diff --check` no intervalo inteiro: falha em marcador de conflito
 *   (`<<<<<<<` etc.) e espaco em branco invalido. `execImpl` propaga o
 *   status de saida != 0 como excecao; nada de `|| true` escondendo a
 *   falha do git.
 * - UTF-8 valido no conteudo de cada documento adicionado/modificado/
 *   renomeado no diff.
 * - Todo link relativo ADICIONADO em cada documento aponta para algo que
 *   existe no repositorio. "Adicionado" quer dizer: so linhas que o diff
 *   marca com `+` (nao o arquivo inteiro), e "relativo" e resolvido contra
 *   o DIRETORIO DO PROPRIO DOCUMENTO — nao a raiz do repositorio. Um link
 *   como `../guia.md` escrito em `docs/sub/a.md` aponta para `docs/guia.md`,
 *   nao para `guia.md` na raiz; resolver contra a raiz da um falso vermelho
 *   nesse caso e, pior, um falso verde se por acaso existir um arquivo
 *   parecido na raiz.
 */
const PROTOCOLOS_LINK_EXTERNO = /^(https?:|mailto:|tel:|data:)/i

function utf8Valido(buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

/** Extrai os alvos de `](alvo)` das linhas ADICIONADAS (`+`, exceto o cabecalho `+++`) de um diff unificado. */
export function extrairLinksAdicionados(diffUnificado) {
  const alvos = []
  if (typeof diffUnificado !== 'string') return alvos
  for (const linha of diffUnificado.split('\n')) {
    if (!linha.startsWith('+') || linha.startsWith('+++')) continue
    const conteudo = linha.slice(1)
    const regex = /\]\(([^)]*)\)/g
    let combinacao
    while ((combinacao = regex.exec(conteudo)) !== null) {
      let bruto = combinacao[1].trim()
      if (bruto.startsWith('<')) {
        const fimAngulo = bruto.indexOf('>')
        bruto = fimAngulo === -1 ? bruto.slice(1) : bruto.slice(1, fimAngulo)
      } else {
        const indiceEspaco = bruto.search(/\s/)
        if (indiceEspaco !== -1) bruto = bruto.slice(0, indiceEspaco)
      }
      if (bruto.length > 0) alvos.push(bruto)
    }
  }
  return alvos
}

/**
 * Resolve um alvo de link markdown contra o diretorio do arquivo que o
 * contem. Devolve `null` quando o alvo nao e um caminho de arquivo local
 * para conferir (so ancora, URL externa ou protocolo relativo). Devolve
 * `{ fora: true }` quando o caminho normalizado escaparia do repositorio, e
 * `{ fora: false, caminho }` com o caminho POSIX relativo a raiz do
 * repositorio nos demais casos.
 */
export function resolverAlvoLink(alvoBruto, arquivoDeOrigem) {
  const semAncora = alvoBruto.split('#')[0].split('?')[0]
  if (semAncora.length === 0) return null
  if (PROTOCOLOS_LINK_EXTERNO.test(semAncora)) return null
  if (semAncora.startsWith('//')) return null
  const combinado = semAncora.startsWith('/')
    ? semAncora.slice(1)
    : path.posix.join(path.posix.dirname(arquivoDeOrigem), semAncora)
  const normalizado = path.posix.normalize(combinado)
  if (normalizado === '..' || normalizado.startsWith('../')) return { fora: true, caminho: normalizado }
  return { fora: false, caminho: normalizado }
}

/**
 * Roda a verificacao leve descrita acima entre o ancestral comum de `base`
 * e `head` (mesma tecnica de merge-base usada na classificacao de PR — aqui
 * o chamador so entra em modo de verificacao depois que a classificacao ja
 * confirmou que a mudanca inteira e documental, entao a base movel de uma PR
 * nao e um risco). Devolve a lista de problemas encontrados; lista vazia
 * quer dizer verificacao limpa.
 */
export function verificarDocumentos({
  base,
  head,
  eventName,
  execImpl = execFileSync,
  existsImpl = existsSync,
  readFileImpl = readFileSync,
} = {}) {
  if (!referenciaGitValida(base) || !referenciaGitValida(head)) {
    throw new Error('BASE_SHA/HEAD_SHA invalidos para a verificacao documental.')
  }
  const baseReal = basePorEvento({ base, head, eventName, execImpl })

  execImpl('git', ['diff', '--no-color', '--check', baseReal, String(head)], { encoding: 'utf8' })

  const arquivos = interpretarNameStatus(
    execImpl(
      'git',
      ['diff', '--no-color', '-M', '--name-status', '-z', '--diff-filter=ACMR', baseReal, String(head)],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 },
    ),
  ).filter((arquivo) => ehCaminhoDocumental(arquivo.filename))

  const problemas = []

  for (const arquivo of arquivos) {
    let conteudo
    try {
      conteudo = readFileImpl(arquivo.filename)
    } catch (erro) {
      problemas.push({
        arquivo: arquivo.filename,
        motivo: 'arquivo-ilegivel',
        detalhe: erro instanceof Error ? erro.message : String(erro),
      })
      continue
    }
    if (!utf8Valido(conteudo)) {
      problemas.push({ arquivo: arquivo.filename, motivo: 'utf8-invalido' })
    }

    const diffArquivo = execImpl(
      'git',
      ['diff', '--no-color', '-U0', baseReal, String(head), '--', arquivo.filename],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 },
    )
    for (const alvoBruto of extrairLinksAdicionados(diffArquivo)) {
      const resolvido = resolverAlvoLink(alvoBruto, arquivo.filename)
      if (resolvido === null) continue
      if (resolvido.fora) {
        problemas.push({ arquivo: arquivo.filename, alvo: alvoBruto, motivo: 'fora-do-repositorio' })
      } else if (!existsImpl(resolvido.caminho)) {
        problemas.push({ arquivo: arquivo.filename, alvo: alvoBruto, motivo: 'nao-encontrado' })
      }
    }
  }

  return problemas
}

/**
 * Formato de saida consumido pelos workflows via `>> "$GITHUB_OUTPUT"`:
 * `perfil` substitui o antigo `documental` booleano pelo tri-estado
 * ('documentation' | 'ci-mechanism' | 'product') que decide o que cada job
 * dispensa (ver AGENTS.md, secao Deploy e producao / CI).
 */
function imprimirResultado(resultado) {
  console.log(`perfil=${resultado.perfil}`)
  console.log(`motivo=${resultado.motivo ?? ''}`)
  if (resultado.perfil === 'product') {
    console.error(`Mudanca classificada como PRODUTO (motivo: ${resultado.motivo}); verificacao completa e obrigatoria.`)
  } else {
    console.error(`Mudanca classificada como "${resultado.perfil}"; dispensando verificacao completa de produto.`)
  }
}

function imprimirProblemasDocumentais(problemas) {
  for (const problema of problemas) {
    const alvo = problema.alvo ? ` (${problema.alvo})` : ''
    const detalhe = problema.detalhe ? ` — ${problema.detalhe}` : ''
    console.error(`${problema.arquivo}: ${problema.motivo}${alvo}${detalhe}`)
  }
}

/**
 * Modo `--verify-docs` da CLI: ver `verificarDocumentos`. Usa BASE_SHA/HEAD_SHA,
 * os mesmos do modo de classificacao local, e o mesmo GITHUB_EVENT_NAME — a
 * selecao entre merge-base e comparacao literal (ver `basePorEvento`) tem que
 * ser a MESMA que classificou a mudanca como documental; senao a verificacao
 * poderia conferir um diff diferente daquele que a classificacao aprovou.
 */
function executarVerificacaoDocumental() {
  const problemas = verificarDocumentos({
    base: process.env.BASE_SHA,
    head: process.env.HEAD_SHA,
    eventName: process.env.GITHUB_EVENT_NAME,
  })
  if (problemas.length > 0) {
    imprimirProblemasDocumentais(problemas)
    throw new Error(`Verificacao documental encontrou ${problemas.length} problema(s); ver mensagens acima.`)
  }
  console.log('Verificacao documental concluida sem problemas.')
}

/**
 * CLI. Tres modos:
 *
 * - `--verify-docs`: roda a verificacao leve dos documentos alterados (ver
 *   `verificarDocumentos`), usando `BASE_SHA`/`HEAD_SHA`. Usado pelo job
 *   "verificacao" de `ci.yml` sempre que a mudanca nao exigir a bateria de
 *   produto (perfil 'documentation' ou 'ci-mechanism'), mesmo quando nenhum
 *   dos arquivos alterados for de fato um documento (a funcao filtra
 *   internamente e nao acusa problema onde nao ha documento nenhum).
 * - `PR_NUMBER` + `GITHUB_REPOSITORY` + `GH_TOKEN`: classifica pela API do
 *   GitHub (evento `pull_request`). Preferir este modo so quando nao houver
 *   um checkout local com a base e o head alcancaveis; so distingue
 *   documentation/product (ver comentario no corpo de `main`).
 * - `BASE_SHA` + `HEAD_SHA`: classifica por `git diff` local entre as duas
 *   referencias, com o perfil tri-estado completo (documentation/ci-mechanism/
 *   product). E o modo preferido nos workflows deste repositorio, que ja
 *   fazem checkout com historico completo: evita a API (sujeita a corrida se
 *   um commit novo chegar enquanto a execucao roda) e usa os SHAs fixos do
 *   proprio evento. `GITHUB_EVENT_NAME` (ja definido pelo runner, nao precisa
 *   ser passado pelo workflow) decide como as duas referencias sao comparadas:
 *   merge-base para tudo que nao for push, comparacao literal para push (ver
 *   `basePorEvento`) — push muda a ponta literal de uma ref, e antes/depois
 *   podem nao ter relacao de ancestralidade (force-push, reset), caso em que
 *   o merge-base acha um ancestral comum mais antigo e esconde codigo que o
 *   push removeu.
 *
 * Nenhum dos tres presentes e erro: nao ha como o chamador ter esquecido de
 * dizer qual evento disparou isto, e seguir sem saber classificaria errado
 * por omissao.
 */
async function main() {
  if (process.argv.includes('--verify-docs')) {
    executarVerificacaoDocumental()
    return
  }

  const repositorio = process.env.GITHUB_REPOSITORY
  const prNumber = process.env.PR_NUMBER
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN

  let resultado
  if (prNumber) {
    // Modo API (sem checkout local): nao ha como conferir o CONTEUDO real de
    // vercel.json aqui (ver vercelJsonSomenteIgnoreCommand), entao este modo
    // so distingue documentation/product, nunca ci-mechanism. Nenhum workflow
    // deste repositorio usa este modo hoje — todos fazem checkout com
    // fetch-depth 0 e passam BASE_SHA/HEAD_SHA.
    const porPr = await classificarPorPr({ repositorio, prNumber, token })
    resultado = { perfil: porPr.documental ? 'documentation' : 'product', motivo: porPr.motivo }
  } else if (process.env.BASE_SHA || process.env.HEAD_SHA) {
    resultado = classificarPerfilPorReferencias({
      base: process.env.BASE_SHA,
      head: process.env.HEAD_SHA,
      eventName: process.env.GITHUB_EVENT_NAME,
    })
  } else {
    throw new Error('Nem PR_NUMBER nem BASE_SHA/HEAD_SHA foram informados; nao ha o que classificar.')
  }

  imprimirResultado(resultado)
}

const execucaoDireta = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (execucaoDireta) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : 'Falha desconhecida ao classificar a mudanca.')
    process.exitCode = 1
  })
}
