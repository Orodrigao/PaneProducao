# Tarefa: leitor XLS de vendas do CNM

Pedido aprovado pelo Rodrigo em 11/07/2026: criar a base de leitura do
relatório de vendas por produto exportado pelo Controle Na Mão.

## Entendimento

- O relatório deve ser gerado em Vendas, exibido por Produto.
- No CNM, o local `Pane Salute` corresponde à loja `jc` no ERP.
- O botão XLS só habilita após escolher o local e aplicar os filtros.
- O arquivo real é `.xls`, tem três linhas iniciais de título/espaço e contém
  Produto, Categoria, Quantidade, CMV, P/ viagem e Valor Total Produtos -
  Descontos. A última linha traz somente o total líquido.
- Este PR apenas lê, valida e normaliza o arquivo; não grava vendas nem baixa
  estoque.
- O relatório real não será adicionado ao repositório. Os testes usarão dados
  anonimizados.

## Plano aprovado

- [x] Auditar no CNM o fluxo real, as colunas e o formato do arquivo.
- [x] Confirmar o vínculo `Pane Salute -> jc`.
- [x] Instalar a versão aprovada do leitor XLS.
- [x] Criar contratos e parser TypeScript com validações explícitas.
- [x] Criar fixture anonimizada em memória e testes do fluxo principal/erros.
- [x] Validar o parser contra o arquivo real apenas localmente.
- [x] Rodar testes, typecheck, lint, build e revisar o diff.
- [x] Commitar, publicar e integrar na `main` após validação completa.

## Fora desta entrega

- Tabelas, migrations, RLS ou escrita no Supabase.
- Tela de upload, prévia ou mapeamento de produtos.
- Confirmação da importação e baixa de estoque.
- Automação do navegador ou armazenamento de credenciais do CNM.
- Mapeamento de JA ou alterações no fluxo de EX.
