export const PRODUCTION_SUPABASE_PROJECT_REF = 'gohluceldchoitihrimw'
export const PREVIEW_SUPABASE_PROJECT_REF = 'tuqzhjsbodoycjbmwuqm'

interface SupabaseEnvironmentInput {
  supabaseUrl: string | undefined
  vercelEnvironment?: string
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
