import { assuntoDoAlarme, ehClaimAlarme, htmlDoAlarme, type ClaimAlarmePronto } from './email.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const resendApiKey = Deno.env.get('RESEND_API_KEY')
const appUrl = 'https://pane-producao-git-main-orodrigaos-projects.vercel.app'

class RpcError extends Error {
  constructor(name: string, readonly status: number) {
    super(`RPC ${name} recusou a chamada (${status}).`)
  }
}

function requireConfig(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Configuração ausente: ${name}`)
  return value
}

async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${requireConfig(supabaseUrl, 'SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: requireConfig(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${requireConfig(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new RpcError(name, response.status)
  const responseBody = await response.text()
  return responseBody ? JSON.parse(responseBody) : null
}

async function enviar(claim: ClaimAlarmePronto, cronSecret: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireConfig(resendApiKey, 'RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      // Uma fotografia por dia: a mesma chave impede e-mail repetido quando a
      // marcação de enviado falha e o cron tenta de novo.
      'Idempotency-Key': `alarme-rotina:${claim.report_date}`,
    },
    body: JSON.stringify({
      from: 'Pane&Salute Alarme <alarme@paneesalute.com.br>',
      to: [claim.recipient],
      subject: assuntoDoAlarme(claim.fotografia),
      html: htmlDoAlarme(claim.fotografia, appUrl),
    }),
  })
  if (!response.ok) throw new Error(`Resend recusou o envio (${response.status}).`)
  // Resposta 2xx já é envio aceito: corpo vazio ou ilegível não vira falha.
  let providerResult: unknown = null
  try {
    providerResult = await response.json()
  } catch {
    providerResult = null
  }
  const providerId = providerResult && typeof providerResult === 'object'
    && typeof (providerResult as Record<string, unknown>).id === 'string'
    ? (providerResult as Record<string, string>).id
    : 'aceito-pelo-resend'
  await callRpc('mark_alarme_rotina_enviado', {
    p_secret: cronSecret, p_envio_id: claim.envio_id, p_attempt_token: claim.attempt_token,
    p_provider_message_id: providerId,
  })
}

Deno.serve(async request => {
  // Saúde para o vigia do GitHub: só a data da última fotografia concluída
  // (enviada ou sem nada a mandar). Sem segredo e sem conteúdo do alarme.
  if (request.method === 'GET') {
    try {
      const dia = await callRpc('alarme_rotina_ultimo_dia_concluido', {})
      return Response.json(
        { ultimo_dia_concluido: typeof dia === 'string' ? dia : null },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    } catch {
      return new Response(null, { status: 503 })
    }
  }

  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const cronSecret = request.headers.get('x-alarme-rotina-cron-secret')
  if (!cronSecret) return new Response(null, { status: 401 })

  let result: unknown
  try {
    result = await callRpc('claim_alarme_rotina_para_envio', { p_secret: cronSecret })
  } catch (error) {
    const status = error instanceof RpcError && (error.status === 401 || error.status === 403) ? 401 : 500
    return new Response(null, { status })
  }
  if (!ehClaimAlarme(result)) return new Response(null, { status: 500 })
  if (result.state !== 'pronto_para_enviar') return Response.json({ status: result.state })

  try {
    await enviar(result, cronSecret)
    return Response.json({ status: 'enviado' })
  } catch (error) {
    try {
      await callRpc('record_alarme_rotina_falha', {
        p_secret: cronSecret, p_envio_id: result.envio_id, p_attempt_token: result.attempt_token,
        p_error: error instanceof Error ? error.message : 'Falha desconhecida ao enviar o alarme.',
      })
    } catch {
      // O retorno não revela o erro interno; o cron tenta de novo em 15 minutos.
    }
    return new Response(null, { status: 502 })
  }
})
