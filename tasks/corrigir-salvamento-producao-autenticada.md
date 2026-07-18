# Tarefa técnica — corrigir salvamento da produção autenticada

## Problema

Após a migração do login legado por PIN para Supabase Auth, a tela **Produção >
Itens JC** carrega para o usuário autenticado, mas exibe erro ao salvar a lista.
A sessão permanece ativa, porém o `POST` para `product_production` retorna HTTP
403.

## Causa confirmada

A tabela `public.product_production` tinha privilégios de tabela para
`authenticated`, mas somente policies RLS destinadas ao papel `anon`. O token
do login por e-mail identifica corretamente o usuário como `authenticated`, que
não encontrava policy de `INSERT`, `UPDATE` ou `DELETE`.

## Escopo

- remover as policies e os privilégios anônimos de `product_production`;
- permitir leitura a qualquer perfil ERP ativo;
- permitir escrita somente a perfis ativos com role `admin`, único perfil ao
  qual a interface atual oferece o salvamento de Itens JC;
- preservar a sessão Auth durante consultas e gravações;
- cobrir a migration com teste de regressão.

## Critérios de aceite

- [ ] Um administrador autenticado abre Produção > Itens JC e enxerga a lista
  já salva para a data selecionada.
- [ ] Um administrador autenticado salva uma lista com ao menos um item e recebe
  a confirmação “Lista de itens salva!”.
- [ ] Ao recarregar a mesma data, quantidades e observação permanecem salvas.
- [ ] O usuário continua autenticado após salvar e consegue navegar no ERP sem
  novo login.
- [ ] Um perfil ativo não administrador consegue consultar a lista, mas não
  consegue inserir, alterar ou excluir linhas diretamente.
- [ ] Uma requisição sem sessão não consegue consultar nem modificar
  `product_production`.
- [ ] Lint, TypeScript, testes e build passam.

## Validação e rollback

Validar primeiro as policies no catálogo do Postgres, depois executar o fluxo
completo em uma data sem impacto operacional. Em caso de regressão, reverter a
migration restaurando as policies anteriores somente como medida emergencial;
não manter escrita anônima como solução definitiva.
