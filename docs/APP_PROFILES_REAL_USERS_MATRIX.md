# Matriz preliminar de usuários reais — app_profiles

Status histórico: a primeira leva de usuários Auth já foi criada. Esta matriz
não é fonte do estado atual e não deve ser reaplicada.

Use [CURRENT_STATE.md](CURRENT_STATE.md) e
[SUPABASE_AUTH_EMAIL_APPLY_RESULT.md](SUPABASE_AUTH_EMAIL_APPLY_RESULT.md).
Confirme dados pessoais diretamente com Rodrigo antes de qualquer alteração.

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
| Geolar | [producao1@paneesalute.com.br](mailto:producao1@paneesalute.com.br) | Padeiro chefe | producao | jc | Produção, congelados, lista de compras, forno | Confirmar se este e-mail será dele |
| Sander | [forno@paneesalute.com.br](mailto:forno@paneesalute.com.br) | Produção | producao | jc | Forno | Acesso forno |
| Fran | [cozinha@paneesalute.com.br](mailto:cozinha@paneesalute.com.br) | Produção | producao | jc | Congelados, lista de compras, cozinha | Acesso congelados/lista de compras/cozinha |
| expedicao | [expedicao@paneesalute.com.br](mailto:expedicao@paneesalute.com.br) | Expedição | expedicao | jc | Romaneio, congelados, estoque, Pedidos PJ | Conta setorial; PJ é canal/tipo de pedido, não loja |
| Gustavo | [expedicao2@paneesalute.com.br](mailto:expedicao2@paneesalute.com.br) | Expedição | expedicao | jc | Romaneio, congelados, Pedidos PJ | PJ é canal/tipo de pedido, não loja |
| Liara | [atendiment@paneesalute.com.br](mailto:atendiment@paneesalute.com.br) | Atendimento | vendas | jc | Sobras, congelados, lista de compras, encomendas, fechamento de caixa | Fechamento de caixa ainda não existe |
| Samuca | [atendimento2@paneesalute.com.br](mailto:atendimento2@paneesalute.com.br) | Atendimento | vendas | jc | Sobras, congelados, lista de compras, encomendas | E-mail definido |
| Cleo | [atendimento3@paneesalute.com.br](mailto:atendimento3@paneesalute.com.br) | Atendimento | vendas | ja | Sobras, congelados, lista de compras, encomendas, fechamento de caixa | Fechamento de caixa ainda não existe |
| Conferência EX | [producao2@paneesalute.com.br](mailto:producao2@paneesalute.com.br) | Conferência EX | vendas | ex | Congelados somente EX, romaneio EX | Definido por Rodrigo para esta etapa |
| Marselle | [borges@paneesalute.com.br](mailto:borges@paneesalute.com.br) | Gerente EX | vendas | ex | Congelados somente EX, romaneio EX, pedidos produção | Manter como vendas por enquanto; role `gerente_loja` pode ser avaliada futuramente, mas não será criada agora |

## E-mails gerais/setoriais

| E-mail | Uso previsto | Decisão atual |
| --- | --- | --- |
| [expedicao@paneesalute.com.br](mailto:expedicao@paneesalute.com.br) | E-mail geral/setorial da expedição | Registrar como e-mail setorial, não como usuário Auth individual por enquanto |

## Decisões aprovadas nesta etapa

* Elis permanece com escopo global.
* Fran usará [cozinha@paneesalute.com.br](mailto:cozinha@paneesalute.com.br).
* Sander usará [forno@paneesalute.com.br](mailto:forno@paneesalute.com.br).
* A conta setorial da expedição usa [expedicao@paneesalute.com.br](mailto:expedicao@paneesalute.com.br).
* Gustavo usará [expedicao2@paneesalute.com.br](mailto:expedicao2@paneesalute.com.br).
* Liara, Samuca e Cleo usarão [atendiment@paneesalute.com.br](mailto:atendiment@paneesalute.com.br), [atendimento2@paneesalute.com.br](mailto:atendimento2@paneesalute.com.br) e [atendimento3@paneesalute.com.br](mailto:atendimento3@paneesalute.com.br).
* Conferência EX usará [producao2@paneesalute.com.br](mailto:producao2@paneesalute.com.br).
* [expedicao@paneesalute.com.br](mailto:expedicao@paneesalute.com.br) fica como e-mail setorial, não usuário Auth individual por enquanto.
* Marselle permanece como vendas por enquanto.
* Não será criada role `gerente_loja` agora.
* Atendimento EX não será criado como usuário genérico.
* E-mails devem representar pessoas reais sempre que possível, para preservar auditoria.
* Nenhum usuário será criado nesta etapa.
* Nenhum profile será inserido nesta etapa.
* Login atual não será alterado.

## Pendências antes de inserir qualquer profile

* Confirmar se [producao1@paneesalute.com.br](mailto:producao1@paneesalute.com.br) será de Geolar.
* Avaliar futuramente se Marselle precisará de role `gerente_loja`, sem criar essa role agora.
* Definir se “fechamento de caixa” será feature futura e quais roles terão acesso.
* Manter a regra de que e-mails devem representar pessoas reais sempre que possível, para preservar auditoria.
* Planejar ajuste futuro para remover `pj` da constraint de `store`, se confirmado que PJ nunca será loja.

## Ponto de parada obrigatório

Antes de qualquer ação futura que crie usuários, insira profiles, execute SQL, use Supabase MCP, altere Supabase Auth, altere login ou mexa em `app_users`, o Codex deve parar e pedir aprovação explícita do Rodrigo.
