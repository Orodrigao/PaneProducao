const ROMANEIO_TIME_ZONE = 'America/Sao_Paulo'

const romaneioDateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: ROMANEIO_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function timestampParts(value: string | null | undefined): Record<string, string> | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return Object.fromEntries(
    romaneioDateTimeFormatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
}

export function formatRomaneioTime(value: string | null | undefined): string {
  const parts = timestampParts(value)
  return parts ? `${parts.hour}:${parts.minute}` : ''
}

export function formatRomaneioDateTime(value: string | null | undefined): string {
  const parts = timestampParts(value)
  return parts ? `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}` : ''
}
