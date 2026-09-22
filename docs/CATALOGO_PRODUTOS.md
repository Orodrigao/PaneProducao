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

## Fase 1 — Fundação (PR #318, em produção desde 2026-09-03)

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

**Os nove tipos de item da fase 1:** matéria-prima, embalagem, higiene e
limpeza, escritório e administrativo, utensílio e equipamento, manutenção,
produto fabricado, produto de revenda, kit. A fase 2A acrescentou o décimo,
**serviço** (ver abaixo).

**O que a fase 1 deliberadamente NÃO faz:** não reclassifica nenhum produto,
não renomeia nada, não apaga nada, e não troca a categoria em texto livre da
tela antiga de produto.

## Fases seguintes, na ordem prevista

O escopo abaixo está aprovado em linhas gerais; cada fase ainda recebe plano
próprio e aprovação antes de começar.

### Fase 2A — A lista nasce preenchida e o cadastro aponta para ela

Entregue em 2026-09-22. A fase 1 criou a estrutura e ninguém a preencheu: a
lista ficou vazia e os 655 produtos seguiram sem tipo e sem categoria
controlada. A unificação do texto livre (abaixo) deixou 20 grafias limpas, e
isso permitiu preencher tudo de uma vez, sem tela de classificação:

- as 20 categorias do cadastro entram na lista controlada, cada uma com o tipo
  de item decidido pelo Rodrigo: Insumos é matéria-prima; Embalagens, Higiene e
  limpeza, Escritório e Manutenção vão para os tipos de mesmo nome; Revenda é
  produto de revenda; as catorze categorias de venda são produto fabricado;
- nasce um **décimo tipo de item, serviço**, e com ele a vigésima primeira
  categoria, `Serviços`. Existe porque a padaria cobra tele-entrega por um
  "produto" chamado `Tele`, criado pela Elis para lançar o frete do cliente, e
  nenhuma das nove gavetas servia: não é matéria-prima, não é fabricado, não é
  revenda. Rodrigo decidiu criar a gaveta em vez de forçar o item numa errada;
  ela serve para qualquer taxa futura. O tipo vive em três lugares que precisam
  concordar: o check de `product_categories`, o de `products` e a validação
  dentro de `manage_product_category`, mais `CATALOG_TYPES` no navegador;
- `private.assign_controlled_product_categories()` amarra cada produto à
  categoria **ativa** de mesmo nome normalizado e grava tipo e categoria. Só
  toca produto sem os dois campos, então rodar de novo é seguro e decisão já
  registrada não é sobrescrita. Categoria inativa não classifica ninguém;
- cada classificação fica em `private.product_catalog_assignment_log` com o
  valor anterior e a rodada que a gravou;
- `products.category` não é tocado, então nenhuma tela que ainda lê o texto
  muda de comportamento;
- duas travas fecham em vez de adivinhar: categoria já cadastrada com tipo
  diferente do decidido aborta a migration, e produto cuja categoria não existe
  na lista também aborta. Classificar metade do catálogo em silêncio seria pior
  que recusar a migration.

**Como desfazer**, se um dia for preciso: sempre por migration nova, nesta
ordem. Primeiro devolver `catalog_type` e `category_id` dos produtos a partir
do registro, filtrando por `run_label` e comparando com os valores que a
rodada gravou, para não atropelar decisão tomada depois; só então apagar as
categorias, porque a chave estrangeira é `on delete restrict` e recusa apagar
categoria em uso. O SQL está escrito no cabeçalho da migration.

Os seis produtos marcados como kit (`products.kind = 'kit'`) seguem a categoria
de pão onde já estão. Quem responde "isto é um kit" hoje é `kind`; uma segunda
fonte para a mesma pergunta é como as grafias repetidas nasceram. Os tipos
`utensilio_equipamento` e `kit` continuam sem categoria até a operação precisar.

### Fase 2B — A tela de produto passa a usar a lista controlada

O cadastro de produto escolhe tipo e categoria da lista, em vez de digitar
texto, e o texto legado passa a ser gravado com o nome da categoria escolhida,
para as telas que ainda leem o texto continuarem certas. As duas informações
convivem até a fase 4.

Decisão do Rodrigo, 2026-09-22: tipo e categoria são **obrigatórios para
produto novo** já nesta fase. Produto antigo continua salvando sem travar.

### Fase 3 — Famílias de insumo

A migração assistida item a item deixou de ser necessária para classificar o
catálogo: a fase 2A fez isso pelo nome. O trabalho de decisão que sobra é
outro, e é o que o CMV precisa: os 340 insumos estão hoje numa família só,
chamada "Insumos". Quebrar isso em famílias reais (farinhas, laticínios,
fermentos, e assim por diante) continua exigindo decisão item a item, agora
sobre um recorte menor e com a estrutura pronta para receber.

### Fase 4 — Aposentar a categoria em texto livre

Só depois de a 2B estar no ar e de nenhuma tela depender mais do texto livre.
Hoje Sobras, Itens JC, Tabelas de preço e a contagem de estoque ainda leem
`products.category`. Remoção de coluna em uso é
mudança destrutiva e segue a regra de duas fases do AGENTS.md: primeiro o site
para de usar, em um PR, depois o banco remove, em outro.

### Fase 5 — Relatórios por família

A entrega que justifica as anteriores: custo, compras e CMV por família de
insumo e por tipo de item.

## Limpeza do texto legado, antes da fase 3 (2026-09-22)

A contagem de estoque agrupa pela categoria em texto livre, e as grafias
repetidas viravam grupos separados. Por decisão do Rodrigo, a migration
`20260922164735_unificar_categorias_produtos.sql` unificou o texto legado sem
esperar a lista controlada:

- uma grafia por grupo: `Insumos`, `Revenda`, `Embalagens`, `Higiene e limpeza`,
  `Manutenção`, `Escritório`, `Pães Recheados`;
- `Doce`, `Bolos`, `Muffins`, `Cookies`, `Brownie` e `Folhados & Doces` entram
  em `Confeitaria`; `Pães - Migrado` vira `Pães`;
- itens no grupo errado mudaram: bombons para Revenda; base de brigadeiro e
  mistura de panettone para Insumos; luva para Higiene e limpeza. Massa folhada
  ficou em Confeitaria porque tem preço em tabela de preço;
- uma categoria só de embalagem: o que põe a embalagem no custo do produto é a
  ficha técnica, não a categoria.

Cada troca fica em `private.product_category_unification_log` com o texto
antigo. As telas comparam `Insumos` sem diferenciar maiúscula. Essa limpeza é o
que tornou a fase 2A possível sem tela de classificação item a item.

**Segunda rodada, junto da fase 2A (2026-09-22).** Olhando os itens de cada
categoria, o Rodrigo achou mais dois grupos fora do lugar, e a migration
`20260922184538_categorias_controladas.sql` corrige os dez antes de classificar:

- cinco itens de limpeza que estavam em `Manutenção` (detergente neutro, escova
  de roupa, lã de aço, palha de aço e luva nitrílica) vão para
  `Higiene e limpeza`, pelo mesmo critério que mandou a luva de látex para lá.
  `Manutenção` fica só com a chave do toalheiro;
- cinco industrializados que estavam em `Insumos` e já vinham marcados com
  `is_revenda` (goma de mascar, café em pacote, muffin pronto e dois chocolates
  Trento) vão para `Revenda`, e param de contar como matéria-prima no custo.

A correção vem antes da classificação de propósito: trocar o texto depois
deixaria o produto com a categoria nova escrita e a gaveta antiga amarrada.
Um terceiro item saiu junto: `Tele`, que estava em `Confeitaria` marcado como
revenda, é a taxa de tele-entrega e foi para a categoria `Serviços`. No ERP ele
não está ligado a preço, romaneio, cobrança nem venda — conferido por consulta
somente leitura em 22/09/2026 —, então mudar sua categoria não altera nenhum
número registrado. Onde a cobrança de frete deve morar de verdade continua uma
pergunta aberta, maior que o catálogo.

## Riscos e dívidas registradas

- **Entre a fase 2A e a 2B, os dois campos divergem no primeiro salvamento.**
  A tela antiga monta o corpo do salvamento a partir de `select('*')`, então
  reescreve `catalog_type` e `category_id` com o valor antigo enquanto muda o
  texto livre. Nenhuma trava do banco reclama, porque a categoria antiga
  continua válida. Não é "pode divergir" um dia: é toda edição de categoria
  feita antes da 2B. A correção é a própria 2B; enquanto ela não vem, reclassificar
  exige uma migration nova, nunca comando manual em produção.
- **Produto criado depois da migration nasce sem classificação.** É o caso dos
  produtos fictícios do seed no banco de teste, que roda depois das migrations,
  e o de qualquer produto cadastrado antes de a 2B exigir a escolha. A função
  continua idempotente para isso, mas só uma migration pode chamá-la: ela não
  tem grant para nenhum papel de cliente.
- **O tipo das 20 categorias ficou imutável pela tela.** `manage_product_category`
  recusa trocar o tipo de categoria já usada por produtos, e depois desta fase
  todas as 20 têm produto. Mudar de ideia sobre um tipo (por exemplo, decidir
  que Lanches é revenda) passa a exigir PR com migration, não mais um clique do
  administrador. É consequência da fase 1, e vale saber antes de precisar.
- **Kit tem duas respostas que podem discordar.** Os 6 produtos com
  `kind = 'kit'` estão em `catalog_type = 'produto_fabricado'`. Para kit, **quem
  manda é `kind`**: qualquer soma por `catalog_type` precisa excluir
  `kind = 'kit'`, senão conta o kit e de novo os pães que o compõem, já que
  existe baixa de componentes de kit no projeto. Nada no banco força isso hoje;
  a regra é esta linha.
- **`is_revenda` é a outra fonte que ninguém conciliou.** A classificação deriva
  `produto_revenda` do texto da categoria, não da marcação `is_revenda`, que
  está viva em seis telas. Um produto marcado como revenda dentro de Insumos
  vira matéria-prima e as duas leituras discordam. A fase 2B precisa decidir
  quem manda antes de qualquer relatório somar por tipo.
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
