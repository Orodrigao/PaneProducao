import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, mock } from 'node:test'
import {
  CAMINHOS_DOCUMENTAIS_FIXOS,
  CAMINHOS_MECANISMO_CI,
  LIMITE_PAGINAS_ARQUIVOS_PR,
  SHA_VAZIO,
  arquivosPorGitDiff,
  buscarArquivosDaPr,
  calcularMergeBase,
  classificarArquivo,
  classificarMudancas,
  classificarPerfilArquivo,
  classificarPerfilMudancas,
  classificarPerfilPorReferencias,
  classificarPorPr,
  classificarPorReferencias,
  ehCaminhoDocumental,
  ehCaminhoMecanismoCi,
  extrairLinksAdicionados,
  interpretarNameStatus,
  referenciaGitValida,
  resolverAlvoLink,
  vercelJsonSomenteIgnoreCommand,
  verificarDocumentos,
} from './change-scope.mjs'
import { decidirIgnorarBuild, resolverReferencias } from './ignore-documentation-build.mjs'

/** Cria um repositorio Git real e descartavel para testar contra o binario git de verdade, nao um mock. */
function repositorioGitTemporario() {
  const dir = mkdtempSync(join(tmpdir(), 'change-scope-git-'))
  const exec = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
  exec('git', ['init', '--quiet'])
  exec('git', ['config', 'user.email', 'teste@example.com'])
  exec('git', ['config', 'user.name', 'Teste'])
  return { dir, exec }
}

function commitar(dir, exec, caminhoRelativo, conteudo, mensagem) {
  mkdirSync(join(dir, caminhoRelativo, '..'), { recursive: true })
  writeFileSync(join(dir, caminhoRelativo), conteudo)
  exec('git', ['add', caminhoRelativo])
  exec('git', ['commit', '--quiet', '-m', mensagem])
  return exec('git', ['rev-parse', 'HEAD']).trim()
}

// ---------------------------------------------------------------------------
// Extrator e avaliador minimos das condicoes `if:` REAIS de um workflow, para
// testar a decisao que o YAML realmente toma (nao um seletor paralelo que o
// workflow nao usa). Nao e um parser YAML generico: entende so o suficiente
// da indentacao de 2 espacos e dos poucos formatos (escalar, bloco `>-`,
// ancora `&nome`, alias `*nome`) que os workflows deste repositorio usam.
// ---------------------------------------------------------------------------

function extrairValorDeIf(linhas, indiceChave, ancoras) {
  const linha = linhas[indiceChave]
  const indentacaoChave = linha.match(/^(\s*)/)[1].length
  let resto = linha.slice(linha.indexOf('if:') + 3).trim()

  let nomeAncora = null
  const combinacaoAncora = resto.match(/^&(\S+)\s*(.*)$/)
  if (combinacaoAncora) {
    nomeAncora = combinacaoAncora[1]
    resto = combinacaoAncora[2].trim()
  }

  const combinacaoAlias = resto.match(/^\*(\S+)$/)
  if (combinacaoAlias) {
    const valor = ancoras[combinacaoAlias[1]]
    if (valor === undefined) throw new Error(`Alias "*${combinacaoAlias[1]}" usado antes da ancora "&${combinacaoAlias[1]}" ser definida.`)
    return valor
  }

  if (resto && !['>-', '|-', '>', '|'].includes(resto)) {
    if (nomeAncora) ancoras[nomeAncora] = resto
    return resto
  }

  const partes = []
  for (let i = indiceChave + 1; i < linhas.length; i += 1) {
    const atual = linhas[i]
    if (atual.trim() === '') continue
    const indentacaoAtual = atual.match(/^(\s*)/)[1].length
    if (indentacaoAtual <= indentacaoChave) break
    partes.push(atual.trim())
  }
  const valor = partes.join(' ')
  if (nomeAncora) ancoras[nomeAncora] = valor
  return valor
}

/** Extrai o `if:` do job e o `if:` de cada passo (por nome), resolvendo ancoras/aliases na ordem em que aparecem no arquivo. */
function extrairCondicoesDoJob(workflowTexto, nomeJob) {
  // Estes workflows sao salvos com CRLF; sem normalizar, toda linha carrega
  // um '\r' final e nenhuma comparacao exata de linha (`===`) bateria.
  const linhas = workflowTexto.replace(/\r\n/g, '\n').split('\n')
  const indiceJob = linhas.findIndex((l) => l === `  ${nomeJob}:`)
  if (indiceJob === -1) throw new Error(`Job "${nomeJob}" nao encontrado no workflow.`)
  let fimJob = linhas.length
  for (let i = indiceJob + 1; i < linhas.length; i += 1) {
    if (/^ {2}\S/.test(linhas[i])) { fimJob = i; break }
  }
  const bloco = linhas.slice(indiceJob, fimJob)

  const ancoras = {}
  let ifDoJob
  const passos = []
  let passoAtual = null

  for (let i = 0; i < bloco.length; i += 1) {
    const linha = bloco[i]
    if (!passoAtual && /^ {4}if:/.test(linha)) {
      ifDoJob = extrairValorDeIf(bloco, i, ancoras)
      continue
    }
    const inicioPasso = linha.match(/^( +)- (?:name|uses):\s*(.+)$/)
    if (inicioPasso) {
      if (passoAtual) passos.push(passoAtual)
      passoAtual = { titulo: inicioPasso[2].trim().replace(/^['"]|['"]$/g, ''), if: undefined, indentacao: inicioPasso[1].length }
      continue
    }
    if (passoAtual) {
      const indentacaoIfDoPasso = passoAtual.indentacao + 2
      if (new RegExp(`^ {${indentacaoIfDoPasso}}if:`).test(linha)) {
        passoAtual.if = extrairValorDeIf(bloco, i, ancoras)
      }
    }
  }
  if (passoAtual) passos.push(passoAtual)

  return { if: ifDoJob, passos }
}

/** `==`/`!=` do GitHub Actions viram `===`/`!==` do JS; o resto da sintaxe usada aqui (&&, ||, !(), literais) ja e compativel. */
function paraJs(expressaoGithub) {
  const marcador = '\x00NEQ\x00'
  return expressaoGithub.replace(/!=/g, marcador).replace(/==/g, '===').replace(new RegExp(marcador, 'g'), '!==')
}

function contemFuncaoDeStatus(expressao) {
  return /\b(always|success|failure|cancelled)\s*\(/.test(expressao)
}

/** Avalia uma expressao `if:` do GitHub Actions contra um contexto fabricado (github/needs/inputs) e um status de "sucesso ate aqui". */
function avaliarExpressaoGithub(expressao, contexto, statusAteAqui) {
  const fn = new Function(
    'github', 'needs', 'inputs', 'always', 'success', 'failure', 'cancelled',
    `return (${paraJs(expressao)});`,
  )
  return fn(
    contexto.github ?? {},
    contexto.needs ?? {},
    contexto.inputs ?? {},
    () => true,
    () => statusAteAqui === 'success',
    () => statusAteAqui === 'failure',
    () => statusAteAqui === 'cancelled',
  )
}

/**
 * Aplica a regra implicita do GitHub Actions: um `if` que nao usa nenhuma das
 * quatro funcoes de status e avaliado como `success() && (<if>)` — e essa
 * combinacao implicita, nao documentada de forma obvia, e a causa raiz do
 * bloqueador: um job cuja dependencia fica "skipped" nunca satisfaz
 * `success()`, entao QUALQUER `if` personalizado sem `always()` e pulado.
 */
function avaliarIfComRegraImplicita(expressao, contexto, statusAteAqui) {
  if (expressao === undefined) return statusAteAqui === 'success'
  const expressaoEfetiva = contemFuncaoDeStatus(expressao) ? expressao : `success() && (${expressao})`
  return avaliarExpressaoGithub(expressaoEfetiva, contexto, statusAteAqui)
}

/**
 * Simula a execucao sequencial dos passos de um job: cada passo roda (ou
 * nao) conforme sua condicao real + a regra implicita de success() sobre o
 * status acumulado dos passos anteriores. `nomesQueFalham` sao os passos cujo
 * corpo real e um `exit 1` incondicional quando alcancados (conhecido por
 * leitura do workflow, nao fabricado pelo teste).
 */
function simularPassosDoJob(passos, contexto, nomesQueFalham) {
  let statusAteAqui = 'success'
  const resultados = []
  for (const passo of passos) {
    const deveRodar = avaliarIfComRegraImplicita(passo.if, contexto, statusAteAqui)
    let falhou = false
    if (deveRodar && statusAteAqui === 'success' && nomesQueFalham.has(passo.titulo)) {
      falhou = true
      statusAteAqui = 'failure'
    }
    resultados.push({ titulo: passo.titulo, rodou: deveRodar, falhou })
  }
  return resultados
}

describe('ehCaminhoDocumental', () => {
  it('aceita os quatro arquivos fixos da raiz', () => {
    for (const caminho of CAMINHOS_DOCUMENTAIS_FIXOS) {
      assert.equal(ehCaminhoDocumental(caminho), true, caminho)
    }
  })

  it('aceita qualquer .md dentro de docs/, inclusive aninhado', () => {
    assert.equal(ehCaminhoDocumental('docs/PLAN.md'), true)
    assert.equal(ehCaminhoDocumental('docs/history/migrations-pre-baseline/nota.md'), true)
    assert.equal(ehCaminhoDocumental('docs/ARQUIVO.md'), true)
  })

  it('recusa MDX, assets, scripts, workflows e configs', () => {
    assert.equal(ehCaminhoDocumental('docs/PLAN.mdx'), false)
    assert.equal(ehCaminhoDocumental('docs/diagrama.png'), false)
    assert.equal(ehCaminhoDocumental('scripts/change-scope.mjs'), false)
    assert.equal(ehCaminhoDocumental('.github/workflows/ci.yml'), false)
    assert.equal(ehCaminhoDocumental('vercel.json'), false)
  })

  it('nao trata nome parecido fora do lugar certo como documental', () => {
    assert.equal(ehCaminhoDocumental('src/docs/README.md'), false)
    assert.equal(ehCaminhoDocumental('AGENTS.md.bak'), false)
    assert.equal(ehCaminhoDocumental('.claude/skills/x/AGENTS.md'), false)
  })

  it('diferencia maiusculas e minusculas', () => {
    assert.equal(ehCaminhoDocumental('agents.md'), false)
    assert.equal(ehCaminhoDocumental('README.MD'), false)
    assert.equal(ehCaminhoDocumental('Docs/plan.md'), false)
  })

  it('recusa entrada que nao seja string ou vazia', () => {
    assert.equal(ehCaminhoDocumental(''), false)
    assert.equal(ehCaminhoDocumental(undefined), false)
    assert.equal(ehCaminhoDocumental(null), false)
  })

  it('recusa travessia de diretorio que escaparia de docs/', () => {
    assert.equal(ehCaminhoDocumental('docs/../AGENTS.md'), false)
    assert.equal(ehCaminhoDocumental('docs/../../etc/malicioso.md'), false)
    assert.equal(ehCaminhoDocumental('docs/sub/../../fora.md'), false)
  })

  it('recusa barra invertida, caminho absoluto e caractere de controle', () => {
    assert.equal(ehCaminhoDocumental('docs\\PLAN.md'), false)
    assert.equal(ehCaminhoDocumental('/AGENTS.md'), false)
    assert.equal(ehCaminhoDocumental('docs/' + String.fromCharCode(7) + '.md'), false)
    assert.equal(ehCaminhoDocumental('docs/' + String.fromCharCode(0) + '.md'), false)
  })

  it('recusa dois-pontos (unidade do Windows ou fluxo alternativo de NTFS)', () => {
    assert.equal(ehCaminhoDocumental('C:/AGENTS.md'), false)
    assert.equal(ehCaminhoDocumental('docs/PLAN.md:oculto'), false)
  })

  it('recusa segmento "." e segmento vazio (barra dupla), nao so ".."', () => {
    assert.equal(ehCaminhoDocumental('docs/./PLAN.md'), false)
    assert.equal(ehCaminhoDocumental('docs//PLAN.md'), false)
    assert.equal(ehCaminhoDocumental('docs/PLAN.md/'), false)
    assert.equal(ehCaminhoDocumental('./AGENTS.md'), false)
  })
})

describe('classificarArquivo', () => {
  it('aceita arquivo documental simples, sem renomeacao', () => {
    assert.deepEqual(classificarArquivo({ filename: 'docs/PLAN.md', status: 'modified' }), { documental: true, motivo: null })
  })

  it('recusa arquivo de codigo', () => {
    const resultado = classificarArquivo({ filename: 'src/app/page.tsx', status: 'modified' })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'caminho-nao-documental')
  })

  it('aceita renomeacao de documento para documento', () => {
    const resultado = classificarArquivo({
      filename: 'docs/NOVO_NOME.md',
      previous_filename: 'docs/NOME_ANTIGO.md',
      status: 'renamed',
    })
    assert.equal(resultado.documental, true)
  })

  it('recusa renomeacao de codigo para dentro de docs/ (apaga um arquivo de codigo)', () => {
    const resultado = classificarArquivo({
      filename: 'docs/MIGRADO.md',
      previous_filename: 'src/lib/antigo.ts',
      status: 'renamed',
    })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'caminho-anterior-nao-documental')
  })

  it('recusa renomeacao de documento para fora de docs/', () => {
    const resultado = classificarArquivo({
      filename: 'src/lib/virou-codigo.ts',
      previous_filename: 'docs/ERA_DOC.md',
      status: 'renamed',
    })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'caminho-nao-documental')
  })

  it('recusa arquivo sem filename', () => {
    assert.equal(classificarArquivo({}).motivo, 'campo-ausente')
    assert.equal(classificarArquivo(null).motivo, 'campo-ausente')
    assert.equal(classificarArquivo({ filename: '' }).motivo, 'campo-ausente')
  })

  it('recusa previous_filename vazio em vez de ignora-lo', () => {
    const resultado = classificarArquivo({ filename: 'docs/PLAN.md', status: 'modified', previous_filename: '' })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'campo-ausente')
  })

  it('recusa status que este contrato nao conhece, mesmo com caminho documental', () => {
    const resultado = classificarArquivo({ filename: 'docs/PLAN.md', status: 'algo-que-a-api-inventou' })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'status-desconhecido')
  })

  it('recusa renomeacao/copia sem caminho anterior mesmo que o caminho novo seja documental', () => {
    const renomeada = classificarArquivo({ filename: 'docs/PLAN.md', status: 'renamed' })
    assert.equal(renomeada.documental, false)
    assert.equal(renomeada.motivo, 'renomeacao-sem-caminho-anterior')

    const copiada = classificarArquivo({ filename: 'docs/PLAN.md', status: 'copied', previous_filename: '' })
    assert.equal(copiada.documental, false)
    assert.equal(copiada.motivo, 'renomeacao-sem-caminho-anterior')
  })

  it('recusa status ausente mesmo com caminho documental (nenhum consumidor legado depende disso)', () => {
    const resultado = classificarArquivo({ filename: 'docs/PLAN.md' })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'status-desconhecido')
  })
})

describe('classificarMudancas', () => {
  it('aprova quando todos os arquivos sao documentais', () => {
    const resultado = classificarMudancas([
      { filename: 'AGENTS.md', status: 'modified' },
      { filename: 'docs/PLAN.md', status: 'modified' },
    ])
    assert.equal(resultado.documental, true)
  })

  it('reprova se um unico arquivo entre varios for codigo', () => {
    const resultado = classificarMudancas([
      { filename: 'docs/PLAN.md', status: 'modified' },
      { filename: 'src/app/page.tsx', status: 'modified' },
    ])
    assert.equal(resultado.documental, false)
    assert.equal(resultado.arquivo, 'src/app/page.tsx')
  })

  // Os tres casos que a realidade nao oferece de bandeja.
  it('lista vazia NAO concede dispensa', () => {
    assert.deepEqual(classificarMudancas([]), { documental: false, motivo: 'lista-vazia' })
  })

  it('campo ausente em qualquer entrada reprova o conjunto inteiro', () => {
    const resultado = classificarMudancas([{ filename: 'AGENTS.md', status: 'modified' }, {}])
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'campo-ausente')
  })

  it('status ausente em qualquer entrada reprova o conjunto, mesmo com caminho documental', () => {
    const resultado = classificarMudancas([{ filename: 'AGENTS.md', status: 'modified' }, { filename: 'docs/PLAN.md' }])
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'status-desconhecido')
    assert.equal(resultado.arquivo, 'docs/PLAN.md')
  })

  it('lista truncada (recebidos != declarados) reprova mesmo que o recebido pareca documental', () => {
    const resultado = classificarMudancas([{ filename: 'AGENTS.md', status: 'modified' }], { recebidos: 1, declarados: 4000 })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'lista-truncada')
  })

  it('lista invalida (nao-array) reprova', () => {
    assert.equal(classificarMudancas(null).motivo, 'lista-invalida')
    assert.equal(classificarMudancas(undefined).motivo, 'lista-invalida')
    assert.equal(classificarMudancas('nao é lista').motivo, 'lista-invalida')
  })

  it('status git desconhecido (codigo nao mapeado) reprova o conjunto', () => {
    const arquivos = interpretarNameStatus(['U', 'docs/PLAN.md', ''].join('\0'))
    assert.deepEqual(arquivos, [{ status: 'unknown', filename: 'docs/PLAN.md' }])
    const resultado = classificarMudancas(arquivos)
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'status-desconhecido')
  })

  it('contador negativo ou fracionario reprova, mesmo batendo entre si', () => {
    assert.equal(classificarMudancas([{ filename: 'AGENTS.md', status: 'modified' }], { recebidos: -1, declarados: -1 }).motivo, 'contador-invalido')
    assert.equal(classificarMudancas([{ filename: 'AGENTS.md', status: 'modified' }], { recebidos: 1.5, declarados: 1.5 }).motivo, 'contador-invalido')
    assert.equal(classificarMudancas([{ filename: 'AGENTS.md', status: 'modified' }], { recebidos: '1', declarados: '1' }).motivo, 'contador-invalido')
  })

  it('so um dos contadores presente tambem reprova (nao ha default seguro para o que falta)', () => {
    assert.equal(classificarMudancas([{ filename: 'AGENTS.md', status: 'modified' }], { recebidos: 1 }).motivo, 'contador-invalido')
    assert.equal(classificarMudancas([{ filename: 'AGENTS.md', status: 'modified' }], { declarados: 1 }).motivo, 'contador-invalido')
  })

  it('recebidos que nao bate com o tamanho real da lista reprova, mesmo igual a declarados', () => {
    const resultado = classificarMudancas(
      [{ filename: 'AGENTS.md', status: 'modified' }],
      { recebidos: 2, declarados: 2 },
    )
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'contador-nao-bate-com-lista')
  })
})

describe('interpretarNameStatus', () => {
  it('devolve lista vazia para entrada vazia', () => {
    assert.deepEqual(interpretarNameStatus(''), [])
    assert.deepEqual(interpretarNameStatus(undefined), [])
  })

  it('interpreta adicao, remocao e modificacao', () => {
    const saida = ['A', 'docs/NOVO.md', 'D', 'docs/REMOVIDO.md', 'M', 'AGENTS.md', ''].join('\0')
    assert.deepEqual(interpretarNameStatus(saida), [
      { status: 'added', filename: 'docs/NOVO.md' },
      { status: 'removed', filename: 'docs/REMOVIDO.md' },
      { status: 'modified', filename: 'AGENTS.md' },
    ])
  })

  it('interpreta renomeacao com o codigo de similaridade (Rxxx)', () => {
    const saida = ['R100', 'docs/ANTIGO.md', 'docs/NOVO.md', ''].join('\0')
    assert.deepEqual(interpretarNameStatus(saida), [
      { status: 'renamed', previous_filename: 'docs/ANTIGO.md', filename: 'docs/NOVO.md' },
    ])
  })

  it('interpreta copia (Cxxx) com a mesma forma de renomeacao', () => {
    const saida = ['C100', 'docs/ORIGEM.md', 'docs/COPIA.md', ''].join('\0')
    const [entrada] = interpretarNameStatus(saida)
    assert.equal(entrada.status, 'copied')
    assert.equal(entrada.previous_filename, 'docs/ORIGEM.md')
    assert.equal(entrada.filename, 'docs/COPIA.md')
  })

  it('preserva caminho com espaco ou caractere especial, que -z nao escapa', () => {
    const saida = ['M', 'docs/nota com espaco.md', ''].join('\0')
    assert.deepEqual(interpretarNameStatus(saida), [
      { status: 'modified', filename: 'docs/nota com espaco.md' },
    ])
  })

  it('lanca ao encontrar renomeacao/copia truncada (sem os dois caminhos)', () => {
    assert.throws(() => interpretarNameStatus(['R100', 'docs/ANTIGO.md', ''].join('\0')), /truncada/)
    assert.throws(() => interpretarNameStatus(['C100', ''].join('\0')), /truncada/)
  })

  it('lanca ao encontrar status sem caminho (stream cortado no meio)', () => {
    assert.throws(() => interpretarNameStatus(['M', ''].join('\0')), /truncada/)
  })

  it('lanca quando a saida nao termina em NUL (stream cortado sem sinal de fechamento)', () => {
    assert.throws(() => interpretarNameStatus('M\0AGENTS.md'), /truncada.*NUL/)
    assert.throws(() => interpretarNameStatus('M\0AGENTS.md\0D\0docs/REMOVIDO.md'), /truncada.*NUL/)
  })

  it('lanca quando ha NUL duplicado (token vazio no meio, nao so no fim)', () => {
    assert.throws(() => interpretarNameStatus('M\0\0'), /corrompida/)
    assert.throws(() => interpretarNameStatus('M\0AGENTS.md\0\0D\0docs/REMOVIDO.md\0'), /corrompida/)
  })
})

describe('referenciaGitValida', () => {
  it('recusa ausente, vazia e o SHA-zero do primeiro push de uma branch', () => {
    assert.equal(referenciaGitValida(undefined), false)
    assert.equal(referenciaGitValida(''), false)
    assert.equal(referenciaGitValida(SHA_VAZIO), false)
  })

  it('aceita um SHA de verdade', () => {
    assert.equal(referenciaGitValida('7cb8ce501ff4b2c7edc8de2c75a915b1f3b59025'), true)
  })

  it('recusa valor que comecaria com "-" e poderia ser lido como opcao pelo git', () => {
    assert.equal(referenciaGitValida('--upload-pack=/bin/sh'), false)
    assert.equal(referenciaGitValida('-o'), false)
  })

  it('recusa valor com NUL embutido', () => {
    assert.equal(referenciaGitValida('abc\0def'), false)
  })
})

describe('calcularMergeBase', () => {
  it('chama git merge-base com as duas referencias e devolve a saida sem quebra de linha', () => {
    const execImpl = mock.fn(() => 'mergebase123\n')
    const resultado = calcularMergeBase({ base: 'b', head: 'h', execImpl })
    assert.equal(resultado, 'mergebase123')
    assert.equal(execImpl.mock.callCount(), 1)
    const [comando, args] = execImpl.mock.calls[0].arguments
    assert.equal(comando, 'git')
    assert.deepEqual(args, ['merge-base', 'b', 'h'])
  })

  it('lanca quando o git nao encontra ancestral comum', () => {
    const execImpl = mock.fn(() => '')
    assert.throws(() => calcularMergeBase({ base: 'b', head: 'h', execImpl }), /ancestral comum/)
  })
})

describe('classificarPorReferencias', () => {
  it('falha fechado quando falta referencia, sem chamar o git', () => {
    const execImpl = mock.fn()
    assert.deepEqual(classificarPorReferencias({ base: SHA_VAZIO, head: 'abc', execImpl }), {
      documental: false,
      motivo: 'sem-base',
    })
    assert.equal(execImpl.mock.callCount(), 0)
  })

  it('classifica documental quando o git diff so mostra arquivos documentais', () => {
    const execImpl = mock.fn((_cmd, args) => (
      args[0] === 'merge-base' ? 'base123\n' : ['M', 'docs/PLAN.md', ''].join('\0')
    ))
    const resultado = classificarPorReferencias({ base: 'base123', head: 'head456', execImpl })
    assert.equal(resultado.documental, true)
    assert.equal(execImpl.mock.callCount(), 2)

    const [comandoBase, argsBase] = execImpl.mock.calls[0].arguments
    assert.equal(comandoBase, 'git')
    assert.deepEqual(argsBase, ['merge-base', 'base123', 'head456'])

    const [comandoDiff, argsDiff] = execImpl.mock.calls[1].arguments
    assert.equal(comandoDiff, 'git')
    assert.deepEqual(argsDiff, ['diff', '--no-color', '-M', '--name-status', '-z', 'base123', 'head456'])
  })

  it('classifica nao documental quando o diff toca codigo', () => {
    const execImpl = mock.fn((_cmd, args) => (
      args[0] === 'merge-base' ? 'b\n' : ['M', 'src/app/page.tsx', ''].join('\0')
    ))
    const resultado = classificarPorReferencias({ base: 'b', head: 'h', execImpl })
    assert.equal(resultado.documental, false)
  })

  it('propaga o erro (fail closed) quando nao ha ancestral comum alcancavel entre base e head', () => {
    const execImpl = mock.fn((_cmd, args) => {
      if (args[0] === 'merge-base') {
        throw new Error("fatal: Not a valid commit name b")
      }
      return ''
    })
    assert.throws(() => classificarPorReferencias({ base: 'b', head: 'h', execImpl }))
  })

  // Regressao real de push: ancestral A; B parte de A e altera codigo-fonte
  // (o "antes" do push, ja no ar); C tambem parte de A, nao de B, e so altera
  // documentacao (o "depois" do push). merge-base(B, C) devolve A, e o diff
  // A..C parece "so documental" — mas o push de B para C troca o codigo de B
  // por nada, uma mudanca real que o merge-base nunca compararia. So a
  // comparacao LITERAL entre B e C expoe essa remocao (arquivo de codigo com
  // status "removed"), que `classificarArquivo` ja reprova por caminho nao
  // documental. Usa git de verdade, nao merge-base mockado, para provar a
  // divergencia real de DAG.
  it('push real: comparacao literal reprova quando o push remove codigo que o merge-base esconderia', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const shaA = commitar(dir, exec, 'src/x.txt', 'codigo original', 'A: baseline')
      const shaB = commitar(dir, exec, 'src/x.txt', 'codigo alterado', 'B: muda codigo (antes do push)')

      exec('git', ['checkout', '--quiet', shaA])
      const shaC = commitar(dir, exec, 'docs/NOTA.md', '# nota', 'C: parte de A, so documentacao (depois do push)')

      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
      const resultado = classificarPorReferencias({ base: shaB, head: shaC, eventName: 'push', execImpl })
      assert.equal(resultado.documental, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Mesmo DAG divergente, mas fora de um push (`eventName` ausente ou
  // 'pull_request'): continua usando merge-base, porque numa PR o que importa
  // e o que mudou desde o ponto de bifurcacao com a base declarada, nao uma
  // comparacao literal entre dois SHAs quaisquer. Preserva o comportamento
  // historico — este teste existe para que o caso push acima nunca vire uma
  // regressao no caminho de PR.
  it('PR real: preserva merge-base (documental=true) quando o evento nao e push, mesmo com o mesmo DAG divergente', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const shaA = commitar(dir, exec, 'src/x.txt', 'codigo original', 'A: baseline')
      const shaB = commitar(dir, exec, 'src/x.txt', 'codigo alterado', 'B: muda codigo')

      exec('git', ['checkout', '--quiet', shaA])
      const shaC = commitar(dir, exec, 'docs/NOTA.md', '# nota', 'C: parte de A, so documentacao')

      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
      const semEventName = classificarPorReferencias({ base: shaB, head: shaC, execImpl })
      const comPullRequest = classificarPorReferencias({ base: shaB, head: shaC, eventName: 'pull_request', execImpl })
      assert.equal(semEventName.documental, true)
      assert.equal(comPullRequest.documental, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('arquivosPorGitDiff', () => {
  it('calcula o ancestral comum antes de comparar, e usa-o (nao o base literal) no diff', () => {
    const execImpl = mock.fn((_cmd, args) => (args[0] === 'merge-base' ? 'm\n' : ''))
    arquivosPorGitDiff({ base: 'x', head: 'y', execImpl })

    assert.equal(execImpl.mock.callCount(), 2)
    const [, argsMergeBase] = execImpl.mock.calls[0].arguments
    assert.deepEqual(argsMergeBase, ['merge-base', 'x', 'y'])

    const [, argsDiff, opcoes] = execImpl.mock.calls[1].arguments
    assert.ok(argsDiff.includes('-M'))
    assert.ok(argsDiff.includes('-z'))
    assert.deepEqual(argsDiff.slice(-2), ['m', 'y'])
    assert.equal(opcoes.encoding, 'utf8')
  })
})

function respostaJson(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), { status })
}

describe('buscarArquivosDaPr', () => {
  it('exige repositorio, numero da PR e token antes de qualquer chamada', async () => {
    await assert.rejects(buscarArquivosDaPr({ prNumber: 1, token: 't' }), /Repositorio/)
    await assert.rejects(buscarArquivosDaPr({ repositorio: 'r/r', token: 't' }), /Numero da PR/)
    await assert.rejects(buscarArquivosDaPr({ repositorio: 'r/r', prNumber: 1 }), /Token/)
  })

  it('para de paginar quando a pagina vem incompleta, confirma contra changed_files e confere o head duas vezes', async () => {
    const respostas = [
      respostaJson({ changed_files: 2, head: { sha: 'commitA' } }),
      respostaJson([{ filename: 'AGENTS.md' }, { filename: 'docs/PLAN.md' }]),
      respostaJson({ changed_files: 2, head: { sha: 'commitA' } }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    const resultado = await buscarArquivosDaPr({ repositorio: 'org/repo', prNumber: 42, token: 't', fetchImpl })
    assert.equal(resultado.recebidos, 2)
    assert.equal(resultado.declarados, 2)
    assert.equal(resultado.headSha, 'commitA')
    assert.equal(fetchImpl.mock.callCount(), 3)
  })

  it('pagina de 100 em 100 enquanto a pagina vier cheia', async () => {
    const paginaCheia = Array.from({ length: 100 }, (_, i) => ({ filename: `docs/${i}.md` }))
    const respostas = [
      respostaJson({ changed_files: 101, head: { sha: 'commitB' } }),
      respostaJson(paginaCheia),
      respostaJson([{ filename: 'docs/ultimo.md' }]),
      respostaJson({ changed_files: 101, head: { sha: 'commitB' } }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    const resultado = await buscarArquivosDaPr({ repositorio: 'org/repo', prNumber: 1, token: 't', fetchImpl })
    assert.equal(resultado.recebidos, 101)
    assert.equal(fetchImpl.mock.callCount(), 4)
  })

  it('recusa quando a PR nao informa changed_files', async () => {
    const fetchImpl = mock.fn(async () => respostaJson({}))
    await assert.rejects(
      buscarArquivosDaPr({ repositorio: 'org/repo', prNumber: 1, token: 't', fetchImpl }),
      /changed_files/,
    )
  })

  it('recusa quando a PR nao informa o SHA do head', async () => {
    const fetchImpl = mock.fn(async () => respostaJson({ changed_files: 1 }))
    await assert.rejects(
      buscarArquivosDaPr({ repositorio: 'org/repo', prNumber: 1, token: 't', fetchImpl }),
      /SHA do head/,
    )
  })

  it('repassa erro da API em vez de seguir no escuro', async () => {
    const fetchImpl = mock.fn(async () => new Response('sem permissao', { status: 403 }))
    await assert.rejects(
      buscarArquivosDaPr({ repositorio: 'org/repo', prNumber: 1, token: 't', fetchImpl }),
      /403/,
    )
  })

  it('recusa quando a listagem de arquivos nao vem como lista', async () => {
    const respostas = [
      respostaJson({ changed_files: 1, head: { sha: 'commitC' } }),
      respostaJson({ nao: 'e lista' }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    await assert.rejects(
      buscarArquivosDaPr({ repositorio: 'org/repo', prNumber: 1, token: 't', fetchImpl }),
      /lista/,
    )
  })

  it('recusa quando a PR recebe commit novo durante a paginacao (protecao contra corrida)', async () => {
    const respostas = [
      respostaJson({ changed_files: 1, head: { sha: 'antigo' } }),
      respostaJson([{ filename: 'AGENTS.md' }]),
      respostaJson({ changed_files: 2, head: { sha: 'novo' } }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    await assert.rejects(
      buscarArquivosDaPr({ repositorio: 'org/repo', prNumber: 1, token: 't', fetchImpl }),
      /commit novo/,
    )
  })

  it('o limite de paginas fica com margem confortavel acima do teto conhecido da API (3000)', () => {
    assert.ok(LIMITE_PAGINAS_ARQUIVOS_PR * 100 > 3000)
  })
})

describe('classificarPorPr', () => {
  it('junta busca e classificacao', async () => {
    const respostas = [
      respostaJson({ changed_files: 1, head: { sha: 'h1' } }),
      respostaJson([{ filename: 'AGENTS.md', status: 'modified' }]),
      respostaJson({ changed_files: 1, head: { sha: 'h1' } }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    const resultado = await classificarPorPr({ repositorio: 'org/repo', prNumber: 1, token: 't', fetchImpl })
    assert.equal(resultado.documental, true)
  })

  it('reprova PR truncada mesmo que o recebido pareca todo documental', async () => {
    const respostas = [
      respostaJson({ changed_files: 5000, head: { sha: 'h2' } }),
      respostaJson([{ filename: 'AGENTS.md' }]),
      respostaJson({ changed_files: 5000, head: { sha: 'h2' } }),
    ]
    const fetchImpl = mock.fn(async () => respostas.shift())
    const resultado = await classificarPorPr({ repositorio: 'org/repo', prNumber: 1, token: 't', fetchImpl })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'lista-truncada')
  })
})

// Contrato compartilhado com a Portaria (workspace/manuals/PORTARIA.md, fora
// deste repositorio): a lista positiva e literal e nao pode crescer sem
// combinar. Este teste prende a lista contra silencio.
describe('lista positiva documental', () => {
  it('e exatamente README.md, AGENTS.md, CLAUDE.md, lessons.md', () => {
    assert.deepEqual(
      [...CAMINHOS_DOCUMENTAIS_FIXOS].sort(),
      ['AGENTS.md', 'CLAUDE.md', 'README.md', 'lessons.md'],
    )
  })
})

// Espelho do seletor local da Portaria (Get-CiMechanismPaths em
// ~/.ai-team/scripts/verification-plan.ps1): a mesma lista de oito caminhos,
// literal, prende os dois lados contra divergencia silenciosa.
describe('lista positiva do mecanismo de CI', () => {
  it('e exatamente os oito caminhos que implementam o mecanismo de CI', () => {
    assert.deepEqual(
      [...CAMINHOS_MECANISMO_CI].sort(),
      [
        '.github/workflows/banco-por-pr.yml',
        '.github/workflows/banco-preview.yml',
        '.github/workflows/ci.yml',
        '.github/workflows/usuarios-banco-por-pr.yml',
        'scripts/change-scope.mjs',
        'scripts/change-scope.test.mjs',
        'scripts/ignore-documentation-build.mjs',
        'vercel.json',
      ].sort(),
    )
  })
})

describe('ehCaminhoMecanismoCi', () => {
  it('aceita exatamente os oito caminhos cadastrados', () => {
    for (const caminho of CAMINHOS_MECANISMO_CI) {
      assert.equal(ehCaminhoMecanismoCi(caminho), true, caminho)
    }
  })

  it('recusa caminho de produto, documento e nome parecido fora do lugar certo', () => {
    assert.equal(ehCaminhoMecanismoCi('src/app/page.tsx'), false)
    assert.equal(ehCaminhoMecanismoCi('AGENTS.md'), false)
    assert.equal(ehCaminhoMecanismoCi('supabase/migrations/20260101000000_x.sql'), false)
    assert.equal(ehCaminhoMecanismoCi('.github/workflows/outro.yml'), false)
    assert.equal(ehCaminhoMecanismoCi('scripts/change-scope2.mjs'), false)
  })

  it('nao aceita prefixo nem glob: e uma lista fechada, nao um diretorio inteiro', () => {
    assert.equal(ehCaminhoMecanismoCi('.github/workflows/ci.yml.bak'), false)
    assert.equal(ehCaminhoMecanismoCi('scripts/ci.yml'), false)
  })

  it('recusa entrada insegura (travessia, caminho absoluto, barra invertida)', () => {
    assert.equal(ehCaminhoMecanismoCi('vercel.json/../vercel.json'), false)
    assert.equal(ehCaminhoMecanismoCi('/vercel.json'), false)
    assert.equal(ehCaminhoMecanismoCi('vercel.json:oculto'), false)
  })
})

describe('classificarPerfilArquivo', () => {
  it('categoriza documento e mecanismo separadamente', () => {
    assert.deepEqual(classificarPerfilArquivo({ filename: 'AGENTS.md', status: 'modified' }), { categoria: 'documento', motivo: null })
    assert.deepEqual(classificarPerfilArquivo({ filename: 'vercel.json', status: 'modified' }), { categoria: 'mecanismo', motivo: null })
    assert.deepEqual(classificarPerfilArquivo({ filename: '.github/workflows/ci.yml', status: 'modified' }), { categoria: 'mecanismo', motivo: null })
  })

  it('reprova arquivo de produto (categoria null)', () => {
    const resultado = classificarPerfilArquivo({ filename: 'src/app/page.tsx', status: 'modified' })
    assert.equal(resultado.categoria, null)
    assert.equal(resultado.motivo, 'caminho-fora-das-listas')
  })

  it('aceita renomeacao dentro da MESMA categoria (mecanismo para mecanismo)', () => {
    const resultado = classificarPerfilArquivo({
      filename: 'scripts/change-scope.mjs',
      previous_filename: 'scripts/change-scope.mjs',
      status: 'renamed',
    })
    assert.equal(resultado.categoria, 'mecanismo')
  })

  // Paridade com o seletor local (Get-VerificationPlan): a UNIAO das duas
  // listas e o universo aprovado. Renomear DENTRO dela (CI<->docs, nos dois
  // sentidos) continua mecanismo, porque nenhum lado sai do que ja e
  // verificado pelo mecanismo isolado — so uma ponta em PRODUTO reprova.
  it('CI para documento: renomeacao dentro da uniao continua mecanismo (nao reprova mais)', () => {
    const resultado = classificarPerfilArquivo({
      filename: 'AGENTS.md',
      previous_filename: 'vercel.json',
      status: 'renamed',
    })
    assert.deepEqual(resultado, { categoria: 'mecanismo', motivo: null })
  })

  it('documento para CI: renomeacao dentro da uniao continua mecanismo (nao reprova mais)', () => {
    const resultado = classificarPerfilArquivo({
      filename: 'vercel.json',
      previous_filename: 'AGENTS.md',
      status: 'renamed',
    })
    assert.deepEqual(resultado, { categoria: 'mecanismo', motivo: null })
  })

  it('produto para documento: uma ponta fora da uniao ainda reprova (categoria null)', () => {
    const resultado = classificarPerfilArquivo({
      filename: 'docs/MIGRADO.md',
      previous_filename: 'src/lib/antigo.ts',
      status: 'renamed',
    })
    assert.equal(resultado.categoria, null)
    assert.equal(resultado.motivo, 'caminho-anterior-fora-das-listas')
  })

  it('produto para mecanismo de CI: uma ponta fora da uniao ainda reprova (categoria null)', () => {
    const resultado = classificarPerfilArquivo({
      filename: 'scripts/change-scope.mjs',
      previous_filename: 'src/lib/antigo.ts',
      status: 'renamed',
    })
    assert.equal(resultado.categoria, null)
    assert.equal(resultado.motivo, 'caminho-anterior-fora-das-listas')
  })

  it('documento para documento: continua documento (comportamento original preservado)', () => {
    const resultado = classificarPerfilArquivo({
      filename: 'docs/NOVO_NOME.md',
      previous_filename: 'docs/NOME_ANTIGO.md',
      status: 'renamed',
    })
    assert.deepEqual(resultado, { categoria: 'documento', motivo: null })
  })

  it('recusa remocao de arquivo do mecanismo tratando-a como categoria valida (deletar ainda toca o mecanismo)', () => {
    const resultado = classificarPerfilArquivo({ filename: 'vercel.json', status: 'removed' })
    assert.equal(resultado.categoria, 'mecanismo')
  })

  it('recusa campo ausente e status desconhecido, mesma defesa de classificarArquivo', () => {
    assert.equal(classificarPerfilArquivo({}).motivo, 'campo-ausente')
    assert.equal(classificarPerfilArquivo({ filename: 'vercel.json', status: 'algo-novo' }).motivo, 'status-desconhecido')
  })
})

describe('vercelJsonSomenteIgnoreCommand', () => {
  function repoComVercelJson(conteudoBase, conteudoHead) {
    const { dir, exec } = repositorioGitTemporario()
    const base = commitar(dir, exec, 'vercel.json', conteudoBase, 'base')
    writeFileSync(join(dir, 'vercel.json'), conteudoHead)
    exec('git', ['add', 'vercel.json'])
    exec('git', ['commit', '--quiet', '-m', 'muda vercel.json'])
    const head = exec('git', ['rev-parse', 'HEAD']).trim()
    const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
    return { dir, base, head, execImpl }
  }

  it('aceita quando so ignoreCommand muda', () => {
    const { dir, base, head, execImpl } = repoComVercelJson(
      JSON.stringify({ outputDirectory: 'out', cleanUrls: true, ignoreCommand: 'echo velho' }),
      JSON.stringify({ outputDirectory: 'out', cleanUrls: true, ignoreCommand: 'echo novo' }),
    )
    try {
      assert.equal(vercelJsonSomenteIgnoreCommand({ base, head, execImpl }), true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('recusa quando outra chave tambem muda, mesmo com ignoreCommand igual', () => {
    const { dir, base, head, execImpl } = repoComVercelJson(
      JSON.stringify({ outputDirectory: 'out', ignoreCommand: 'x' }),
      JSON.stringify({ outputDirectory: 'build', ignoreCommand: 'x' }),
    )
    try {
      assert.equal(vercelJsonSomenteIgnoreCommand({ base, head, execImpl }), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('recusa quando uma chave nova e adicionada (alem de ignoreCommand)', () => {
    const { dir, base, head, execImpl } = repoComVercelJson(
      JSON.stringify({ ignoreCommand: 'x' }),
      JSON.stringify({ ignoreCommand: 'x', rewrites: [] }),
    )
    try {
      assert.equal(vercelJsonSomenteIgnoreCommand({ base, head, execImpl }), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falha fechado (false) quando o JSON e invalido ou nao e objeto', () => {
    const { dir, base, head, execImpl } = repoComVercelJson('{ "ignoreCommand": "x" }', 'nao e json')
    try {
      assert.equal(vercelJsonSomenteIgnoreCommand({ base, head, execImpl }), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falha fechado (false) quando vercel.json nao existe num dos dois lados', () => {
    const execImpl = mock.fn(() => { throw new Error("fatal: path 'vercel.json' does not exist") })
    assert.equal(vercelJsonSomenteIgnoreCommand({ base: 'b', head: 'h', execImpl }), false)
  })
})

describe('classificarPerfilMudancas', () => {
  it('CI-only: perfil ci-mechanism quando so caminhos do mecanismo de CI mudam (sem vercel.json)', () => {
    const resultado = classificarPerfilMudancas([
      { filename: '.github/workflows/ci.yml', status: 'modified' },
      { filename: 'scripts/change-scope.mjs', status: 'modified' },
    ])
    assert.deepEqual(resultado, { perfil: 'ci-mechanism', motivo: null })
  })

  it('CI+docs: mistura de mecanismo de CI com documento aprovado ainda e ci-mechanism', () => {
    const resultado = classificarPerfilMudancas([
      { filename: '.github/workflows/ci.yml', status: 'modified' },
      { filename: 'AGENTS.md', status: 'modified' },
      { filename: 'docs/PLAN.md', status: 'modified' },
    ])
    assert.deepEqual(resultado, { perfil: 'ci-mechanism', motivo: null })
  })

  it('so documentos (sem nenhum arquivo do mecanismo): perfil documentation, nao ci-mechanism', () => {
    const resultado = classificarPerfilMudancas([{ filename: 'AGENTS.md', status: 'modified' }])
    assert.deepEqual(resultado, { perfil: 'documentation', motivo: null })
  })

  it('CI+produto: um unico arquivo de produto junto do mecanismo de CI reprova o conjunto inteiro', () => {
    const resultado = classificarPerfilMudancas([
      { filename: '.github/workflows/ci.yml', status: 'modified' },
      { filename: 'src/app/page.tsx', status: 'modified' },
    ])
    assert.equal(resultado.perfil, 'product')
    assert.equal(resultado.motivo, 'caminho-fora-das-listas')
    assert.equal(resultado.arquivo, 'src/app/page.tsx')
  })

  it('banco: alteracao em supabase/ nunca e mecanismo de CI nem documento, mesmo isolada', () => {
    const resultado = classificarPerfilMudancas([
      { filename: 'supabase/migrations/20260101000000_x.sql', status: 'added' },
    ])
    assert.equal(resultado.perfil, 'product')
    assert.equal(resultado.motivo, 'caminho-fora-das-listas')
  })

  it('arquivo desconhecido (status que a API pode inventar) reprova o conjunto para produto', () => {
    const resultado = classificarPerfilMudancas([
      { filename: '.github/workflows/ci.yml', status: 'algo-que-a-api-inventou' },
    ])
    assert.equal(resultado.perfil, 'product')
    assert.equal(resultado.motivo, 'status-desconhecido')
  })

  it('Vercel fora de ignoreCommand: vercel.json alterado com outra chave reprova para produto', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const base = commitar(dir, exec, 'vercel.json', JSON.stringify({ outputDirectory: 'out', ignoreCommand: 'x' }), 'base')
      writeFileSync(join(dir, 'vercel.json'), JSON.stringify({ outputDirectory: 'build', ignoreCommand: 'x' }))
      exec('git', ['add', 'vercel.json'])
      exec('git', ['commit', '--quiet', '-m', 'muda outputDirectory'])
      const head = exec('git', ['rev-parse', 'HEAD']).trim()
      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })

      const resultado = classificarPerfilMudancas(
        [{ filename: 'vercel.json', status: 'modified' }],
        { base, head, execImpl },
      )
      assert.equal(resultado.perfil, 'product')
      assert.equal(resultado.motivo, 'vercel-json-alem-do-ignorecommand')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Vercel dentro de ignoreCommand: vercel.json alterado so no ignoreCommand entra em ci-mechanism', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const base = commitar(dir, exec, 'vercel.json', JSON.stringify({ outputDirectory: 'out', ignoreCommand: 'echo velho' }), 'base')
      writeFileSync(join(dir, 'vercel.json'), JSON.stringify({ outputDirectory: 'out', ignoreCommand: 'echo novo' }))
      exec('git', ['add', 'vercel.json'])
      exec('git', ['commit', '--quiet', '-m', 'muda ignoreCommand'])
      const head = exec('git', ['rev-parse', 'HEAD']).trim()
      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })

      const resultado = classificarPerfilMudancas(
        [{ filename: 'vercel.json', status: 'modified' }],
        { base, head, execImpl },
      )
      assert.deepEqual(resultado, { perfil: 'ci-mechanism', motivo: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('vercel.json entre os arquivos sem base/head informados falha fechado para produto (nao ha como conferir o conteudo)', () => {
    const resultado = classificarPerfilMudancas([{ filename: 'vercel.json', status: 'modified' }])
    assert.equal(resultado.perfil, 'product')
    assert.equal(resultado.motivo, 'vercel-sem-referencia-para-conferir-conteudo')
  })

  // Renomear vercel.json para fora (mesmo para dentro da uniao documento+
  // mecanismo, que agora conta como mecanismo no nivel de arquivo) nao
  // dispensa a conferencia de conteudo: no head o arquivo simplesmente nao
  // existe mais, e a funcao de conteudo falha fechado (false) nesse caso.
  it('vercel.json renomeado para fora (mesmo dentro da uniao) continua exigindo conteudo, e falha fechado por ausencia no head', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const base = commitar(dir, exec, 'vercel.json', JSON.stringify({ ignoreCommand: 'x' }), 'base')
      exec('git', ['mv', 'vercel.json', 'AGENTS.md'])
      exec('git', ['commit', '--quiet', '-m', 'renomeia vercel.json para AGENTS.md'])
      const head = exec('git', ['rev-parse', 'HEAD']).trim()
      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })

      const resultado = classificarPerfilMudancas(
        [{ filename: 'AGENTS.md', previous_filename: 'vercel.json', status: 'renamed' }],
        { base, head, execImpl },
      )
      assert.equal(resultado.perfil, 'product')
      assert.equal(resultado.motivo, 'vercel-json-alem-do-ignorecommand')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('erro de classificacao (lista invalida, vazia ou truncada) nunca fica verde: sempre produto', () => {
    assert.equal(classificarPerfilMudancas(null).perfil, 'product')
    assert.equal(classificarPerfilMudancas(null).motivo, 'lista-invalida')
    assert.equal(classificarPerfilMudancas([]).perfil, 'product')
    assert.equal(classificarPerfilMudancas([]).motivo, 'lista-vazia')
    const truncada = classificarPerfilMudancas(
      [{ filename: 'AGENTS.md', status: 'modified' }],
      { recebidos: 1, declarados: 4000 },
    )
    assert.equal(truncada.perfil, 'product')
    assert.equal(truncada.motivo, 'lista-truncada')
  })
})

describe('classificarPerfilPorReferencias', () => {
  it('falha fechado (product) quando falta referencia, sem chamar o git', () => {
    const execImpl = mock.fn()
    assert.deepEqual(classificarPerfilPorReferencias({ base: SHA_VAZIO, head: 'abc', execImpl }), {
      perfil: 'product',
      motivo: 'sem-base',
    })
    assert.equal(execImpl.mock.callCount(), 0)
  })

  it('classifica ci-mechanism quando o diff so toca o mecanismo de CI cadastrado', () => {
    const execImpl = mock.fn((_cmd, args) => (
      args[0] === 'merge-base' ? 'base123\n' : ['M', 'scripts/change-scope.mjs', ''].join('\0')
    ))
    const resultado = classificarPerfilPorReferencias({ base: 'base123', head: 'head456', execImpl })
    assert.deepEqual(resultado, { perfil: 'ci-mechanism', motivo: null })
  })

  it('classifica product quando o diff toca codigo fora das duas listas', () => {
    const execImpl = mock.fn((_cmd, args) => (
      args[0] === 'merge-base' ? 'b\n' : ['M', 'src/app/page.tsx', ''].join('\0')
    ))
    const resultado = classificarPerfilPorReferencias({ base: 'b', head: 'h', execImpl })
    assert.equal(resultado.perfil, 'product')
  })
})

describe('resolverReferencias (ignoreCommand da Vercel)', () => {
  it('le VERCEL_GIT_PREVIOUS_SHA e VERCEL_GIT_COMMIT_SHA', () => {
    assert.deepEqual(
      resolverReferencias({ VERCEL_GIT_PREVIOUS_SHA: 'antigo', VERCEL_GIT_COMMIT_SHA: 'novo' }),
      { base: 'antigo', head: 'novo' },
    )
  })
})

describe('decidirIgnorarBuild (ignoreCommand da Vercel)', () => {
  it('constroi (documental=false) na primeira deployment de uma branch, sem VERCEL_GIT_PREVIOUS_SHA', () => {
    const execImpl = mock.fn()
    const resultado = decidirIgnorarBuild({ env: { VERCEL_GIT_COMMIT_SHA: 'novo' }, execImpl })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'sem-base')
    assert.equal(execImpl.mock.callCount(), 0)
  })

  it('dispensa o build quando o diff desde a ultima deployment e so documental', () => {
    const execImpl = mock.fn((_cmd, args) => (
      args[0] === 'merge-base' ? 'antigo\n' : ['M', 'docs/PLAN.md', ''].join('\0')
    ))
    const resultado = decidirIgnorarBuild({
      env: { VERCEL_GIT_PREVIOUS_SHA: 'antigo', VERCEL_GIT_COMMIT_SHA: 'novo' },
      execImpl,
    })
    assert.equal(resultado.documental, true)
  })

  it('constroi quando o diff desde a ultima deployment toca codigo', () => {
    const execImpl = mock.fn((_cmd, args) => (
      args[0] === 'merge-base' ? 'antigo\n' : ['M', 'src/app/page.tsx', ''].join('\0')
    ))
    const resultado = decidirIgnorarBuild({
      env: { VERCEL_GIT_PREVIOUS_SHA: 'antigo', VERCEL_GIT_COMMIT_SHA: 'novo' },
      execImpl,
    })
    assert.equal(resultado.documental, false)
  })

  it('constroi (nunca dispensa) quando o clone raso da Vercel nao alcanca mais o commit anterior, nem para calcular o ancestral', () => {
    const execImpl = mock.fn(() => {
      throw new Error("fatal: ambiguous argument 'antigo': unknown revision or path not in the working tree.")
    })
    const resultado = decidirIgnorarBuild({
      env: { VERCEL_GIT_PREVIOUS_SHA: 'antigo', VERCEL_GIT_COMMIT_SHA: 'novo' },
      execImpl,
    })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'erro-git')
  })

  // merge-base(base, head) so prova que os dois tem ALGUM ancestral comum,
  // nao que `base` esteja na linha de `head`. Se `base` (o commit implantado
  // por ultimo) nao for ancestral de `head` (o commit atual), o diff
  // baseReal..head pode parecer "so documental" escondendo codigo que ainda
  // esta no ar e que `head` nunca viu, porque `head` nao descende de `base`.
  it('nao dispensa quando o commit anterior implantado nao e ancestral literal do head (merge-base mais antigo)', () => {
    const execImpl = mock.fn((_cmd, args) => (
      args[0] === 'merge-base' ? 'ancestral-comum-mais-antigo\n' : ['M', 'docs/PLAN.md', ''].join('\0')
    ))
    const resultado = decidirIgnorarBuild({
      env: { VERCEL_GIT_PREVIOUS_SHA: 'commit-b-implantado', VERCEL_GIT_COMMIT_SHA: 'commit-c-so-docs' },
      execImpl,
    })
    assert.equal(resultado.documental, false)
    assert.equal(resultado.motivo, 'base-nao-ancestral')
    // A checagem de ancestralidade e ANTES do diff: so uma chamada ao git.
    assert.equal(execImpl.mock.callCount(), 1)
  })

  // Reproduz literalmente o cenario do bloqueador: ancestral A; uma branch B
  // antiga parte de A e altera codigo-fonte (fica implantada); a nova head C
  // TAMBEM parte de A, nao de B, e so altera documentacao. Usa o git de
  // verdade (nao um merge-base mockado) para provar que a divergencia real
  // de DAG e detectada, nao so um valor de retorno fabricado.
  it('DAG real: nao dispensa quando a head diverge do commit implantado em vez de descender dele', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const shaA = commitar(dir, exec, 'src/app.js', 'console.log("a")', 'A: baseline')
      const shaB = commitar(dir, exec, 'src/app.js', 'console.log("b")', 'B: muda codigo (implantado por ultimo)')

      exec('git', ['checkout', '--quiet', shaA])
      const shaC = commitar(dir, exec, 'docs/NOTA.md', '# nota', 'C: parte de A, so documentacao')

      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_GIT_PREVIOUS_SHA: shaB, VERCEL_GIT_COMMIT_SHA: shaC },
        execImpl,
      })
      assert.equal(resultado.documental, false)
      assert.equal(resultado.motivo, 'base-nao-ancestral')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Controle positivo com o mesmo git real: quando a head DESCENDE do commit
  // implantado (caso normal, sem divergencia), a ancestralidade e confirmada
  // e a classificacao documental continua funcionando.
  it('DAG real: dispensa quando a head realmente descende do commit implantado e so altera docs', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const shaA = commitar(dir, exec, 'src/app.js', 'console.log("a")', 'A: baseline')
      const shaBImplantado = commitar(dir, exec, 'src/app.js', 'console.log("b")', 'B: implantado por ultimo')
      const shaCHead = commitar(dir, exec, 'docs/NOTA.md', '# nota', 'C: descende de B, so documentacao')

      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_GIT_PREVIOUS_SHA: shaBImplantado, VERCEL_GIT_COMMIT_SHA: shaCHead },
        execImpl,
      })
      assert.equal(resultado.documental, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // CI-only desde a ultima deployment: o ignoreCommand tambem precisa
  // reconhecer o mecanismo de CI cadastrado, nao so documentacao pura.
  it('dispensa o build (perfil ci-mechanism) quando o diff so toca o mecanismo de CI cadastrado', () => {
    const execImpl = mock.fn((_cmd, args) => (
      args[0] === 'merge-base' ? 'antigo\n' : ['M', 'scripts/change-scope.mjs', ''].join('\0')
    ))
    const resultado = decidirIgnorarBuild({
      env: { VERCEL_GIT_PREVIOUS_SHA: 'antigo', VERCEL_GIT_COMMIT_SHA: 'novo' },
      execImpl,
    })
    assert.equal(resultado.perfil, 'ci-mechanism')
    // `documental` (booleano historico) so cobre 'documentation'; nao finge
    // que ci-mechanism e a mesma coisa para quem ainda le esse campo.
    assert.equal(resultado.documental, false)
  })

  it('expõe o perfil tri-estado junto do booleano historico nos demais casos', () => {
    const execImpl = mock.fn((_cmd, args) => (
      args[0] === 'merge-base' ? 'antigo\n' : ['M', 'docs/PLAN.md', ''].join('\0')
    ))
    const resultado = decidirIgnorarBuild({
      env: { VERCEL_GIT_PREVIOUS_SHA: 'antigo', VERCEL_GIT_COMMIT_SHA: 'novo' },
      execImpl,
    })
    assert.equal(resultado.perfil, 'documentation')
    assert.equal(resultado.documental, true)
  })

  // Sem este fallback, TODA primeira deployment de PREVIEW de toda PR
  // construía o ERP inteiro (Vercel nunca manda VERCEL_GIT_PREVIOUS_SHA na
  // primeira deployment de uma branch) — inclusive a primeira preview desta
  // propria branch, o bloqueador que motivou este ajuste.
  describe('fallback de primeira deployment de PREVIEW (sem VERCEL_GIT_PREVIOUS_SHA)', () => {
    function execImplFallback({ mainSha = 'mainsha', ancestralRetornado = mainSha, diffSaida, fetchFalha, mergeBaseFalha } = {}) {
      return mock.fn((_cmd, args) => {
        if (args[0] === 'fetch') {
          if (fetchFalha) throw new Error('fatal: unable to access origin: Could not resolve host')
          return ''
        }
        if (args[0] === 'rev-parse') return `${mainSha}\n`
        if (args[0] === 'merge-base') {
          if (mergeBaseFalha) throw new Error("fatal: Not a valid commit name mainsha")
          return `${ancestralRetornado}\n`
        }
        return diffSaida
      })
    }

    it('CI-only: primeira preview que so toca o mecanismo de CI cadastrado dispensa o build', () => {
      const execImpl = execImplFallback({
        diffSaida: ['M', 'scripts/change-scope.mjs', ''].join('\0'),
      })
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'head1' },
        execImpl,
      })
      assert.equal(resultado.perfil, 'ci-mechanism')
    })

    it('docs-only: primeira preview que so toca documentacao aprovada dispensa o build', () => {
      const execImpl = execImplFallback({
        diffSaida: ['M', 'AGENTS.md', ''].join('\0'),
      })
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'head1' },
        execImpl,
      })
      assert.equal(resultado.perfil, 'documentation')
      assert.equal(resultado.documental, true)
    })

    it('preview misto/produto: primeira preview que toca codigo de produto constroi', () => {
      const execImpl = execImplFallback({
        diffSaida: ['M', 'src/app/page.tsx', ''].join('\0'),
      })
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'head1' },
        execImpl,
      })
      assert.equal(resultado.perfil, 'product')
    })

    it('fetch falho (sem rede/host) constroi, sem laco de novas tentativas', () => {
      const execImpl = execImplFallback({ fetchFalha: true })
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'head1' },
        execImpl,
      })
      assert.equal(resultado.perfil, 'product')
      assert.equal(resultado.motivo, 'sem-base-fallback-fetch-falhou')
      // Uma unica tentativa: 1 fetch + 1 rev-parse, nada mais.
      const chamadas = execImpl.mock.calls.map((c) => c.arguments[1][0])
      assert.deepEqual(chamadas, ['fetch'])
    })

    it('historico insuficiente (sem ancestral comum alcancavel na profundidade buscada) constroi', () => {
      const execImpl = execImplFallback({ mergeBaseFalha: true })
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'head1' },
        execImpl,
      })
      assert.equal(resultado.perfil, 'product')
      assert.equal(resultado.motivo, 'sem-base-fallback-sem-ancestral')
    })

    it('main buscado divergente (nao ancestral literal do head) constroi', () => {
      const execImpl = execImplFallback({ mainSha: 'mainsha', ancestralRetornado: 'ancestral-mais-antigo' })
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'head1' },
        execImpl,
      })
      assert.equal(resultado.perfil, 'product')
      assert.equal(resultado.motivo, 'sem-base-fallback-nao-ancestral')
    })

    it('primeira deployment de PRODUCAO (sem VERCEL_ENV=preview) nao aciona o fallback: constroi sem chamar o git', () => {
      const execImpl = mock.fn()
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_GIT_COMMIT_SHA: 'head1' },
        execImpl,
      })
      assert.equal(resultado.perfil, 'product')
      assert.equal(resultado.motivo, 'sem-base')
      assert.equal(execImpl.mock.callCount(), 0)
    })

    it('VERCEL_GIT_PREVIOUS_SHA presente porem invalido (nao ausente) nao aciona o fallback, mesmo em preview', () => {
      const execImpl = mock.fn()
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: SHA_VAZIO, VERCEL_GIT_COMMIT_SHA: 'head1' },
        execImpl,
      })
      assert.equal(resultado.perfil, 'product')
      assert.equal(resultado.motivo, 'sem-base')
      assert.equal(execImpl.mock.callCount(), 0)
    })

    // Preserva a ancestralidade quando VERCEL_GIT_PREVIOUS_SHA EXISTE: o
    // fallback e exclusivo do caso "ausente" e nunca reduz a exigencia normal.
    it('quando VERCEL_GIT_PREVIOUS_SHA existe e nao e ancestral, continua reprovando pelo caminho normal (sem fallback)', () => {
      const execImpl = mock.fn((_cmd, args) => (
        args[0] === 'merge-base' ? 'ancestral-comum-mais-antigo\n' : ''
      ))
      const resultado = decidirIgnorarBuild({
        env: { VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: 'commit-implantado', VERCEL_GIT_COMMIT_SHA: 'head1' },
        execImpl,
      })
      assert.equal(resultado.perfil, 'product')
      assert.equal(resultado.motivo, 'base-nao-ancestral')
      assert.equal(execImpl.mock.callCount(), 1)
    })

    // Prova com GIT DE VERDADE, sem mockar `origin/main`: reproduz o clone
    // raso single-branch que a Vercel usa para a branch de uma PR (so a
    // branch da PR, nunca `main`) via `file://` local, sem rede externa. Isto
    // e o que provou o bloqueador real (ver work/git-fetch-probe-result.json,
    // tarefa 20260912-ci-proporcional-integracao): `git fetch origin main`
    // termina com exit 0 e atualiza `FETCH_HEAD`, mas
    // `git rev-parse refs/remotes/origin/main` falha com exit 128 no MESMO
    // clone, porque `--single-branch` restringe o refspec do remoto aquela
    // unica branch. So `FETCH_HEAD` e confiavel aqui.
    describe('prova com clone raso single-branch real (file://, sem rede externa)', () => {
      function paraUrlDeArquivo(caminhoAbsoluto) {
        const posix = caminhoAbsoluto.replace(/\\/g, '/')
        return posix.startsWith('/') ? `file://${posix}` : `file:///${posix}`
      }

      /** Origem com `main` (um commit) e `feature` bifurcada de `main` com mais um commit isolado. */
      function origemComMainEFeature(caminhoArquivoAlterado, conteudoAlterado) {
        const { dir, exec } = repositorioGitTemporario()
        commitar(dir, exec, 'README.md', '# origem', 'main: commit base')
        exec('git', ['branch', '-M', 'main'])
        const shaMain = exec('git', ['rev-parse', 'HEAD']).trim()
        exec('git', ['checkout', '--quiet', '-b', 'feature'])
        const shaFeature = commitar(dir, exec, caminhoArquivoAlterado, conteudoAlterado, 'feature: altera arquivo isolado')
        return { dir, shaMain, shaFeature }
      }

      /** Clona SO `branch` (nunca `main`) com profundidade minima — o formato que reproduz o bug. */
      function cloneRasoSingleBranch(origemDir, branch, profundidade) {
        const destino = mkdtempSync(join(tmpdir(), 'change-scope-clone-'))
        execFileSync(
          'git',
          ['clone', '--quiet', '--single-branch', '--branch', branch, `--depth=${profundidade}`, paraUrlDeArquivo(origemDir), '.'],
          { cwd: destino, encoding: 'utf8' },
        )
        const exec = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: destino, encoding: 'utf8' })
        return { dir: destino, exec }
      }

      // Profundidade 10: a mesma que a Vercel documenta para o clone raso da
      // branch da PR (kb "Ignored Build Step", clone depth 10). Com essa
      // profundidade, o unico commit de `main` cabe dentro da janela que o
      // proprio clone da branch ja traz, e o merge-base enxerga o ancestral
      // sem precisar de segunda busca nenhuma.
      const PROFUNDIDADE_REALISTA_VERCEL = 10

      function rodarCenario(caminhoArquivoAlterado, conteudoAlterado, profundidade = PROFUNDIDADE_REALISTA_VERCEL) {
        const { dir: origemDir, shaFeature } = origemComMainEFeature(caminhoArquivoAlterado, conteudoAlterado)
        try {
          const { dir: cloneDir, exec: execClone } = cloneRasoSingleBranch(origemDir, 'feature', profundidade)
          try {
            // Confirma a premissa do bloqueador: o proprio clone que a Vercel
            // usaria ja nao tem `origin/main`, antes mesmo de chamar o
            // fallback.
            assert.throws(
              () => execClone('git', ['rev-parse', '--verify', 'refs/remotes/origin/main']),
              'o clone single-branch nao deveria ter refs/remotes/origin/main; a premissa do teste mudou.',
            )
            const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: cloneDir, encoding: 'utf8' })
            return decidirIgnorarBuild({
              env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: shaFeature },
              execImpl,
            })
          } finally {
            rmSync(cloneDir, { recursive: true, force: true })
          }
        } finally {
          rmSync(origemDir, { recursive: true, force: true })
        }
      }

      it('CI-only (profundidade 10, igual a Vercel): origin/main nao existe no clone, o fetch de fallback funciona e o preview e dispensado (ci-mechanism)', () => {
        const resultado = rodarCenario('scripts/change-scope.mjs', '// mudanca isolada no mecanismo de CI')
        assert.equal(resultado.perfil, 'ci-mechanism')
        assert.equal(resultado.primeiraPreview, true)
      })

      it('docs-only (profundidade 10, igual a Vercel): origin/main nao existe no clone, o fetch de fallback funciona e o preview e dispensado (documentation)', () => {
        const resultado = rodarCenario('AGENTS.md', '# AGENTS\n\nmudanca isolada de documentacao\n')
        assert.equal(resultado.perfil, 'documentation')
        assert.equal(resultado.documental, true)
      })

      it('produto (profundidade 10, igual a Vercel): origin/main nao existe no clone, o fetch de fallback funciona mas o preview NAO e dispensado (product)', () => {
        const resultado = rodarCenario('src/app/page.tsx', '// mudanca de produto')
        assert.equal(resultado.perfil, 'product')
      })

      // Negativo real (nao mockado): profundidade 1 nao chega ao commit de
      // `main` a partir da propria ponta da branch (o clone da branch fica
      // raso demais mesmo depois de `main` ser buscado a parte). Falha
      // fechada correta: constroi. Reproduz o resultado independente de
      // Codex em work/git-fetch-depth1-result.json (merge-base sai com
      // codigo 1 nessa mesma configuracao).
      it('historico insuficiente com git real (profundidade 1): fetch de main funciona, mas o merge-base falha e o preview NAO e dispensado', () => {
        const resultado = rodarCenario('AGENTS.md', '# AGENTS\n\nmudanca isolada de documentacao\n', 1)
        assert.equal(resultado.perfil, 'product')
        assert.equal(resultado.motivo, 'sem-base-fallback-sem-ancestral')
      })
    })
  })
})

// A logica de workflow que DECIDE alguma coisa so era exercitada abrindo PR e
// esperando o semaforo. Estes testes conferem que a chamada real em ci.yml
// continua usando esta mesma classificacao, ao pe da letra.
describe('uso em ci.yml', () => {
  it('o workflow chama scripts/change-scope.mjs na etapa de classificacao', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    assert.ok(
      workflow.includes('node scripts/change-scope.mjs'),
      'ci.yml parou de chamar change-scope.mjs; este teste ficou para tras.',
    )
    assert.ok(
      workflow.includes("needs.classificacao.outputs.perfil == 'product'"),
      'A guarda que dispensa a bateria completa mudou e este teste ficou para tras.',
    )
  })

  it('verificacao e navegador falham explicitamente se a classificacao nao concluir com um perfil valido', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
      .replace(/\s+/g, ' ')

    assert.ok(
      workflow.includes("needs.classificacao.result != 'success' ||"),
      'A guarda explicita contra classificacao que falhou/nao concluiu sumiu de ci.yml.',
    )
    assert.ok(
      workflow.includes(
        "needs.classificacao.outputs.perfil != 'documentation' && " +
        "needs.classificacao.outputs.perfil != 'ci-mechanism' && " +
        "needs.classificacao.outputs.perfil != 'product'",
      ),
      'A guarda contra perfil invalido (nem documentation, nem ci-mechanism, nem product) sumiu de ci.yml.',
    )
    assert.ok(
      /verificacao:[\s\S]*if:\s*always\(\)/.test(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')),
      'O job verificacao precisa de if: always() para nao ser pulado silenciosamente quando a classificacao falha.',
    )
  })

  // Consumo dos outputs pelos jobs: ci-mechanism precisa rodar o node --test
  // isolado (com teto de 180s) e NUNCA instalar/construir o ERP, exatamente
  // como documentation — a unica diferenca de ci-mechanism e o passo extra.
  describe('consumo do output perfil pelo job verificacao', () => {
    const workflowTexto = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    const NOMES_QUE_FALHAM = new Set(['Falhar se a classificação não concluiu com um resultado válido'])

    function simular(perfil) {
      const { passos } = extrairCondicoesDoJob(workflowTexto, 'verificacao')
      const contexto = { needs: { classificacao: { result: 'success', outputs: { perfil } } } }
      return simularPassosDoJob(passos, contexto, NOMES_QUE_FALHAM)
    }

    function rodou(passos, titulo) {
      const passo = passos.find((p) => p.titulo === titulo)
      assert.ok(passo, `Passo "${titulo}" nao encontrado.`)
      return passo.rodou
    }

    it('product: roda a bateria completa e nunca a verificacao leve nem o teste isolado', () => {
      const passos = simular('product')
      assert.equal(rodou(passos, 'Instalar dependências'), true)
      assert.equal(rodou(passos, 'Lint'), true)
      assert.equal(rodou(passos, 'Build'), true)
      assert.equal(rodou(passos, 'Verificação documental (mudança apenas documental ou mecanismo de CI)'), false)
      assert.equal(rodou(passos, 'Verificação isolada do mecanismo de CI (sem instalar o ERP)'), false)
    })

    it('documentation: dispensa a bateria completa, roda so a verificacao leve', () => {
      const passos = simular('documentation')
      assert.equal(rodou(passos, 'Instalar dependências'), false)
      assert.equal(rodou(passos, 'Build'), false)
      assert.equal(rodou(passos, 'Verificação documental (mudança apenas documental ou mecanismo de CI)'), true)
      assert.equal(rodou(passos, 'Verificação isolada do mecanismo de CI (sem instalar o ERP)'), false)
    })

    it('ci-mechanism: dispensa a bateria completa E roda o teste isolado com timeout, sem instalar o ERP', () => {
      const passos = simular('ci-mechanism')
      assert.equal(rodou(passos, 'Instalar dependências'), false)
      assert.equal(rodou(passos, 'Build'), false)
      assert.equal(rodou(passos, 'Verificação documental (mudança apenas documental ou mecanismo de CI)'), true)
      assert.equal(rodou(passos, 'Verificação isolada do mecanismo de CI (sem instalar o ERP)'), true)

      const inicio = workflowTexto.indexOf('Verificação isolada do mecanismo de CI (sem instalar o ERP)')
      const fim = workflowTexto.indexOf('\n\n', inicio)
      const trecho = workflowTexto.slice(inicio, fim === -1 ? workflowTexto.length : fim)
      assert.ok(trecho.includes('node --test scripts/change-scope.test.mjs'), 'o passo isolado parou de chamar node --test.')
      assert.ok(/timeout-minutes:\s*3\b/.test(trecho), 'o teto de 180s (3 minutos) sumiu do passo isolado.')
    })

    it('perfil invalido/ausente: nenhum passo condicional roda (a falha explicita ja para o job antes)', () => {
      const passos = simular('talvez')
      assert.equal(rodou(passos, 'Falhar se a classificação não concluiu com um resultado válido'), true)
      assert.equal(rodou(passos, 'Instalar dependências'), false)
      assert.equal(rodou(passos, 'Verificação documental (mudança apenas documental ou mecanismo de CI)'), false)
      assert.equal(rodou(passos, 'Verificação isolada do mecanismo de CI (sem instalar o ERP)'), false)
    })
  })

  describe('grupo de concorrencia do job navegador (nao pode disputar a fila real do Banco Preview a toa)', () => {
    const workflowTexto = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

    /** Extrai a expressao `${{ ... }}` do campo `group:` de `concurrency:` de um job (escalar de uma linha). */
    function extrairGrupoConcorrencia(nomeJob) {
      const linhas = workflowTexto.replace(/\r\n/g, '\n').split('\n')
      const indiceJob = linhas.findIndex((l) => l === `  ${nomeJob}:`)
      assert.ok(indiceJob > -1, `Job "${nomeJob}" nao encontrado.`)
      let fimJob = linhas.length
      for (let i = indiceJob + 1; i < linhas.length; i += 1) {
        if (/^ {2}\S/.test(linhas[i])) { fimJob = i; break }
      }
      const linhaGrupo = linhas.slice(indiceJob, fimJob).find((l) => /^\s*group:/.test(l))
      assert.ok(linhaGrupo, `"concurrency.group" nao encontrado no job "${nomeJob}".`)
      const bruto = linhaGrupo.slice(linhaGrupo.indexOf('group:') + 6).trim()
      const combinacao = bruto.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/)
      assert.ok(combinacao, `"concurrency.group" do job "${nomeJob}" nao esta no formato \${{ ... }}: ${bruto}`)
      return combinacao[1]
    }

    function avaliarGrupo(expressao, contexto) {
      const fn = new Function(
        'github', 'needs', 'format',
        `return (${paraJs(expressao)});`,
      )
      return fn(
        contexto.github ?? {},
        contexto.needs ?? {},
        (modelo, ...valores) => modelo.replace(/\{(\d+)\}/g, (_, indice) => valores[Number(indice)]),
      )
    }

    it('so entra na fila real quando a classificacao teve sucesso, confirmou perfil "product" E a verificacao tambem teve sucesso', () => {
      const expressao = extrairGrupoConcorrencia('navegador')

      const casos = [
        ['classificacao com sucesso, perfil product, verificacao com sucesso: fila real', { result: 'success', outputs: { perfil: 'product' } }, { result: 'success' }, 'banco-preview-compartilhado'],
        ['classificacao com sucesso, documentation: grupo unico (verificacao dispensada nem roda a bateria)', { result: 'success', outputs: { perfil: 'documentation' } }, { result: 'success' }, 'ci-docs-only-42'],
        ['classificacao com sucesso, ci-mechanism: grupo unico (mesma dispensa de documentation)', { result: 'success', outputs: { perfil: 'ci-mechanism' } }, { result: 'success' }, 'ci-docs-only-42'],
        ['classificacao falhou: grupo unico, NUNCA a fila real', { result: 'failure', outputs: {} }, { result: 'skipped' }, 'ci-docs-only-42'],
        ['classificacao foi pulada: grupo unico, NUNCA a fila real', { result: 'skipped', outputs: {} }, { result: 'skipped' }, 'ci-docs-only-42'],
        ['classificacao com sucesso mas perfil invalido: grupo unico, NUNCA a fila real', { result: 'success', outputs: { perfil: 'talvez' } }, { result: 'failure' }, 'ci-docs-only-42'],
        ['classificacao com sucesso e perfil product, mas verificacao (lint/tipos/testes/build) falhou: grupo unico, NUNCA a fila real', { result: 'success', outputs: { perfil: 'product' } }, { result: 'failure' }, 'ci-docs-only-42'],
        ['classificacao com sucesso e perfil product, mas verificacao foi pulada: grupo unico, NUNCA a fila real', { result: 'success', outputs: { perfil: 'product' } }, { result: 'skipped' }, 'ci-docs-only-42'],
      ]

      for (const [rotulo, classificacao, verificacao, esperado] of casos) {
        const contexto = { github: { run_id: '42' }, needs: { classificacao, verificacao } }
        assert.equal(avaliarGrupo(expressao, contexto), esperado, rotulo)
      }
    })
  })
})

describe('uso em banco-preview.yml', () => {
  const workflowTexto = readFileSync(new URL('../.github/workflows/banco-preview.yml', import.meta.url), 'utf8')
  const NOMES_QUE_FALHAM = new Set([
    'Falhar se o push tiver classificacao ausente ou invalida',
    'Exigir confirmacao da reconstrucao manual',
  ])

  function simular(contexto) {
    const { if: ifDoJob, passos } = extrairCondicoesDoJob(workflowTexto, 'restaurar-main')
    return { ifDoJob, passos: simularPassosDoJob(passos, contexto, NOMES_QUE_FALHAM) }
  }

  function rodou(resultado, titulo) {
    const passo = resultado.passos.find((p) => p.titulo === titulo)
    assert.ok(passo, `Passo "${titulo}" nao encontrado na extracao.`)
    return passo.rodou
  }

  it('chama scripts/change-scope.mjs na classificacao do push', () => {
    assert.ok(
      workflowTexto.includes('node scripts/change-scope.mjs'),
      'banco-preview.yml parou de chamar change-scope.mjs; este teste ficou para tras.',
    )
  })

  it('o job usa always() — sem isso, needs.classificacao "skipped" pulava o job inteiro em silencio', () => {
    const { if: ifDoJob } = extrairCondicoesDoJob(workflowTexto, 'restaurar-main')
    assert.equal(ifDoJob, 'always()')
  })

  it('prova o bug historico: sem always(), o success() implicito do GitHub pulava a reconstrucao manual e a limpeza de PR fechada', () => {
    // Usa a MESMA expressao real (`deve-reconstruir`, via alias no passo de
    // checkout) que decide "deve reconstruir", so que avaliada como o
    // GitHub avaliava o `if` de JOB antigo: implicitamente combinada com
    // success() sobre o resultado de "classificacao" — que fica "skipped"
    // em workflow_dispatch e pull_request(closed), porque aquele job so
    // roda em push.
    const { passos } = extrairCondicoesDoJob(workflowTexto, 'restaurar-main')
    const condicaoReal = passos.find((p) => p.titulo === 'actions/checkout@v4').if

    const contextoManual = { github: { event_name: 'workflow_dispatch' }, needs: { classificacao: { result: 'skipped' } }, inputs: { confirmacao: 'RECONSTRUIR' } }
    const contextoPrFechada = { github: { event_name: 'pull_request', event: { action: 'closed', pull_request: { merged: false } } }, needs: { classificacao: { result: 'skipped' } } }

    for (const contexto of [contextoManual, contextoPrFechada]) {
      const comAlwaysAntigo = avaliarIfComRegraImplicita('always()', contexto, 'success')
      const semAlwaysAntigo = avaliarIfComRegraImplicita(condicaoReal, contexto, contexto.needs.classificacao.result)
      assert.equal(comAlwaysAntigo, true, 'O job com always() deveria iniciar.')
      assert.equal(semAlwaysAntigo, false, 'Sem always(), o success() implicito deveria pular o job (era o bug).')
    }
  })

  it('push documental: nao reconstroi, e o passo informativo confirma que nao ha nada a fazer', () => {
    const contexto = { github: { event_name: 'push' }, needs: { classificacao: { result: 'success', outputs: { perfil: 'documentation' } } } }
    const resultado = simular(contexto)
    assert.equal(rodou(resultado, 'Falhar se o push tiver classificacao ausente ou invalida'), false)
    assert.equal(rodou(resultado, 'Nada a reconstruir para este evento'), true)
    assert.equal(rodou(resultado, 'actions/checkout@v4'), false)
    assert.equal(rodou(resultado, 'Apagar desvios e reconstruir a partir da main'), false)
  })

  it('push so mecanismo de CI (ci-mechanism): nao reconstroi, mesma dispensa de push documental', () => {
    const contexto = { github: { event_name: 'push' }, needs: { classificacao: { result: 'success', outputs: { perfil: 'ci-mechanism' } } } }
    const resultado = simular(contexto)
    assert.equal(rodou(resultado, 'Nada a reconstruir para este evento'), true)
    assert.equal(rodou(resultado, 'actions/checkout@v4'), false)
    assert.equal(rodou(resultado, 'Apagar desvios e reconstruir a partir da main'), false)
  })

  it('push perfil product: reconstroi de ponta a ponta', () => {
    const contexto = { github: { event_name: 'push' }, needs: { classificacao: { result: 'success', outputs: { perfil: 'product' } } } }
    const resultado = simular(contexto)
    assert.equal(rodou(resultado, 'Nada a reconstruir para este evento'), false)
    assert.equal(rodou(resultado, 'actions/checkout@v4'), true)
    assert.equal(rodou(resultado, 'Apagar desvios e reconstruir a partir da main'), true)
    assert.equal(rodou(resultado, 'Verificar invariantes e seed canonicos'), true)
  })

  for (const [rotulo, resultadoClassificacao] of [
    ['classificacao falhou', { result: 'failure', outputs: {} }],
    ['classificacao foi pulada', { result: 'skipped', outputs: {} }],
    ['classificacao produziu perfil invalido', { result: 'success', outputs: { perfil: 'talvez' } }],
  ]) {
    it(`push com ${rotulo}: falha explicitamente ANTES de qualquer passo com segredo, sem reset`, () => {
      const contexto = { github: { event_name: 'push' }, needs: { classificacao: resultadoClassificacao } }
      const resultado = simular(contexto)
      assert.equal(rodou(resultado, 'Falhar se o push tiver classificacao ausente ou invalida'), true)
      const indiceFalha = resultado.passos.findIndex((p) => p.titulo === 'Falhar se o push tiver classificacao ausente ou invalida')
      // Nenhum passo POSTERIOR a falha roda — nem o informativo, nem o reset.
      for (const passo of resultado.passos.slice(indiceFalha + 1)) {
        assert.equal(passo.rodou, false, `"${passo.titulo}" nao deveria rodar apos a falha de classificacao.`)
      }
    })
  }

  it('workflow_dispatch confirmado: reconstroi mesmo com needs.classificacao skipped (a dependencia so existe para push)', () => {
    const contexto = { github: { event_name: 'workflow_dispatch' }, needs: { classificacao: { result: 'skipped', outputs: {} } }, inputs: { confirmacao: 'RECONSTRUIR' } }
    const resultado = simular(contexto)
    assert.equal(rodou(resultado, 'Falhar se o push tiver classificacao ausente ou invalida'), false)
    // So valida (e falha) quando a confirmacao esta ERRADA; com a palavra certa nao ha nada a bloquear.
    assert.equal(rodou(resultado, 'Exigir confirmacao da reconstrucao manual'), false)
    assert.equal(rodou(resultado, 'actions/checkout@v4'), true)
    assert.equal(rodou(resultado, 'Apagar desvios e reconstruir a partir da main'), true)
  })

  it('workflow_dispatch com confirmacao errada: falha no passo de confirmacao, sem chegar no reset', () => {
    const contexto = { github: { event_name: 'workflow_dispatch' }, needs: { classificacao: { result: 'skipped', outputs: {} } }, inputs: { confirmacao: 'errado' } }
    const resultado = simular(contexto)
    const passoConfirmacao = resultado.passos.find((p) => p.titulo === 'Exigir confirmacao da reconstrucao manual')
    assert.equal(passoConfirmacao.rodou, true)
    assert.equal(passoConfirmacao.falhou, true)
    assert.equal(rodou(resultado, 'actions/checkout@v4'), false)
    assert.equal(rodou(resultado, 'Apagar desvios e reconstruir a partir da main'), false)
  })

  it('PR fechada SEM merge: limpa mesmo com needs.classificacao skipped, e nunca depende da classificacao documental', () => {
    const contexto = { github: { event_name: 'pull_request', event: { action: 'closed', pull_request: { merged: false } } }, needs: { classificacao: { result: 'skipped', outputs: {} } } }
    const resultado = simular(contexto)
    assert.equal(rodou(resultado, 'Nada a reconstruir para este evento'), false)
    assert.equal(rodou(resultado, 'actions/checkout@v4'), true)
    assert.equal(rodou(resultado, 'Apagar desvios e reconstruir a partir da main'), true)

    // A clausula do evento `pull_request` (a terceira, separada por `||`) e
    // quem decide a limpeza de PR fechada — e ela, isoladamente, que nao pode
    // referenciar needs.classificacao (a clausula do `push`, bem antes dela
    // na mesma expressao, referencia needs.classificacao legitimamente).
    const condicaoDeveReconstruir = extrairCondicoesDoJob(workflowTexto, 'restaurar-main').passos
      .find((p) => p.titulo === 'actions/checkout@v4').if
    const clausulaPullRequest = condicaoDeveReconstruir.slice(condicaoDeveReconstruir.indexOf("github.event_name == 'pull_request'"))
    assert.ok(
      !clausulaPullRequest.includes('needs.classificacao'),
      'A clausula do evento pull_request(closed) nao pode depender de needs.classificacao para decidir a limpeza de PR fechada.',
    )
  })

  it('PR fechada COM merge: nao reconstroi por aqui (a main sera restaurada pelo push do proprio merge)', () => {
    const contexto = { github: { event_name: 'pull_request', event: { action: 'closed', pull_request: { merged: true } } }, needs: { classificacao: { result: 'skipped', outputs: {} } } }
    const resultado = simular(contexto)
    assert.equal(rodou(resultado, 'Nada a reconstruir para este evento'), true)
    assert.equal(rodou(resultado, 'actions/checkout@v4'), false)
  })
})

describe('uso em banco-por-pr.yml', () => {
  it('classifica com os SHAs do proprio evento antes de apontar o preview, sem gatear a limpeza nem o disparo manual', () => {
    const bruto = readFileSync(new URL('../.github/workflows/banco-por-pr.yml', import.meta.url), 'utf8')
    const workflow = bruto.replace(/\s+/g, ' ')

    assert.ok(
      workflow.includes('node scripts/change-scope.mjs'),
      'banco-por-pr.yml parou de chamar change-scope.mjs; este teste ficou para tras.',
    )
    assert.ok(
      workflow.includes("if: github.event_name == 'workflow_dispatch' || steps.classificar.outputs.perfil == 'product'"),
      'A guarda de perfil antes de apontar o preview mudou e este teste ficou para tras.',
    )

    const indiceJobLimpar = bruto.indexOf('\n  limpar:')
    assert.ok(indiceJobLimpar > -1, 'job limpar sumiu do workflow.')
    assert.ok(
      !bruto.slice(indiceJobLimpar).includes('classificacao') && !bruto.slice(indiceJobLimpar).includes('classificar'),
      'A limpeza do Banco por PR nao pode ser condicionada a classificacao documental.',
    )
  })

  it('classifica com o diff COMPLETO base..head da PR, mesmo em synchronize (nao so o ultimo commit)', () => {
    const workflow = readFileSync(new URL('../.github/workflows/banco-por-pr.yml', import.meta.url), 'utf8')
    const inicio = workflow.indexOf('Classificar mudança desta sincronização')
    const fim = workflow.indexOf('\n      - name:', inicio + 1)
    const trecho = workflow.slice(inicio, fim === -1 ? workflow.length : fim).replace(/\s+/g, ' ')

    assert.ok(
      trecho.includes('BASE_SHA: ${{ github.event.pull_request.base.sha }}'),
      'BASE_SHA precisa ser sempre a base da PR inteira, igual ao contrato de ci.yml — classificar so o ultimo commit ' +
      '(o comportamento antigo em synchronize) esconde codigo nao-documental de commits anteriores da mesma PR.',
    )
    assert.ok(
      !trecho.includes('github.event.before'),
      'A classificacao voltou a usar o commit anterior ao ultimo push (diff parcial); este teste ficou para tras.',
    )
  })

  // Consumo do output pelos dois passos condicionais: ci-mechanism (mecanismo
  // de CI cadastrado, sem tocar supabase/) nunca precisa apontar o preview
  // para um banco proprio, exatamente como documentation.
  describe('consumo do output perfil pelos passos "Descobrir..." e "Apontar"', () => {
    const workflowTexto = readFileSync(new URL('../.github/workflows/banco-por-pr.yml', import.meta.url), 'utf8')

    function simular(perfil) {
      const { passos } = extrairCondicoesDoJob(workflowTexto, 'apontar')
      const contexto = { github: { event_name: 'pull_request' } }
      const passosComOutput = passos.map((p) => ({
        ...p,
        if: p.if?.replaceAll("steps.classificar.outputs.perfil", `'${perfil}'`),
      }))
      return simularPassosDoJob(passosComOutput, contexto, new Set())
    }

    function rodou(passos, titulo) {
      const passo = passos.find((p) => p.titulo === titulo)
      assert.ok(passo, `Passo "${titulo}" nao encontrado.`)
      return passo.rodou
    }

    it('product: aponta o preview para o banco proprio', () => {
      const passos = simular('product')
      assert.equal(rodou(passos, 'Descobrir se esta PR altera o Supabase'), true)
      assert.equal(rodou(passos, 'Apontar'), true)
    })

    it('documentation: nao aponta (nada no banco mudou)', () => {
      const passos = simular('documentation')
      assert.equal(rodou(passos, 'Descobrir se esta PR altera o Supabase'), false)
      assert.equal(rodou(passos, 'Apontar'), false)
    })

    it('ci-mechanism: nao aponta, mesma dispensa de documentation (nenhum dos oito caminhos toca supabase/)', () => {
      const passos = simular('ci-mechanism')
      assert.equal(rodou(passos, 'Descobrir se esta PR altera o Supabase'), false)
      assert.equal(rodou(passos, 'Apontar'), false)
    })
  })
})

describe('extrairLinksAdicionados', () => {
  it('ignora linhas nao adicionadas e o cabecalho +++', () => {
    const diff = [
      '--- a/docs/A.md',
      '+++ b/docs/A.md',
      '-[velho](./sumiu.md)',
      ' [inalterado](./fica.md)',
      '+[novo](./chegou.md)',
    ].join('\n')
    assert.deepEqual(extrairLinksAdicionados(diff), ['./chegou.md'])
  })

  it('extrai varios links na mesma linha adicionada', () => {
    const diff = '+veja [a](./a.md) e [b](./b.md)'
    assert.deepEqual(extrairLinksAdicionados(diff), ['./a.md', './b.md'])
  })

  it('descarta o titulo apos espaco e preserva alvo entre < >', () => {
    const diff = [
      '+[com titulo](./doc.md "um titulo")',
      '+[com espaco](<./nome com espaco.md>)',
    ].join('\n')
    assert.deepEqual(extrairLinksAdicionados(diff), ['./doc.md', './nome com espaco.md'])
  })

  it('devolve lista vazia quando nao ha entrada', () => {
    assert.deepEqual(extrairLinksAdicionados(''), [])
    assert.deepEqual(extrairLinksAdicionados(undefined), [])
  })
})

describe('resolverAlvoLink', () => {
  it('resolve link relativo contra o DIRETORIO do documento, nao a raiz', () => {
    assert.deepEqual(resolverAlvoLink('../guia.md', 'docs/sub/a.md'), { fora: false, caminho: 'docs/guia.md' })
    assert.deepEqual(resolverAlvoLink('./irmao.md', 'docs/sub/a.md'), { fora: false, caminho: 'docs/sub/irmao.md' })
    assert.deepEqual(resolverAlvoLink('PLAN.md', 'docs/CURRENT_STATE.md'), { fora: false, caminho: 'docs/PLAN.md' })
  })

  it('ignora ancora pura, sem arquivo para conferir', () => {
    assert.equal(resolverAlvoLink('#secao', 'docs/A.md'), null)
  })

  it('remove ancora e query string antes de resolver', () => {
    assert.deepEqual(resolverAlvoLink('./guia.md#secao', 'docs/A.md'), { fora: false, caminho: 'docs/guia.md' })
    assert.deepEqual(resolverAlvoLink('./guia.md?raw=1', 'docs/A.md'), { fora: false, caminho: 'docs/guia.md' })
  })

  it('ignora URL externa e protocolo relativo', () => {
    assert.equal(resolverAlvoLink('https://example.com/x.md', 'docs/A.md'), null)
    assert.equal(resolverAlvoLink('mailto:rodrigao@gmail.com', 'docs/A.md'), null)
    assert.equal(resolverAlvoLink('//cdn.example.com/x.md', 'docs/A.md'), null)
  })

  it('trata alvo absoluto (a partir de "/") como relativo a raiz do repositorio', () => {
    assert.deepEqual(resolverAlvoLink('/AGENTS.md', 'docs/sub/a.md'), { fora: false, caminho: 'AGENTS.md' })
  })

  it('marca como "fora" o alvo que escaparia da raiz do repositorio', () => {
    const resultado = resolverAlvoLink('../../../fora.md', 'docs/A.md')
    assert.equal(resultado.fora, true)
  })
})

describe('verificarDocumentos (--verify-docs)', () => {
  it('link relativo valido, resolvido contra o diretorio do documento: sem problema', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const base = commitar(dir, exec, 'AGENTS.md', '# base', 'base')
      mkdirSync(join(dir, 'docs', 'sub'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'guia.md'), '# guia')
      writeFileSync(join(dir, 'docs', 'sub', 'a.md'), '# a\n\nveja [o guia](../guia.md).\n')
      exec('git', ['add', 'docs'])
      exec('git', ['commit', '--quiet', '-m', 'adiciona docs/sub/a.md com link relativo valido'])
      const head = exec('git', ['rev-parse', 'HEAD']).trim()

      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
      const existsImpl = (relPath) => existsSync(join(dir, relPath))
      const readFileImpl = (relPath) => readFileSync(join(dir, relPath))

      const problemas = verificarDocumentos({ base, head, execImpl, existsImpl, readFileImpl })
      assert.deepEqual(problemas, [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('link relativo ausente: reporta problema, e a resolucao contra a raiz nao mascara o defeito nem gera falso vermelho por engano', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const base = commitar(dir, exec, 'AGENTS.md', '# base', 'base')
      mkdirSync(join(dir, 'docs', 'sub'), { recursive: true })
      // Nao existe docs/guia.md nem guia.md na raiz: o alvo esta genuinamente ausente.
      writeFileSync(join(dir, 'docs', 'sub', 'a.md'), '# a\n\nveja [o guia](../guia.md).\n')
      exec('git', ['add', 'docs'])
      exec('git', ['commit', '--quiet', '-m', 'adiciona docs/sub/a.md com link relativo quebrado'])
      const head = exec('git', ['rev-parse', 'HEAD']).trim()

      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
      const existsImpl = (relPath) => existsSync(join(dir, relPath))
      const readFileImpl = (relPath) => readFileSync(join(dir, relPath))

      const problemas = verificarDocumentos({ base, head, execImpl, existsImpl, readFileImpl })
      assert.equal(problemas.length, 1)
      assert.equal(problemas[0].arquivo, 'docs/sub/a.md')
      assert.equal(problemas[0].motivo, 'nao-encontrado')
      assert.equal(problemas[0].alvo, '../guia.md')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolveria errado contra a raiz: prova que a raiz teria um falso vermelho onde o diretorio do documento acerta', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const base = commitar(dir, exec, 'AGENTS.md', '# base', 'base')
      mkdirSync(join(dir, 'docs', 'sub'), { recursive: true })
      // guia.md so existe dentro de docs/, nunca na raiz — se alguem resolvesse
      // "../guia.md" contra a raiz do repositorio (bug relatado), o teste acima
      // ja provaria isso como falso vermelho. Aqui confirmamos que resolver
      // contra a raiz de fato erraria o alvo, evidenciando por que o fix importa.
      assert.equal(existsSync(join(dir, 'guia.md')), false)
      writeFileSync(join(dir, 'docs', 'guia.md'), '# guia')
      writeFileSync(join(dir, 'docs', 'sub', 'a.md'), '# a\n\nveja [o guia](../guia.md).\n')
      exec('git', ['add', 'docs'])
      exec('git', ['commit', '--quiet', '-m', 'adiciona docs/sub/a.md'])
      const head = exec('git', ['rev-parse', 'HEAD']).trim()

      const resolvido = resolverAlvoLink('../guia.md', 'docs/sub/a.md')
      assert.equal(resolvido.caminho, 'docs/guia.md')
      assert.notEqual(resolvido.caminho, 'guia.md')

      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
      const existsImpl = (relPath) => existsSync(join(dir, relPath))
      const readFileImpl = (relPath) => readFileSync(join(dir, relPath))
      assert.deepEqual(verificarDocumentos({ base, head, execImpl, existsImpl, readFileImpl }), [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falha (lanca) em UTF-8 invalido no documento alterado, sem `|| true` escondendo o problema', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const base = commitar(dir, exec, 'AGENTS.md', '# base', 'base')
      mkdirSync(join(dir, 'docs'), { recursive: true })
      // 0xFF/0xFE sozinhos nao formam UTF-8 valido.
      writeFileSync(join(dir, 'docs', 'RUIM.md'), Buffer.from([0x23, 0x20, 0xff, 0xfe]))
      exec('git', ['add', 'docs/RUIM.md'])
      exec('git', ['commit', '--quiet', '-m', 'adiciona documento com bytes invalidos'])
      const head = exec('git', ['rev-parse', 'HEAD']).trim()

      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
      const existsImpl = (relPath) => existsSync(join(dir, relPath))
      const readFileImpl = (relPath) => readFileSync(join(dir, relPath))

      const problemas = verificarDocumentos({ base, head, execImpl, existsImpl, readFileImpl })
      assert.equal(problemas.length, 1)
      assert.equal(problemas[0].arquivo, 'docs/RUIM.md')
      assert.equal(problemas[0].motivo, 'utf8-invalido')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lanca (nao engole) quando o diff tem marcador de conflito, via git diff --check real', () => {
    const { dir, exec } = repositorioGitTemporario()
    try {
      const base = commitar(dir, exec, 'docs/A.md', '# a\nconteudo original\n', 'base')
      const marcador = ['<', '<', '<', '<', '<', '<', '<', ' HEAD'].join('')
      writeFileSync(join(dir, 'docs', 'A.md'), `# a\n${marcador}\nconteudo\n`)
      exec('git', ['add', 'docs/A.md'])
      exec('git', ['commit', '--quiet', '-m', 'introduz marcador de conflito por engano'])
      const head = exec('git', ['rev-parse', 'HEAD']).trim()

      const execImpl = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
      const existsImpl = (relPath) => existsSync(join(dir, relPath))
      const readFileImpl = (relPath) => readFileSync(join(dir, relPath))

      assert.throws(() => verificarDocumentos({ base, head, execImpl, existsImpl, readFileImpl }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falha fechado (lanca) com BASE_SHA/HEAD_SHA invalidos, em vez de dispensar por omissao', () => {
    assert.throws(() => verificarDocumentos({ base: undefined, head: 'abc' }))
    assert.throws(() => verificarDocumentos({ base: SHA_VAZIO, head: 'abc' }))
  })
})

describe('uso de --verify-docs em ci.yml', () => {
  it('a verificacao dispensada chama scripts/change-scope.mjs --verify-docs, sem `|| true` escondendo falha do git', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    const inicio = workflow.indexOf('Verificação documental (mudança apenas documental ou mecanismo de CI)')
    assert.ok(inicio > -1, 'passo de verificacao dispensada sumiu de ci.yml.')
    const fimPasso = workflow.indexOf('\n      - name:', inicio + 1)
    const trechoPasso = workflow.slice(inicio, fimPasso === -1 ? workflow.length : fimPasso)
    assert.ok(
      trechoPasso.includes('node scripts/change-scope.mjs --verify-docs'),
      'O passo de verificacao dispensada parou de chamar --verify-docs; este teste ficou para tras.',
    )
    assert.ok(
      !trechoPasso.includes('|| true'),
      'O passo de verificacao dispensada voltou a usar `|| true`, que esconde falha real do git.',
    )
  })
})
