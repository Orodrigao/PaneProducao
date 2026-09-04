'use client'

import { useMemo, useState } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import {
  calculateUsableQuantity,
  conversionFactorFromUsableQuantity,
  conversionNeedsConfirmation,
  formatConversionExplanation,
  getConversionUnitWarning,
  initialSearchFromDescription,
  matchesProductSearch,
  suggestConversionFactor,
  type NfeConversionBasis,
  type NfeItemDraft,
} from '@/lib/nfeXml'
import type { PayableProduct } from '@/lib/payables'

const MAX_RESULTS = 8

export function ProductSelector({
  item,
  products,
  onChange,
  onCreate,
  onWithoutProduct,
}: {
  item: NfeItemDraft
  products: PayableProduct[]
  onChange: (productId: string) => void
  onCreate: () => void
  onWithoutProduct: () => void
}) {
  const [query, setQuery] = useState(() => initialSearchFromDescription(item.description))
  const selected = products.find(product => product.id === item.baseProductId)

  const results = useMemo(
    () => (query.trim() ? products.filter(product => matchesProductSearch(product.name, query)).slice(0, MAX_RESULTS) : []),
    [products, query],
  )
  const total = useMemo(
    () => (query.trim() ? products.filter(product => matchesProductSearch(product.name, query)).length : 0),
    [products, query],
  )

  if (item.mappingStatus === 'nao_aplicavel') {
    return (
      <div className="ps-fieldgroup">
        <div className="ps-fieldlabel">Classificação do item</div>
        <div className="ps-card" style={{ padding: 10, borderColor: 'var(--teal-border)', background: 'var(--teal-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={16} color="var(--teal)" aria-hidden />
          <div style={{ flex: 1 }}>
            <b>Uso ou despesa — não entra em receita</b>
            <small style={{ display: 'block', marginTop: 3 }}>O nome, a marca, o fornecedor e o preço da NF-e continuam guardados. O sistema lembrará desta decisão na próxima nota.</small>
          </div>
          <button className="ps-btn ghost sm" onClick={() => onChange('')}>Trocar</button>
        </div>
      </div>
    )
  }

  if (selected) {
    return (
      <div className="ps-fieldgroup">
        <div className="ps-fieldlabel">Item-base da receita</div>
        <div
          className="ps-card"
          style={{ padding: 10, borderColor: 'var(--teal-border)', background: 'var(--teal-bg)', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Check size={16} color="var(--teal)" aria-hidden />
          <b style={{ flex: 1 }}>{selected.name}{selected.unit ? ` · ${selected.unit}` : ''}</b>
          <button className="ps-btn ghost sm" onClick={() => onChange('')}>Trocar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ps-fieldgroup">
      <div className="ps-fieldlabel">Como este item deve ser tratado?</div>
      <div
        role="alert"
        className="ps-card"
        style={{ padding: 10, borderColor: 'var(--red-border)', background: 'var(--red-bg)', marginBottom: 8 }}
      >
        <b style={{ color: 'var(--red)' }}>Item ainda não classificado</b>
        <small style={{ display: 'block', marginTop: 3 }}>
          Escolha um dos três caminhos abaixo: vincular ao cadastro, cadastrar um produto novo da padaria ou marcar o que é apenas uso ou despesa.
        </small>
      </div>
      {/* Em 03/09/2026, duas cartelas de queijo para revenda foram marcadas
          como despesa porque o cadastro de item novo estava escondido depois
          da busca. As três saídas precisam permanecer visíveis e equivalentes. */}
      <div className="ps-fieldgroup">
        <div className="ps-fieldlabel">1. Insumo de receita já cadastrado</div>
        <small className="ps-help">Procure e vincule ao item que a padaria já usa.</small>
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} aria-hidden />
          <input
            className="ps-input"
            style={{ paddingLeft: 30 }}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Procure pelo nome do insumo"
            aria-label={`Procurar item-base para ${item.description}`}
          />
          {query && (
            <button
              className="ps-iconbtn"
              style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
              onClick={() => setQuery('')}
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {!query.trim() && products.length > 0 && <small className="ps-help">Digite parte do nome. Ex.: &quot;acucar&quot; acha &quot;AÇÚCAR INSUMO PRODUÇÃO&quot;.</small>}

      <div className="ps-fieldrow" style={{ marginTop: 8 }}>
        <div className="ps-fieldgroup" style={{ flexBasis: 220 }}>
          <div className="ps-fieldlabel">2. Produto novo da padaria</div>
          <small className="ps-help">Para um insumo novo ou uma mercadoria de revenda.</small>
          <button className="ps-btn ghost sm block" onClick={onCreate}><Plus size={14} /> Cadastrar item novo</button>
        </div>
        <div className="ps-fieldgroup" style={{ flexBasis: 220 }}>
          <div className="ps-fieldlabel">3. Uso ou despesa</div>
          <small className="ps-help">Para limpeza, manutenção, escritório ou material de uso. Esta decisão fica memorizada para este fornecedor.</small>
          <button className="ps-btn ghost sm block" onClick={onWithoutProduct}>Marcar como uso ou despesa</button>
        </div>
      </div>

      {/* A busca pode achar um parente sem ser o item certo: "CREME" acha o
          creme de bolo quando se procura o de confeiteiro. Por isso, o cadastro
          continua disponível no bloco 2 mesmo quando há resultados e reaparece
          no ponto de decisão quando nada é encontrado. */}
      {query.trim() && results.length > 0 && (
        <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
          <small className="ps-help">Itens encontrados para vincular:</small>
          {results.map(product => (
            <button key={product.id} className="ps-btn ghost sm" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => onChange(product.id)}>
              {product.name}{product.unit ? ` · ${product.unit}` : ''}
            </button>
          ))}
          {total > results.length && <small className="ps-help">Mais {total - results.length} resultado(s). Escreva mais para estreitar.</small>}
          {/* A busca pode achar parente sem ser o certo: "CREME" acha o creme de
              bolo quando se procura o de confeiteiro. Quem chegou ate aqui e nao
              reconheceu nenhum resultado precisa da saida de cadastro no proprio
              lugar onde desistiu, e nao la em cima. O smoke de navegador cobre
              este caso e reprovou quando o bloco foi removido, em 03/09/2026. */}
          <small className="ps-help" style={{ marginTop: 4 }}>Nenhum desses serve?</small>
          <button className="ps-btn ghost sm" style={{ alignSelf: 'start' }} onClick={onCreate}><Plus size={14} /> Cadastrar item novo</button>
        </div>
      )}

      {products.length === 0 && (
        <small className="ps-help">Carregando o cadastro de insumos...</small>
      )}

      {query.trim() && products.length > 0 && results.length === 0 && (
        <div className="ps-banner" style={{ marginTop: 8 }}>
          <b>Nenhum insumo com esse nome</b>
          <small style={{ display: 'block', marginTop: 3 }}>
            Tente outra palavra antes de criar. Só cadastre item novo se tiver certeza de que a padaria não usa nada parecido.
          </small>
          <button className="ps-btn ghost sm" style={{ marginTop: 8 }} onClick={onCreate}><Plus size={14} /> Cadastrar item novo</button>
        </div>
      )}
    </div>
  )
}

export function ConversionEditor({ item, onChange }: { item: NfeItemDraft; onChange: (next: NfeItemDraft) => void }) {
  const suggestion = useMemo(
    () => (item.baseUnit ? suggestConversionFactor(item.description, item.baseUnit) : null),
    [item.description, item.baseUnit],
  )
  const needsAttention = conversionNeedsAttention(item)
  const [open, setOpen] = useState(needsAttention)

  if (item.mappingStatus === 'nao_aplicavel') return <small style={{ color: 'var(--teal)' }}>Resolvido sem item-base: esta compra não altera custo de receita.</small>
  if (!item.baseProductId) return <small style={{ color: 'var(--honey-deep)' }}>Classifique o item para liberar o custo normalizado.</small>

  const explanation = formatConversionExplanation(item)
  const basis = item.conversionBasis
  const factor = item.conversionFactor ?? 1
  const usable = item.usableQuantity ?? calculateUsableQuantity(item.quantity, factor)
  const unitWarning = getConversionUnitWarning(item.purchaseUnit, item.baseUnit ?? '', factor)

  function updateFactor(value: number) {
    const safe = value > 0 ? value : 0
    onChange({ ...item, conversionFactor: safe, usableQuantity: calculateUsableQuantity(item.quantity, safe), factorConfirmed: true })
  }

  function updateUsable(value: number) {
    const safe = value > 0 ? value : 0
    onChange({ ...item, usableQuantity: safe, conversionFactor: conversionFactorFromUsableQuantity(item.quantity, safe), factorConfirmed: true })
  }

  return (
    <div style={{ marginTop: 8 }}>
      {needsAttention && (
        <div role="alert" className="ps-card" style={{ padding: 10, borderColor: 'var(--red-border)', background: 'var(--red-bg)', marginBottom: 8 }}>
          <b style={{ color: 'var(--red)' }}>Confira quanto vem na embalagem</b>
          <small style={{ display: 'block', marginTop: 3 }}>
            A NF-e cobra em {item.purchaseUnit} e a receita usa {item.baseUnit}. Sem o fator certo, um saco inteiro entra como se fosse uma unidade.
          </small>
        </div>
      )}
      {suggestion && !item.factorConfirmed && (
        <div className="ps-banner honey" style={{ marginBottom: 8 }}>
          <b>A nota diz &quot;{suggestion.evidence}&quot;</b>
          <small style={{ display: 'block', marginTop: 3 }}>
            Sugestão: cada {item.purchaseUnit} vale {suggestion.factor} {item.baseUnit}. Confira e aplique, ou digite outro valor abaixo.
          </small>
          <button className="ps-btn primary sm" style={{ marginTop: 8 }} onClick={() => updateFactor(suggestion.factor)}>
            <Check size={14} /> Usar {suggestion.factor} {item.baseUnit}
          </button>
        </div>
      )}
      <button className="ps-btn ghost sm" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? 'Fechar fator de conversão' : 'Fator de conversão'}</button>
      {open && (
        <div className="ps-banner honey" style={{ marginTop: 8 }}>
          <div className="ps-fieldgroup"><div className="ps-fieldlabel">Como este item entra na receita?</div><select className="ps-select" value={basis} onChange={event => onChange({ ...item, conversionBasis: event.target.value as NfeConversionBasis })}><option value="simple">A quantidade da NF já é a quantidade útil</option><option value="package">Cada unidade comprada contém quantas unidades úteis?</option><option value="usable">Informar o total aproveitável (ex.: peso drenado)</option></select></div>
          {basis === 'usable' ? (
            <div className="ps-fieldgroup" style={{ marginTop: 8 }}><div className="ps-fieldlabel">Quantidade aproveitável total ({item.baseUnit})</div><input className="ps-input" type="number" min="0" step="0.001" value={usable || ''} onChange={event => updateUsable(Number(event.target.value))} /></div>
          ) : (
            <div className="ps-fieldgroup" style={{ marginTop: 8 }}><div className="ps-fieldlabel">Fator por unidade comprada ({item.baseUnit})</div><input className="ps-input" type="number" min="0" step="0.001" value={factor || ''} onChange={event => updateFactor(Number(event.target.value))} /></div>
          )}
          {unitWarning && <div role="alert" className="ps-card" style={{ marginTop: 8, borderColor: 'var(--berry)', background: 'var(--berry-tint)' }}><b>Confira o fator antes de continuar</b><small style={{ display: 'block', marginTop: 4 }}>{unitWarning}</small></div>}
          <div style={{ marginTop: 10 }}><b>Conferência do cálculo</b><small style={{ display: 'block', marginTop: 4 }}>{explanation.input}</small><small style={{ display: 'block' }}>{explanation.operation}</small><small style={{ display: 'block' }}>{explanation.output}</small><small style={{ display: 'block', marginTop: 4 }}><b>{explanation.cost}</b></small></div>
        </div>
      )}
    </div>
  )
}

/**
 * Item classificado cuja unidade de compra é de outra família que a da receita
 * (caixa contra quilo, por exemplo) não pode passar com o fator 1 automático:
 * foi assim que farinha em saco de 25 kg virou R$ 74,00 o quilo.
 */
export function conversionNeedsAttention(item: NfeItemDraft): boolean {
  if (!item.baseProductId || !item.baseUnit) return false
  return conversionNeedsConfirmation(item.purchaseUnit, item.baseUnit, item.factorConfirmed)
}
