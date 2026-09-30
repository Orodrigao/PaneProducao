'use client'

import {
  formatChangedAt,
  percentInputText,
  pricingChannelLabel,
  slotId,
  type PricingChannel,
  type PricingSettingSlot,
  type PricingSettingValue,
} from '@/lib/pricingSettings'
import styles from '@/app/admin/configuracao/page.module.css'

interface FieldProps {
  slot: PricingSettingSlot
  label: string
  draft: Readonly<Record<string, string>>
  current: ReadonlyMap<string, PricingSettingValue>
  errors: Readonly<Record<string, string>>
  disabled: boolean
  onChange: (id: string, text: string) => void
}

/** Campo de percentual: vazio é "não definido" e mostra quem mudou por último. */
export function PricingPercentField({ slot, label, draft, current, errors, disabled, onChange }: FieldProps) {
  const id = slotId(slot)
  const saved = current.get(id)
  const text = draft[id] ?? percentInputText(saved?.value ?? null)
  const inputId = `pricing-${id.replace(/[^a-z0-9]+/gi, '-')}`
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.fieldLabel}>{label}</label>
      <div className={styles.inputRow}>
        <input
          id={inputId}
          className={`ps-input ${styles.percentInput}`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="não definido"
          value={text}
          disabled={disabled}
          aria-invalid={errors[id] ? true : undefined}
          onChange={event => onChange(id, event.target.value)}
        />
        <span className={styles.percentSign}>%</span>
      </div>
      {errors[id]
        ? <small className={styles.fieldError}>{errors[id]}</small>
        : <small className={styles.fieldMeta}>
            {saved ? `${saved.value === null ? 'Limpo' : 'Mudado'} por ${saved.changedByName} em ${formatChangedAt(saved.changedAt)}` : 'Nunca definido'}
          </small>}
    </div>
  )
}

interface ChannelProps extends Omit<FieldProps, 'slot' | 'label'> {
  channel: PricingChannel
}

export function PricingChannelCard({ channel, ...field }: ChannelProps) {
  return (
    <section className={`ps-card ${styles.card}`} aria-label={`Canal ${pricingChannelLabel(channel)}`}>
      <h3 className={styles.cardTitle}>{pricingChannelLabel(channel)}</h3>
      <div className={styles.grid}>
        <PricingPercentField {...field} slot={{ key: 'taxa_canal', channel, categoryId: null }}
          label={channel === 'ifood' ? 'Taxa (comissão + cartão)' : channel === 'balcao' ? 'Taxa de cartão' : 'Taxa do canal'} />
        <PricingPercentField {...field} slot={{ key: 'margem_desejada', channel, categoryId: null }} label="Margem desejada" />
        <PricingPercentField {...field} slot={{ key: 'margem_minima', channel, categoryId: null }} label="Margem mínima" />
      </div>
    </section>
  )
}

interface CategoryProps extends Omit<FieldProps, 'slot' | 'label'> {
  categoryId: string
  categoryName: string
  channels: readonly PricingChannel[]
}

export function PricingCategoryCard({ categoryId, categoryName, channels, ...field }: CategoryProps) {
  return (
    <section className={`ps-card ${styles.card}`} aria-label={`Exceção ${categoryName}`}>
      <h3 className={styles.cardTitle}>{categoryName}</h3>
      {channels.map(channel => (
        <div key={channel} className={styles.categoryChannel}>
          <b className={styles.channelName}>{pricingChannelLabel(channel)}</b>
          <div className={styles.grid}>
            <PricingPercentField {...field} slot={{ key: 'margem_desejada', channel, categoryId }} label="Margem desejada" />
            <PricingPercentField {...field} slot={{ key: 'margem_minima', channel, categoryId }} label="Margem mínima" />
          </div>
        </div>
      ))}
      <small className={styles.fieldMeta}>Campo vazio aqui usa a margem do canal.</small>
    </section>
  )
}
