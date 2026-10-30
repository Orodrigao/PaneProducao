import { describe, expect, it } from 'vitest'
import {
  assuntoDoAlarme,
  ehClaimAlarme,
  htmlDoAlarme,
  linkDaRotina,
  nomeDaRotina,
  type FotografiaAlarme,
  type LinhaAlarme,
} from '../../supabase/functions/alarme-rotina-parada/email'

const appUrl = 'https://erp.exemplo'

function linha(parcial: Partial<LinhaAlarme> & Pick<LinhaAlarme, 'rotina' | 'loja'>): LinhaAlarme {
  return {
    estado: 'em_dia',
    detalhe: `${parcial.rotina} da ${parcial.loja}: em dia.`,
    bloco: 'operacao',
    classe: 'em_dia',
    desde: null,
    ...parcial,
  }
}

function fotografia(parcial: Partial<FotografiaAlarme> = {}): FotografiaAlarme {
  return {
    dia: '2026-11-03',
    base: '2026-10-31',
    blocos: [{ bloco: 'operacao', verificado: true }, { bloco: 'financeiro', verificado: true }],
    linhas: [],
    resolvidos: [],
    em_espera: [],
    segunda: false,
    motivos: [],
    deve_enviar: true,
    ...parcial,
  }
}

const prateleiraNova = linha({
  rotina: 'prateleira', loja: 'jc', estado: 'atrasada', classe: 'novo', desde: '2026-11-03',
  detalhe: 'Contagem de prateleira da JC: 2 dias sem lancamento nos ultimos 7 dias esperados (31/10, 03/11).',
})
const parcelaContinua = linha({
  rotina: 'parcela_vencida', loja: 'jc', estado: 'atrasada', classe: 'continua', desde: '2026-10-30',
  bloco: 'financeiro', detalhe: 'Parcelas a pagar da JC: 21 vencidas sem baixa, a mais antiga de 20/08, R$ 13.166,45.',
})
const pjContinua = linha({
  rotina: 'pj_liberacao', loja: 'jc', estado: 'atrasada', classe: 'continua', desde: '2026-10-30',
  bloco: 'financeiro', detalhe: 'Pedidos PJ: 2 pedidos conferidos pela Expedição sem liberação.',
})

describe('nome e tela de cada rotina', () => {
  it('junta a loja quando a rotina é por loja e omite em pedido PJ e nas gerais', () => {
    expect(nomeDaRotina('prateleira', 'jc')).toBe('Contagem de prateleira JC')
    expect(nomeDaRotina('caixa', 'ja')).toBe('Fechamento de caixa JA')
    expect(nomeDaRotina('pj_liberacao', 'jc')).toBe('Pedidos PJ sem liberar')
    expect(nomeDaRotina('recebimento_parado', 'geral')).toBe('Recebimentos')
    expect(nomeDaRotina('nfe_entrada', 'todas')).toBe('Entrada de NF-e')
  })

  it('leva cada rotina à tela que resolve e cai no início quando não conhece a rotina', () => {
    expect(linkDaRotina('prateleira', appUrl)).toBe('https://erp.exemplo/sobras')
    expect(linkDaRotina('venda_balcao', appUrl)).toBe('https://erp.exemplo/relatorios/vendas-balcao')
    expect(linkDaRotina('pj_liberacao', appUrl)).toBe('https://erp.exemplo/pedidos-pj')
    expect(linkDaRotina('parcela_vencida', appUrl)).toBe('https://erp.exemplo/contas-pagar')
    expect(linkDaRotina('rotina_que_nao_existe', appUrl)).toBe('https://erp.exemplo/')
    expect(nomeDaRotina('rotina_que_nao_existe', 'jc')).toBe('rotina_que_nao_existe JC')
  })
})

describe('assunto do e-mail', () => {
  it('põe o que é novo primeiro, pelo nome, e conta o que continua', () => {
    const assunto = assuntoDoAlarme(fotografia({ linhas: [parcelaContinua, prateleiraNova, pjContinua] }))
    expect(assunto).toBe('Rotina parada 03/11: NOVO: Contagem de prateleira JC; 2 continuam')
  })

  it('informativo nunca entra no assunto nem conta como atraso', () => {
    const informativo = linha({
      rotina: 'parcela_vencida', loja: 'jc', estado: 'informativo', classe: 'informativo', bloco: 'financeiro',
      detalhe: 'Parcelas a pagar da JC: nenhuma vencida sem baixa; vencem até 04/11: 2, R$ 300,00.',
    })
    const comNovo = fotografia({ linhas: [prateleiraNova, informativo] })
    expect(assuntoDoAlarme(comNovo)).toBe('Rotina parada 03/11: NOVO: Contagem de prateleira JC')
    expect(htmlDoAlarme(comNovo, appUrl)).toContain('1 rotina atrasada hoje.')
    expect(assuntoDoAlarme(fotografia({ dia: '2026-11-02', segunda: true, linhas: [informativo] })))
      .toBe('Resumo de segunda: rotinas em dia (02/11)')
  })

  it('sem novidade, diz pelo nome o que continua atrasado', () => {
    expect(assuntoDoAlarme(fotografia({ linhas: [parcelaContinua] })))
      .toBe('Rotina parada 03/11: continua: Parcelas a pagar JC')
  })

  it('encurta a lista longa de novos', () => {
    const novos = ['caixa', 'sobras', 'forno', 'romaneio'].map(rotina =>
      linha({ rotina, loja: 'jc', estado: 'atrasada', classe: 'novo', desde: '2026-11-03' }))
    expect(assuntoDoAlarme(fotografia({ linhas: novos })))
      .toBe('Rotina parada 03/11: NOVO: Fechamento de caixa JC, Sobras JC, Forno JC e mais 1')
  })

  it('bloco que não foi verificado aparece no assunto, nunca como tudo em dia', () => {
    const assunto = assuntoDoAlarme(fotografia({
      blocos: [{ bloco: 'operacao', verificado: true }, { bloco: 'financeiro', verificado: false, erro: 'falhou' }],
    }))
    expect(assunto).toBe('Alarme do ERP 03/11: sem conferência: avisos do financeiro')
    expect(assunto).not.toContain('em dia')
  })

  it('só resolvidos: diz o que voltou ao normal', () => {
    expect(assuntoDoAlarme(fotografia({
      resolvidos: [{ rotina: 'prateleira', loja: 'jc', bloco: 'operacao', detalhe: 'ok', desde: '2026-10-30' }],
    }))).toBe('Alarme do ERP 03/11: em dia de novo: Contagem de prateleira JC')
  })

  it('segunda sem atraso manda o resumo', () => {
    expect(assuntoDoAlarme(fotografia({ dia: '2026-11-02', segunda: true, linhas: [linha({ rotina: 'caixa', loja: 'jc' })] })))
      .toBe('Resumo de segunda: rotinas em dia (02/11)')
  })
})

describe('corpo do e-mail', () => {
  it('novo vem antes de continua, e continua mostra desde quando, em uma linha por rotina', () => {
    const html = htmlDoAlarme(fotografia({ linhas: [parcelaContinua, prateleiraNova] }), appUrl)
    const posicaoNovo = html.indexOf('Novo atraso')
    const posicaoContinua = html.indexOf('Continuam atrasadas')
    expect(posicaoNovo).toBeGreaterThan(-1)
    expect(posicaoContinua).toBeGreaterThan(posicaoNovo)
    expect(html).toContain('Parcelas a pagar JC</a>, desde 30/10: ')
    expect(html).toContain('href="https://erp.exemplo/sobras"')
    expect(html).toContain('2 rotinas atrasadas hoje.')
  })

  it('bloco não verificado abre o e-mail e lista o que estava atrasado nele', () => {
    const html = htmlDoAlarme(fotografia({
      blocos: [{ bloco: 'operacao', verificado: true }, { bloco: 'financeiro', verificado: false, erro: 'a regra devolveu 3 linhas em vez de 4' }],
      linhas: [prateleiraNova],
      em_espera: [parcelaContinua],
    }), appUrl)
    expect(html.indexOf('Não foi possível verificar')).toBeLessThan(html.indexOf('Novo atraso'))
    expect(html).toContain('a regra devolveu 3 linhas em vez de 4')
    expect(html).toContain('Isso não quer dizer que está tudo em dia.')
    expect(html).toContain('Parcelas a pagar JC</a>: estava atrasada desde 30/10; sem conferência hoje.')
  })

  it('resolvido, informativo e em dia aparecem depois dos atrasos', () => {
    const html = htmlDoAlarme(fotografia({
      linhas: [
        prateleiraNova,
        linha({ rotina: 'nfe_atraso_emissao', loja: 'todas', estado: 'informativo', classe: 'informativo', detalhe: '2 notas chegaram atrasadas.' }),
        linha({ rotina: 'caixa', loja: 'ja' }),
      ],
      resolvidos: [{ rotina: 'sobras', loja: 'ja', bloco: 'operacao', detalhe: 'ok', desde: '2026-10-28' }],
    }), appUrl)
    expect(html.indexOf('Em dia de novo')).toBeGreaterThan(html.indexOf('Novo atraso'))
    expect(html).toContain('Sobras JA</a>: voltou ao normal (estava atrasada desde 28/10).')
    expect(html).toContain('2 notas chegaram atrasadas.')
    expect(html).toContain('Fechamento de caixa JA.')
  })

  it('escapa o texto que vem do banco', () => {
    const html = htmlDoAlarme(fotografia({
      linhas: [linha({ rotina: 'caixa', loja: 'jc', estado: 'atrasada', classe: 'novo', desde: '2026-11-03', detalhe: '<script>x</script> & "y"' })],
    }), appUrl)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;y&quot;')
  })

  it('não usa travessão no texto do e-mail', () => {
    const html = htmlDoAlarme(fotografia({ linhas: [prateleiraNova, parcelaContinua] }), appUrl)
    expect(html).not.toContain('—')
    expect(assuntoDoAlarme(fotografia({ linhas: [prateleiraNova, parcelaContinua] }))).not.toContain('—')
  })
})

describe('conferência do que o banco devolve', () => {
  it('aceita os estados sem envio e a fotografia completa', () => {
    expect(ehClaimAlarme({ state: 'domingo' })).toBe(true)
    expect(ehClaimAlarme({ state: 'concluido' })).toBe(true)
    expect(ehClaimAlarme({
      state: 'pronto_para_enviar', envio_id: 'e', report_date: '2026-11-03', attempt_token: 't',
      recipient: 'r@exemplo', fotografia: fotografia({ linhas: [prateleiraNova] }),
    })).toBe(true)
  })

  it('recusa estado desconhecido, fotografia sem bloco e linha fora do formato', () => {
    expect(ehClaimAlarme({ state: 'outro' })).toBe(false)
    expect(ehClaimAlarme(null)).toBe(false)
    const pronto = { state: 'pronto_para_enviar', envio_id: 'e', report_date: '2026-11-03', attempt_token: 't', recipient: 'r@exemplo' }
    expect(ehClaimAlarme({ ...pronto, fotografia: { ...fotografia(), blocos: undefined } })).toBe(false)
    expect(ehClaimAlarme({ ...pronto, fotografia: fotografia({ linhas: [{ ...prateleiraNova, classe: 'talvez' as never }] }) })).toBe(false)
    expect(ehClaimAlarme({ ...pronto, fotografia: { ...fotografia(), dia: '03/11/2026' } })).toBe(false)
  })
})
