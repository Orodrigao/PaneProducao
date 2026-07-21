import { describe, expect, it } from 'vitest'
import { createProductIdentityResolver, productIdentityKey } from './productIdentity'

describe('productIdentity', () => {
  it('monta a chave de identidade como source:id', () => {
    expect(productIdentityKey('bread', 'italiano-legado')).toBe('bread:italiano-legado')
    expect(productIdentityKey('product', 'uuid-1')).toBe('product:uuid-1')
  })

  it('resolve o vínculo nas duas direções, com a identidade própria primeiro', () => {
    const resolver = createProductIdentityResolver([
      { productId: 'uuid-bbrasil', legacyBreadId: 'b-brasil-legado' },
    ])

    expect(resolver.keysFor('bread', 'b-brasil-legado')).toEqual([
      'bread:b-brasil-legado',
      'product:uuid-bbrasil',
    ])
    expect(resolver.keysFor('product', 'uuid-bbrasil')).toEqual([
      'product:uuid-bbrasil',
      'bread:b-brasil-legado',
    ])
  })

  it('produto sem vínculo mantém somente a própria chave', () => {
    const resolver = createProductIdentityResolver([
      { productId: 'uuid-baguete-francesa', legacyBreadId: null },
    ])

    expect(resolver.keysFor('product', 'uuid-baguete-francesa')).toEqual(['product:uuid-baguete-francesa'])
    expect(resolver.keysFor('bread', 'baguete-legado')).toEqual(['bread:baguete-legado'])
  })

  it('fontes fora do vínculo (ex.: extra) ficam só com a própria chave', () => {
    const resolver = createProductIdentityResolver([
      { productId: 'uuid-1', legacyBreadId: 'pao-legado' },
    ])

    expect(resolver.keysFor('extra', 'extra_123')).toEqual(['extra:extra_123'])
  })

  it('vários produtos unificados apontando para o mesmo pão são todos equivalentes', () => {
    const resolver = createProductIdentityResolver([
      { productId: 'uuid-a', legacyBreadId: 'pao-legado' },
      { productId: 'uuid-b', legacyBreadId: 'pao-legado' },
    ])

    expect(resolver.keysFor('bread', 'pao-legado')).toEqual([
      'bread:pao-legado',
      'product:uuid-a',
      'product:uuid-b',
    ])
  })
})
