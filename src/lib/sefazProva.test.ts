import { createHash, createPrivateKey, createSign, createVerify, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  abrirGzip, conferirToken, criarHandler, executarProva, REJEICOES_TECNICAS, TIPOS_DE_FALHA,
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
  it('classifica nota completa pelo schema procNFe, mesmo com raiz nfeProc', async () => {
    const xml = '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe/></nfeProc>'
    const documents = `<docZip schema="procNFe_v4.00.xsd">${zip(xml)}</docZip>`
      + `<docZip schema="desconhecido_v1.xsd">${zip('<resNFe/>')}</docZip>`
      + `<docZip>${zip('<resNFe/>')}</docZip>`
    expect(await resumirDfe(dfe('138', documents))).toMatchObject({ docs: { procNFe: 1, outro: 2 } })
  })
  it('preserva cStat e NSUs com gzip e XML ilegíveis entre documentos validos', async () => {
    const documents = `<docZip schema="resNFe_v1.xsd">${zip('<resNFe/>')}</docZip>`
      + '<docZip schema="procNFe_v4.00.xsd">invalido</docZip>'
      + `<docZip schema="procNFe_v4.00.xsd">${zip('<nfeProc>')}</docZip>`
      + `<docZip schema="resEvento_v1.xsd">${zip('<resEvento/>')}</docZip>`
    const raw = dfe('138', documents)
    const result = await executarProva(validarEntrada(entrada)!, async name => ({
      status: 'ok', http: 200, body: name.endsWith('dfe') ? raw : name.endsWith('adn') ? '{}' : evento('128', '217'),
    }))
    expect(result).toMatchObject({ rgf: { dfe: { status: 'ok', cStat: '138',
      ultNSU: '000000000001234', maxNSU: '000000000001290',
      docs: { resNFe: 1, resEvento: 1, ilegivel: 2 }, bytes: Buffer.byteLength('<resNFe/><resEvento/>'),
    } } })
    expect(JSON.stringify(result)).not.toContain('prova_falhou')
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
  it('conta gzip e XML ilegíveis no ADN e preserva os documentos legiveis', async () => {
    const body = JSON.stringify({ loteDFe: [zip('<NFSe/>'), 'H4sIinvalido', zip('<NFSe>'), zip('<CompNfse/>')] })
    const result = await executarProva(validarEntrada(entrada)!, async name => ({
      status: 'ok', http: 200, body: name.endsWith('adn') ? body : name.endsWith('dfe') ? dfe('137') : evento('128', '217'),
    }))
    expect(result).toMatchObject({ sf: { adn: { status: 'ok', http: 200, chaves_json: ['loteDFe'],
      docs: { NFSe: 1, CompNfse: 1, ilegivel: 2 }, bytes: Buffer.byteLength('<NFSe/><CompNfse/>'),
    } } })
  })
  it.each(['arquivoXml', 'ARQUIVO', 'conteudoXML'])('conta documento invalido pelo nome do campo %s', async campo => {
    expect(await resumirAdn(JSON.stringify({ loteDFe: [{ [campo]: 'invalido' }] }), 200))
      .toMatchObject({ status: 'ok', docs: { ilegivel: 1 }, bytes: 0 })
  })
  it('abre gzip com quebra de linha em campo desconhecido do ADN', async () => {
    expect(await resumirAdn(JSON.stringify({ loteDFe: [{ conteudo: `\n${zip('<NFSe/>')} ` }] }), 200))
      .toMatchObject({ status: 'ok', docs: { NFSe: 1 }, bytes: Buffer.byteLength('<NFSe/>') })
  })
  it('ignora metadados do ADN sem contar documentos', async () => {
    expect(await resumirAdn(JSON.stringify({ dataHoraProcessamento: '2026-11-19T19:00:00Z' }), 200))
      .toMatchObject({ status: 'ok', docs: {}, bytes: 0 })
  })
  it('so aceita assinatura em lote processado e resposta de negocio reconhecida', () => {
    expect(resumirEvento(evento('128', '217')).assinatura_e_certificado_aceitos).toBe(true)
    expect(resumirEvento(evento('225', '217')).assinatura_e_certificado_aceitos).toBe(false)
    for (const c of [...REJEICOES_TECNICAS, 999]) expect(resumirEvento(evento('128', String(c))).assinatura_e_certificado_aceitos).toBe(false)
  })
})

describe('fronteiras e saneamento', () => {
  it.each(['ok', 'falhou'] as const)('preserva a sondagem somente no evento com RPC %s', async status => {
    const sondagem = { status: 'ok', http: 403, ms_banco: 32.125, body: 'CORPO PROIBIDO',
      headers: { segredo: 'PROIBIDO' }, campo_estranho: true, bytes: 123,
      sondagem_sem_certificado: { status: 'ok' } }
    const result = await executarProva(validarEntrada(entrada)!, async name => ({
      status, http: 200, ms_banco: 12,
      ...(status === 'falhou' ? { motivo: 'falha_transporte', erro: 'conexao_encerrada', codigo: 'XX000' } : {}),
      body: name.endsWith('dfe') ? dfe('137') : name.endsWith('adn') ? '{}' : evento('128', '217'),
      sondagem_sem_certificado: sondagem,
    }))
    const expected = { status: 'ok', http: 403, ms_banco: 32.13 }
    for (const empresa of ['rgf', 'sf']) {
      const item = result[empresa] as Record<string, Record<string, unknown>>
      expect(item.evento_homologacao).toMatchObject({ status, sondagem_sem_certificado: expected })
      expect(item.evento_homologacao.sondagem_sem_certificado).toEqual(expected)
      for (const prova of ['dfe', 'adn', 'certificado']) expect(item[prova] ?? {}).not.toHaveProperty('sondagem_sem_certificado')
    }
    expect(JSON.stringify(result)).not.toMatch(/body|headers|PROIBIDO|campo_estranho/)
    expect(sanearResumo(result)).toEqual(result)
    expect(resumirEvento(evento('128', '217'), sondagem)).toMatchObject({ sondagem_sem_certificado: expected })
  })
  it('preserva diagnostico seguro da sondagem e a prova com certificado independente', async () => {
    const sondagem = { status: 'falhou', motivo: 'falha_transporte', erro: 'conexao_encerrada',
      codigo: 'XX000', erro_texto: 'Recv failure: Connection reset by peer; [...] [n]', ms_banco: 4 }
    const handler = criarHandler({ token: () => 'segredo', memoria: () => ({ rss: 0, heapUsed: 0 }),
      rpc: async name => ({ status: 'ok', http: 200,
        body: name.endsWith('dfe') ? dfe('137') : name.endsWith('adn') ? '{}' : evento('128', '217'),
        sondagem_sem_certificado: { ...sondagem, body: 'CORPO PROIBIDO' } }),
    })
    const response = await handler(new Request('https://local', { method: 'POST',
      headers: { 'x-sefaz-prova-token': 'segredo' }, body: JSON.stringify(entrada) }))
    const result = await response.json()
    expect(response.status).toBe(200)
    for (const empresa of ['rgf', 'sf']) {
      expect(result[empresa].evento_homologacao).toMatchObject({ status: 'ok',
        assinatura_e_certificado_aceitos: true, sondagem_sem_certificado: sondagem })
      expect(result[empresa].evento_homologacao.sondagem_sem_certificado).toEqual(sondagem)
      for (const prova of ['dfe', 'adn', 'certificado']) expect(result[empresa][prova]).not.toHaveProperty('sondagem_sem_certificado')
    }
    expect(JSON.stringify(result)).not.toMatch(/body|PROIBIDO/)
  })
  it('preserva a comparacao quando hom1 recusa o HTTP da chamada com certificado', async () => {
    const sondagem = { status: 'ok', http: 403, ms_banco: 10 }
    const result = await executarProva(validarEntrada(entrada)!, async name => ({ status: 'ok',
      http: name.endsWith('evento') ? 403 : 200,
      body: name.endsWith('dfe') ? dfe('137') : '{}', sondagem_sem_certificado: sondagem,
    }))
    expect(result).toMatchObject({ rgf: { evento_homologacao: { status: 'falhou',
      motivo: 'http_recusado', http: 403, sondagem_sem_certificado: sondagem } } })
    expect(JSON.stringify(result)).not.toContain('body')
  })
  it('preserva a sondagem saneada quando o corpo do evento com HTTP 200 e ilegivel', async () => {
    const sondagem = { status: 'ok', http: 403, ms_banco: 10 }
    const result = await executarProva(validarEntrada(entrada)!, async name => ({
      status: 'ok', http: 200,
      body: name.endsWith('dfe') ? dfe('137') : name.endsWith('adn') ? '{}' : '<resposta/>',
      sondagem_sem_certificado: { ...sondagem, body: 'CORPO PROIBIDO', headers: { segredo: 'PROIBIDO' } },
    }))
    for (const empresa of ['rgf', 'sf']) {
      const item = result[empresa] as Record<string, Record<string, unknown>>
      expect(item.evento_homologacao).toMatchObject({ status: 'falhou', motivo: 'prova_falhou' })
      expect(item.evento_homologacao.sondagem_sem_certificado).toEqual(sondagem)
      for (const prova of ['dfe', 'adn', 'certificado']) expect(item[prova]).not.toHaveProperty('sondagem_sem_certificado')
    }
    expect(JSON.stringify(result)).not.toMatch(/body|headers|PROIBIDO|resposta/)
  })
  it('nao reaproveita sondagem quando a RPC do evento lanca excecao sem resposta', async () => {
    const sondagem = { status: 'ok', http: 403, ms_banco: 10 }
    const result = await executarProva(validarEntrada(entrada)!, async (name, args) => {
      if (name.endsWith('evento') && args.p_empresa === 'sf') throw new Error('ERRO PROIBIDO')
      return { status: 'ok', http: 200,
        body: name.endsWith('dfe') ? dfe('137') : name.endsWith('adn') ? '{}' : evento('128', '217'),
        sondagem_sem_certificado: sondagem }
    })
    expect(result).toMatchObject({ rgf: { evento_homologacao: { status: 'ok', sondagem_sem_certificado: sondagem } },
      sf: { evento_homologacao: { status: 'falhou', motivo: 'prova_falhou' } } })
    const sf = result.sf as Record<string, Record<string, unknown>>
    expect(sf.evento_homologacao).not.toHaveProperty('sondagem_sem_certificado')
    expect(JSON.stringify(result)).not.toContain('PROIBIDO')
  })
  it.each([
    '-----BEGIN PRIVATE KEY-----', 'CNPJ 11222333000181 invalido', 'A'.repeat(20),
    'falha\ncontrole', 'x '.repeat(101), 'conexão encerrada',
  ])('descarta texto proibido dentro da sondagem: %s', erro_texto => {
    const result = sanearResumo({ rgf: { evento_homologacao: { status: 'falhou',
      sondagem_sem_certificado: { status: 'falhou', erro_texto } } } })
    expect(result).toEqual({ rgf: { evento_homologacao: { status: 'falhou',
      sondagem_sem_certificado: { status: 'falhou' } } }, funcao: {} })
  })
  it('restringe os campos e os valores da sondagem ao contrato', () => {
    const result = sanearResumo({ rgf: { evento_homologacao: { status: 'ok',
      sondagem_sem_certificado: { status: 'sem_certificado', motivo: 'inventado', erro: 'DNS',
        codigo: 'xx000', http: Infinity, ms_banco: '12', ms_total: 15, docs: { resNFe: 1 },
        lote_cStat: '128', assinatura_e_certificado_aceitos: true } } } })
    expect(result).toEqual({ rgf: { evento_homologacao: { status: 'ok',
      sondagem_sem_certificado: { status: 'falhou' } } }, funcao: {} })
  })
  it.each([
    "Failed to connect to adn.nfse.gov.br port 443 after 3 ms: Couldn't connect to server",
    'OpenSSL/3.5.7: error:0A000410:SSL routines::ssl/tls alert handshake failure',
    'Recv failure: Connection reset by peer',
    '[omitido]', 'Certificado [...] numero [n]', 'x '.repeat(100),
    'A'.repeat(19), '1234567890', ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  ])('preserva texto de falha seguro: %s', erro_texto => {
    expect(sanearResumo({ rgf: { dfe: { status: 'falhou', erro_texto } } }))
      .toEqual({ rgf: { dfe: { status: 'falhou', erro_texto } }, funcao: {} })
  })
  it.each([
    ['tamanho', 'x '.repeat(100) + 'x'],
    ['controle', 'Recv\nfailure'], ['tabulacao', 'Recv\tfailure'],
    ['DEL', 'Recv\x7ffailure'], ['nao ASCII', 'conexão encerrada'],
    ['base64', 'Certificado ' + 'Ab9+/='.repeat(11) + ' invalido'],
    ['base64 no limite', 'A'.repeat(20)],
    ['numero longo', 'CNPJ 11222333000181 invalido'], ['numero no limite', '12345678901'],
    ['PEM', '-----BEGIN PRIVATE KEY-----'], ['delimitador', 'falha ----- fim'],
    ['begin', 'falha BeGiN fim'], ['private', 'falha PrIvAtE fim'],
    ['nulo', null], ['numero', 42], ['objeto', { toString: () => 'seguro' }],
  ])('descarta o campo inteiro de texto proibido: %s', (_caso, erro_texto) => {
    expect(sanearResumo({ rgf: { dfe: { status: 'falhou', erro_texto } } }))
      .toEqual({ rgf: { dfe: { status: 'falhou' } }, funcao: {} })
  })
  it.each(['dns', 'tempo_esgotado', 'conexao_recusada', 'certificado_local',
    'certificado_servidor', 'renegociacao', 'conexao_encerrada', 'handshake_tls',
    'opcao_curl', 'cancelado', 'permissao', 'outro'])('preserva somente tipo conhecido: %s', erro => {
    expect(TIPOS_DE_FALHA).toContain(erro)
    expect(sanearResumo({ rgf: { dfe: { status: 'falhou', motivo: 'falha_transporte', erro, codigo: 'XX000' } } }))
      .toMatchObject({ rgf: { dfe: { status: 'falhou', motivo: 'falha_transporte', erro, codigo: 'XX000' } } })
  })
  it.each([
    ['desconhecido', 'xx000'], ['could not load PEM client certificate', 'XX00'],
    ['conexao_recusada extra', 'XX0000'], [null, 'XX00!'], [42, 12345],
    [{ toString: () => 'dns' }, 'XX000\n'], ['DNS', null],
  ])('descarta tipo e codigo fora do contrato (%s, %s)', (erro, codigo) => {
    expect(sanearResumo({ rgf: { dfe: { status: 'falhou', erro, codigo } } }))
      .toEqual({ rgf: { dfe: { status: 'falhou' } }, funcao: {} })
  })
  it('leva tipo, codigo e texto mascarado da falha RPC ate a resposta saneada do handler', async () => {
    const erro_texto = 'Recv failure: Connection reset by peer; [...] [n]'
    const handler = criarHandler({
      token: () => 'segredo', memoria: () => ({ rss: 0, heapUsed: 0 }),
      rpc: async () => ({ status: 'falhou', motivo: 'falha_transporte',
        erro: 'conexao_recusada', codigo: 'XX000', erro_texto, body: 'PEM SENSIVEL' }),
    })
    const response = await handler(new Request('https://local', {
      method: 'POST', headers: { 'x-sefaz-prova-token': 'segredo' }, body: JSON.stringify(entrada),
    }))
    expect(response.status).toBe(200)
    const result = await response.json()
    for (const empresa of ['rgf', 'sf']) {
      for (const prova of ['dfe', 'adn', 'evento_homologacao']) {
        expect(result[empresa][prova]).toEqual({ status: 'falhou', motivo: 'falha_transporte',
          erro: 'conexao_recusada', codigo: 'XX000', erro_texto })
      }
    }
    expect(JSON.stringify(result)).not.toMatch(/PEM|SENSIVEL/)
  })
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
    const body = JSON.stringify(entrada)
    expect((await handler(req('POST', 'segredo', body.padEnd(4097, ' ')))).status).toBe(400)
    expect(calls).toBe(0)
    const response = await handler(req('POST', 'segredo', body.padEnd(4096, ' ')))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ funcao: { memoria_rss_mb: 1, heap_mb: 0.5 } })
    expect(calls).toBe(2)
  })
  it('preserva as provas quando o runtime nao consegue medir memoria', async () => {
    const handler = criarHandler({ token: () => 'segredo', memoria: () => { throw new Error('indisponivel') },
      rpc: async name => ({ status: 'ok', http: 200,
        body: name.endsWith('dfe') ? dfe('137') : name.endsWith('adn') ? '{}' : evento('128', '217') }),
    })
    const response = await handler(new Request('https://local', { method: 'POST',
      headers: { 'x-sefaz-prova-token': 'segredo' }, body: JSON.stringify(entrada) }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ rgf: { dfe: { status: 'ok', cStat: '137' } }, sf: { adn: { status: 'ok' } } })
    expect(result.funcao.ms_total).toEqual(expect.any(Number))
    expect(result.funcao).not.toHaveProperty('memoria_rss_mb')
    expect(result.funcao).not.toHaveProperty('heap_mb')
  })
  it('preserva motivo redirecionado sem repassar corpo da RPC', async () => {
    const result = await executarProva(validarEntrada(entrada)!, async () => ({
      status: 'falhou', motivo: 'redirecionado', body: 'NAO PODE SAIR',
    }))
    expect(result).toMatchObject({ rgf: { dfe: { status: 'falhou', motivo: 'redirecionado' } } })
    expect(JSON.stringify(result)).not.toContain('NAO PODE SAIR')
  })
  it('preserva registro_inseguro no saneamento sem repassar corpo da RPC', async () => {
    const result = await executarProva(validarEntrada(entrada)!, async () => ({
      status: 'falhou', motivo: 'registro_inseguro', body: 'NAO PODE SAIR',
    }))
    expect(result).toMatchObject({ rgf: { dfe: { status: 'falhou', motivo: 'registro_inseguro' } } })
    expect(sanearResumo(result)).toMatchObject({ sf: { adn: { status: 'falhou', motivo: 'registro_inseguro' } } })
    expect(JSON.stringify(result)).not.toContain('NAO PODE SAIR')
  })
})

describe('decisoes do workflow executadas literalmente', () => {
  const workflow = readFileSync('.github/workflows/sefaz-prova.yml', 'utf8')
  const trecho = (name: string) => workflow.split(`// INICIO ${name} TESTAD`)[1].split('\n').slice(1).join('\n').split(`// FIM ${name} TESTAD`)[0]
  it.each([
    { codes: ['503', '503', '503', '503', '503', '503', '200'], calls: 6, waits: 5 },
    { codes: ['503', '200'], calls: 2, waits: 1 },
    { codes: ['401', '200'], calls: 1, waits: 0 },
    { codes: ['500', '200'], calls: 1, waits: 0 },
    { codes: ['200'], calls: 1, waits: 0 },
  ])('repete somente 503, com teto de seis chamadas: $codes', ({ codes, calls, waits }) => {
    const run = new Function('process', trecho('REPETICAO'))
    let count = 0, pausas = 0
    for (const code of codes) {
      const state = { env: { HTTP_CODE: code, TENTATIVA: String(++count) }, exitCode: -1 }
      run(state)
      if (state.exitCode !== 0) break
      pausas++
    }
    expect(count).toBe(calls)
    expect(pausas).toBe(waits)
    expect(workflow).toContain('for tentativa in {1..6}; do')
    expect(workflow).toMatch(/then\s+sleep 10\s+else\s+break/)
  })
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
