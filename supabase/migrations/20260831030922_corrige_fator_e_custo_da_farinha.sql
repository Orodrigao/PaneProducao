-- A farinha de trigo custava R$ 74,00 o quilo. Custa R$ 2,96.
--
-- A nota diz "FARINHA DE TRIGO TIPO 1 NORDESTE 25KG PAPEL", 48 sacos por
-- R$ 3.552,00. O vinculo entre a linha da nota e o cadastro foi gravado com
-- fator de conversao 1, ou seja, o sistema acreditou que os 48 eram QUILOS e
-- nao SACOS DE 25 KG. Resultado: 3552 / 48 = R$ 74,00 o quilo, quando o real e
-- 3552 / 1200 = R$ 2,96.
--
-- POR QUE ISSO E O CONSERTO MAIS CARO DE AGOSTO: a farinha esta em 23 das 31
-- fichas tecnicas. Medido antes de escrever esta migration, o custo das fichas
-- afetadas cai entre 60% e 96%. Nenhuma cai menos de 60%.
--
-- POR QUE SO A FARINHA: dos 41 insumos que as fichas usam, apenas 9 ja
-- receberam custo de nota fiscal, e destes so a farinha esta errada. Os outros
-- 32 tem custo digitado a mao e serao conferidos pelo Rodrigo em separado.
-- Existem outros vinculos com fator errado no cadastro, mas nenhum deles esta
-- em receita: eles sujam o historico de compras e ficam para setembro.
--
-- FORMA DESTA MIGRATION: segue a licao
-- `correcao-de-dado-de-producao-nao-se-testa-por-igualdade` (22/08). Cada
-- UPDATE declara o valor ANTERIOR e so muda a linha se ela ainda estiver
-- naquele valor. Assim: rodar de novo nao faz nada, o proprio arquivo registra
-- o antes e o depois, e se alguem tiver corrigido a mao antes de isto ser
-- aplicado, o UPDATE nao encontra a linha e nao atropela a correcao dele.
--
-- REVERSAO: migration e so ida. Para voltar, uma migration nova devolvendo
-- fator 1 e custo 74,00. Nao ha por que: o valor antigo esta comprovadamente
-- errado contra a propria nota fiscal.

begin;

-- 1) O vinculo, para que as PROXIMAS notas de farinha ja entrem certas.
--    Sem isto, a correcao do custo abaixo seria desfeita na proxima
--    importacao, que voltaria a dividir por 48.
update public.payable_product_mappings
set conversion_factor = 25,
    conversion_basis = 'package',
    updated_at = now()
where id = '613ad02c-a202-4a1c-9466-dbea4f00a28f'
  and conversion_factor = 1
  and active;

-- 2) O custo do insumo, que e o numero que as 23 fichas leem hoje.
--    3552,00 / (48 sacos x 25 kg) = 2,96.
update public.products
set cost_price = 2.96
where name = 'Farinha de Trigo'
  and cost_price = 74.00;

-- 3) A prova, escrita para PRENDER onde a linha existe e CALAR onde ela nao
--    existe.
--
--    Isto nao e detalhe: as duas linhas so existem em PRODUCAO. O ensaio do
--    semaforo monta um banco limpo a partir de migrations e seed, onde nao ha
--    nem o vinculo nem o insumo com este nome (o seed usa "[TESTE] Farinha de
--    trigo", outro nome de proposito). Uma prova que exigisse os valores sem
--    perguntar se a linha existe reprovaria o ensaio de toda PR daqui em
--    diante, sem nenhum defeito real.
--
--    Entao a regra e condicional: SE a linha estiver la, ela tem de estar
--    corrigida. Em producao isso prende; no banco limpo passa por vacuidade.
do $$
declare
  v_fator numeric;
  v_custo numeric;
  v_achou boolean;
begin
  select conversion_factor, true into v_fator, v_achou
  from public.payable_product_mappings
  where id = '613ad02c-a202-4a1c-9466-dbea4f00a28f';

  if v_achou and v_fator is distinct from 25 then
    raise exception using errcode = '22023',
      message = 'O vinculo da farinha existe e nao ficou com fator 25; encontrado: ' || v_fator::text;
  end if;

  v_achou := null;

  select cost_price, true into v_custo, v_achou
  from public.products
  where name = 'Farinha de Trigo';

  if v_achou and v_custo is distinct from 2.96 then
    raise exception using errcode = '22023',
      message = 'O insumo Farinha de Trigo existe e nao ficou em 2,96; encontrado: ' || v_custo::text;
  end if;
end
$$;

commit;
