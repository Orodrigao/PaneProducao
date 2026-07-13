# Tarefa: restaurar acesso ao lançamento de sobras e descartes

Erro identificado pelo Rodrigo em 13/07/2026: o item Sobras do menu passou a
abrir diretamente a Central de Pendências e escondeu a tela operacional de
lançamento que continua disponível em `/sobras`.

## Plano

- [x] Ler documentos obrigatórios e identificar a regressão de navegação.
- [x] Restaurar `/sobras` como entrada principal do item Sobras no menu.
- [x] Adicionar teste de regressao para preservar o destino do menu.
- [x] Validar teste, typecheck, lint e build.

## Fora desta entrega

- Não alterar schema nem dados do Supabase.
- Não mudar regras de destino, estoque, lote ou reaproveitamento.
- Não mexer em auth, PINs, roles ou login.
- Não redesenhar as telas de lançamento ou da Central de Pendências.
