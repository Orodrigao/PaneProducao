# Tarefa: indicador de ficha tecnica no catalogo

Pedido aprovado pelo Rodrigo em 06/07/2026: mostrar na tela de produtos quais
itens ja tem ficha tecnica e quais ainda estao sem ficha.

## Entendimento

- A tela de produtos ja carrega os componentes das fichas tecnicas.
- Produto com componentes cadastrados deve aparecer com indicador de ficha.
- Produto elegivel sem componentes deve aparecer com indicador de sem ficha.
- Insumos e produtos de revenda nao devem ser tratados como pendencia de ficha.
- A mudanca deve ser visual, sem alterar banco, auth ou regras de ficha.

## Plano

- [x] Ler documentos obrigatorios e auditar a tela de produtos.
- [x] Adicionar selo com icone para ficha existente ou ausente.
- [x] Validar testes, typecheck, lint e build.

## Fora desta entrega

- Nao alterar schema ou dados do Supabase.
- Nao mexer em auth, PINs, roles ou login.
- Nao alterar fluxo de cadastro da ficha tecnica.
