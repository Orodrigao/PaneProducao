'use client'

import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import { formatBRL, PAYABLE_MAX_CATEGORIES, type PayableCategorySlice } from '@/lib/payables'
import { parseMoneyInput } from '@/lib/cashClosing'
import type { FinanceAccountRow, FinanceCategoryRow } from '@/lib/finance'
import type { PayableActualPaymentMethod } from '@/lib/payables'

interface PayableCategoryPickerProps {
  categories: readonly FinanceCategoryRow[]
  accounts: readonly FinanceAccountRow[]
  slices: PayableCategorySlice[]
  accountKey: string
  total: number
  disabled?: boolean
  paymentMethod?: PayableActualPaymentMethod
  onChangeSlices: (slices: PayableCategorySlice[]) => void
  onChangeAccount: (accountKey: string) => void
}

const GROUP_LABELS: Record<string, string> = {
  receita: 'Entradas',
  cmv: 'Mercadoria (CMV)',
  mao_de_obra: 'Gente',
  ocupacao: 'Ocupação',
  impostos: 'Impostos',
  taxas: 'Taxas',
  manutencao: 'Manutenção',
  servicos: 'Serviços',
  financeiras: 'Financeiras',
  outras: 'Outras',
  emprestimos: 'Empréstimos',
  investimento: 'Investimento',
  retiradas: 'Retiradas',
}

export default function PayableCategoryPicker({
  categories,
  accounts,
  slices,
  accountKey,
  total,
  disabled = false,
  paymentMethod,
  onChangeSlices,
  onChangeAccount,
}: PayableCategoryPickerProps) {
  const grouped = useMemo(() => {
    const groups = new Map<string, FinanceCategoryRow[]>()
    for (const category of categories) {
      if (category.nature !== 'despesa') continue
      const list = groups.get(category.dre_group) ?? []
      list.push(category)
      groups.set(category.dre_group, list)
    }
    return [...groups.entries()]
  }, [categories])

  // Aceita o jeito que a pessoa escreve dinheiro aqui: "1.234,56".
  const soma = slices.reduce((acumulado, slice) => acumulado + parseMoneyInput(slice.amount), 0)
  const dividido = slices.length > 1
  const falta = Math.round((total - soma) * 100) / 100

  function update(index: number, patch: Partial<PayableCategorySlice>) {
    onChangeSlices(slices.map((slice, posicao) => (posicao === index ? { ...slice, ...patch } : slice)))
  }

  function dividir() {
    if (slices.length >= PAYABLE_MAX_CATEGORIES) return
    onChangeSlices([...slices, { categoryKey: '', amount: '' }])
  }

  function remover(index: number) {
    const restantes = slices.filter((_, posicao) => posicao !== index)
    // Voltando a uma categoria só, ela leva o total da conta.
    onChangeSlices(restantes.length === 1
      ? [{ ...restantes[0], amount: total.toFixed(2) }]
      : restantes)
  }

  const availableAccounts = accounts.filter(account => paymentMethod === 'cartao'
    ? account.kind === 'cartao_credito' : account.kind !== 'cartao_credito')
  return (
    <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
      <span className="ps-fieldlabel">Categoria do DRE *</span>

      {slices.map((slice, index) => (
        <div key={index} className="ps-fieldrow" style={{ marginTop: index === 0 ? 4 : 8 }}>
          <div className="ps-fieldgroup">
            <select
              className="ps-select"
              aria-label={dividido ? `Categoria ${index + 1}` : 'Categoria'}
              value={slice.categoryKey}
              disabled={disabled}
              onChange={event => update(index, { categoryKey: event.target.value })}
            >
              <option value="">Escolha a categoria</option>
              {grouped.map(([group, items]) => (
                <optgroup key={group} label={GROUP_LABELS[group] ?? group}>
                  {items.map(category => (
                    <option key={category.key} value={category.key}>{category.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {dividido && (
            <div className="ps-fieldgroup" style={{ maxWidth: 150 }}>
              <input
                className="ps-input"
                inputMode="decimal"
                aria-label={`Valor da categoria ${index + 1}`}
                placeholder="0,00"
                value={slice.amount}
                disabled={disabled}
                onChange={event => update(index, { amount: event.target.value })}
              />
            </div>
          )}
          {dividido && (
            <button
              type="button"
              className="ps-iconbtn"
              onClick={() => remover(index)}
              disabled={disabled}
              aria-label={`Remover categoria ${index + 1}`}
            >
              <X size={15} />
            </button>
          )}
        </div>
      ))}

      {dividido && (
        <small style={{ display: 'block', marginTop: 6, color: falta === 0 ? 'inherit' : 'var(--berry)' }}>
          {falta === 0
            ? `Dividido: ${formatBRL(soma)} de ${formatBRL(total)}.`
            : falta > 0
              ? `Faltam ${formatBRL(falta)} para fechar os ${formatBRL(total)} da conta.`
              : `Passou ${formatBRL(-falta)} do total da conta.`}
        </small>
      )}

      {slices.length < PAYABLE_MAX_CATEGORIES && (
        <button
          type="button"
          className="ps-btn ghost"
          style={{ marginTop: 8 }}
          onClick={dividir}
          disabled={disabled}
        >
          <Plus size={15} /> Dividir entre categorias
        </button>
      )}

      <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
        <label className="ps-fieldlabel" htmlFor="payable-finance-account">Saiu de qual conta</label>
        <select
          id="payable-finance-account"
          className="ps-select"
          value={accountKey}
          disabled={disabled}
          onChange={event => onChangeAccount(event.target.value)}
        >
          <option value="">Não informar</option>
          {availableAccounts.map(account => (
            <option key={account.key} value={account.key}>{account.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
