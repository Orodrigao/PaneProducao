// Documento impresso do Fechamento EX. Mostra o mesmo que a tela: as semanas já
// cobradas, com o valor cobrado, e o que falta cobrar pelo preço do dia de cada
// romaneio. O total "a cobrar" nunca inclui semana já cobrada.

import { formatDateBR } from '@/lib/utils'
import {
  billedPeriodLabel,
  formatBRL,
  formatQuantity,
  type FechamentoExCobranca,
} from '@/lib/romaneioExFechamento'
import { billingRowPeriodLabel, type RomaneioExBillingRow } from '@/lib/romaneioExBilling'
import { adjustmentText, changeText, signedBRL } from './FechamentoExCobrancas'

const PANE_SENDER = {
  store: 'Pane Júlio',
  company: 'RGF PANE PIZZA LTDA',
  cnpj: '55.800.425/0001-77',
}

const BUCK_RECIPIENT = {
  store: 'EX — Exposição',
  company: 'Buck Comércio de Alimentos LTDA - ME',
  cnpj: '28.994.014/0001-97',
}

const SECTION_TITLE = { margin: '16px 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em' } as const

export function rowNameWithPeriod(row: RomaneioExBillingRow) {
  const period = row.priceChanged ? billingRowPeriodLabel(row) : null
  return period ? `${row.productName} (${period})` : row.productName
}

function BilledWeekPrint({ cobranca }: { cobranca: FechamentoExCobranca }) {
  return (
    <table className="rom-ex-print-table" style={{ marginBottom: 10 }}>
      <thead>
        <tr>
          <th>{billedPeriodLabel(cobranca.periodStart, cobranca.periodEnd)}</th>
          <th>Cobrado</th>
          <th>Preço</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {!cobranca.withPhoto && (
          <tr><td colSpan={4}>Cobrança sem o detalhe das linhas (botão antigo).</td></tr>
        )}
        {cobranca.lines.rows.map(row => (
          <tr key={row.key}>
            <td>{rowNameWithPeriod(row)}</td>
            <td>{formatQuantity(row.billedQuantity, row.billingUnit)}</td>
            <td>{row.unitPrice === null ? '—' : `${formatBRL(row.unitPrice)}/${row.billingUnit}`}</td>
            <td>{row.total === null ? '—' : formatBRL(row.total)}</td>
          </tr>
        ))}
        {cobranca.adjustments.map(ajuste => (
          <tr key={`ajuste-${ajuste.position}`}>
            <td colSpan={3}>{adjustmentText(ajuste)}</td>
            <td>{signedBRL(ajuste.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3}>COBRADO NA SEMANA</td>
          <td>{formatBRL(cobranca.amount)}</td>
        </tr>
        {cobranca.changes.map(mudanca => (
          <tr key={mudanca.key}>
            <td colSpan={3} style={{ fontWeight: 400 }}>Fora do valor cobrado: {changeText(mudanca)}</td>
            <td style={{ fontWeight: 400 }}>{mudanca.total === null ? 'sem valor' : signedBRL(mudanca.total)}</td>
          </tr>
        ))}
      </tfoot>
    </table>
  )
}

export default function FechamentoExPrint({
  rows,
  total,
  period,
  tripCount,
  showsBilled,
  billed,
  billedTotal,
}: {
  rows: RomaneioExBillingRow[]
  total: number
  period: { from: string; to: string }
  tripCount: number
  showsBilled: boolean
  billed: FechamentoExCobranca[]
  billedTotal: number
}) {
  return (
    <section id="romaneios-ex-print" aria-hidden="true">
      <header className="rom-ex-print-header">
        <div>
          <h1>Fechamento de Romaneios — EX</h1>
          <p>Base para cobrança dos pães enviados à Exposição.</p>
        </div>
        <div className="rom-ex-print-meta">
          <span>Período</span>
          <b>{formatDateBR(period.from)} a {formatDateBR(period.to)}</b>
          <span>{showsBilled ? 'Viagens a cobrar' : 'Viagens incluídas'}</span>
          <b>{tripCount}</b>
          {billed.length > 0 && (
            <>
              <span>Já cobrado</span>
              <b>{formatBRL(billedTotal)}</b>
            </>
          )}
        </div>
      </header>

      <div className="rom-ex-print-parties">
        <section>
          <h2>Remetente</h2>
          <b>{PANE_SENDER.store}</b>
          <p>{PANE_SENDER.company}</p>
          <p>CNPJ: {PANE_SENDER.cnpj}</p>
        </section>
        <section>
          <h2>Destinatário / cobrança</h2>
          <b>{BUCK_RECIPIENT.store}</b>
          <p>{BUCK_RECIPIENT.company}</p>
          <p>CNPJ: {BUCK_RECIPIENT.cnpj}</p>
        </section>
      </div>

      {billed.length > 0 && (
        <>
          <h2 style={SECTION_TITLE}>Semanas já cobradas</h2>
          <p className="rom-ex-print-note">Como ficou na confirmação da cobrança. O que mudou nos romaneios depois aparece no fim de cada semana, fora do valor cobrado.</p>
          {billed.map(cobranca => <BilledWeekPrint key={cobranca.receivableId} cobranca={cobranca}/>)}
          <h2 style={SECTION_TITLE}>A cobrar</h2>
        </>
      )}

      <p className="rom-ex-print-note">Preço da Tabela BUCK no dia de cada romaneio. Quantidade cobrada: aceita na conferência ou, sem conferência, enviada.</p>

      <table className="rom-ex-print-table">
        <thead>
          <tr>
            <th>Produto</th>
            <th>Enviado</th>
            <th>Cobrado</th>
            <th>Preço</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5}>Nada a cobrar no período.</td></tr>
          )}
          {rows.map(row => (
            <tr key={row.key}>
              <td>{rowNameWithPeriod(row)}</td>
              <td>{formatQuantity(row.sentQuantity, row.billingUnit)}</td>
              <td>{formatQuantity(row.billedQuantity, row.billingUnit)}</td>
              <td>{row.unitPrice === null ? '—' : `${formatBRL(row.unitPrice)}/${row.billingUnit}`}</td>
              <td>{row.total === null ? '—' : formatBRL(row.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>{showsBilled ? 'TOTAL A COBRAR' : 'TOTAL PARA COBRANÇA'}</td>
            <td>{formatBRL(total)}</td>
          </tr>
        </tfoot>
      </table>

      <footer className="rom-ex-print-signatures">
        <div>Conferido pela Pane</div>
        <div>Conferido pela EX</div>
      </footer>
    </section>
  )
}
