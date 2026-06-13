# CODEX_PROJECT_COMMAND.md — Comando do projeto PaneProducao

## Decisão

A partir desta fase, o projeto será conduzido com Codex. O arquivo `CLAUDE.md` fica como histórico técnico, mas a fonte principal de instruções para agentes passa a ser `AGENTS.md`.

## Objetivo do ciclo atual

Chegar ao CMV confiável da Pane&Salute com segurança e dados rastreáveis.

O ERP deve responder:

- quanto custou produzir;
- quanto foi comprado;
- quanto foi vendido;
- quanto sobrou;
- quanto foi descartado;
- onde o dinheiro está vazando;
- quais produtos têm margem ruim;
- quais fornecedores pioraram preço;
- quais lojas/canais geram problema.

## Regra de prioridade

Não construir dashboard bonito antes de ter base confiável.

Ordem de execução:

1. Segurança Supabase/Auth.
2. Importação de XML de compras.
3. Unidade de medida e conversões.
4. Entrada de estoque transacional.
5. Ficha técnica versionada.
6. Importação de vendas CNM.
7. Sobras/descartes/rupturas com custo.
8. CMV teórico.
9. CMV real por família.
10. Dashboard e IA.

## O que fica congelado por enquanto

- Chatbot de cliente.
- Automação pesada de WhatsApp.
- Visão computacional de vitrine.
- Emissão fiscal própria.
- Reescrita geral de UI.
- DRE completo antes de CMV base.

## Definição de pronto

Uma entrega só é considerada pronta quando:

- tem PR pequeno;
- passou nos checks aplicáveis;
- não expôs segredo;
- não quebrou produção;
- tem rollback mental claro;
- foi explicada em português simples para Rodrigo.
