# Tarefa: relatório de romaneios para cobrança da EX

Pedido do Rodrigo em 13/07/2026: habilitar para a Elis o relatório de
romaneios da EX, com valores para fechamento e impressão de cobrança.

## Entendimento

- A fonte de preços é a tabela `Buck - Exposição`, preenchida pela Elis.
- Ciabatta e mini croissant são cobrados por kg; os demais pães, por unidade.
- O fechamento usa a quantidade aceita na conferência ou, sem conferência,
  a quantidade enviada.
- Linhas sem preço ou com unidade incompatível não entram no total de cobrança.

## Plano

- [x] Auditar acesso da Elis, romaneios e tabelas de preço existentes.
- [x] Criar cálculo testável de fechamento da EX por produto e unidade.
- [x] Criar o relatório com período, alertas de preço e impressão de cobrança.
- [x] Impedir Ciabatta por unidade nos novos romaneios destinados à EX.
- [x] Habilitar o card de Romaneios e validar testes, typecheck, lint e build.

## Fora desta entrega

- Não alterar preços, romaneios ou quantidades históricas automaticamente.
- Não alterar perfil, PIN, e-mail ou permissões da Elis.
- Não emitir nota fiscal nem criar cobrança financeira automática.
