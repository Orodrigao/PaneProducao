# PRD — ERP Pane&Salute

**Dono do produto:** Rodrigo Gomes
**Natureza:** visão estável do produto, não acompanhamento de implementação.

Para fase e capacidades atuais, consulte
[CURRENT_STATE.md](CURRENT_STATE.md). Para a ordem de execução, consulte
[PLAN.md](PLAN.md).

## 1. Problema

A Pane&Salute tem operação relevante, produtos de boa margem e três lojas, mas
não possui visibilidade suficiente para explicar por que o dinheiro fica curto.

O ERP deve responder:

> Para onde vai o dinheiro da Pane&Salute?

Isso exige separar fatos que hoje se misturam:

- quanto foi comprado;
- quanto foi produzido;
- quanto foi vendido;
- quanto sobrou, foi reaproveitado ou descartado;
- quanto deixou de ser vendido por ruptura;
- qual custo pertence a produto, loja, canal ou período;
- qual variação vem de preço, rendimento, erro ou desperdício.

## 2. Papel do ERP

O ERP complementa o Controle Na Mão (CNM). Ele não substitui:

- PDV;
- cupom ou nota fiscal;
- integração fiscal com SEFAZ.

O ERP recebe dados operacionais e comerciais, mantém custos e rastreabilidade e
cruza essas fontes para apoiar decisão.

## 3. Unidades e conceitos

Lojas:

- Júlio de Castilhos (`jc`);
- Jardim América (`ja`);
- Exposição (`ex`).

Conceitos que não devem ser confundidos:

- loja é local físico;
- setor é área operacional;
- role é permissão de uma pessoa;
- PJ é tipo/canal de pedido, não loja;
- expedição é operação/perfil, não sinônimo da loja Exposição.

## 4. Usuários

- dono e administração;
- financeiro;
- produção, forno e cozinha;
- atendimento/vendas;
- estoque e compras;
- expedição/romaneio.

Cada acesso deve pertencer a uma pessoa identificável. Login compartilhado por
setor deve ser evitado.

## 5. Capacidades do produto

### Operação

- pedidos e planejamento de produção;
- forno e confirmação de lotes;
- sobras, reaproveitamento e descartes;
- romaneio e transferências;
- estoques e inventários;
- compras, cotações e fornecedores.

### Comercial

- catálogo único de produtos;
- clientes, pedidos PJ e encomendas;
- opções e tabelas de preço;
- fechamento de caixa;
- importação de vendas CNM.

### Custos

- XML e histórico de compras;
- unidades e conversões;
- ficha técnica versionada;
- custo por produto e forma de venda;
- CMV teórico;
- CMV real por família;
- margem por produto, loja e canal.

### Gestão

- perdas e rupturas em reais;
- comparação entre lojas e períodos;
- variação de preço por fornecedor;
- indicadores com origem rastreável;
- alertas e explicações para Rodrigo.

## 6. Requisitos de experiência

- mobile-first;
- uso rápido durante a operação;
- botões e escolhas visuais;
- poucos campos livres;
- confirmação em ações críticas;
- mensagens que indiquem como corrigir o problema;
- funcionamento com toque repetido ou conexão instável sem duplicar dados.

## 7. Requisitos de dados

- origem e data de cada informação;
- loja, usuário e operação identificáveis;
- importações idempotentes;
- histórico em vez de sobrescrita silenciosa;
- unidades compatíveis;
- revisão humana em importações e mapeamentos;
- indicadores que mostrem cobertura e dados faltantes.

## 8. Segurança

- identidade real via Supabase Auth;
- autorização no banco por RLS;
- privilégio mínimo;
- nenhuma chave privada no frontend;
- dados financeiros somente após proteção adequada;
- operações críticas transacionais e auditáveis.

## 9. Métricas de sucesso

- percentual dos produtos vendidos com ficha técnica válida;
- percentual das vendas CNM corretamente mapeadas;
- tempo para fechar CMV mensal e semanal;
- divergência entre CMV teórico e real;
- perdas em quantidade e reais;
- rupturas por loja e produto;
- variação de preços por fornecedor;
- redução de intervenções manuais do Rodrigo.

## 10. Fora de escopo

- emissão fiscal própria;
- folha de pagamento;
- substituição completa do CNM;
- automação irreversível de compra ou preço;
- funcionalidades sem relação comprovada com operação, custo ou decisão.
