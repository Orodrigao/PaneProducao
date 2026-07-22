-- Catalogo de permissoes do sistema (dados, nao schema).
-- O baseline reproduz a estrutura do banco; este arquivo reproduz o
-- catalogo estavel de app_permissions, para que qualquer ambiente novo
-- nasca completo. Upsert idempotente: so escreve quando os valores
-- divergem do catalogo versionado; com dados identicos (producao hoje),
-- nenhuma linha e alterada.
-- Fonte: dump de producao em 2026-07-22. Permissao nova = nova migration.

INSERT INTO "public"."app_permissions" ("key", "module", "label", "description", "sort_order") VALUES
	('producao.acessar', 'Operacao', 'Producao', 'Acessar a tela de producao.', 10),
	('forno.acessar', 'Operacao', 'Forno', 'Acessar o fluxo do forno.', 20),
	('romaneio.acessar', 'Operacao', 'Romaneio', 'Acessar romaneios. Acoes detalhadas serao ativadas depois.', 30),
	('relatorios.acessar', 'Operacao', 'Relatorios', 'Acessar relatorios operacionais.', 40),
	('sobras.acessar', 'Operacao', 'Sobras', 'Registrar e consultar sobras.', 50),
	('caixa.acessar', 'Operacao', 'Caixa', 'Acessar fechamento de caixa.', 60),
	('congelado.acessar', 'Operacao', 'Congelado', 'Acessar estoque congelado.', 70),
	('saldo_paes.acessar', 'Operacao', 'Saldo de Paes', 'Acessar saldo de paes.', 80),
	('estoque.acessar', 'Operacao', 'Estoque', 'Acessar estoque de insumos.', 90),
	('compras.acessar', 'Comercial', 'Compras', 'Acessar listas de compras.', 110),
	('cotacoes.acessar', 'Comercial', 'Cotacoes', 'Acessar cotacoes.', 120),
	('fornecedores.acessar', 'Comercial', 'Fornecedores', 'Acessar fornecedores.', 130),
	('produtos.acessar', 'Comercial', 'Produtos', 'Acessar produtos.', 140),
	('clientes.acessar', 'Comercial', 'Clientes', 'Acessar clientes.', 150),
	('pedidos_pj.acessar', 'Comercial', 'Pedidos PJ', 'Acessar pedidos PJ.', 160),
	('encomendas.acessar', 'Comercial', 'Encomendas', 'Acessar encomendas.', 170),
	('tabelas_preco.acessar', 'Gestao', 'Tabelas de preco', 'Acessar tabelas de preco.', 210),
	('simulador.acessar', 'Gestao', 'Simulador', 'Acessar simulador de desconto.', 220),
	('usuarios.gerenciar', 'Administracao', 'Usuarios', 'Preparar permissoes de usuarios.', 310),
	('romaneio.visualizar', 'Romaneio', 'Visualizar', 'Consultar e imprimir romaneios.', 31),
	('romaneio.criar', 'Romaneio', 'Criar', 'Montar um novo romaneio para a loja selecionada.', 32),
	('romaneio.confirmar_saida', 'Romaneio', 'Confirmar saída', 'Confirmar a saída e movimentar o saldo de pães.', 33),
	('romaneio.conferir_recebimento', 'Romaneio', 'Conferir recebimento', 'Informar quantidades recebidas e divergências.', 34),
	('romaneio.aprovar_divergencia', 'Romaneio', 'Aprovar divergências', 'Aprovar divergências registradas no recebimento.', 35),
	('romaneio.administrar', 'Romaneio', 'Administrar', 'Acesso completo, inclusive exclusão e fechamento.', 36),
	('pedidos_pj.confirmar_envio', 'Comercial', 'Confirmar envio de Pedido PJ', 'Marcar um Pedido PJ como enviado pela Expedicao da JC.', 161)

ON CONFLICT (key) DO UPDATE SET
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order
WHERE (app_permissions.module, app_permissions.label,
       app_permissions.description, app_permissions.sort_order)
  IS DISTINCT FROM
      (excluded.module, excluded.label,
       excluded.description, excluded.sort_order);
