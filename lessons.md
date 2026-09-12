Regras de uma linha, ate 40 palavras, teto de 40 linhas; passou disso, consolide. Formato: data - slug - regra. Post-mortem fica na PR; como-fazer de ambiente em docs/AMBIENTE_PREVIEW.md; licao que vira teste, lint ou guarda entra como codigo.
2026-07-06 - fechamento-caixa-informativos - iFood, envelope e proximo dia sao informativos, fora da conta do dia; venda em dinheiro = dinheiro contado + sangrias - abertura.
2026-07-18 - contexto-nao-e-autorizacao - Loja e contexto dos dados; autorizacao vem de permissao explicita e transferivel, nunca de nome, cargo ou loja de quem opera.
2026-07-21 - leitura-operacional-sem-preco - Esconder preco na tela ou na RPC nao protege nada; bloqueie na policy da tabela e exponha a leitura operacional por funcao com colunas explicitas.
2026-07-21 - validar-tambem-na-saida - Numero que vira dinheiro valida no ponto de saida (relatorio, cobranca) alem de cada porta de entrada; limite so no cliente e mitigacao, nao garantia.
2026-07-21 - identidade-dupla-bread-product - Tela que cruza operacao com preco ou custo resolve identidade via src/lib/productIdentity.ts; match cru de source:id em codigo novo e sinal de bug.
2026-07-21 - tsc-e-build-em-sequencia - Rode `tsc --noEmit` e `next build` em sequencia, nunca em paralelo: ambos disputam `.next/types` e produzem falsos TS6053.
2026-07-22 - grants-implicitos-variam - Migration revoga defaults amplos, concede cada acesso explicitamente e testa privilegios efetivos apos reconstruir o banco do zero.
2026-08-07 - dinheiro-nasce-de-evento - Dinheiro se liga a evento gravado, nunca a deducao de calendario; meca a adocao do evento antes de depender dele.
2026-08-12 - tela-nova-precisa-do-menu - Tela nova exige quatro listas alinhadas: DEFAULT_ROUTES_BY_ROLE, permissao granular, policies RLS e o menu em src/components/Nav.tsx; confira o menu do perfil real.
2026-08-12 - funcao-redefinida-perde-melhoria - `create or replace function` sobrescreve tudo: parta da definicao mais recente (grep nas migrations) e faca diff contra a vigente antes de enviar.
2026-08-12 - plpgsql-returns-table - Colunas de RETURNS TABLE levam prefixo proprio para nao ficar ambiguas; cubra a funcao com pgTAP que a executa de verdade.
2026-08-12 - dinheiro-digitado-com-virgula - Campo de dinheiro usa parseMoneyInput (src/lib/cashClosing.ts) na tela, na validacao e no envio; nunca Number() cru.
2026-08-13 - valor-novo-no-check - Valor novo em check ou enum do banco atualiza o mapa de rotulos no mesmo commit; a leitura passa por funcao com fallback para a chave crua.
2026-08-14 - data-da-padaria - "Hoje" do negocio em SQL e em teste de banco e private.data_na_padaria(); nunca current_date nem now()::date, que respondem em UTC.
2026-08-14 - chave-de-origem-e-o-evento - source_ref de lancamento financeiro aponta para o evento que moveu dinheiro (recebimento, parcela), nunca para o agregado (cobranca, compra).
2026-08-14 - cadastro-guarda-padrao - Cadastro guarda o padrao; a transacao guarda a decisao. "Esse cliente e assim" quase sempre significa "as vezes e assim".
2026-08-14 - botao-desabilitado-com-motivo - Controle desabilitado mostra o motivo escrito ao lado, inclusive no estado "ainda sem informacao"; tooltip nao existe no celular.
2026-08-14 - uuid-e-crlf-em-teste - uuid de cenario so aceita [0-9a-f]; normalize CRLF para LF antes de comparar texto de SQL.
2026-08-14 - seed-copia-producao - Dado ficticio copia producao ate na caixa do texto, nasce dois dias afastado de "hoje" e o seed limpa o proprio espaco antes de recriar.
2026-08-20 - so-as-linhas-alteradas-viajam - Formulario de varias linhas envia somente o que mudou; o teste exercita preenchimento parcial, que e como a pessoa usa.
2026-08-20 - teste-nao-depende-da-hora - Teste cujo resultado muda com o relogio e defeito; janela de relatorio vem do relogio do cliente, afaste o dado ficticio dois dias.
2026-08-21 - espera-mira-prontidao - Espera de teste mira sinal de prontidao, cabe no orcamento do aplicativo vezes o numero de chamadas e tolera voltas contadas; localizador nunca prende em rotulo que muda de estado.
2026-08-21 - campo-opcional-fiscal-sem-palpite - Campo opcional de documento fiscal que vira dinheiro nunca recebe valor padrao silencioso; a tela diz de onde veio e a varredura cobre todas as ocorrencias.
2026-08-22 - correcao-de-dado-por-invariante - Correcao de dado de producao se prende por invariante em supabase/tests/invariantes.test.sql, nunca por igualdade com ids que so existem em producao.
2026-08-24 - integrar-pr-de-outra-sessao - Antes de integrar, `git status -sb` no worktree da PR procurando ahead; depois, `git diff origin/main HEAD` vazio; apos rebase confira o ref e o headRefOid do check.
2026-08-20 - branch-com-pr-aberta - Renomear branch com PR aberta fecha a PR; push recusado em branch compartilhada e trabalho alheio: leia o commit do outro e rebase a mao.
2026-08-26 - migration-de-dado-com-alvo - Migration que escreve dado precisa de linha no seed que caia no filtro, inclusive a recusada; liste gatilhos por tabela com pg_get_triggerdef.
2026-08-27 - permissao-tem-varias-portas - "Tem a permissao mas nao deixa": pegue a mensagem exata nos logs do Postgres e cruze com edge_logs; cada funcao do modulo tem criterio proprio.
2026-08-31 - constraint-nao-e-regra - Antes de escrever direto numa tabela, leia a funcao oficial da operacao; constraint diz o que o banco tolera, nao o que o negocio permite.
2026-09-02 - campo-novo-e-passado-pendente - Filtro de pendencia por campo novo trata todo o historico como pendente; conte no banco real antes de expor e ancore em campo que sempre existiu.
2026-09-02 - assercao-com-dente - Prove que o teste falha reintroduzindo o defeito; assercao montada do texto que voce escreveu confirma suposicao, nao comportamento.
2026-09-02 - guarda-de-workflow-trava-a-precondicao - Guarda de CI trava a precondicao que torna a fonte confiavel e compara caminho por realpath, nunca por texto; garantia vale so para o que ela cobre.
2026-09-04 - texto-envelhece-com-o-sistema - Mudanca de comportamento inclui as telas que explicam o comportamento antigo: grep em src/ pelas frases da regra trocada e leia o fluxo inteiro.
2026-09-04 - caso-padrao-na-fronteira - Valor do banco que escolhe rotulo ou indice tem caso padrao seguro na fronteira (bloquear, nunca liberar); teste de paridade le o SQL.
2026-09-07 - onde-aparece-vem-de-quem-organiza - Em que aba ou secao algo aparece vem da funcao que monta a lista (organizePjOrders), nunca de regra reescrita ao lado.
2026-09-09 - seed-nao-prova-usuario-real - Permissao nova exige matriz permitido x bloqueado no preview e consulta somente leitura provando que o ator real tem a concessao.
2026-09-12 - selo-depois-do-ci - Check da Portaria so depois do CI remoto verde; selo antes do push custou seis PRs por entrega. Falha no CI corrige na mesma branch e PR.
