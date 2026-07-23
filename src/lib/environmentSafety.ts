export const PRODUCTION_SUPABASE_PROJECT_REF = 'gohluceldchoitihrimw'
export const PREVIEW_SUPABASE_PROJECT_REF = 'tuqzhjsbodoycjbmwuqm'

interface SupabaseEnvironmentInput {
  supabaseUrl: string | undefined
  vercelEnvironment?: string
}

interface SupabasePublicKeyInput {
  supabaseUrl: string | undefined
  supabaseKey: string | undefined
  fetchImpl?: typeof fetch
}

function projectRefFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    const suffix = '.supabase.co'
    return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : null
  } catch {
    return null
  }
}

export function assertSafeSupabaseEnvironment({
  supabaseUrl,
  vercelEnvironment,
}: SupabaseEnvironmentInput): void {
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ausente: o build foi interrompido por seguranca.')
  }

  const projectRef = projectRefFromUrl(supabaseUrl)
  if (!projectRef) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL invalida: informe um projeto Supabase conhecido.')
  }

  if (vercelEnvironment === 'production') {
    if (projectRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
      throw new Error('Producao tentou usar o banco de teste ou um projeto desconhecido.')
    }
    return
  }

  if (projectRef !== PREVIEW_SUPABASE_PROJECT_REF) {
    const environmentName = vercelEnvironment === 'preview' ? 'Preview' : 'Ambiente local'
    throw new Error(`${environmentName} tentou usar o banco de producao ou um projeto desconhecido.`)
  }
}

export async function assertValidSupabasePublicKey({
  supabaseUrl,
  supabaseKey,
  fetchImpl = fetch,
}: SupabasePublicKeyInput): Promise<void> {
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ausente: a chave publica nao pode ser validada.')
  }
  if (!supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY ausente: o build foi interrompido por seguranca.')
  }

  let response: Response
  try {
    response = await fetchImpl(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('Nao foi possivel validar a chave publica no Supabase; o build foi interrompido.')
  }

  if (!response.ok) {
    throw new Error(`Chave publica recusada pelo Supabase (HTTP ${response.status}); o build foi interrompido.`)
  }
}
