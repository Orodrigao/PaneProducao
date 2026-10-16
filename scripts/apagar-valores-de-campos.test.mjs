import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  MARCADOR,
  MARCADOR_SEGREDO,
  apagarSegredos,
  apagarValoresDeCampos,
  conferirSemPedacosDeSegredo,
  limparPasta,
  limparTexto,
  pedacosDoSegredo,
  valoresRestantes,
  variantesDoSegredo,
} from './apagar-valores-de-campos.mjs'

// O Playwright guarda o valor dos campos de texto no error-context.md; na tela
// de login isso e a senha (run 38425196586, 13/10/2026). Aqui so existe senha
// FALSA, escrita de proposito para ser reconhecida.

const SCRIPT = fileURLToPath(new URL('./apagar-valores-de-campos.mjs', import.meta.url))
const SENHA_FALSA = 'Falsa#Senha-7qZ!Nunca-Real'
const EMAIL_FALSO = 'fulano+teste@example.com'

// Mesma forma do arquivo que vazou: a tela de login depois do clique, com o erro.
const TELA_DE_LOGIN = [
  '# Instructions',
  '',
  '- Following Playwright test failed.',
  '',
  '```yaml',
  '- alert',
  '- text: P',
  '- heading "Pane & Salute" [level=1]',
  '- paragraph: Entrar com senha',
  '- text: E-mail',
  `- textbox "nome@paneesalute.com.br": ${EMAIL_FALSO}`,
  '- text: Senha',
  `- textbox: ${SENHA_FALSA}`,
  '- button "Entrar"',
  '- button "Primeiro acesso / esqueci senha"',
  '- paragraph: E-mail ou senha inválidos.',
  '```',
  '',
  '# Test source',
  '',
  '```ts',
  "  146 |     await page.locator('input[type=\"password\"]').fill(senha)",
  '```',
  '',
].join('\n')

describe('apagarValoresDeCampos', () => {
  it('apaga a senha e o e-mail da tela de login e deixa o resto igual', () => {
    const { texto, apagados } = apagarValoresDeCampos(TELA_DE_LOGIN)
    assert.equal(apagados, 2)
    assert.ok(!texto.includes(SENHA_FALSA), 'a senha falsa nao pode sobrar')
    assert.ok(!texto.includes(EMAIL_FALSO))
    assert.match(texto, /- textbox: \[valor apagado\]\n/)
    assert.match(texto, /- textbox "nome@paneesalute\.com\.br": \[valor apagado\]\n/)
    // O diagnostico continua legivel: a estrutura e a mensagem de erro ficam.
    assert.match(texto, /- paragraph: E-mail ou senha inválidos\./)
    assert.match(texto, /- button "Entrar"/)
    assert.match(texto, /- text: Senha\n/)
    assert.match(texto, /fill\(senha\)/)
    assert.equal(texto.replaceAll(MARCADOR, 'X').split('\n').length, TELA_DE_LOGIN.split('\n').length)
  })

  it('cobre os formatos que o Playwright escreve', () => {
    const linhas = [
      `- textbox: ${SENHA_FALSA}`,
      `- textbox "Senha": ${SENHA_FALSA}`,
      `  - textbox "Senha" [disabled]: ${SENHA_FALSA}`,
      `- searchbox "Buscar": ${SENHA_FALSA}`,
      `- combobox "Loja": ${SENHA_FALSA}`,
      `- spinbutton "Quantidade": ${SENHA_FALSA}`,
      `- slider: ${SENHA_FALSA}`,
      // nome com ": " dentro, chave entre aspas
      `- 'textbox "Buscar pão cadastrado (ex.: ${SENHA_FALSA}`,
      `- 'textbox "Campo (ex.: x)": ${SENHA_FALSA}'`,
      `- textbox "Hora 10:30": ${SENHA_FALSA}`,
    ]
    const { texto } = apagarValoresDeCampos(linhas.join('\n'))
    assert.ok(!texto.includes(SENHA_FALSA), texto)
    assert.equal(valoresRestantes(texto), 0)
    for (const linha of texto.split('\n')) assert.ok(linha.includes(MARCADOR), linha)
  })

  it('arquivo com quebra de linha do Windows tambem e limpo', () => {
    const { texto, apagados } = apagarValoresDeCampos(TELA_DE_LOGIN.replaceAll('\n', '\r\n'))
    assert.equal(apagados, 2)
    assert.ok(!texto.includes(SENHA_FALSA))
    assert.match(texto, /- textbox: \[valor apagado\]\r\n/)
  })

  it('nao mexe no que nao e valor de campo', () => {
    const intactas = [
      '- textbox "Observações sobre o romaneio..."',
      '- textbox "0"',
      '- textbox "nome@paneesalute.com.br":',
      '- text: Senha',
      `- text: textbox: ${SENHA_FALSA}`,
      '- paragraph: textbox: aviso comum',
      '- button "Entrar"',
      '- link "textbox: aqui"',
      '- heading "Pane & Salute" [level=1]',
      '',
      'Error: expect(locator).toBeVisible() failed',
    ]
    const { texto, apagados } = apagarValoresDeCampos(intactas.join('\n'))
    assert.equal(apagados, 0)
    assert.equal(texto, intactas.join('\n'))
  })

  it('e idempotente', () => {
    const uma = apagarValoresDeCampos(TELA_DE_LOGIN)
    const duas = apagarValoresDeCampos(uma.texto)
    assert.equal(duas.apagados, 0)
    assert.equal(duas.texto, uma.texto)
  })
})

describe('valoresRestantes', () => {
  it('enxerga campo com valor e ignora o marcador', () => {
    assert.equal(valoresRestantes(`- textbox: ${SENHA_FALSA}`), 1)
    assert.equal(valoresRestantes(`- textbox: ${MARCADOR}`), 0)
    assert.equal(valoresRestantes('- textbox "Senha"'), 0)
  })
})

// Os outros dois lugares onde o Playwright real escreveu o que foi digitado
// (ensaio de 16/10/2026): o registro de chamadas de um `fill` que estoura o
// tempo e o eco de uma asercao sobre o valor do campo. Nenhum deles e uma linha
// de campo, entao so a camada literal os alcanca.
const ECO_NO_REGISTRO = [
  'Call log:',
  `  - fill("${SENHA_FALSA}")`,
  '  - waiting for element to be visible, enabled and editable',
  `Received: "${SENHA_FALSA}"`,
  `       - unexpected value "${SENHA_FALSA}"`,
  '',
].join('\n')

describe('variantesDoSegredo e apagarSegredos', () => {
  it('cobre o texto cru e as formas em que um registro o reescreve', () => {
    const segredo = `a"b\\c'd e&f/g`
    const formas = variantesDoSegredo(segredo)
    assert.ok(formas.includes(segredo))
    assert.ok(formas.includes('a\\"b\\\\c\'d e&f/g'), 'forma JSON')
    assert.ok(formas.includes(`a"b\\c''d e&f/g`), "aspas simples do YAML")
    assert.ok(formas.includes(encodeURIComponent(segredo)), 'forma de URL')
    for (let i = 1; i < formas.length; i += 1) assert.ok(formas[i - 1].length >= formas[i].length, 'da maior para a menor')
  })

  it('segredo vazio ou ausente nao apaga nada', () => {
    assert.deepEqual(variantesDoSegredo(''), [])
    assert.deepEqual(variantesDoSegredo(undefined), [])
    const { texto, apagados } = apagarSegredos(ECO_NO_REGISTRO, ['', undefined])
    assert.equal(apagados, 0)
    assert.equal(texto, ECO_NO_REGISTRO)
  })

  it('apaga o segredo em qualquer lugar, inclusive fora de linha de campo', () => {
    const { texto, apagados } = apagarSegredos(ECO_NO_REGISTRO, [SENHA_FALSA])
    assert.equal(apagados, 3)
    assert.ok(!texto.includes(SENHA_FALSA))
    assert.match(texto, /- fill\("\[segredo apagado\]"\)/)
    assert.match(texto, /Received: "\[segredo apagado\]"/)
    assert.match(texto, /waiting for element to be visible, enabled and editable/)
  })

  it('apaga tambem a forma reescrita pelo registro', () => {
    const segredo = `Abc"Def\\Ghi'Jkl 12`
    const reescrito = `- fill("${JSON.stringify(segredo).slice(1, -1)}")\n- 'valor ${segredo.replaceAll("'", "''")}'\nlink?s=${encodeURIComponent(segredo)}\n`
    const { texto, apagados } = apagarSegredos(reescrito, [segredo])
    assert.equal(apagados, 3)
    assert.ok(!texto.includes('Abc'), texto)
    assert.ok(!texto.includes(encodeURIComponent(segredo)))
    assert.ok(texto.includes(MARCADOR_SEGREDO))
  })
})

// Achados da revisao independente de 16/10/2026 (outra familia de IA): formas
// que escapariam de uma limpeza so por regex ou so por texto cru.
describe('limparTexto: ordem das camadas e rede de seguranca', () => {
  it('segredo dentro do nome do campo, com ": " no meio, nao deixa prefixo para tras', () => {
    const segredo = 'Inicio: Final'
    const { texto } = limparTexto(`- textbox "${segredo}": algum valor\n`, [segredo])
    assert.ok(!texto.includes('Inicio'), texto)
    assert.ok(!texto.includes('Final'), texto)
    assert.match(texto, /- textbox "\[segredo apagado\]": \[valor apagado\]/)
  })

  it('chave entre aspas duplas tambem e reconhecida como campo', () => {
    const { texto } = limparTexto(`- "textbox \\"Senha\\"": ${SENHA_FALSA}\n- "textbox": outro-valor\n`)
    assert.ok(!texto.includes(SENHA_FALSA))
    assert.ok(!texto.includes('outro-valor'))
    assert.equal(valoresRestantes(texto), 0)
  })

  it('valor de campo que ja era o segredo fica marcado como segredo, nao como valor comum', () => {
    const { texto, campos, segredos } = limparTexto(`- textbox: ${SENHA_FALSA}\n`, [SENHA_FALSA])
    assert.equal(texto, `- textbox: ${MARCADOR_SEGREDO}\n`)
    assert.deepEqual({ campos, segredos }, { campos: 0, segredos: 1 })
  })

  it('segredo reescrito de um jeito desconhecido falha em vez de passar (escape unicode)', () => {
    assert.throws(
      () => limparTexto('Received: "Falsa\\u0023Senha-7qZ!Nunca-Real"\n', [SENHA_FALSA]),
      /pedaco de segredo/,
    )
  })

  it('segredo truncado com reticencias falha', () => {
    assert.throws(() => limparTexto('Received: "Falsa#Senha-7qZ…"\n', [SENHA_FALSA]), /pedaco de segredo/)
  })

  it('segredo dividido em duas linhas falha', () => {
    assert.throws(() => limparTexto('- textbox: x\n  Falsa#Senha-\n  7qZ!Nunca-Real\n', [SENHA_FALSA]), /pedaco de segredo/)
  })

  it('a mensagem de erro nunca mostra o pedaco encontrado', () => {
    try {
      limparTexto('Received: "Falsa\\u0023Senha-7qZ!Nunca-Real"\n', [SENHA_FALSA])
      assert.fail('devia ter falhado')
    } catch (erro) {
      assert.ok(!String(erro.message).includes('Senha-7qZ'))
      assert.ok(!String(erro.message).includes('Falsa'))
    }
  })

  it('texto comum sem o segredo passa, com ou sem segredo configurado', () => {
    assert.doesNotThrow(() => limparTexto(TELA_DE_LOGIN, [SENHA_FALSA]))
    assert.doesNotThrow(() => conferirSemPedacosDeSegredo(TELA_DE_LOGIN, []))
  })

  it('segredo curto vira um unico pedaco inteiro', () => {
    assert.deepEqual(pedacosDoSegredo(['abc']), ['abc'])
    assert.ok(pedacosDoSegredo([SENHA_FALSA]).every((pedaco) => pedaco.length === 8 || pedaco.length > 8))
  })
})

function pastaTemporaria() {
  return mkdtempSync(join(tmpdir(), 'apagar-valores-'))
}

describe('limparPasta', () => {
  it('limpa o contexto de cada teste e de cada repeticao, e so ele', () => {
    const raiz = pastaTemporaria()
    try {
      const saida = join(raiz, 'saida')
      for (const nome of ['login-falhou', 'login-falhou-retry1', 'fundo/outro-teste']) {
        mkdirSync(join(saida, nome), { recursive: true })
        writeFileSync(join(saida, nome, 'error-context.md'), TELA_DE_LOGIN + ECO_NO_REGISTRO)
      }
      // Outros arquivos nao sao o artefato, ficam como estao.
      writeFileSync(join(saida, 'login-falhou', 'anotacao.txt'), `- textbox: ${SENHA_FALSA}\n`)

      const resultado = limparPasta(saida, [SENHA_FALSA])
      // Por arquivo: o e-mail e valor de campo (1); a senha aparece 4 vezes (a
      // linha do campo, fill, Received e unexpected value) e cai na camada literal.
      assert.deepEqual(resultado, { arquivos: 3, campos: 3, segredos: 12 })
      for (const nome of ['login-falhou', 'login-falhou-retry1', 'fundo/outro-teste']) {
        const texto = readFileSync(join(saida, nome, 'error-context.md'), 'utf8')
        assert.ok(!texto.includes(SENHA_FALSA), nome)
        assert.ok(!texto.includes(EMAIL_FALSO), nome)
      }
      assert.ok(readFileSync(join(saida, 'login-falhou', 'anotacao.txt'), 'utf8').includes(SENHA_FALSA))
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  })

  it('sem o segredo no ambiente a camada dos campos ainda funciona', () => {
    const raiz = pastaTemporaria()
    try {
      mkdirSync(join(raiz, 't1'), { recursive: true })
      writeFileSync(join(raiz, 't1', 'error-context.md'), TELA_DE_LOGIN)
      assert.deepEqual(limparPasta(raiz), { arquivos: 1, campos: 2, segredos: 0 })
      assert.ok(!readFileSync(join(raiz, 't1', 'error-context.md'), 'utf8').includes(SENHA_FALSA))
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  })

  it('pasta inexistente nao e erro: nao ha o que guardar', () => {
    const raiz = pastaTemporaria()
    try {
      assert.deepEqual(limparPasta(join(raiz, 'nao-existe'), [SENHA_FALSA]), { arquivos: 0, campos: 0, segredos: 0 })
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  })
})

describe('linha de comando', () => {
  const rodar = (argumentos, ambiente = {}) => {
    const env = { ...process.env }
    delete env.SUPABASE_TEST_USER_PASSWORD
    return spawnSync(process.execPath, [SCRIPT, ...argumentos], { encoding: 'utf8', env: { ...env, ...ambiente } })
  }

  it('limpa a pasta, resume sem mostrar valor e sai com 0', () => {
    const raiz = pastaTemporaria()
    try {
      mkdirSync(join(raiz, 't1'), { recursive: true })
      writeFileSync(join(raiz, 't1', 'error-context.md'), TELA_DE_LOGIN + ECO_NO_REGISTRO)
      const r = rodar([raiz], { SUPABASE_TEST_USER_PASSWORD: SENHA_FALSA })
      assert.equal(r.status, 0, r.stderr)
      assert.match(r.stdout, /1 arquivo\(s\) conferido\(s\), 1 valor\(es\) de campo e 4 ocorrencia\(s\) de segredo apagado\(s\)\./)
      assert.ok(!`${r.stdout}${r.stderr}`.includes(SENHA_FALSA))
      assert.ok(!readFileSync(join(raiz, 't1', 'error-context.md'), 'utf8').includes(SENHA_FALSA))
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  })

  it('pedaco de segredo que sobra faz sair com erro, sem mostrar o pedaco', () => {
    const raiz = pastaTemporaria()
    try {
      mkdirSync(join(raiz, 't1'), { recursive: true })
      writeFileSync(join(raiz, 't1', 'error-context.md'), 'Received: "Falsa\\u0023Senha-7qZ!Nunca-Real"\n')
      const r = rodar([raiz], { SUPABASE_TEST_USER_PASSWORD: SENHA_FALSA })
      assert.equal(r.status, 1, `${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /Nao consegui limpar os artefatos/)
      assert.match(r.stderr, /pedaco de segredo/)
      assert.ok(!`${r.stdout}${r.stderr}`.includes('Senha-7qZ'))
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  })

  it('sem pasta informada sai com erro, para o upload nao rodar', () => {
    const r = rodar([])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Uso:/)
  })

  // Como root o sistema deixa gravar em arquivo somente leitura, e o teste
  // nao teria como falhar; no runner do GitHub e na maquina nao e root.
  it('arquivo que nao da para regravar sai com erro, nunca em silencio', { skip: process.getuid?.() === 0 }, () => {
    const raiz = pastaTemporaria()
    try {
      mkdirSync(join(raiz, 't1'), { recursive: true })
      const arquivo = join(raiz, 't1', 'error-context.md')
      writeFileSync(arquivo, TELA_DE_LOGIN)
      chmodSync(arquivo, 0o444)
      const r = rodar([raiz])
      assert.equal(r.status, 1, `${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /Nao consegui limpar os artefatos/)
      assert.ok(!r.stderr.includes(SENHA_FALSA))
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  })
})
