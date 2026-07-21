'use client'

import type { CSSProperties } from 'react'
import { AlertTriangle, CalendarDays, ChevronRight, Clock3, History, Search, X } from 'lucide-react'
import { organizePjOrders, type PjOrderListItem, type PjOrderListSection } from '@/lib/pjOrderList'

export interface PjOrderListDisplayItem extends PjOrderListItem {
  itemCount: number
  total: number
  statusLabel: string
  statusClass: string
  statusBorder: string
}

interface PjOrderListPanelProps {
  orders: PjOrderListDisplayItem[]
  today: string
  search: string
  onSearchChange: (value: string) => void
  activeStage: 'open' | 'history'
  onStageChange: (stage: 'open' | 'history') => void
  onOpen: (orderKey: string) => void
  formatDate: (date: string | null) => string
}

function futureSectionLabel(date: string): string {
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date(`${date}T12:00:00`))
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function sectionPresentation(section: PjOrderListSection<PjOrderListDisplayItem>) {
  if (section.id === 'overdue') {
    return { label: 'Produção atrasada', icon: AlertTriangle, tone: 'overdue' }
  }
  if (section.id === 'today') {
    return { label: 'Produzir hoje', icon: Clock3, tone: 'today' }
  }
  if (section.id === 'tomorrow') {
    return { label: 'Produzir amanhã', icon: CalendarDays, tone: 'tomorrow' }
  }
  return {
    label: futureSectionLabel(section.date || section.id.slice(5)),
    icon: CalendarDays,
    tone: 'future',
  }
}

function OrderRow({
  order,
  stage,
  showStage,
  onOpen,
  formatDate,
}: {
  order: PjOrderListDisplayItem
  stage: 'open' | 'history'
  showStage: boolean
  onOpen: (orderKey: string) => void
  formatDate: (date: string | null) => string
}) {
  const cancelled = Boolean(order.cancelledAt)
  const style = { '--pj-order-accent': order.statusBorder } as CSSProperties

  return (
    <button
      type="button"
      onClick={() => onOpen(order.key)}
      className={`pj-order-row${cancelled ? ' is-cancelled' : ''}`}
      style={style}
    >
      <div className="pj-order-row-main">
        <div className="pj-order-customer">{order.customerName}</div>
        <div className="pj-order-dates">
          <span><b>Produção</b> {formatDate(order.productionDate)}</span>
          <span><b>Entrega</b> {formatDate(order.deliveryDate)}</span>
          <span className="pj-order-created">Implantado {formatDate(order.orderDate)}</span>
        </div>
      </div>

      <div className="pj-order-row-summary">
        <div className="pj-order-badges">
          {showStage && (
            <span className={`pj-order-stage ${stage}`}>{stage === 'open' ? 'Em aberto' : 'Histórico'}</span>
          )}
          <span className={`ps-status ${order.statusClass}`}>{order.statusLabel}</span>
        </div>
        <div className="pj-order-numbers">
          <span>{order.itemCount} {order.itemCount === 1 ? 'item' : 'itens'}</span>
          <strong>R$ {order.total.toFixed(2)}</strong>
        </div>
      </div>
      <ChevronRight className="pj-order-chevron" size={18} aria-hidden="true" />
    </button>
  )
}

export function PjOrderListPanel({
  orders,
  today,
  search,
  onSearchChange,
  activeStage,
  onStageChange,
  onOpen,
  formatDate,
}: PjOrderListPanelProps) {
  const organized = organizePjOrders(orders, { today, query: search })
  const trimmedSearch = search.trim()

  return (
    <section className="pj-order-list" aria-label="Lista de Pedidos PJ">
      <div className="pj-order-toolbar">
        <div className="pj-order-search">
          <Search size={18} aria-hidden="true" />
          <label className="sr-only" htmlFor="pj-order-search">Buscar cliente em todos os pedidos</label>
          <input
            id="pj-order-search"
            type="search"
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder="Buscar cliente em todos os pedidos"
          />
          {search && (
            <button type="button" onClick={() => onSearchChange('')} aria-label="Limpar busca">
              <X size={17} />
            </button>
          )}
        </div>

        <div className="pj-order-stage-tabs" aria-label="Situação dos pedidos">
          <button
            type="button"
            aria-pressed={activeStage === 'open'}
            className={activeStage === 'open' ? 'active' : ''}
            onClick={() => onStageChange('open')}
          >
            Em aberto <span>{organized.open.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={activeStage === 'history'}
            className={activeStage === 'history' ? 'active' : ''}
            onClick={() => onStageChange('history')}
          >
            <History size={15} /> Histórico <span>{organized.history.length}</span>
          </button>
        </div>
      </div>

      {trimmedSearch ? (
        <div className="pj-order-results" aria-live="polite">
          <div className="pj-order-result-summary">
            {organized.searchResults.length === 0
              ? `Nenhum pedido encontrado para “${trimmedSearch}”`
              : `${organized.searchResults.length} ${organized.searchResults.length === 1 ? 'pedido encontrado' : 'pedidos encontrados'} em todas as listas`}
          </div>
          {organized.searchResults.length === 0 ? (
            <div className="ps-empty pj-order-empty">
              Tente digitar outra parte do nome do cliente.
            </div>
          ) : (
            <div className="pj-order-rows">
              {organized.searchResults.map(result => (
                <OrderRow
                  key={result.order.key}
                  order={result.order}
                  stage={result.stage}
                  showStage
                  onOpen={onOpen}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </div>
      ) : activeStage === 'open' ? (
        organized.openSections.length === 0 ? (
          <div className="ps-empty pj-order-empty">Nenhum pedido em aberto.</div>
        ) : (
          <div className="pj-order-sections">
            {organized.openSections.map(section => {
              const presentation = sectionPresentation(section)
              const Icon = presentation.icon
              return (
                <section key={section.id} className={`pj-order-section ${presentation.tone}`}>
                  <header>
                    <div>
                      <Icon size={17} aria-hidden="true" />
                      <h2>{presentation.label}</h2>
                    </div>
                    <span>{section.orders.length} {section.orders.length === 1 ? 'pedido' : 'pedidos'}</span>
                  </header>
                  <div className="pj-order-rows">
                    {section.orders.map(order => (
                      <OrderRow
                        key={order.key}
                        order={order}
                        stage="open"
                        showStage={false}
                        onOpen={onOpen}
                        formatDate={formatDate}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )
      ) : organized.history.length === 0 ? (
        <div className="ps-empty pj-order-empty">Nenhum pedido no histórico.</div>
      ) : (
        <div className="pj-order-results">
          <div className="pj-order-result-summary">
            {organized.history.length} {organized.history.length === 1 ? 'pedido no histórico' : 'pedidos no histórico'}
          </div>
          <div className="pj-order-rows">
            {organized.history.map(order => (
              <OrderRow
                key={order.key}
                order={order}
                stage="history"
                showStage={false}
                onOpen={onOpen}
                formatDate={formatDate}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
