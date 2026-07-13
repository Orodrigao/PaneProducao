# Tarefa: corrigir telas presas em “Carregando...” após login

Relato do Rodrigo em 13/07/2026: vários usuários entram no ERP, mas telas ficam
indefinidamente em “Carregando...”. O problema já ocorreu em Congelados, Caixa e
Romaneio. A tela móvel mostra a navegação inferior, porém não abre o conteúdo.

## Evidência e causa confirmada

- Os logs do Supabase registram respostas `401` para `destinations` e
  `product_prices` em acessos móveis ao Romaneio.
- Essas tabelas aceitam leitura somente com a função `authenticated` e perfil
  ativo autorizado para `/romaneio`.
- `src/app/romaneio/page.tsx` faz as chamadas usando sempre a chave pública como
  `Authorization`, descartando o token da sessão do usuário que acabou de entrar.
- Quando uma chamada falha, o overlay é fechado, mas `screen` continua em `init`;
  por isso um segundo carregamento sem saída permanece visível.

## Plano aprovado

- [x] Mapear todas as consultas REST diretas que ainda substituem o token do
      usuário pela chave pública, não apenas as três telas relatadas.
- [x] Criar um helper compartilhado que envie o token da sessão Supabase quando
      houver login por e-mail e preserve temporariamente o fallback PIN.
- [x] Migrar Congelados, Caixa, Romaneio e qualquer outra rota protegida que use
      o padrão incorreto, sem alterar regras de negócio.
- [x] Tratar sessão expirada/ausente e erros de carga com mensagem clara e saída
      do estado de carregamento; quando necessário, retornar ao login.
- [x] Adicionar testes para token autenticado, fallback PIN, erro de sessão e
      garantia de que nenhuma rota protegida mantém o cabeçalho incorreto.
- [x] Registrar a lição do bug e atualizar a documentação de autenticação tocada
      pela correção.
- [x] Rodar testes, typecheck, lint e build; revisar o diff.
- [ ] Validar visualmente em navegador móvel autenticado; a conexão do navegador
      do Codex não ficou disponível nesta sessão.

## Escopo

- O número final de arquivos depende do inventário das chamadas diretas. A
  mudança continuará mecânica e limitada à autenticação/transição de loading.
- Fora do escopo: alterar RLS, reabrir acesso anônimo às tabelas, remover o login
  por PIN de todo o ERP, renomear outros usuários ou publicar na `main`.
