# Tarefa técnica — corrigir salvamento da produção da Loja EX

## Problema

Após o login de Marselle (`borges@paneesalute.com.br`), a tela **Produção >
Loja EX** carrega normalmente, mas exibe “Erro ao salvar. Tente novamente.” ao
salvar o pedido. A sessão permanece válida, porém as linhas não são gravadas.

## Causa confirmada

Marselle possui perfil ativo com role `vendas` e loja `ex`. O formulário da
Loja EX salva suas linhas em `public.orders` com `order_type = 'producao'`, mas
as policies RLS autenticadas da tabela permitiam ao perfil `vendas` escrever
somente linhas com `order_type = 'encomenda'`.

Assim, o token de login era enviado corretamente, mas o `DELETE` não alcançava
as linhas existentes e o `INSERT` era rejeitado pelo banco com HTTP 403.

## Escopo

- identificar explicitamente os pedidos do formulário de produção com
  `order_type = 'producao'`;
- permitir que um perfil ativo de `vendas` insira, altere e exclua produção
  somente quando a linha pertence à loja cadastrada em seu próprio perfil;
- manter o acesso já existente de `admin`, `financeiro` e do fluxo de
  `encomenda`;
- impedir que Marselle altere produção de JC, JA, PJ ou qualquer outra loja;
- preservar a sessão Supabase Auth durante a gravação;
- cobrir payload e policies com teste de regressão.

## Critérios de aceite

- [ ] Marselle entra com `borges@paneesalute.com.br` e acessa **Produção > Loja
  EX**.
- [ ] Ao salvar ao menos uma quantidade, a interface confirma “Pedido salvo!”.
- [ ] Ao recarregar a mesma data, as quantidades e a observação permanecem
  salvas.
- [ ] Marselle continua autenticada após salvar e consegue navegar no ERP sem
  novo login.
- [ ] O perfil `vendas` da loja EX consegue inserir, alterar e excluir somente
  pedidos `producao` da loja EX.
- [ ] O mesmo perfil não consegue modificar pedidos `producao` de JC, JA ou PJ.
- [ ] Os fluxos de encomendas, administrador e financeiro continuam
  funcionando.
- [ ] Lint, TypeScript, testes e build passam.

## Validação e rollback

Validar as policies no catálogo do Postgres e executar a gravação em uma data de
teste sem impacto operacional. Em caso de regressão, restaurar as policies da
migration anterior, que restringiam `vendas` a `order_type = 'encomenda'`.
