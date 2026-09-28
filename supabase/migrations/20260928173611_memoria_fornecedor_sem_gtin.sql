-- Memória de fornecedor: "SEM GTIN" deixa de ser código de barras (28/09/2026).
--
-- A NF-e escreve "SEM GTIN" no cEAN de todo produto sem código de barras, como
-- as farinhas a granel. As três funções que gravam e procuram a memória do
-- fornecedor (create_xml_payable, classify_payable_item e
-- classify_payable_item_without_product) comparavam esse texto como código de
-- barras: para elas, todos os produtos "SEM GTIN" do mesmo fornecedor e da mesma
-- unidade eram o mesmo produto. Efeitos medidos em produção nesta data:
--   * a Le 5 Stagioni ficou com uma memória só para três farinhas; cada nota
--     confirmada sobrescrevia a anterior, e a nota seguinte já chegou com
--     Mora e La Rustica preenchidas como farinha de croissant;
--   * 12 fornecedores mandam "SEM GTIN"; 7 memórias apontavam para o cadastro
--     de outro produto (açúcar mascavo -> damasco, cacau -> fermento...);
--   * marcar um item como uso ou despesa desligava a memória de outro produto
--     do mesmo fornecedor, e vice-versa.
--
-- O conserto normaliza só a memória, em vez de reescrever as três funções
-- grandes: um gatilho guarda nulo no lugar de qualquer código que não seja um
-- GTIN de verdade. Em toda comparação das três funções um dos lados é a memória
-- gravada (mapping.supplier_ean = <valor do item>); com a memória normalizada,
-- "SEM GTIN" nunca mais casa, venha o item do site atual, de um site antigo em
-- cache ou de um rascunho retomado, e o item passa a ser reconhecido pelo código
-- do produto do fornecedor, que a NF-e sempre traz (cProd é obrigatório). O item
-- da nota continua guardando o que a NF-e diz. O site aplica a mesma regra na
-- busca da memória (normalizeGtin em src/lib/nfeXml.ts).
--
-- As memórias que apontam para o cadastro errado não são corrigidas aqui: a
-- correção de dados vem na migration seguinte, com a lista conferida.

begin;

-- GTIN válido: 8, 12, 13 ou 14 dígitos, não só zeros e com o dígito verificador
-- GS1 certo (pesos 3 e 1 alternados a partir do vizinho do verificador). Número
-- com dígito errado repetido em produtos diferentes voltaria a juntar memórias;
-- sem ele, o reconhecimento cai no código do fornecedor. Em 28/09/2026 os 399
-- códigos numéricos gravados em produção tinham o dígito certo.
create or replace function private.gtin_valido(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when codigo.valor ~ '^([0-9]{8}|[0-9]{12,14})$'
      and codigo.valor !~ '^0+$'
      and (
        10 - (
          select sum(substr(lpad(codigo.valor, 14, '0'), posicao, 1)::int
                     * case when posicao % 2 = 1 then 3 else 1 end)
          from pg_catalog.generate_series(1, 13) as posicao
        ) % 10
      ) % 10 = right(codigo.valor, 1)::int
      then codigo.valor
    else null
  end
  from (select btrim(p_value) as valor) as codigo;
$$;

revoke all on function private.gtin_valido(text) from public, anon, authenticated;

create or replace function private.normalizar_gtin_memoria_fornecedor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.supplier_ean := private.gtin_valido(new.supplier_ean);
  return new;
end;
$$;

revoke all on function private.normalizar_gtin_memoria_fornecedor() from public, anon, authenticated;

drop trigger if exists normalizar_gtin_memoria_insumo on public.payable_product_mappings;
create trigger normalizar_gtin_memoria_insumo
before insert or update of supplier_ean on public.payable_product_mappings
for each row execute function private.normalizar_gtin_memoria_fornecedor();

drop trigger if exists normalizar_gtin_memoria_uso_despesa on public.payable_non_catalog_mappings;
create trigger normalizar_gtin_memoria_uso_despesa
before insert or update of supplier_ean on public.payable_non_catalog_mappings
for each row execute function private.normalizar_gtin_memoria_fornecedor();

-- Memórias já gravadas. As duas tabelas não têm outro gatilho, e só a coluna do
-- código de barras muda: updated_at fica como está, para a ordem "confirmação
-- mais recente" das memórias não mudar. Em 28/09/2026 eram 26 memórias com
-- "SEM GTIN", nenhuma com espaço em volta de um GTIN válido e nenhuma com dígito
-- verificador errado.
update public.payable_product_mappings
set supplier_ean = private.gtin_valido(supplier_ean)
where supplier_ean is distinct from private.gtin_valido(supplier_ean);

update public.payable_non_catalog_mappings
set supplier_ean = private.gtin_valido(supplier_ean)
where supplier_ean is distinct from private.gtin_valido(supplier_ean);

commit;
