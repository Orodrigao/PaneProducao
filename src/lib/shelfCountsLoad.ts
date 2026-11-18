// Leitura das contagens de prateleira do período escolhido.

export async function loadShelfCounts<Row>(
  sequence: { current: number },
  view: {
    setRows: (rows: Row[]) => void
    setLoading: (loading: boolean) => void
  },
  read: () => PromiseLike<{ data: Row[] | null }>,
): Promise<void> {
  const seq = ++sequence.current
  view.setLoading(true)
  try {
    const { data } = await read()
    if (seq !== sequence.current) return
    view.setRows(data || [])
  } catch {
    // Falha de leitura mantém a lista anterior, como na tela.
  } finally {
    if (seq === sequence.current) view.setLoading(false)
  }
}
