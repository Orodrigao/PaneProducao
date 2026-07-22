import { describe, expect, it } from 'vitest'
import {
  formatRole,
  formatStore,
  groupPermissions,
  isPjOrderSingleCheckboxPermission,
  isSingleCheckboxPermissionChecked,
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
