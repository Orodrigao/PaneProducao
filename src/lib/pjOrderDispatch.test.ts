import { describe, expect, it } from 'vitest'
import { resolvePjOrderAccess } from './pjOrderDispatch'

describe('acesso ao envio de Pedidos PJ', () => {
  it('entrega uma fila sem valores e com confirmação para a Expedição da JC', () => {
    expect(resolvePjOrderAccess({ role: 'expedicao', store: 'jc' })).toEqual({
      mode: 'dispatch',
      canManage: false,
      canDispatch: true,
      canLaunch: false,
      showCommercialValues: false,
    })
  })

  it('mantém Admin e Financeiro na tela comercial sem permitir confirmar o envio', () => {
    expect(resolvePjOrderAccess({ role: 'admin', store: null })).toEqual({
      mode: 'commercial',
      canManage: true,
      canDispatch: false,
      canLaunch: false,
      showCommercialValues: true,
    })
    expect(resolvePjOrderAccess({ role: 'financeiro', store: null })).toEqual({
      mode: 'commercial',
      canManage: true,
      canDispatch: false,
      canLaunch: false,
      showCommercialValues: true,
    })
  })

  it('não transforma outra loja ou outro perfil em Expedição da JC', () => {
    expect(resolvePjOrderAccess({ role: 'expedicao', store: 'ex' }).mode).toBe('blocked')
    expect(resolvePjOrderAccess({ role: 'vendas', store: 'jc' }).mode).toBe('blocked')
  })
})

describe('lançamento de Pedido PJ pela Expedição', () => {
  const conferir = { permission_key: 'pedidos_pj.confirmar_envio', scope: 'jc' }
  const lancar = (scope: string) => [{ permission_key: 'pedidos_pj.lancar', scope }, conferir]

  it('abre o lançamento para a Expedição JC com a permissão em todas as lojas ou na JC', () => {
    expect(resolvePjOrderAccess({ role: 'expedicao', store: 'jc', permissions: lancar('*') }).canLaunch).toBe(true)
    expect(resolvePjOrderAccess({ role: 'expedicao', store: 'jc', permissions: lancar('jc') }).canLaunch).toBe(true)
  })

  it('não abre com a permissão marcada para outra loja', () => {
    expect(resolvePjOrderAccess({ role: 'expedicao', store: 'jc', permissions: lancar('ja') }).canLaunch).toBe(false)
  })

  it('não abre sem a confirmação de envio, que dá a leitura da jornada', () => {
    expect(resolvePjOrderAccess({
      role: 'expedicao', store: 'jc', permissions: [{ permission_key: 'pedidos_pj.lancar', scope: '*' }],
    }).canLaunch).toBe(false)
  })

  it('a permissão não muda o que outro perfil vê', () => {
    expect(resolvePjOrderAccess({ role: 'vendas', store: 'jc', permissions: lancar('*') }).canLaunch).toBe(false)
    expect(resolvePjOrderAccess({ role: 'expedicao', store: 'ja', permissions: lancar('*') }).canLaunch).toBe(false)
    expect(resolvePjOrderAccess({ role: 'financeiro', store: null, permissions: lancar('*') })).toMatchObject({
      canLaunch: false,
      canManage: true,
    })
  })
})
