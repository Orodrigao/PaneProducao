# CATALOGO_PRODUTOS.md — Tipos e categorias controladas

**Criado em:** 2026-09-03. Registra um plano aprovado por Rodrigo em 2026-09-02
que até aqui existia somente na conversa e no manifesto da tarefa.

**Autoridade:** este documento descreve o plano e as decisões. O que existe de
fato está no código, nas migrations e nos testes.

## Problema

A categoria do produto é texto livre. "Insumos", "INSUMOS" e "insumos " podem
existir como três categorias diferentes, e existem variações assim no cadastro
real. Isso quebra qualquer agrupamento confiável: relatório por família de
insumo, comparação de preço e CMV por família dependem de a categoria ser a
mesma coisa escrita do mesmo jeito.

Além disso, o catálogo mistura naturezas diferentes num único campo de texto:
matéria-prima de receita, embalagem, material de higiene, item de escritório,
utensílio, manutenção, produto fabricado, revenda e kit. Sem essa separação,
a pergunta central do repositório ("para onde vai o dinheiro") não tem resposta
por família.

**Não confundir com as categorias financeiras do DRE.** São duas listas
diferentes, com propósitos diferentes: a do DRE classifica o lançamento; esta
classifica o item do catálogo.

## Decisão de ordem, tomada por Rodrigo em 2026-09-02

Primeiro **bloquear sujeira nova**, depois **limpar a antiga**. A limpeza dos
dados existentes não anda junto com a criação da estrutura, porque limpar exige
decisão item por item e a estrutura precisa existir antes.

Consequência aceita: enquanto a migração assistida não acontecer, tipo e
categoria controlada são informação **opcional** no cadastro, e a categoria em
texto livre continua existindo em paralelo.

## Fase 1 — Fundação (PR #318, aguardando teste do Rodrigo)

**Escopo:** o lugar onde as categorias passam a viver de forma controlada.

- tabela `public.product_categories`: nome, nome normalizado gerado pelo banco,
  tipo de item fixo, ordem e situação. RLS forçada, leitura para perfil ativo,
  escrita somente pela função `manage_product_category`, restrita a
  administrador;
- `public.products` ganha `catalog_type` e `category_id`, os dois opcionais,
  com chave estrangeira composta que impede um produto de um tipo receber
  categoria de outro;
- tela `/produtos/categorias`, com link no topo de Produtos apenas para
  administrador;
- nome normalizado por decomposição Unicode, o mesmo algoritmo no navegador e
  no banco, para que acento embutido e acento escrito como caractere separado
  produzam a mesma chave.

**Os nove tipos de item:** matéria-prima, embalagem, higiene e limpeza,
escritório e administrativo, utensílio e equipamento, manutenção, produto
fabricado, produto de revenda, kit.

**O que a fase 1 deliberadamente NÃO faz:** não reclassifica nenhum produto,
não renomeia nada, não apaga nada, e não troca a categoria em texto livre da
tela antiga de produto.

## Fases seguintes, na ordem prevista

O escopo abaixo está aprovado em linhas gerais; cada fase ainda recebe plano
próprio e aprovação antes de começar.

### Fase 2 — A tela de produto passa a usar a lista controlada

O cadastro de produto escolhe tipo e categoria da lista, em vez de digitar
texto. As duas informações convivem durante a transição: o texto legado
permanece na coluna antiga até a fase 4.

Decisão pendente: se tipo e categoria passam a ser obrigatórios para item novo
já nesta fase, ou somente depois da migração assistida.

### Fase 3 — Migração assistida do cadastro existente

Uma tela que percorre o cadastro atual e permite classificar em lote, com
sugestão automática a partir do texto legado. Rodrigo revisa e confirma; nada é
reclassificado sozinho.

Ordem de grandeza conhecida: cerca de 337 insumos, mais os demais itens do
catálogo.

### Fase 4 — Aposentar a categoria em texto livre

Só depois de a migração assistida cobrir o cadastro. Remoção de coluna em uso é
mudança destrutiva e segue a regra de duas fases do AGENTS.md: primeiro o site
para de usar, em um PR, depois o banco remove, em outro.

### Fase 5 — Relatórios por família

A entrega que justifica as anteriores: custo, compras e CMV por família de
insumo e por tipo de item.

## Riscos e dívidas registradas

- **Duas implementações da normalização de nome**, uma no navegador
  (`src/lib/productCategories.ts`) e uma no banco
  (`private.normalize_product_category_name`). Elas precisam mudar juntas. Hoje
  produzem a mesma chave, provado em teste dos dois lados; se divergirem, o
  banco aceita categoria duplicada, que é exatamente o que esta estrutura
  existe para impedir.
- **O nome de uma categoria inativa continua reservado.** Não dá para criar
  outra com o mesmo nome sem reativar a antiga. É intencional, para não mascarar
  duplicata.
- **A rota `/produtos/categorias` é filha de `/produtos`.** Quem tem acesso a
  Produtos alcança o endereço direto; a tela devolve quem não é administrador, e
  o banco recusa qualquer escrita dessa pessoa. Só administrador vê o botão.
