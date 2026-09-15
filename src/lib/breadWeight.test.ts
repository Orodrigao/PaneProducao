import { describe, expect, it } from 'vitest'
import { parseBreadWeightKg } from './breadWeight'

describe('parseBreadWeightKg', () => {
  it('aceita peso positivo com até três casas decimais', () => {
    expect(parseBreadWeightKg('0.5')).toBe(0.5)
    expect(parseBreadWeightKg('0,35')).toBe(0.35)
    expect(parseBreadWeightKg(' 1.234 ')).toBe(1.234)
  })

  it('rejeita vazio, zero, negativo e texto', () => {
    expect(parseBreadWeightKg('')).toBeNull()
    expect(parseBreadWeightKg('   ')).toBeNull()
    expect(parseBreadWeightKg('0')).toBeNull()
    expect(parseBreadWeightKg('-0.2')).toBeNull()
    expect(parseBreadWeightKg('abc')).toBeNull()
  })

  it('rejeita mais de três casas decimais e valor absurdo', () => {
    expect(parseBreadWeightKg('0.1234')).toBeNull()
    expect(parseBreadWeightKg('51')).toBeNull()
  })
})
