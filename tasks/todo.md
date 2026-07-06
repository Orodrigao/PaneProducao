# Tarefa: impressao do romaneio

Pedido aprovado pelo Rodrigo em 06/07/2026: permitir imprimir o romaneio
com as informacoes de envio, o destinatario fiscal e o remetente fiscal da
Pane Julio.

## Entendimento

- A impressao deve sair a partir do detalhe do romaneio.
- O remetente e sempre Pane Julio / RGF PANE PIZZA LTDA.
- Para Exposicao, o destinatario e Buck Comercio de Alimentos LTDA - ME.
- Para Jardim, o destinatario e Sf & Salute Padaria e Cafeteria Ltda.
- A impressao deve esconder a interface operacional e mostrar um documento
limpo com itens e dados de envio.

## Plano

- [x] Localizar a tela de detalhe do romaneio.
- [x] Adicionar botao de impressao no detalhe.
- [x] Criar documento imprimivel com remetente, destinatario, envio e itens.
- [x] Validar testes, typecheck e build.

## Fora desta entrega

- Nao alterar schema ou dados do Supabase.
- Nao mexer em auth, PINs, roles ou login.
- Nao alterar regras de envio/conferencia do romaneio.
