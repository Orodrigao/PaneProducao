import { criarHandler, type Objeto } from './prova.ts'

// Unico destino da Edge Function: RPCs do proprio banco. Certificado/chave
// nunca chegam a este processo. Sem dependencias externas ou conexao ao fisco.
async function rpc(name: string, args: Objeto): Promise<unknown> {
  if (!['sefaz_prova_dfe', 'sefaz_prova_adn', 'sefaz_prova_evento'].includes(name)) throw new Error('falha_rpc')
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('falha_rpc')
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  })
  if (!response.ok) { await response.body?.cancel(); throw new Error('falha_rpc') }
  // Limite tambem no transporte, antes de alocar/interpretar o JSON.
  const reader = response.body?.getReader()
  if (!reader) throw new Error('falha_rpc')
  let text = '', bytes = 0
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 16 * 1024 * 1024) throw new Error('falha_rpc')
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { await reader.cancel() }
}

Deno.serve(criarHandler({
  token: () => Deno.env.get('SEFAZ_PROVA_TOKEN'), rpc,
  memoria: () => Deno.memoryUsage(),
}))
