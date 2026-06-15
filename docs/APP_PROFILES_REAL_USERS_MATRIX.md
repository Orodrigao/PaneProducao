# Matriz preliminar de usuários reais — app_profiles

Status: rascunho para validação.
Ação: não inserir no Supabase ainda.

## Conceito corrigido

* `PJ` não é loja/unidade.
* `PJ` representa clientes pessoa jurídica / Pedidos PJ.
* As lojas/unidades atuais são:

  * `jc` — Júlio de Castilhos
  * `ex` — Exposição
  * `ja` — Jardim América
  * `global` — acesso transversal
* Setores como produção, expedição, atendimento e financeiro não devem ser tratados como lojas.
* Não usar `store = 'pj'` para usuários.
* A constraint atual da tabela ainda permite `pj`, mas isso deve ser tratado em tarefa futura específica, sem mexer agora.

## Matriz preliminar

| Pessoa | E-mail futuro Supabase Auth | Função real | Role sugerida | Loja/Escopo | Acesso desejado | Observações |
| --- | --- | --- | --- | --- | --- | --- |
| Rodrigo | [rodrigao@gmail.com](mailto:rodrigao@gmail.com) | Dono | admin | global | Tudo | Admin principal |
| Suélen | [dra.suelen.oliveira@gmail.com](mailto:dra.suelen.oliveira@gmail.com) | Financeiro / gestão | admin | global | Tudo | Admin |
| Elis | [financeiro@paneesalute.com.br](mailto:financeiro@paneesalute.com.br) | Financeiro | financeiro | global | Financeiro, compras, pedidos, cadastro de produtos, tabelas de preços | Escopo global aprovado por envolver financeiro, compras, pedidos, cadastro de produtos e tabelas de preços. |
| Geolar | A definir | Padeiro chefe | producao | jc | Produção, congelados, lista de compras, forno | Sem e-mail no momento |
| Sander | A definir | Produção | producao | jc | Forno | Sem e-mail no momento |
| Fran | A definir | Produção | producao | jc | Congelados, lista de compras | Sem e-mail no momento |
| Brian | [expedicao1pane@gmail.com](mailto:expedicao1pane@gmail.com) | Expedição | expedicao | jc | Romaneio, congelados, estoque, Pedidos PJ | E-mail definido. PJ é canal/tipo de pedido, não loja |
| Gustavo | [expedicao2pane@gmail.com](mailto:expedicao2pane@gmail.com) | Expedição | expedicao | jc | Romaneio, congelados, Pedidos PJ | E-mail definido. PJ é canal/tipo de pedido, não loja |
| Liara | A definir | Atendimento | vendas | jc | Sobras, congelados, lista de compras, encomendas, fechamento de caixa | Fechamento de caixa ainda não existe |
| Samuca | A definir | Atendimento | vendas | jc | Sobras, congelados, lista de compras, encomendas | Sem e-mail no momento |
| Cleo | A definir | Atendimento | vendas | ja | Sobras, congelados, lista de compras, encomendas, fechamento de caixa | Fechamento de caixa ainda não existe |
| Atendimento EX | A definir | Atendimento | vendas | ex | Congelados somente EX, romaneio EX | Pendente: não tratar como usuário real; substituir por uma pessoa real com e-mail próprio. Não criar usuário compartilhado |
| Marselle | [borges@paneesalute.com.br](mailto:borges@paneesalute.com.br) | Gerente EX | vendas | ex | Congelados somente EX, romaneio EX, pedidos produção | Manter como vendas por enquanto; role `gerente_loja` pode ser avaliada futuramente, mas não será criada agora |

## Decisões aprovadas nesta etapa

- Elis terá escopo global.
* Marselle permanece como vendas por enquanto.
* Não será criada role `gerente_loja` agora.
* Atendimento EX não será criado como usuário genérico.
* E-mails pendentes não bloqueiam a evolução técnica, desde que nenhum usuário/profile real seja criado ainda.
* Nenhuma alteração será feita no login atual.

## Pendências antes de inserir qualquer profile

* Obter e-mails de Geolar, Sander, Fran, Liara, Samuca, Cleo e pessoa real do Atendimento EX.
* Trocar “Atendimento EX” por pessoa real, com e-mail próprio.
* Avaliar futuramente se Marselle precisará de role `gerente_loja`, sem criar essa role agora.
* Definir se “fechamento de caixa” será feature futura e quais roles terão acesso.
* Planejar ajuste futuro para remover `pj` da constraint de `store`, se confirmado que PJ nunca será loja.

## Ponto de parada obrigatório

Antes de qualquer ação futura que crie usuários, insira profiles, execute SQL, altere Supabase Auth, altere login ou mexa em `app_users`, o Codex deve parar e pedir aprovação explícita do Rodrigo.
