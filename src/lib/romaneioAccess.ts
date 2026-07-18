import {
  canPerformRomaneioAction,
  type RomaneioPermissions,
} from './romaneioPermissions'

export function destinationCode(destination: { code?: string | null; name?: string | null } | null | undefined): string {
  const normalize = (value: string | null | undefined) =>
    (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  const code = normalize(destination?.code)
  if (code) return code
  const name = normalize(destination?.name)
  if (name.includes('EXPOS')) return 'EX'
  if (name.includes('JARDIM')) return 'JA'
  if (name.includes('JULIO')) return 'JC'
  return ''
}

export function canSeeRomaneio(
  permissions: RomaneioPermissions,
  destination: { code?: string | null; name?: string | null } | null | undefined,
): boolean {
  const code = destinationCode(destination)
  return canPerformRomaneioAction(permissions, 'view', code)
    || canPerformRomaneioAction(permissions, 'manage', code)
}
