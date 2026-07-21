# Roadmap canônico — Pane&Salute ERP

**Atualizado em:** 2026-07-21
**Objetivo:** chegar ao CMV confiável com segurança e rastreabilidade.

Este arquivo define ordem e critérios. O estado real está em
[CURRENT_STATE.md](CURRENT_STATE.md).

## Princípios

- Segurança vem antes de novos dados financeiros.
- Ficha técnica e vendas são pré-requisitos do CMV consolidado.
- Toda fase deve ser pequena, reversível e validada no navegador.
- Implementação parcial não significa fase concluída.
- Dashboard não compensa dado incompleto ou sem origem rastreável.

## Fase 0A — Estabilização do projeto

Objetivo: recuperar uma base confiável para continuar desenvolvendo.

- sanear documentação e memória;
- garantir branch nova a partir do `origin/main` atualizado;
- revisar branches e worktrees antigos;
- executar baseline de lint, tipos, testes e build;
- testar no navegador os fluxos críticos;
- consolidar uma lista reproduzível de regressões.

Critério de saída:

- fonte de verdade única;
- `main` validado;
- bugs críticos conhecidos e priorizados;
- nenhuma tarefa nova parte de base antiga.

## Fase 0B — Segurança Supabase/Auth

Objetivo: encerrar a transição de autenticação sem interromper a operação.

- validar login, sessão, recuperação e logout por e-mail em celular;
- concluir RLS e grants por perfil nas tabelas operacionais;
- proteger Edge Functions e funções privilegiadas;
- remover ou isolar `app_users`;
- retirar PINs e fallback hardcoded quando o acesso por e-mail estiver estável;
- executar auditoria live e testes por perfil/loja.

Critério de saída:

- nenhuma tabela exposta com RLS desligado;
- nenhuma escrita anônima ampla;
- usuários operacionais conseguem executar seus fluxos;
- dados sensíveis não dependem de autorização de frontend;
- fallback legado tem plano e data de retirada.

## Projeto transversal — Unificação da identidade de produto

Aprovado para o roadmap em 2026-07-21, sem data marcada; entra quando não
houver frente financeira mais urgente.

Objetivo: acabar com a identidade dupla do mesmo produto (cadastro legado de
pães, source `bread`, versus catálogo unificado, source `product`, ligados
por `products.legacy_bread_id`).

Contexto: a dupla identidade já causou 3+ bugs — o último travou a cobrança
da EX porque preço salvo numa identidade não era encontrado pela outra. A
ponte central em `src/lib/productIdentity.ts` é mitigação, não solução: cada
tela nova ainda precisa lembrar de usá-la, e preço/custo pode existir
duplicado nas duas identidades com valores divergentes, errando cobrança sem
aviso.

Escopo previsto, em fases pequenas com aprovação por fase (risco alto: dados
de produção e telas do dia a dia):

- telas operacionais (romaneio, encomendas, estoque congelado, forno,
  sobras) passam a gravar a identidade unificada;
- conversão auditável do histórico gravado com source `bread`;
- cadastro legado de pães vira somente leitura (arquivo histórico);
- bloqueio de preço/custo duplicado entre identidades.

Critério de saída:

- nenhuma escrita nova com source `bread`;
- a ponte `productIdentity` permanece apenas para ler histórico antigo;
- nenhum preço ou custo ativo duplicado entre identidades.

## Fase 1 — Compras por XML

Objetivo: registrar custo de compra com origem auditável.

- importar XML de fornecedor;
- validar documento, fornecedor, itens, tributos e duplicidade;
- mapear descrição bruta para insumo interno;
- manter arquivo bruto anonimizado ou em armazenamento protegido;
- registrar histórico de preço por fornecedor;
- exigir revisão humana antes da confirmação.

## Fase 2 — Unidades e conversões

Objetivo: comparar compra, estoque e receita na mesma unidade.

- unidade base do insumo;
- unidade de compra;
- fator de conversão;
- validação de dimensão incompatível;
- tratamento explícito de peso, volume e unidade;
- histórico quando uma conversão mudar.

## Fase 3 — Estoque transacional

Objetivo: impedir entradas e baixas parciais.

- entrada, itens, saldo e movimentos em uma transação;
- idempotência por documento/operação;
- inventário físico e ajustes auditáveis;
- validação de quantidade e custo;
- tratamento de concorrência e repetição de toque.

## Fase 4 — Ficha técnica versionada

Objetivo: transformar a ficha já existente em base histórica confiável.

Já existem componentes, rendimentos, opções de venda e cálculo parcial. Ainda
faltam:

- versões com vigência;
- rendimento, perda técnica e embalagem por versão;
- snapshot do custo usado;
- aprovação e histórico;
- cobertura dos principais produtos.

## Fase 5 — Vendas CNM

Objetivo: trazer quantidade e receita vendida para o ERP.

Já existem experimentos de leitura XLS e coleta autorizada. A fase só termina
quando houver:

- fluxo oficial de arquivo/coleta;
- staging e validação;
- mapeamento CNM para produto interno;
- loja, canal, data, quantidade, descontos e valor líquido;
- bloqueio de duplicidade;
- revisão humana e auditoria da importação.

## Fase 6 — Sobras, descartes e rupturas

Objetivo: medir perda e falha de atendimento em quantidade e reais.

O fluxo operacional de sobras já avançou. Ainda faltam:

- motivo padronizado;
- loja e etapa de origem;
- custo estimado pela ficha vigente;
- distinção entre sobra, reaproveitamento e descarte;
- registro de ruptura;
- indicadores comparáveis por loja e produto.

## Fase 7 — CMV teórico

Objetivo: calcular custo esperado do que foi vendido.

- produto vendido vinculado à ficha vigente;
- custo teórico por produto e opção de venda;
- CMV por categoria, loja e canal;
- margem bruta estimada;
- perda em reais;
- cobertura e qualidade dos dados visíveis.

Os cálculos e a auditoria de CMV já existentes são fundação, não conclusão
desta fase.

## Fase 8 — CMV real por família

Objetivo: confrontar consumo esperado com compras, estoque e inventário.

- consumo real por família crítica;
- variação teórico versus real;
- efeito de preço, rendimento e perda;
- explicação auditável das diferenças.

## Fase 9 — Dashboard do Rodrigo

Objetivo: transformar dados confiáveis em decisão.

- visão por período, loja, canal e família;
- alertas de variação;
- fornecedores com aumento;
- produtos com margem ruim;
- perdas e rupturas prioritárias;
- origem clicável de cada número.

## Fase 10 — IA de apoio

Objetivo: explicar variações e sugerir investigação.

A IA não decide compra, preço ou produção automaticamente. Toda recomendação
deve mostrar dados usados, incerteza e ação humana necessária.

## Fora de prioridade até CMV v1

- chatbot de cliente;
- emissão fiscal própria;
- visão computacional de vitrine;
- compra automática;
- automação pesada de WhatsApp;
- DRE completo;
- reescrita geral de UI.

## Definição de pronto de uma fase

- critérios de aceite cumpridos;
- fluxo testado no navegador;
- lint, tipos, testes e build aplicáveis aprovados;
- RLS/grants validados quando houver banco;
- nenhum segredo ou dado sensível versionado;
- PR pequeno e revisável;
- documentação atualizada somente onde mudou algo durável;
- rollback conhecido.
