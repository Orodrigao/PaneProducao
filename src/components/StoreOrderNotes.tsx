import { storeOrderNotes, type StoreOrderNoteMap } from '@/lib/storeOrderNote'

const STORE_LABELS: Record<string, string> = { ex: 'EX', jc: 'JC', ja: 'JA' }

interface Props {
  orders: StoreOrderNoteMap
  stores: readonly string[]
}

// Recado que cada loja escreveu no pedido. Fica no topo da folha da produção e
// também sai no papel: é ali que a produção lê "4 inteiros e 4 fatiados".
export function StoreOrderNotes({ orders, stores }: Props) {
  const notes = storeOrderNotes(orders, stores)
  if (!notes.length) return null

  return (
    <section
      aria-label="Observações das lojas"
      className="ps-card"
      style={{ marginBottom: 12, borderColor: 'var(--honey-line)', background: 'var(--honey-tint)' }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 6, fontSize: 15 }}>Observações das lojas</h3>
      {notes.map(({ store, note }) => (
        <p key={store} style={{ margin: '4px 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>
          <strong>{STORE_LABELS[store] ?? store.toUpperCase()}:</strong> {note}
        </p>
      ))}
    </section>
  )
}
