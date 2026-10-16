import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

// Trava estatica do diagnostico de login de test/preview-pr/apoio/entrar.ts.
// O repositorio e publico e o corpo de um login que deu certo carrega o token da
// sessao: o diagnostico so pode ler corpo de recusa (status >= 400), com prazo,
// da resposta DESTE pedido, e a senha nunca sai na mensagem. A prova de
// comportamento (Auth simulado devolvendo 400, 429, 503, corpo pendurado) vive no
// PR; aqui fica o que protege o arquivo de uma edicao futura distraida. Cada
// regra tem um defeito reintroduzido abaixo para provar que a trava reprova.

const ajudante = readFileSync(
  fileURLToPath(new URL('../test/preview-pr/apoio/entrar.ts', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n')

/** Recorta uma funcao de topo, da assinatura ate o `}` da coluna zero. */
function funcao(texto, assinatura) {
  const inicio = texto.indexOf(assinatura)
  if (inicio < 0) return ''
  const fim = texto.indexOf('\n}\n', inicio)
  return fim < 0 ? '' : texto.slice(inicio, fim)
}

function problemasDe(texto) {
  const problemas = []

  const leituras = texto.match(/\.(?:text|body|json)\(\)/g) ?? []
  if (leituras.length !== 1 || leituras[0] !== '.text()') {
    problemas.push('corpo: o arquivo so pode ler corpo num lugar (.text() em lerCorpoComPrazo)')
  }
  if (!/Promise\.race\(\[resposta\.text\(\), esgotou\]\)/.test(funcao(texto, 'async function lerCorpoComPrazo('))) {
    problemas.push('prazo: a leitura do corpo precisa de Promise.race com prazo')
  }
  if ((texto.match(/lerCorpoComPrazo\(/g) ?? []).length !== 2) {
    problemas.push('corpo: lerCorpoComPrazo so pode ser chamada por resumirRespostaDoAuth')
  }

  const resumo = funcao(texto, 'async function resumirRespostaDoAuth(')
  const trava = resumo.indexOf('if (resposta.status() < 400) return resumo')
  const leitura = resumo.indexOf('lerCorpoComPrazo(resposta)')
  if (trava < 0 || leitura < 0 || trava > leitura) {
    problemas.push('corpo de sucesso: so le o corpo depois de devolver o status abaixo de 400')
  }
  if (!resumo.includes('/^[\\w.-]{1,80}$/.test(bruto)')) {
    problemas.push('codigo: so imprime identificador curto do Auth')
  }

  if (!texto.includes('candidata.request() === pedido')) {
    problemas.push('pedido: a resposta do diagnostico tem de ser a do pedido de login')
  }
  if (!texto.includes("page.on('response', guardarResposta)") || !/finally \{[^}]*page\.off\('response', guardarResposta\)/.test(texto)) {
    problemas.push('listener: response registrado e removido no mesmo try/finally')
  }
  if (!texto.includes('`${diagnostico}\\n${original}`.split(senha).join(\'***\')')) {
    problemas.push('senha: a mensagem final inteira passa pela troca da senha')
  }
  if (!/not\.toHaveURL\([^\n]*\n\s+\} catch \(erro\) \{[\s\S]*?explicarLoginPreso\(/.test(texto)) {
    problemas.push('falha: o diagnostico so roda quando o login nao sai de /login')
  }
  if ((texto.match(/getByRole\('button', \{ name: 'Entrar'/g) ?? []).length !== 1) {
    problemas.push('repeticao: o login e clicado uma vez so (sem repeticao automatica)')
  }
  return problemas
}

describe('diagnostico de login do roteiro do preview da PR', () => {
  it('o arquivo real passa em todas as regras', () => {
    assert.deepEqual(problemasDe(ajudante), [])
  })

  const defeitos = [
    ['le o corpo de sucesso', (t) => t.replace('  if (resposta.status() < 400) return resumo\n', ''), /corpo de sucesso/],
    ['le corpo em outro lugar', (t) => t.replace('JSON.parse(texto)', 'JSON.parse(texto) && (await resposta.json())'), /^corpo: o arquivo so pode/],
    ['leitura sem prazo', (t) => t.replace('Promise.race([resposta.text(), esgotou])', 'resposta.text()'), /^prazo/],
    ['segunda chamada de leitura', (t) => `${t}\nvoid lerCorpoComPrazo(x)\n`, /lerCorpoComPrazo so pode/],
    ['qualquer texto como codigo', (t) => t.replace('/^[\\w.-]{1,80}$/.test(bruto)', 'true'), /^codigo/],
    ['resposta de outro pedido', (t) => t.replace('candidata.request() === pedido', 'true'), /^pedido/],
    ['listener nao removido', (t) => t.replace("    page.off('response', guardarResposta)\n", ''), /^listener/],
    ['senha fora da mensagem final', (t) => t.replace('.split(senha).join(\'***\'))', ')'), /^senha/],
    ['diagnostico fora do caminho de falha', (t) => t.replace('} catch (erro) {\n      const original', '} catch (erro2) {\n      const original'), /^falha/],
    ['login repetido', (t) => t.replace("await page.getByRole('button', { name: 'Entrar', exact: true }).click()", "await page.getByRole('button', { name: 'Entrar', exact: true }).click()\n    await page.getByRole('button', { name: 'Entrar', exact: true }).click()"), /^repeticao/],
  ]
  for (const [nome, estraga, esperado] of defeitos) {
    it(`reprova: ${nome}`, () => {
      const estragado = estraga(ajudante)
      assert.notEqual(estragado, ajudante, 'a troca do defeito nao encontrou o trecho')
      assert.ok(problemasDe(estragado).some((p) => esperado.test(p)), `esperava problema ${esperado}`)
    })
  }
})
