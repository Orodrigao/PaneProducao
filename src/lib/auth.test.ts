import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAppUser,
  fetchCurrentAuthUser,
  navigateAfterAuthentication,
  normalizeEmailInput,
  passwordPolicyChecklist,
  passwordRecoveryErrorMessage,
  resolveAllowedRoutes,
  validatePasswordSetup,
} from './auth'

const authSupabaseMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: authSupabaseMock.getSession },
    from: authSupabaseMock.from,
  },
}))

describe('resolveAllowedRoutes', () => {
  it('libera Pedidos PJ quando a permissão de acesso vale para a loja do usuário', () => {
    const routes = resolveAllowedRoutes('expedicao', 'jc', ['/romaneio'], [
      { permission_key: 'pedidos_pj.acessar', scope: 'jc' },
    ])

    expect(routes).toEqual(['/romaneio', '/pedidos-pj'])
  })

  it('retira Pedidos PJ quando o checkbox de acesso é desmarcado', () => {
    const routes = resolveAllowedRoutes('expedicao', 'jc', ['/romaneio', '/pedidos-pj'], [])

    expect(routes).toEqual(['/romaneio'])
  })

  it('preserva o acesso total do Administrador sem depender do checkbox', () => {
    const routes = resolveAllowedRoutes('admin', null, ['/', '/pedidos-pj'], [])

    expect(routes).toEqual(['/', '/pedidos-pj'])
  })
})

describe('buildAppUser', () => {
  it('entrega ao menu a rota concedida pela Tela de Usuários', () => {
    const user = buildAppUser({
      user_id: 'uuid-expedicao',
      display_name: 'Expedição',
      role: 'expedicao',
      active: true,
      allowed_routes: ['/romaneio'],
      store: 'jc',
    }, 'expedicao@paneesalute.com.br', [
      { permission_key: 'pedidos_pj.acessar', scope: 'jc' },
    ])

    expect(user?.allowedRoutes).toEqual(['/romaneio', '/pedidos-pj'])
  })
})

describe('fetchCurrentAuthUser', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
    authSupabaseMock.getSession.mockResolvedValue({
      data: { session: { user: { id: 'uuid-expedicao', email: 'expedicao@paneesalute.com.br' } } },
      error: null,
    })
    authSupabaseMock.from.mockImplementation((table: string) => {
      if (table === 'app_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: 'uuid-expedicao',
                  display_name: 'Expedição',
                  role: 'expedicao',
                  active: true,
                  allowed_routes: ['/romaneio'],
                  store: 'jc',
                },
                error: null,
              }),
            }),
          }),
        }
      }

      return {
        select: () => ({
          eq: async () => ({
            data: [{ permission_key: 'pedidos_pj.acessar', scope: 'jc' }],
            error: null,
          }),
        }),
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('carrega a permissão própria antes de montar as rotas autenticadas', async () => {
    const user = await fetchCurrentAuthUser()

    expect(user?.allowedRoutes).toContain('/pedidos-pj')
    expect(authSupabaseMock.from).toHaveBeenCalledWith('app_user_permissions')
  })
})

describe('normalizeEmailInput', () => {
  it('remove espaços e padroniza e-mail em minúsculas', () => {
    expect(normalizeEmailInput('  Rodrigao@GMAIL.COM  ')).toBe('rodrigao@gmail.com')
  })
})

describe('navigateAfterAuthentication', () => {
  it('faz uma navegação completa para iniciar a rota com a sessão persistida', () => {
    const destinations: string[] = []

    navigateAfterAuthentication('/romaneio', destination => destinations.push(destination))

    expect(destinations).toEqual(['/romaneio'])
  })
})

describe('validatePasswordSetup', () => {
  it('exige senha com pelo menos 10 caracteres', () => {
    expect(validatePasswordSetup('Aa1!56789', 'Aa1!56789')).toMatchObject({ ok: false })
  })

  it('rejeita confirmação diferente', () => {
    expect(validatePasswordSetup('SenhaForte1!', 'SenhaForte2!')).toMatchObject({ ok: false })
  })

  it('rejeita senha sem tipos variados de caracteres', () => {
    expect(validatePasswordSetup('senhaforte', 'senhaforte')).toMatchObject({ ok: false })
  })

  it('rejeita senhas comuns ou obvias', () => {
    expect(validatePasswordSetup('Senha1234!', 'Senha1234!')).toMatchObject({ ok: false })
    expect(validatePasswordSetup('PaneSalute2026!', 'PaneSalute2026!')).toMatchObject({ ok: false })
  })

  it('rejeita senha sequencial', () => {
    expect(validatePasswordSetup('Abc123456!', 'Abc123456!')).toMatchObject({ ok: false })
  })

  it('aceita senha válida com confirmação igual', () => {
    expect(validatePasswordSetup('Forno#Dia72', 'Forno#Dia72')).toMatchObject({ ok: true })
  })
})

describe('passwordPolicyChecklist', () => {
  it('marca critérios visuais de senha forte', () => {
    expect(passwordPolicyChecklist('Forno#Dia72').every(rule => rule.valid)).toBe(true)
  })

  it('indica critérios pendentes para senha fraca', () => {
    const pending = passwordPolicyChecklist('senha').filter(rule => !rule.valid).map(rule => rule.id)

    expect(pending).toEqual(['length', 'case', 'number', 'symbol'])
  })
})

describe('passwordRecoveryErrorMessage', () => {
  it('explica o limite de envio de e-mails', () => {
    const message = passwordRecoveryErrorMessage({ status: 429 })

    expect(message).toContain('Aguarde até uma hora')
    expect(message).not.toContain('PIN')
  })

  it('mantém a mensagem genérica para outros erros', () => {
    const message = passwordRecoveryErrorMessage({ status: 500 })

    expect(message).toBe('Não foi possível enviar o link. Confira o e-mail e tente novamente.')
    expect(message).not.toContain('PIN')
  })
})
