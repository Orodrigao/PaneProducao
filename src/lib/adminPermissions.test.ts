import { describe, expect, it } from 'vitest'
import {
  buildPermissionAssignments,
  formatRole,
  formatStore,
  groupPermissions,
  isPjOrderSingleCheckboxPermission,
  isSingleCheckboxPermissionChecked,
  permissionStoreScopes,
  togglePermissionAssignment,
  toggleSingleCheckboxPermission,
  type PermissionDefinition,
} from './adminPermissions'

// As invariantes de banco (RLS, grants, catálogo) são guardadas contra o
// schema versionado em supabase/tests/ (pgTAP, executado pelo CI Banco).

describe('fundação de permissões por usuário', () => {
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

  it('trata acesso e confirmação de Pedidos PJ como permissões de checkbox único', () => {
    expect(isPjOrderSingleCheckboxPermission('pedidos_pj.acessar')).toBe(true)
    expect(isPjOrderSingleCheckboxPermission('pedidos_pj.confirmar_envio')).toBe(true)
    expect(isPjOrderSingleCheckboxPermission('romaneio.confirmar_saida')).toBe(false)
  })
})

describe('permissões com escopo por loja', () => {
  it('oferece JC, JA e EX para a Cozinha sem alterar as regras existentes', () => {
    expect(permissionStoreScopes('producao_cozinha.lancar')).toEqual(['jc', 'ja', 'ex'])
    expect(permissionStoreScopes('romaneio.confirmar_saida')).toEqual(['jc', 'ja', 'ex'])
    expect(permissionStoreScopes('romaneio.acessar')).toEqual([])
    expect(permissionStoreScopes('pedidos_pj.acessar')).toEqual([])
  })

  it('adiciona uma loja da Cozinha sem retirar nenhum acesso existente', () => {
    const existing = new Set([
      'romaneio.acessar|*',
      'romaneio.confirmar_saida|ex',
      'pedidos_pj.acessar|jc',
      'pedidos_pj.confirmar_envio|jc',
      'producao_cozinha.lancar|ja',
    ])

    const withKitchenJc = togglePermissionAssignment(
      existing,
      'producao_cozinha.lancar',
      'jc',
    )

    expect(withKitchenJc).toEqual(new Set([
      ...existing,
      'producao_cozinha.lancar|jc',
    ]))
    expect(existing).not.toContain('producao_cozinha.lancar|jc')
    expect(togglePermissionAssignment(
      withKitchenJc,
      'producao_cozinha.lancar',
      'jc',
    )).toEqual(existing)
  })

  it('envia a matriz completa ao salvar depois de escolher a loja da Cozinha', () => {
    const assignments = togglePermissionAssignment(new Set([
      'romaneio.acessar|*',
      'romaneio.confirmar_saida|ex',
      'pedidos_pj.acessar|jc',
      'pedidos_pj.confirmar_envio|jc',
    ]), 'producao_cozinha.lancar', 'jc')

    expect(buildPermissionAssignments(assignments)).toEqual([
      { permissionKey: 'romaneio.acessar', scope: '*' },
      { permissionKey: 'romaneio.confirmar_saida', scope: 'ex' },
      { permissionKey: 'pedidos_pj.acessar', scope: 'jc' },
      { permissionKey: 'pedidos_pj.confirmar_envio', scope: 'jc' },
      { permissionKey: 'producao_cozinha.lancar', scope: 'jc' },
    ])
  })
})
