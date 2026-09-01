import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./PjProductionPlanningPanel.tsx', import.meta.url), 'utf8')

describe('painel de programação PJ', () => {
  it('permite escolher linhas, dividir quantidade e informar congelados', () => {
    expect(source).toContain('Selecionar ${item.productName}')
    expect(source).toContain('Quantidade para produzir de ${item.productName}')
    expect(source).toContain('Congelados para ${item.productName}')
    expect(source).toContain('Produzir tudo')
  })

  it('explica as duas regras operacionais que não podem ficar implícitas', () => {
    expect(source).toContain('Sobras das lojas não atendem PJ')
    expect(source).toContain('pedidos por entrega mais próxima')
  })

  it('mantém o mesmo identificador quando uma tentativa de rede falha', () => {
    expect(source).toContain('requestIds[groupKey] ?? requestId()')
    expect(source).toContain("setRequestIds(current => ({ ...current, [groupKey]: stableRequestId }))")
  })

  it('pede uma conferência explícita antes de tornar a programação definitiva', () => {
    expect(source).toContain('Confira a programação de hoje')
    expect(source).toContain('não dá para desfazer o que entrou')
    expect(source).toContain('window.confirm')
  })

  it('não trava a linha depois de programada hoje, porque a Geolar pode produzir mais', () => {
    // O banco ja limita pelo total do pedido, e a fila so traz linha com
    // quantidade pendente. Travar na tela era mais duro que a regra do negocio e
    // empurrava producao para o dia seguinte sem necessidade.
    expect(source).toContain('const blocked = Boolean(item.mappingError || !item.breadId)')
    expect(source).not.toContain('|| scheduledToday)')
    expect(source).toContain('Dá para programar mais, até o que falta')
  })

  it('deixa salvar sempre que houver linha marcada, mesmo ja programada hoje', () => {
    expect(source).toContain('!group.items.some(item => drafts[item.orderId]?.selected)')
  })

  // Este teste existe porque a primeira versao do conserto falhou em producao de
  // um jeito especifico: eu liberei a linha na TELA mas esqueci do filtro que
  // monta a lista na hora de salvar, e do "Produzir tudo". O resultado era pior
  // que a trava antiga: a pessoa marcava, digitava a quantidade, clicava, e a
  // tela dizia que nada estava marcado. A assercao anterior nao pegou porque eu
  // a escrevi com um pedaco de sintaxe que so existia no botao.
  //
  // Contar as ocorrencias e o que fecha a porta: qualquer trava nova baseada em
  // "ja foi programado hoje" quebra este teste e obriga a pensar.
  it('so olha se ja foi programado hoje em dois lugares, e nenhum deles bloqueia', () => {
    const ocorrencias = source.match(/lastScheduledDate/g) ?? []
    expect(ocorrencias).toHaveLength(2)

    // 1. na carga, para a linha nao vir pre-marcada depois de ja ter sido salva
    expect(source).toContain('next[item.orderId] = item.lastScheduledDate === productionDate')
    // 2. no aviso que explica que da para programar mais
    expect(source).toContain('const scheduledToday = item.lastScheduledDate === productionDate')

    // e em nenhum lugar que decide o que pode ser salvo
    expect(source).toContain('if (item.mappingError || !item.breadId) continue')
    expect(source).not.toContain('&& item.lastScheduledDate !== productionDate')
  })

  it('diz de onde vem o congelado oferecido, sem deixar o número solto', () => {
    expect(source).toContain("formatPjProductionQuantity(item.frozenAvailable, 'un')} em estoque")
  })
})
