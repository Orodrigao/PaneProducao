'use client'

import { describeHistoryEntry, formatChangedAt, type PricingHistoryEntry } from '@/lib/pricingSettings'
import styles from '@/app/admin/configuracao/page.module.css'

const VISIBLE_STEP = 20

interface Props {
  history: readonly PricingHistoryEntry[]
  visible: number
  onShowMore: () => void
}

/** Cada versão gravada: o que era, o que ficou, quem mudou e quando. */
export function PricingSettingsHistory({ history, visible, onShowMore }: Props) {
  if (history.length === 0) {
    return <p className={styles.fieldMeta}>Nenhuma mudança gravada ainda.</p>
  }
  return (
    <>
      <ul className={styles.history}>
        {history.slice(0, visible).map(entry => (
          <li key={entry.id} className={styles.historyItem}>
            <span>{describeHistoryEntry(entry)}</span>
            <small className={styles.fieldMeta}>{entry.changedByName} · {formatChangedAt(entry.changedAt)}</small>
          </li>
        ))}
      </ul>
      {history.length > visible && (
        <button type="button" className="ps-btn" onClick={onShowMore}>
          Mostrar mais {Math.min(VISIBLE_STEP, history.length - visible)}
        </button>
      )}
    </>
  )
}

export const PRICING_HISTORY_STEP = VISIBLE_STEP
