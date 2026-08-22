-- Vinte insumos usados em ficha tecnica diziam unidade "un" enquanto as receitas
-- estao escritas em quilo. A prova esta na propria quantidade usada: ninguem
-- coloca 0,002 unidade de gergelim num pao, coloca 2 gramas. Sal aparece em 21
-- receitas, agua em 20, fermento em 17, melhorador em 14.
--
-- Isso nao e so rotulo feio: abre um PONTO CEGO na trava criada em
-- 20260822143544. private.unidade_familia compara a familia da unidade da NF-e
-- com a da receita; com a nota em UN e o cadastro em "un", as duas dizem
-- "unidade", a trava nao toca e o fator 1 passa calado — que e exatamente o erro
-- que gravou farinha de saco de 25 kg a R$ 74,00 o quilo. Com o cadastro em kg,
-- a trava passa a enxergar a diferenca.
--
-- Regra de dominio, palavras do Rodrigo em 2026-08-22: "no mundo da padaria tudo
-- e por kg". Vale inclusive para liquidos — agua e leite tambem vao para kg, e
-- nao para litro, porque panificacao trabalha por porcentagem de padeiro, que e
-- peso sobre peso de farinha.
--
-- Excecao na direcao oposta, tambem decisao dele: produto de limpeza nao se
-- fraciona ("em lugar algum me interessa saber se gastou 100 ml de alcool").
-- Alcool e desmoldante saem de litro/LT e vao para "un".
--
-- NENHUM CUSTO MUDA AQUI. products.cost_price fica igual, e as quantidades das
-- receitas ficam iguais, entao o CMV calculado nao se move nem um centavo — so
-- o rotulo ao lado do numero passa a dizer a verdade. O acerto dos valores vem
-- na fase seguinte, com a conferencia item a item.
--
-- Seguranca conferida antes de escrever: varridas as 25 tabelas que referenciam
-- products. Nenhum destes 22 cadastros tem preco de venda, tabela de preco,
-- romaneio, sobra, descarte, estoque, producao ou receita propria. Aparecem
-- apenas em receitas, compras e cotacoes. As 20 linhas em product_sale_options
-- sao carga generica criada em lote em 26/06 e carregam unidade propria
-- (sale_unit), separada desta.
--
-- O registro do antes e depois e esta propria migration: cada linha declara a
-- unidade anterior, e o UPDATE so toca a linha que ainda estiver nela. Rodar de
-- novo nao faz nada.

begin;

with correcao(produto_id, unidade_anterior, unidade_nova) as (values
  ('d19dc545-2f41-4fa0-9f2e-05298d232fcd'::uuid, 'un', 'kg'), -- AGUA  INSUMO
  ('b0308cc7-8356-4c1e-8fb7-314dc2b0e6ed'::uuid, 'un', 'kg'), -- ALECRIM INSUMO
  ('9fc54b1e-a040-4787-9510-17d0722a51be'::uuid, 'un', 'kg'), -- CHIPS FORNEAVEL AO LEITE
  ('bbc944c1-d074-498b-98e4-995cf5ea69d6'::uuid, 'un', 'kg'), -- CHOCOLATE EM PO 50% KG
  ('a7f1d18b-4008-4e01-aeaf-b3350aedf395'::uuid, 'un', 'kg'), -- DOCE DE LEITE 4,75KG MUMU
  ('0c0d65e0-94f5-4e71-8e02-0d96b0a15b98'::uuid, 'un', 'kg'), -- Farinha de Trigo Croissant
  ('4079150d-e431-471b-b8cb-917966d454cc'::uuid, 'un', 'kg'), -- Farinha de Trigo Integral
  ('a36b5a31-e4db-4e3f-92fd-928b1a343853'::uuid, 'un', 'kg'), -- FERMENTO BIO FRESCO MASSA DOCE
  ('44f3c6ea-31c6-49d1-bf39-640074fcefba'::uuid, 'un', 'kg'), -- FERMENTO INST. MASSA DOCE INSU
  ('2647b417-8aad-438f-b609-461c29b5f076'::uuid, 'un', 'kg'), -- GERGELIM TOSTADO KG INSUMO
  ('f71fd8e1-9e78-4b9a-aaaa-6706b6df2561'::uuid, 'un', 'kg'), -- GRAO CHIA PRETA KG INSUMO
  ('7ab5228f-dddb-408d-aef0-6d51e60e42b4'::uuid, 'un', 'kg'), -- LEITE INTEGRAL 1LT
  ('6f7ad161-2b74-42f1-9466-53e3be427688'::uuid, 'un', 'kg'), -- LINGUICA CALABRESA INT INSUMO
  ('90115b0d-53c1-44eb-9847-c3272f619963'::uuid, 'un', 'kg'), -- MANTEIGA ( SEM SAL ) KG INSUMO
  ('d3f81108-40b5-426e-8527-3dc9a253ba2d'::uuid, 'un', 'kg'), -- MARGARINA KG INSUMO
  ('2fef3dd1-36a8-40f9-bf11-6a2c35b4dcb2'::uuid, 'un', 'kg'), -- Melhorador Puraflex 500gr
  ('3802d816-6bda-4e2a-b722-bf0b011fc437'::uuid, 'un', 'kg'), -- PHIL SARRASIN
  ('b3fbcf7b-8734-4419-bfa1-7ae27ad61802'::uuid, 'un', 'kg'), -- Queijo Mussarela Forma
  ('5d655666-1932-4477-a6cf-58a201c4ef5a'::uuid, 'un', 'kg'), -- Queijo Parmesão forma
  ('716b1629-9392-465c-a704-4e612b377ae1'::uuid, 'un', 'kg'), -- SAL
  ('e85d5bef-b7e3-4239-9ca3-6421f1131708'::uuid, 'litro', 'un'), -- ALCOOL LIQUIDO 5L
  ('4030e4b5-6661-422b-9ad6-5e140cdc3961'::uuid, 'LT', 'un')  -- DESMOLDANTE DESTAK 5LT PURATOS
)
update public.products produto
set unit = correcao.unidade_nova
from correcao
where produto.id = correcao.produto_id
  and produto.unit is not distinct from correcao.unidade_anterior;

commit;
