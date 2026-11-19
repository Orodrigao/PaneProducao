import { createHash, createPrivateKey, createSign, createVerify, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  abrirGzip, conferirToken, criarHandler, executarProva, REJEICOES_TECNICAS,
  resumirAdn, resumirDfe, resumirEvento, sanearResumo, validarEntrada,
} from '../../supabase/functions/sefaz-prova/prova'

// Par autoassinado SEM VALOR, exclusivamente ficticio, fornecido no briefing.
// DER sem delimitadores PEM para nao confundir varredores de segredo.
const chaveDer = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC3cMBKkUUxe9MohFzBws59pwjRhO41UG0MyC6kEXJMEj2pEw08V3CBSUVEDceNk/6zLX4h4V2TIRrpG9EysBom50jIOGJTeqWbUsAcni/kYZOJr/zpY13fXF9nYVw1zsSaQonagg8PU0KtjlHc0DwmyvDG98GhibWMUEtnFAH+S3a4Xn5I0kjeG8SaDGnvHYUZpUPI0EOrw8ETJgLOymIi/ak7oEaq7r9XR9p11nxiUXNlntFI5k9tqLaBklJBiiYXzPjbKqMRYISlREtmujgTzXqQL5xeFzioqQ3itOIGRZDFGLHnLJkwsBTtCBIlWBr0Td+TF2873zF3lD0mB3rvAgMBAAECggEAVVy5jrmVKlbFx0f45g2iC2TMPLuQIe0gId+RnLWlq3KdkO0Vrqu95dvTyLxkzSQ+VODpnhiCc/Hm1O0l52F9efcMrmdWkiQzpljWnzqZbLxfbKYhmfWsfEE/ABuVTlC+uk4WWkFFgssq7xqYS5n3M9IiQ2SNjX9IpVfEDt6Hou5vSpDJ2Q/DiscFEkSbbdNq28fxGbYDIvIlzJJ/UigdyHxKXbT9ELCvIWXLA3LcPuM0O27/RmW/a/0goEIusCRs9sttqvE6UM2UjAQSUH5Av5rr52MWsvOZGN0gKSggfQCps8tDHJ1f2XeQhiaJlFS+zi6UeBKJkPLEw3GDhe7IKQKBgQDaXvCvlwOQz+Jzcry7DqZs7CPDi2tvSyW8Xg4obkV6piqSBPKTM5t6Ly6Rzi+xXA8G6cfislQbbiAfZs1IeMccDK7Rznty0JEQpiLseSC9QPhk7pU/UBavSgFm+DC3EhaI5yAVQ483bJUWugDZD7WHAYXAbCG+gPoJo/malbiMUwKBgQDXDOodWaED+AIIm53WF1kldtcBhdosopXepEkNgEM6XhewnEeeyQurJXSI0ZLVhPeYpAEVAWNSmPWZ+OAPUDX5AE+iA5pEjwMiORiSIwY3lAmg2yMqBo3LgRpkn8nAODn0QztDXfrwxanOAp4yOBc/q6djEJJ5H1JEReGb3IAjdQKBgF3kopKtWRAkApdnRzUa+H4vDrWeteQVqLUUr/u8Zk11Myqzy+V1NC3WKazxvdoB3kg3rwWPbdCZimBWIIA/xkUOQwDdSoE0optJBA0vi980F1m2qB+f/REDvhSbNL8SnPPihQ3/jY3kNzqdYY3zTjctdWgmVmAGLvyEL+fC5qYXAoGAGV8Yr+XHLWSxOLrDYGLYzaa7rx5Pozx7Wg0f4Uvkopo/SULm4EDv830zxoCTRkWtwIB48DV9tlz9fPDz3lqkQ4BZ5M9v/+6ve/Yog/VF4oDAsg2olGi5ieztZDnF37vCeqMD9uq7lHR9mCSO7XXYqFZkJTfrUAb1+cAU4gKdy5ECgYEAwk1IH8ipr07moXNuGuD0OTtwf1eWxe9CMHbQpR4CMkSrFgzhUgTBwgUus9V5/MJwjnpXHcf545i0zDQbSKnP0PsKJsigWM5FFc98bjoGyqQYkclTD9lbqAEtOYX+K0aA8tM9kSDANuYCfyOzFcDbOhkWhoRzgd74Hu20e+g9/OA='
const certificadoDer = 'MIIDyTCCArGgAwIBAgIUMqPamCPppjtu/mcgUYxeDlUBaIYwDQYJKoZIhvcNAQELBQAwdDELMAkGA1UEBhMCQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxGDAWBgNVBAsMD1RFU1RFIFNFTSBWQUxPUjE2MDQGA1UEAwwtRU1QUkVTQSBGSUNUSUNJQSBERSBURVNURSBMVERBOjExMjIyMzMzMDAwMTgxMB4XDTI2MTExOTE4NDA0NVoXDTM2MTExNjE4NDA0NVowdDELMAkGA1UEBhMCQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxGDAWBgNVBAsMD1RFU1RFIFNFTSBWQUxPUjE2MDQGA1UEAwwtRU1QUkVTQSBGSUNUSUNJQSBERSBURVNURSBMVERBOjExMjIyMzMzMDAwMTgxMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt3DASpFFMXvTKIRcwcLOfacI0YTuNVBtDMgupBFyTBI9qRMNPFdwgUlFRA3HjZP+sy1+IeFdkyEa6RvRMrAaJudIyDhiU3qlm1LAHJ4v5GGTia/86WNd31xfZ2FcNc7EmkKJ2oIPD1NCrY5R3NA8JsrwxvfBoYm1jFBLZxQB/kt2uF5+SNJI3hvEmgxp7x2FGaVDyNBDq8PBEyYCzspiIv2pO6BGqu6/V0faddZ8YlFzZZ7RSOZPbai2gZJSQYomF8z42yqjEWCEpURLZro4E816kC+cXhc4qKkN4rTiBkWQxRix5yyZMLAU7QgSJVga9E3fkxdvO98xd5Q9Jgd67wIDAQABo1MwUTAdBgNVHQ4EFgQU9mg538r4Dv7wySb/0UjhP91fao8wHwYDVR0jBBgwFoAU9mg538r4Dv7wySb/0UjhP91fao8wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATC4Et3zwUzdMNpvHGnWvGIai0teueE+6WhOz5y2F1Hq3Jy+zX/HBxVggigAJTT0EHzaBXYtUA0tec+G5PJi3HyLolgcQMOK1oU5ri1LcbAqXw7UEsClFGQ2G5hLBHMpxXAXz9LsqZ0HyISoAy0zNhXphh4QyIjhUtSsfx+su33B8WW5gmU+u+F4rQr7l3l0ZctXuORVFsWYkCtCNSjcYH9F0LVf3XID6ekdBkatVC/tdyi/kS6SAQeDo//UnC6CxDymgdCABY/BV8c8257iD4dzhYjdgp/L9RPWTkoggrRiA97Mucsk9+f/tq2bfL+s3lRjiPg0wj5jXCNOSSerIqA=='
const chaveFicticia = '43261111222333000181550010000000011000000016'
const dataEvento = '2026-11-19T19:00:00Z'
const entrada = { empresas: ['rgf', 'sf'], modo: 'distNSU', numero: '000000000000000', adn_nsu: '0', evento_homologacao: true }
const zip = (xml: string) => gzipSync(xml).toString('base64')
const dfe = (cStat: string, documents = '') => `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe"><cStat>${cStat}</cStat><xMotivo>nao confiar nesta mensagem</xMotivo><ultNSU>000000000001234</ultNSU><maxNSU>000000000001290</maxNSU><loteDistDFeInt>${documents}</loteDistDFeInt></retDistDFeInt></s:Body></s:Envelope>`
const evento = (lote: string, code: string) => `<retEnvEvento><cStat>${lote}</cStat><retEvento><infEvento><cStat>${code}</cStat></infEvento></retEvento></retEnvEvento>`

// Montagem independente do SQL: entradas do vetor e algoritmos nativos Node.
function vetorNode() {
  const cert = new X509Certificate(Buffer.from(certificadoDer, 'base64'))
  const cnpj = /:([0-9]{14})(?:\n|$)/.exec(cert.subject)?.[1]
  const info = `<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="ID210210${chaveFicticia}01"><cOrgao>91</cOrgao><tpAmb>2</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chaveFicticia}</chNFe><dhEvento>2026-11-19T16:00:00-03:00</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>`
  const digest = createHash('sha1').update(info).digest('base64')
  const si = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#ID210210${chaveFicticia}01"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`
  const key = createPrivateKey({ key: Buffer.from(chaveDer, 'base64'), format: 'der', type: 'pkcs8' })
  const signature = createSign('RSA-SHA1').update(si).sign(key, 'base64')
  const xml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${info}<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${si}<SignatureValue>${signature}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certificadoDer}</X509Certificate></X509Data></KeyInfo></Signature></evento>`
  return { cert, cnpj, info, digest, si, signature, xml }
}

describe('prova SEFAZ: vetores independentes', () => {
  it('refaz digest, assinatura e XML gravados no pgTAP usando Node/OpenSSL', () => {
    const v = vetorNode()
    expect(v.cnpj).toBe('11222333000181')
    expect(createVerify('RSA-SHA1').update(v.si).verify(v.cert.publicKey, v.signature, 'base64')).toBe(true)
    const sql = readFileSync('supabase/tests/sefaz_conexao_pelo_banco.test.sql', 'utf8')
    for (const text of [v.info, v.si, v.signature, v.digest, v.xml]) expect(sql).toContain(text)
    expect(sql).toContain(dataEvento)
    expect(v.cert.checkPrivateKey(createPrivateKey({ key: Buffer.from(chaveDer, 'base64'), type: 'pkcs8', format: 'der' }))).toBe(true)
  })
})

describe('distribuicao e leitura limitada', () => {
  it('abre gzip e conta os quatro tipos em 138, sem dados dos documentos', async () => {
    const types = ['resNFe', 'procNFe', 'resEvento', 'procEventoNFe']
    const documents = types.map(t => `<docZip NSU="000000000001234" schema="${t}_v1.01.xsd">${zip(`<${t}><CNPJ>11222333000181</CNPJ></${t}>`)}</docZip>`).join('')
    expect(await resumirDfe(dfe('138', documents))).toMatchObject({ status: 'ok', cStat: '138', docs: Object.fromEntries(types.map(t => [t, 1])) })
    expect(await abrirGzip(zip('<teste/>'))).toBe('<teste/>')
  })
  it.each(['137', '656'])('le %s e descarta xMotivo externo', async code => {
    const summary = await resumirDfe(dfe(code))
    expect(summary).toMatchObject({ cStat: code, docs: {}, bytes: 0 })
    expect(summary.xMotivo).not.toContain('nao confiar')
  })
  it('recusa zip, XML e expansao excessiva', async () => {
    await expect(abrirGzip('invalido')).rejects.toThrow()
    await expect(abrirGzip(zip('x'.repeat(2 * 1024 * 1024 + 1)))).rejects.toThrow()
    await expect(resumirDfe('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///x">]><x/>')).rejects.toThrow()
    await expect(resumirDfe('<retDistDFeInt><cStat>138</cStat>')).rejects.toThrow()
    await expect(resumirDfe(dfe('138'))).rejects.toThrow()
  })
  it('le ADN tolerando nomes desconhecidos, mas so divulga chaves permitidas', async () => {
    expect(await resumirAdn(JSON.stringify({ loteDFe: [{ arquivoXml: zip('<NFSe><valor>10</valor></NFSe>') }], campoNovo: true }), 200))
      .toMatchObject({ status: 'ok', http: 200, docs: { NFSe: 1 }, chaves_json: ['loteDFe'], chaves_omitidas: 1 })
    expect(await resumirAdn('[]', 200)).toMatchObject({ status: 'ok', docs: {} })
    expect(await resumirAdn('erro privado', 403)).toMatchObject({ status: 'falhou', http: 403 })
  })
  it('so aceita assinatura em lote processado e resposta de negocio reconhecida', () => {
    expect(resumirEvento(evento('128', '217')).assinatura_e_certificado_aceitos).toBe(true)
    expect(resumirEvento(evento('225', '217')).assinatura_e_certificado_aceitos).toBe(false)
    for (const c of [...REJEICOES_TECNICAS, 999]) expect(resumirEvento(evento('128', String(c))).assinatura_e_certificado_aceitos).toBe(false)
  })
})

describe('fronteiras e saneamento', () => {
  it('valida estritamente empresa, modo, NSU e evento somente booleano', () => {
    expect(validarEntrada(entrada)).toEqual(entrada)
    for (const bad of [null, {}, { ...entrada, empresas: ['rgf', 'rgf'] }, { ...entrada, empresas: ['ex'] },
      { ...entrada, modo: 'consChNFe' }, { ...entrada, numero: '0' }, { ...entrada, numero: '1'.repeat(44) },
      { ...entrada, adn_nsu: '../' }, { ...entrada, url: 'https://exemplo.com' }, { ...entrada, evento_homologacao: 'true' }]) {
      expect(validarEntrada(bad)).toBeNull()
    }
  })
  it('compara tokens sem revelar conteudo', async () => {
    expect(await conferirToken('abc', 'abc')).toBe(true)
    for (const t of [null, '', 'ab', 'abd', 'abcx']) expect(await conferirToken(t, 'abc')).toBe(false)
    expect(await conferirToken('', '')).toBe(false)
  })
  it('projeta campos fechados e recusa CNPJ/chave/XML/PEM/base64 e mensagens externas', () => {
    const privateText = '11222333000181 ' + '9'.repeat(44) + ' <xml> BEGIN ' + 'Q'.repeat(200)
    const safe = sanearResumo({
      rgf: { dfe: { status: 'ok', cStat: '138', xMotivo: privateText, body: privateText, motivo: privateText,
        ultNSU: '11222333000181', maxNSU: '9'.repeat(44), docs: { [privateText]: 1, resNFe: 2 },
        chaves_json: [privateText, 'loteDFe'] }, certificado: { status: 'ok', pem: privateText } },
      [privateText]: privateText, funcao: { heap_mb: 18, stack: privateText },
    })
    const text = JSON.stringify(safe)
    expect(text).not.toMatch(/\d{14}|\d{44}|<|BEGIN|[A-Za-z0-9+/]{80}/)
    expect(safe).toMatchObject({ rgf: { dfe: { docs: { resNFe: 2 }, chaves_json: ['loteDFe'] } }, funcao: { heap_mb: 18 } })
    // NSU tem 15 digitos por contrato, unica excecao de identificador permitida.
    expect(sanearResumo({ rgf: { dfe: { status: 'ok', ultNSU: '000000000001234' } } }))
      .toMatchObject({ rgf: { dfe: { ultNSU: '000000000001234' } } })
  })
  it('segue com SF se RGF nao tem certificado e nunca repassa erro RPC', async () => {
    const calls: string[] = []
    const result = await executarProva(validarEntrada(entrada)!, async (name, args) => {
      calls.push(`${args.p_empresa}:${name}`)
      if (args.p_empresa === 'rgf') return { status: 'sem_certificado' }
      if (name === 'sefaz_prova_adn') throw new Error('BEGIN PRIVATE KEY nao pode sair')
      return { status: 'ok', http: 200, body: name.endsWith('dfe') ? dfe('137') : evento('128', '217'), ms_banco: 500, dias_para_vencer: 391 }
    })
    expect(calls.filter(c => c.startsWith('rgf'))).toHaveLength(1)
    expect(calls.filter(c => c.startsWith('sf'))).toHaveLength(3)
    expect(JSON.stringify(result)).not.toContain('BEGIN')
    expect(result).toMatchObject({ rgf: { certificado: { status: 'sem_certificado' } }, sf: { adn: { status: 'falhou' } } })
  })
  it('responde 503, 405, 401, 400 e 200 sem chamadas indevidas', async () => {
    const config: { token?: string } = {}
    let calls = 0
    const handler = criarHandler({ token: () => config.token, memoria: () => ({ rss: 1048576, heapUsed: 524288 }), rpc: async () => { calls++; return { status: 'sem_certificado' } } })
    const req = (method = 'POST', password = 'segredo', body = JSON.stringify(entrada)) => new Request('https://local', {
      method, headers: { 'x-sefaz-prova-token': password }, ...(method === 'POST' ? { body } : {}),
    })
    expect((await handler(req())).status).toBe(503)
    config.token = 'segredo'
    expect((await handler(req('GET'))).status).toBe(405)
    expect((await handler(req('POST', 'errado'))).status).toBe(401)
    expect((await handler(req('POST', 'segredo', '{}'))).status).toBe(400)
    expect((await handler(req('POST', 'segredo', 'x'.repeat(4097)))).status).toBe(400)
    expect(calls).toBe(0)
    const response = await handler(req())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ funcao: { memoria_rss_mb: 1, heap_mb: 0.5 } })
    expect(calls).toBe(2)
  })
})

describe('decisoes do workflow executadas literalmente', () => {
  const workflow = readFileSync('.github/workflows/sefaz-prova.yml', 'utf8')
  const trecho = (name: string) => workflow.split(`// INICIO ${name} TESTAD`)[1].split('\n').slice(1).join('\n').split(`// FIM ${name} TESTAD`)[0]
  it('prepara somente entradas completas e validas, sem interpolacao de shell', () => {
    const run = new Function('process', 'validarEntrada', 'writeFileSync', trecho('ENTRADA'))
    const env = { INPUT_EMPRESAS: 'ambas', INPUT_MODO: 'distNSU', INPUT_NUMERO: '000000000000000', INPUT_ADN_NSU: '0', INPUT_EVENTO: 'true', RUNNER_TEMP: '/teste' }
    const saved: string[] = []
    run({ env }, validarEntrada, (_path: string, value: string) => saved.push(value))
    expect(JSON.parse(saved[0])).toEqual(entrada)
    for (const bad of [{}, { ...env, INPUT_MODO: undefined }, { ...env, INPUT_NUMERO: '0'.repeat(16) },
      { ...env, INPUT_EMPRESAS: '' }, { ...env, INPUT_EVENTO: 'invalido' }]) {
      expect(() => run({ env: bad }, validarEntrada, () => { throw new Error('gravacao indevida') })).toThrow('Entrada invalida')
    }
  })
  it('recusa vazio, empresa ausente, fila vazia/bloqueada e evento nao aceito', () => {
    const run = new Function('resumo', 'process', trecho('RESULTADO'))
    const ok = { dfe: { status: 'ok', cStat: '138' }, adn: { status: 'ok' }, evento_homologacao: { status: 'ok', assinatura_e_certificado_aceitos: true } }
    const env = { INPUT_EMPRESAS: 'ambas', INPUT_EVENTO: 'true' }
    const state = { env, exitCode: 0 }
    run({ rgf: ok, sf: ok }, state)
    expect(state.exitCode).toBe(0)
    for (const bad of [{}, { rgf: ok }, { rgf: ok, sf: { ...ok, dfe: { status: 'ok', cStat: '137' } } },
      { rgf: ok, sf: { ...ok, dfe: { status: 'ok', cStat: '656' } } },
      { rgf: ok, sf: { ...ok, evento_homologacao: { status: 'ok', assinatura_e_certificado_aceitos: false } } }]) {
      const state = { env, exitCode: 0 }; run(bad, state); expect(state.exitCode).toBe(1)
    }
  })
})
