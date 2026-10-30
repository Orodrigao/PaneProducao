'use client'

import { useEffect, useState } from 'react'
import { Check, Plus, Save, X } from 'lucide-react'
import {
  calculateUsableQuantity,
  conversionFactorFromUsableQuantity,
  conversionNeedsConfirmation,
  type NfeConversionBasis,
  type NfeNonCatalogKind,
} from '@/lib/nfeXml'
import {
  catalogProductToPreselect,
  classifyPayableItem,
  classifyPayableItemWithoutProduct,
  createPayableCatalogProduct,
  describeCatalogCreateFailure,
  formatBRL,
  getPayableErrorMessage,
  type PayableProduct,
  type PendingPayableItemRow,
} from '@/lib/payables'
import { showToast } from '@/lib/utils'
import { loadProductCategories, payableCatalogCategoryOptions, type ProductCategory } from '@/lib/productCategories'

interface PendingPayableItemsProps {
  items: PendingPayableItemRow[]
  products: PayableProduct[]
  onChanged: () => Promise<void> | void
  onClose: () => void
}

export default function PendingPayableItems({ items, products, onChanged, onClose }: PendingPayableItemsProps) {
  const [values, setValues] = useState<Record<string, { productId: string; basis: NfeConversionBasis; factor: string; usable: string; remember: boolean; factorConfirmed: boolean }>>(() => Object.fromEntries(items.map(item => [item.id, {
    productId: '', basis: item.conversion_basis ?? 'simple', factor: '1', usable: String(Number(item.source_quantity ?? item.quantity) || 1), remember: true, factorConfirmed: false,
  }])))
  const [busy, setBusy] = useState<string | null>(null)
  const [createdProducts, setCreatedProducts] = useState<PayableProduct[]>([])
  const [creatingItemId, setCreatingItemId] = useState<string | null>(null)
  const [newProduct, setNewProduct] = useState({ name: '', category: '', unit: 'un' })
  const [duplicateNotice, setDuplicateNotice] = useState<{ itemId: string; name: string; message: string; matches: number } | null>(null)
  const [catalogCategories, setCatalogCategories] = useState<ProductCategory[]>([])
  const [categoryLoadError, setCategoryLoadError] = useState(false)
  const catalog = [...products, ...createdProducts.filter(extra => !products.some(known => known.id === extra.id))]

  useEffect(() => {
    let cancelled = false
    void loadProductCategories().then(categories => {
      if (!cancelled) setCatalogCategories(payableCatalogCategoryOptions(categories))
    }).catch(error => {
      console.error(error)
      if (!cancelled) setCategoryLoadError(true)
    })
    return () => { cancelled = true }
  }, [])

  function update(itemId: string, patch: Partial<(typeof values)[string]>) {
    setValues(previous => ({ ...previous, [itemId]: { ...previous[itemId], ...patch } }))
  }

  async function save(item: PendingPayableItemRow) {
    const value = values[item.id]
    const product = catalog.find(candidate => candidate.id === value.productId)
    const factor = Number(value.factor)
    const usable = Number(value.usable)
    if (!product || factor <= 0 || usable <= 0) { showToast('Escolha o item-base e confirme a conversão.'); return }
    if (conversionNeedsConfirmation(item.source_unit ?? item.unit, product.unit ?? 'un', value.factorConfirmed)) {
      showToast('Confira quanto vem na embalagem antes de confirmar.'); return
    }
    setBusy(item.id)
    try {
      await classifyPayableItem(item.id, product.id, value.basis, factor, usable, value.remember, value.factorConfirmed)
      // Nota mais antiga que a última do mesmo insumo não troca o custo (fase 3A).
      showToast('Item classificado. O custo do insumo segue a NF-e mais recente.')
      await onChanged()
    } catch (error) { showToast(getPayableErrorMessage(error, 'Não foi possível classificar o item.')) }
    finally { setBusy(null) }
  }

  function openProductForm(item: PendingPayableItemRow) {
    setDuplicateNotice(previous => previous?.itemId === item.id ? null : previous)
    setNewProduct({ name: item.source_description ?? item.item_name, category: catalogCategories.find(category => category.name === 'Insumos')?.name ?? '', unit: 'un' })
    setCreatingItemId(item.id)
  }

  async function saveNewProduct(item: PendingPayableItemRow) {
    if (!newProduct.name.trim() || !newProduct.unit.trim()) { showToast('Informe nome e unidade do item novo.'); return }
    if (!catalogCategories.some(category => category.name === newProduct.category)) { showToast('Escolha uma categoria da lista.'); return }
    setBusy(item.id)
    try {
      const id = await createPayableCatalogProduct(newProduct.name, newProduct.category, newProduct.unit)
      const product: PayableProduct = { id, name: newProduct.name.trim(), category: newProduct.category, unit: newProduct.unit.trim() }
      setCreatedProducts(previous => [...previous, product])
      update(item.id, { productId: id, factorConfirmed: false })
      setCreatingItemId(null)
      showToast('Item criado e selecionado. Confira a conversão e confirme a classificação.')
    } catch (error) {
      const failure = describeCatalogCreateFailure(error, newProduct.name, catalog)
      const duplicateName = failure.duplicateName
      if (duplicateName) {
        // Esta tela escolhe pela lista, sem busca: com um único cadastro de
        // mesmo nome, a escolha 1 já abre nele e a pessoa confere a conversão
        // antes de vincular.
        const preselected = catalogProductToPreselect(failure)
        if (preselected) update(item.id, { productId: preselected.id, factorConfirmed: false })
        setDuplicateNotice({ itemId: item.id, name: duplicateName, message: failure.message, matches: failure.existingProducts.length })
        setCreatingItemId(null)
      } else {
        showToast(failure.message)
      }
    }
    finally { setBusy(null) }
  }

  async function saveWithoutProduct(item: PendingPayableItemRow, kind: NfeNonCatalogKind) {
    const value = values[item.id]
    const question = kind === 'revenda'
      ? 'Confirmar como revenda sem cadastro? O item entra no financeiro como mercadoria, sem criar produto, sem alterar custo de receita e fora da contagem semanal.'
      : 'Confirmar como uso ou despesa? O item continuará na NF-e, mas não alterará nenhum custo de receita.'
    if (!window.confirm(question)) return
    setBusy(item.id)
    try {
      await classifyPayableItemWithoutProduct(item.id, value.remember, kind)
      showToast(kind === 'revenda'
        ? 'Item registrado como revenda sem cadastro, sem alterar custo de receita.'
        : 'Item registrado como uso ou despesa, sem alterar custo de receita.')
      await onChanged()
    } catch (error) { showToast(getPayableErrorMessage(error, 'Não foi possível classificar o item.')) }
    finally { setBusy(null) }
  }

  return (
    <div className="ps-banner honey" style={{ marginTop: 10 }}>
      <div className="ps-card-head"><b>Itens aguardando classificação</b><button className="ps-iconbtn" onClick={onClose} aria-label="Fechar classificação"><X size={15} /></button></div>
      {items.map(item => {
        const value = values[item.id]
        const quantity = Number(item.source_quantity ?? item.quantity)
        const factor = Number(value.factor) || 0
        const usable = Number(value.usable) || 0
        const calculated = value.basis === 'usable' ? conversionFactorFromUsableQuantity(quantity, usable) : calculateUsableQuantity(quantity, factor)
        const product = catalog.find(candidate => candidate.id === value.productId)
        const needsConfirmation = Boolean(product && conversionNeedsConfirmation(item.source_unit ?? item.unit, product.unit ?? 'un', value.factorConfirmed))
        return (
          <div key={item.id} className="ps-card" style={{ padding: 10, marginTop: 8, background: 'var(--cream-raise)' }}>
            <b>{item.source_description ?? item.item_name}</b>
            <small style={{ display: 'block', marginTop: 3 }}>{quantity} {item.source_unit ?? item.unit} · {item.source_product_code ?? 'sem código'} · {formatBRL(item.acquisition_value ?? item.line_total)}{item.acquisition_value != null && Number(item.acquisition_value) !== Number(item.line_total) ? ' com impostos e despesas' : ''}</small>
            <div role="alert" className="ps-card" style={{ padding: 10, borderColor: 'var(--red-border)', background: 'var(--red-bg)' }}>
              <b style={{ color: 'var(--red)' }}>Item ainda não classificado</b>
              <small>Escolha um dos quatro caminhos: vincular a um produto já cadastrado (insumo ou revenda), cadastrar um produto novo da padaria, marcar o que é apenas uso ou despesa ou lançar mercadoria de revenda sem cadastro.</small>
            </div>
            <div className="ps-fieldgroup" style={{ marginTop: 8 }}>
              <div className="ps-fieldlabel">1. Produto já cadastrado (insumo ou revenda)</div>
              <small className="ps-help">Selecione o item que a padaria já usa.</small>
              <select className="ps-select" value={value.productId} onChange={event => { update(item.id, { productId: event.target.value, factorConfirmed: false }); if (duplicateNotice?.itemId === item.id) setDuplicateNotice(null) }}>
                <option value="">Selecione</option>
                {catalog.map(product => <option key={product.id} value={product.id}>{product.name} · {product.unit ?? 'un'}</option>)}
              </select>
              {duplicateNotice?.itemId === item.id && (
                <div role="alert" className="ps-card" style={{ padding: 10, borderColor: 'var(--red-border)', background: 'var(--red-bg)', marginTop: 4 }}>
                  <b style={{ color: 'var(--red)' }}>{duplicateNotice.message}</b>
                  <small style={{ display: 'block', marginTop: 3 }}>
                    {duplicateNotice.matches === 1
                      ? `O cadastro "${duplicateNotice.name}" já ficou escolhido acima. Confira a conversão e vincule.`
                      : duplicateNotice.matches > 1
                        ? `Há ${duplicateNotice.matches} cadastros com o nome "${duplicateNotice.name}" na lista acima. Escolha o certo, confira a conversão e vincule.`
                        : `O cadastro "${duplicateNotice.name}" não aparece nesta lista, que mostra só insumos e mercadorias de revenda. Confira esse cadastro em Produtos antes de continuar.`}
                  </small>
                </div>
              )}
            </div>

            <label className="ps-checkrow" style={{ marginTop: 6 }}><input type="checkbox" checked={value.remember} onChange={event => update(item.id, { remember: event.target.checked })} /><span>Lembrar o vínculo, o uso/despesa ou a revenda sem cadastro para este fornecedor</span></label>

            {/* Em 03/09/2026, duas cartelas de queijo para revenda foram
                marcadas como despesa porque esta tela não mostrava o cadastro
                de produto novo. As saídas devem continuar lado a lado; a
                quarta (revenda sem cadastro) veio em 28/10/2026. */}
            <div className="ps-fieldrow" style={{ marginTop: 8 }}>
              <div className="ps-fieldgroup" style={{ flexBasis: 220 }}>
                <div className="ps-fieldlabel">2. Produto novo da padaria</div>
                <small className="ps-help">Para um insumo novo ou uma mercadoria de revenda.</small>
                <button className="ps-btn ghost sm block" disabled={busy === item.id} onClick={() => openProductForm(item)}><Plus size={14} /> Cadastrar item novo</button>
              </div>
              <div className="ps-fieldgroup" style={{ flexBasis: 220 }}>
                <div className="ps-fieldlabel">3. Uso ou despesa</div>
                <small className="ps-help">Para o que não entra em receita nem vira produto. Com a opção de lembrar marcada, esta escolha volta na próxima nota deste fornecedor.</small>
                <button className="ps-btn ghost sm block" disabled={busy === item.id} onClick={() => void saveWithoutProduct(item, 'uso_despesa')}>Marcar como uso ou despesa</button>
              </div>
              <div className="ps-fieldgroup" style={{ flexBasis: 220 }}>
                <div className="ps-fieldlabel">4. Revenda sem cadastro</div>
                <small className="ps-help">Mercadoria para revender sem criar produto: entra no financeiro como mercadoria, sem custo de receita e fora da contagem. Mostra quanto se gastou, mas não controla estoque nem margem; para isso, use a escolha 2.</small>
                <button className="ps-btn ghost sm block" disabled={busy === item.id} onClick={() => void saveWithoutProduct(item, 'revenda')}>Lançar como revenda sem cadastro</button>
              </div>
            </div>

            {creatingItemId === item.id && (
              <div className="ps-banner" style={{ marginTop: 8 }}>
                <b>Cadastro rápido do produto</b>
                <small style={{ display: 'block' }}>Depois de criar, confira a conversão e vincule o item.</small>
                <div className="ps-fieldgroup" style={{ width: '100%' }}>
                  <div className="ps-fieldlabel">Nome do novo item</div>
                  <input className="ps-input" value={newProduct.name} onChange={event => setNewProduct(previous => ({ ...previous, name: event.target.value }))} />
                </div>
                <div className="ps-fieldrow" style={{ width: '100%' }}>
                  <div className="ps-fieldgroup"><div className="ps-fieldlabel">Categoria</div><select className="ps-select" value={newProduct.category} onChange={event => setNewProduct(previous => ({ ...previous, category: event.target.value }))} disabled={catalogCategories.length === 0}><option value="">Escolha a categoria</option>{catalogCategories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}</select>{categoryLoadError && <small role="alert">Não foi possível carregar as categorias. Reabra esta tela.</small>}</div>
                  <div className="ps-fieldgroup"><div className="ps-fieldlabel">Unidade da receita</div><input className="ps-input" value={newProduct.unit} onChange={event => setNewProduct(previous => ({ ...previous, unit: event.target.value }))} /></div>
                </div>
                <div style={{ width: '100%' }}><button className="ps-btn primary sm" disabled={busy === item.id} onClick={() => void saveNewProduct(item)}><Save size={14} /> {busy === item.id ? 'Salvando...' : 'Criar e selecionar'}</button> <button className="ps-btn ghost sm" disabled={busy === item.id} onClick={() => setCreatingItemId(null)}>Cancelar</button></div>
              </div>
            )}

            <small className="ps-help" style={{ marginTop: 8 }}>Se escolheu um item do cadastro, confira abaixo como a quantidade comprada entra na receita.</small>
            <div className="ps-fieldrow" style={{ marginTop: 8 }}>
              <div className="ps-fieldgroup"><div className="ps-fieldlabel">Base do cálculo</div><select className="ps-select" value={value.basis} onChange={event => update(item.id, { basis: event.target.value as NfeConversionBasis, factorConfirmed: false })}><option value="simple">Quantidade da NF</option><option value="package">Conteúdo por unidade</option><option value="usable">Total aproveitável</option></select></div>
              <div className="ps-fieldgroup"><div className="ps-fieldlabel">{value.basis === 'usable' ? 'Total útil' : 'Fator'}</div><input className="ps-input" type="number" min="0" step="0.001" value={value.basis === 'usable' ? value.usable : value.factor} onChange={event => value.basis === 'usable' ? update(item.id, { usable: event.target.value, factor: String(conversionFactorFromUsableQuantity(quantity, Number(event.target.value))), factorConfirmed: true }) : update(item.id, { factor: event.target.value, usable: String(calculateUsableQuantity(quantity, Number(event.target.value))), factorConfirmed: true })} /></div>
            </div>
            {needsConfirmation && <div role="alert" className="ps-card" style={{ marginTop: 8, borderColor: 'var(--red-border)', background: 'var(--red-bg)' }}><b style={{ color: 'var(--red)' }}>Confira quanto vem na embalagem</b><small style={{ display: 'block', marginTop: 3 }}>A NF-e cobra em {item.source_unit ?? item.unit} e a receita usa {product?.unit ?? 'un'}. Digite o fator, mesmo quando o valor correto for 1.</small></div>}
            <small style={{ display: 'block', marginTop: 6 }}>{quantity} × {value.basis === 'usable' ? calculated : factor} = {value.basis === 'usable' ? usable : calculated} unidade(s) úteis</small>
            <button className="ps-btn primary sm block" disabled={busy === item.id} onClick={() => void save(item)}><Check size={14} /> {busy === item.id ? 'Salvando...' : 'Vincular ao item selecionado'}</button>
          </div>
        )
      })}
    </div>
  )
}
