# Tarefa: revisar a trajetória operacional das sobras

Problema confirmado no primeiro uso real em 13/07/2026: existem pedidos de JC
e JA, mas o formulário fica vazio enquanto o Forno não tiver sido confirmado.
A dependência aparece tanto na interface quanto na RPC do banco e impede o
registro do fato físico observado no fechamento.

## Decisões de desenho

- A contagem física da sobra não pode depender da confirmação prévia do Forno.
- A ausência do Forno não pode criar uma produção fictícia; deve gerar uma
  pendência explícita de conciliação.
- O lote deve acompanhar o produto em todo o caminho, inclusive quando ele
  volta à vitrine e reaparece em outro fechamento.
- JC e JA usam o mesmo fluxo; EX continua fora porque recebe por romaneio.
- Pão descartado depois do fechamento recebe destino na Central de Sobras. A
  tela legada de descarte fica para perdas que não nasceram de uma sobra.
- Contagem, destino e estoque precisam ser auditáveis e utilizáveis no celular.

## Plano de implementação

### Entrega 1 — fechamento físico sem bloqueio

- [x] Fazer o formulário listar a união de pedidos da loja, saídas do Forno,
  registros já salvos e permitir incluir um pão ativo que ficou fora da lista.
- [x] Permitir escolher a data correta do fechamento, com hoje como padrão.
- [x] Criar registro provisório quando faltar Forno, identificado como
  `aguardando_forno`, sem inventar quantidade produzida.
- [x] Conciliar automaticamente o registro provisório quando a saída real do
  Forno for confirmada e manter alerta para divergências.
- [x] Após salvar a contagem, abrir a Central de Sobras já filtrada na mesma
  loja, mostrando quantidade, local físico, idade, lote e situação do Forno.
- [x] Retirar pães já registrados como sobra do caminho de descarte direto para
  evitar dupla baixa; destino será consumo interno, doação, descarte,
  congelamento ou volta à vitrine.
- [x] Incluir alertas operacionais: Forno não conciliado e sobra com mais de 24
  horas sem resolução.
- [x] Adicionar testes unitários e de regressão do fluxo completo.
- [x] Validar typecheck, lint, testes e build: 98 testes aprovados, sem erro de
  tipos, lint ou compilação.
- [ ] Conferir visualmente o percurso mobile após a publicação. A automação
  local não conseguiu anexar a página em duas tentativas.
- [x] Apresentar a migração, obter aprovação e aplicar no Supabase de produção.
- [x] Validar no banco o percurso provisório -> destino -> Forno -> conciliação
  em transação com rollback, sem deixar dados de teste.
- [ ] Atualizar documentação, publicar e integrar à `main` após a validação.

### Entrega 2 — lote real no estoque

- [ ] Fazer o romaneio transferir também o lote; hoje ele movimenta quantidade
  entre central e lojas com `lot_id` vazio.
- [ ] Definir e registrar um saldo inicial confiável por loja/lote, pois o
  histórico legado contém saldos negativos sem lote e não permite FIFO seguro.
- [ ] Preservar a origem quando um pão volta à vitrine e reaparece em outro
  fechamento, com alocação automática por lote sem exigir escolha da atendente.
- [ ] Postar cada destino no lote correto e alertar quantidade acima do estoque
  rastreável.
- [ ] Validar o percurso Forno -> romaneio -> loja -> sobra -> destino ->
  estoque em uma segunda PR, sem misturar a correção operacional com a
  reconstrução do saldo histórico.

## Evidência de 13/07/2026

- Há pedidos positivos de pães para JC e JA.
- Não há nenhuma linha em `production_actuals` para a data.
- Não há sobra registrada no dia nem pendência anterior bloqueando o fechamento.
- A tela filtra os cards exclusivamente por `production_actuals.quantity_baked > 0`.
- A RPC exige `production_actual_id`, portanto remover só o filtro da tela não
  resolveria o problema com segurança.
- O romaneio atual não transporta `lot_id`; por isso o estoque de JC e JA ainda
  não tem rastreabilidade suficiente para alocar sobras automaticamente por
  lote.
