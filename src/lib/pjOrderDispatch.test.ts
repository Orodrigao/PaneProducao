import { describe, expect, it } from 'vitest'
import { resolvePjOrderAccess } from './pjOrderDispatch'

describe('acesso ao envio de Pedidos PJ', () => {
  it('entrega uma fila sem valores e com confirmação para a Expedição da JC', () => {
    expect(resolvePjOrderAccess({ role: 'expedicao', store: 'jc' })).toEqual({
      mode: 'dispatch',
      canManage: false,
      canDispatch: true,
      showCommercialValues: false,
    })
  })

  it('mantém Admin e Financeiro na tela comercial sem permitir confirmar o envio', () => {
    expect(resolvePjOrderAccess({ role: 'admin', store: null })).toEqual({
      mode: 'commercial',
      canManage: true,
      canDispatch: false,
      showCommercialValues: true,
    })
    expect(resolvePjOrderAccess({ role: 'financeiro', store: null })).toEqual({
      mode: 'commercial',
      canManage: true,
      canDispatch: false,
      showCommercialValues: true,
    })
  })

  it('não transforma outra loja ou outro perfil em Expedição da JC', () => {
    expect(resolvePjOrderAccess({ role: 'expedicao', store: 'ex' }).mode).toBe('blocked')
    expect(resolvePjOrderAccess({ role: 'vendas', store: 'jc' }).mode).toBe('blocked')
  })
})
