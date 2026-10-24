-- Fechamento de caixa protegido (Financeiro fase 3, PR 1).
-- Esqueleto: abre a PR cedo para ela ganhar o banco de teste proprio. Os
-- casos chegam junto com a migration desta PR.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
select pass('esqueleto do teste do fechamento protegido');
select * from finish();
rollback;
