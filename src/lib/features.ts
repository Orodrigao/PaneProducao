export const COMPRAS_COTACOES_PAUSADAS = true

export function isComprasCotacoesPath(pathname: string): boolean {
  return pathname === '/compras' ||
    pathname === '/cotacoes' ||
    pathname.startsWith('/cotacoes/')
}
