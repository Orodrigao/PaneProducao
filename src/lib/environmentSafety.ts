import { createHash } from 'node:crypto'

export const PRODUCTION_SUPABASE_PROJECT_REF = 'gohluceldchoitihrimw'
export const PREVIEW_SUPABASE_PROJECT_REF = 'tuqzhjsbodoycjbmwuqm'

const PUBLIC_KEY_FINGERPRINTS: Record<string, string> = {
  [PRODUCTION_SUPABASE_PROJECT_REF]: '6a2b9528fa9016d003a2d4e09c2533fef4455214fd8492edcbbe7d493be09336',
  [PREVIEW_SUPABASE_PROJECT_REF]: '7a929f5e2d0ab5540dc82c0da2768c5b0444e1d75bc0c13ae848d778aa25eb75',
}

interface SupabaseEnvironmentInput {
  supabaseUrl: string | undefined
  vercelEnvironment?: string
}

interface SupabasePublicKeyInput {
  supabaseUrl: string | undefined
  supabaseKey: string | undefined
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
}: SupabasePublicKeyInput): Promise<void> {
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ausente: a chave publica nao pode ser validada.')
  }
  if (!supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY ausente: o build foi interrompido por seguranca.')
  }

  const projectRef = projectRefFromUrl(supabaseUrl)
  const expectedFingerprint = projectRef ? PUBLIC_KEY_FINGERPRINTS[projectRef] : undefined
  const actualFingerprint = createHash('sha256').update(supabaseKey).digest('hex')

  if (!expectedFingerprint || actualFingerprint !== expectedFingerprint) {
    throw new Error('Chave publica nao pertence ao projeto Supabase configurado; o build foi interrompido.')
  }
}
