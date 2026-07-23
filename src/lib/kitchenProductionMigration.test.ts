import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260723003035_producao_cozinha.sql'),
  'utf8',
).replace(/\r\n/g, '\n')

describe('catálogo inicial da Produção da Cozinha', () => {
  it('classifica os 20 produtos reais aprovados', () => {
    const kitchenProductsSql = migration.match(
      /AND "name" IN \(\n([\s\S]*?)\n   \);/,
    )?.[1]

    expect(kitchenProductsSql).toBeDefined()

    const kitchenProducts = Array.from(
      kitchenProductsSql?.matchAll(/'([^']+)'/g) ?? [],
      match => match[1],
    )

    expect(kitchenProducts).toEqual([
      'Bruschetta Brie',
      'Bruschetta de Alcachofra',
      'Bruschetta Gorgonzola',
      'Bruschetta Parma',
      'Pastinha de Azeitona',
      'Pastinha de Frango',
      'Pastinha de Manjericão',
      'Pastinha de Tomate-Seco',
      'Pesto Rosso',
      'Pesto Verde',
      'Pizza Redonda de Calabresa',
      'Pizza Redonda de Portuguesa',
      'Pizza Redonda de Queijo e Cebola',
      'Pizza Redonda Margherita',
      'Pizza Romana de Calabresa',
      'Pizza Romana de Carne e Azeitona',
      'Pizza Romana de Carne e Cebola Caramelizada',
      'Pizza Romana de Carne e Coalho',
      'Pizza Romana de Gorgonzola',
      'Pizza Romana de Parma',
    ])
  })
})
