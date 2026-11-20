import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
import { canUseNfeInbox, formatCnpj, inboxBatchSummary, nfeInboxResultLabel, nfeInboxStatusLabel, readXmlFileText, sendInboxFiles, type NfeInboxReceiveResult } from './nfeInbox'

const success: NfeInboxReceiveResult = { resultado: 'entrou', motivo: null, mensagem: 'Recebida', id: '1', chave: '1', numero: '1', emitente: '[TESTE]', ja_no_erp: false }
const file = (name: string, text = '<NFe/>') => ({ name, text: async () => text })

describe('permissão da caixa', () => {
  it('espelha admin e a concessão de importação na JC, sem depender da loja do perfil', () => {
    expect(canUseNfeInbox({ role: 'admin' })).toBe(true)
    for (const scope of ['jc', '*']) expect(canUseNfeInbox({ role: 'financeiro', permissions: [{ permission_key: 'contas_pagar.importar_xml', scope }] })).toBe(true)
    expect(canUseNfeInbox({ role: 'financeiro', permissions: [{ permission_key: 'contas_pagar.importar_xml', scope: 'ja' }] })).toBe(false)
    expect(canUseNfeInbox({ role: 'financeiro', permissions: [{ permission_key: 'contas_pagar.acessar', scope: 'jc' }] })).toBe(false)
    expect(canUseNfeInbox({ role: 'vendas' })).toBe(false)
    expect(canUseNfeInbox(null)).toBe(false)
  })
})
it('mostra todos os estados e preserva um estado novo vindo do banco', () => {
  expect(['esperando_conferencia', 'conferencia_comecada', 'ja_no_erp', 'lancada', 'ilegivel', 'aguardando_xml'].map(nfeInboxStatusLabel)).toEqual(['Esperando conferência', 'Conferência começada', 'Já estava no ERP', 'Lançada', 'Ilegível', 'Esperando o XML'])
  expect(nfeInboxStatusLabel('estado_futuro')).toBe('estado_futuro')
  expect(['entrou', 'ja_existia', 'completou', 'recusada', 'nao_enviado'].map(resultado => nfeInboxResultLabel({ resultado, ja_no_erp: false }))).toEqual(['Entrou', 'Já estava na caixa', 'XML anexado', 'Recusada', 'Não enviado, tente de novo'])
  expect(nfeInboxResultLabel({ resultado: 'entrou', ja_no_erp: true })).toContain('já estava lançada no ERP')
  expect(nfeInboxResultLabel({ resultado: 'novo', ja_no_erp: false })).toBe('novo')
  expect(formatCnpj('95000000000199')).toBe('95.000.000/0001-99')
  expect(formatCnpj('inválido')).toBe('inválido')
})
it('envia em ordem, sem simultaneidade, mesmo com erro e recusa no meio', async () => {
  let running = false
  const send = vi.fn(async (_text: string, name: string) => {
    expect(running).toBe(false)
    running = true
    await Promise.resolve()
    running = false
    if (name === 'b.xml') throw new Error('Rede indisponível')
    return name === 'c.xml' ? { ...success, resultado: 'recusada', motivo: 'modelo' } : success
  })
  const progress = vi.fn()
  const results = await sendInboxFiles(['a', 'b', 'c', 'd'].map(name => file(name + '.xml')), send, progress)
  expect(send.mock.calls.map(call => call[1])).toEqual(['a.xml', 'b.xml', 'c.xml', 'd.xml'])
  expect(results.map(result => result.resultado)).toEqual(['entrou', 'nao_enviado', 'recusada', 'entrou'])
  expect(results[1].mensagem).toBe('Não foi possível enviar este arquivo. Tente de novo.')
  expect(progress.mock.calls.map(call => call[0])).toEqual([1, 2, 3, 4].map(current => ({ current, total: 4 })))
  expect(inboxBatchSummary(results)).toBe('2 entraram, 1 recusada, 1 não enviado')
})
it('remove BOM e aceita exatamente o limite; acima do limite não chama o banco', async () => {
  expect(await readXmlFileText(file('a', '\uFEFF<NFe/>'))).toBe('<NFe/>')
  expect((await readXmlFileText(file('a', 'x'.repeat(2_000_000)))).length).toBe(2_000_000)
  const send = vi.fn(async () => success)
  const result = await sendInboxFiles([file('grande', 'x'.repeat(2_000_001)), file('bom', '\uFEFF<NFe/>')], send)
  expect(result[0].resultado).toBe('nao_enviado')
  expect(result[0].mensagem).toContain('2.000.000')
  expect(send).toHaveBeenCalledExactlyOnceWith('<NFe/>', 'bom')
})
it('falha ao ler um arquivo não impede o seguinte', async () => {
  const result = await sendInboxFiles([{ name: 'quebrado', text: async () => { throw new Error('Leitura falhou') } }, file('ok')], async () => success)
  expect(result.map(item => item.resultado)).toEqual(['nao_enviado', 'entrou'])
})
