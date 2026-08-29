-- PROVA DA FASE 0 DO BANCO POR PR. NAO INTEGRAR.
--
-- Esta migration existe para responder uma pergunta so: quando uma PR e
-- aberta, o Supabase cria um banco proprio dela e aplica a historia desta
-- branch, ou nao?
--
-- Por isso ela NAO altera objeto nenhum. Se alterasse, a prova viria junto com
-- um risco que a prova nao precisa. Um `select` que nao le tabela nenhuma
-- basta: ou a migration roda no banco da PR, ou nao roda, e as duas respostas
-- aparecem no painel do Supabase sem tocar em dado.
--
-- A PR desta migration e descartavel e vai ser fechada, nunca integrada.
select 1 as prova_do_banco_por_pr;

-- Toque real em arquivo do supabase/, para a integracao reagir.
-- Segundo toque, agora com a PR fora do rascunho.
