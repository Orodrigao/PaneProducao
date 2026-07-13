const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

export class RequestTimeoutError extends Error {
  constructor(message = 'A operação demorou demais para responder.') {
    super(message)
    this.name = 'RequestTimeoutError'
  }
}

export class SupabaseRestError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`Supabase REST respondeu ${status}: ${responseBody}`)
    this.name = 'SupabaseRestError'
  }
}

export function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new RequestTimeoutError()), timeoutMs)

    Promise.resolve(operation).then(
      value => {
        globalThis.clearTimeout(timer)
        resolve(value)
      },
      error => {
        globalThis.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function buildSupabaseRestHeaders(
  accessToken: string | null | undefined,
  initialHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(initialHeaders)
  headers.set('apikey', SB_KEY)
  headers.set('Authorization', `Bearer ${accessToken || SB_KEY}`)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return headers
}

export async function supabaseRestFetch(
  resource: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const { supabase } = await import('@/lib/supabase')
  const { data, error } = await withTimeout(supabase.auth.getSession(), timeoutMs)
  if (error) throw error

  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  const forwardAbort = () => controller.abort()
  init.signal?.addEventListener('abort', forwardAbort, { once: true })

  try {
    const response = await fetch(`${SB_URL}/rest/v1/${resource}`, {
      ...init,
      headers: buildSupabaseRestHeaders(data.session?.access_token, init.headers),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new SupabaseRestError(response.status, await response.text())
    }

    return response
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new RequestTimeoutError()
    }
    throw error
  } finally {
    globalThis.clearTimeout(timer)
    init.signal?.removeEventListener('abort', forwardAbort)
  }
}
