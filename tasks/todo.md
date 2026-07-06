# Tarefa: corrigir fechamento de caixa

Pedido aprovado pelo Rodrigo em 06/07/2026: ajustar o fechamento para refletir
o processo real da loja e remover negativos causados por campos informativos.

## Entendimento

- Total em dinheiro e todo o dinheiro fisico contado no caixa no fechamento.
- Venda em dinheiro = total em dinheiro + sangrias - abertura do caixa.
- Total do dia = venda em dinheiro + Banrisul + Stone + SiTef + Pix.
- iFood, envelope e proximo dia sao apenas informativos.
- O usuario deve preencher os campos na ordem operacional definida pelo Rodrigo.

## Plano

- [x] Ler documentos obrigatorios e auditar a tela de fechamento.
- [x] Ajustar calculo do fechamento e testes.
- [x] Reordenar a tela na sequencia operacional.
- [x] Validar testes, typecheck, lint e build.

## Fora desta entrega

- Nao alterar schema ou dados do Supabase.
- Nao mexer em auth, PINs, roles ou login.
- Nao criar integracao com CNM, iFood ou maquininhas.
