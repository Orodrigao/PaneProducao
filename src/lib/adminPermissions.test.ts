import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  formatRole,
  formatStore,
  groupPermissions,
  isSingleCheckboxPermissionChecked,
  toggleSingleCheckboxPermission,
  type PermissionDefinition,
} from './adminPermissions'

const migrationSource = readFileSync(
  new URL('../../supabase/migrations/20260718181203_preparar_permissoes_usuarios.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('fundação de permissões por usuário', () => {
  it('mantém a matriz separada das rotas operacionais atuais', () => {
    expect(migrationSource).toContain('nao altera allowed_routes, role, store ou active')
    expect(migrationSource).not.toMatch(/update\s+public\.app_profiles/)
  })

  it('não identifica pessoas por nome, e-mail ou UUID no backfill', () => {
    expect(migrationSource).not.toContain('profile.display_name')
    expect(migrationSource).not.toContain('auth.users.email')
    expect(migrationSource).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/)
  })

  it('deriva a matriz inicial somente das rotas atuais do perfil', () => {
    expect(migrationSource).toContain('jsonb_array_elements_text(profile.allowed_routes)')
    expect(migrationSource).toContain('join route_permissions mapping on mapping.route = allowed_route.route')
    expect(migrationSource).toContain('where profile.active')
    expect(migrationSource.match(/null::uuid/g)).toHaveLength(2)
  })

  it('protege catálogo e atribuições com RLS e grants explícitos', () => {
    expect(migrationSource).toContain('alter table public.app_permissions force row level security')
    expect(migrationSource).toContain('alter table public.app_user_permissions force row level security')
    expect(migrationSource).toContain('revoke all on table public.app_user_permissions from anon, authenticated')
    expect(migrationSource).toContain('create policy app_user_permissions_insert_admin')
    expect(migrationSource).toContain('create policy app_user_permissions_delete_admin')
  })

  it('salva a substituição da matriz em uma única transação SQL', () => {
    expect(migrationSource).toContain('create or replace function public.replace_user_permissions')
    expect(migrationSource).toContain('security invoker')
    expect(migrationSource).toContain('grant execute on function public.replace_user_permissions')
  })
  it('mostra Pedidos PJ marcado quando a concessao existente esta limitada a JC', () => {
    const assignments = new Set(['pedidos_pj.acessar|jc'])

    expect(isSingleCheckboxPermissionChecked(assignments, 'pedidos_pj.acessar')).toBe(true)
  })

  it('desmarcar Pedidos PJ retira a concessao mesmo quando ela esta limitada a JC', () => {
    const assignments = new Set([
      'pedidos_pj.acessar|jc',
      'pedidos_pj.confirmar_envio|jc',
      'romaneio.acessar|*',
    ])

    expect(toggleSingleCheckboxPermission(assignments, 'pedidos_pj.acessar')).toEqual(new Set([
      'pedidos_pj.confirmar_envio|jc',
      'romaneio.acessar|*',
    ]))
  })
})

describe('apresentação da gestão de acesso', () => {
  const definitions: PermissionDefinition[] = [
    { key: 'producao.acessar', module: 'Operacao', label: 'Produção', description: null, sort_order: 10 },
    { key: 'compras.acessar', module: 'Comercial', label: 'Compras', description: null, sort_order: 20 },
    { key: 'forno.acessar', module: 'Operacao', label: 'Forno', description: null, sort_order: 30 },
  ]

  it('agrupa os controles por área preservando a ordem recebida', () => {
    expect(groupPermissions(definitions)).toEqual([
      { module: 'Operacao', permissions: [definitions[0], definitions[2]] },
      { module: 'Comercial', permissions: [definitions[1]] },
    ])
  })

  it('traduz função e loja para linguagem operacional', () => {
    expect(formatRole('expedicao')).toBe('Expedição')
    expect(formatStore('ja')).toBe('JA')
    expect(formatStore(null)).toBe('Todas as lojas')
  })
})
