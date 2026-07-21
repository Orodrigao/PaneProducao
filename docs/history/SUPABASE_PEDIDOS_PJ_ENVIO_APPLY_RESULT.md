# Resultado — Envio de Pedidos PJ pela Expedição

Data: 2026-07-21

Status: migration aplicada e matriz concluída; frontend pronto para incorporação.

## Autorização

Rodrigo autorizou explicitamente aplicar a migration da Fase 2 no Supabase de
produção e testar um perfil permitido e um bloqueado.

## Migration aplicada

Projeto Supabase:

```text
PanePedidosLojas — gohluceldchoitihrimw
```

Arquivo versionado:

```text
supabase/migrations/20260721154418_adicionar_envio_pedidos_pj.sql
```

Hash SHA-256 do arquivo aplicado:

```text
e57cc3e795d67cd0c854c93ae6336c474e222e2f791a8ed1cf9c80c34ba97fbf
```

A aplicação foi feita pelo Supabase MCP e ficou registrada no histórico
remoto como:

| Versão | Nome |
| --- | --- |
| `20260721162137` | `adicionar_envio_pedidos_pj` |

O timestamp remoto difere do arquivo local porque foi gerado no momento da
aplicação.

## Resultado validado no banco

- as três colunas de despacho existem em `public.orders`;
- os dois gatilhos de proteção estão ativos;
- as funções usam privilégio elevado com caminho de busca fechado;
- usuário anônimo não pode executar as funções;
- o catálogo contém `pedidos_pj.confirmar_envio`, carregado dinamicamente pela
  Tela de Usuários;
- a Expedição JC recebeu rota e permissões de acesso e confirmação com escopo
  `jc`;
- como Expedição JC, a leitura direta retornou zero linhas PJ e a fila segura
  retornou 117 linhas sem preço;
- como Expedição JC, confirmar um grupo fictício atravessou a autorização e
  retornou `P0002 — Pedido PJ não encontrado`;
- como Administrador, consultar a fila operacional ou confirmar o mesmo grupo
  fictício retornou `42501 — Sem permissão`;
- a simulação técnica com grupo fictício não alterou nenhum pedido real.

## Resultado no navegador

- perfil de Vendas (Marselle): ao abrir `/pedidos-pj`, foi redirecionado para a
  tela inicial, como esperado;
- perfil permitido da Expedição: abriu a fila sem valores e sem ações
  comerciais, com 11 pedidos em aberto e 39 no Histórico;
- Rodrigo confirmou no preview o envio real do pedido de LUCKY COFFE CAFETERIA
  LTDA, que saiu de Em aberto e apareceu no Histórico como ENVIADO;
- o detalhe mostrou Croissant, 64 unidades e `Por expedicao em 21/07/2026,
  13:54`, sem preço ou total;
- a leitura posterior no banco confirmou uma linha enviada, um único horário
  (`21/07/2026 13:54:04`) e um único responsável (`expedicao`), sem duplicação;
- a interface nova ainda não está em produção; ela permanece no PR draft 149.

## Alertas fora do escopo

Os Advisors do Supabase continuam listando alertas gerais do projeto. Nenhum
alerta de segurança apontou as novas funções, gatilhos ou policy. O índice novo
aparece como não utilizado imediatamente após a criação, o que é esperado antes
do uso da fila em produção.

O histórico operacional da tela de Romaneios continua fora da Fase 2. A nova
permissão entregue nesta migration é **Confirmar envio de Pedido PJ**.
