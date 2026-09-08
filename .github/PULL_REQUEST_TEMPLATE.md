# O que muda para a operação

<!-- Linguagem leiga: o que a padaria ganha ou deixa de sofrer. -->

# O que foi feito

<!-- Resumo técnico curto: arquivos, migrations, decisões. -->

# Nível de risco

<!-- Baixo | Médio | Alto — e por quê. -->

# Verificações executadas

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `Banco por PR` e `Usuarios do Banco por PR` verdes (quando a PR mexe em `supabase/`)
- [ ] `CI Banco` verde (quando a PR mexe em migration, teste de banco, seed ou config.toml)
- [ ] Fluxo completo testado no navegador

## Matriz de verificação

<!-- Obrigatória quando a mudança toca Auth, permissão, rota ou dado
compartilhado. Se não se aplicar (ex.: só documentação), preencha as células
com N/A e a justificativa — não apague a seção. -->

| Dimensão                                           | Evidência |
| -------------------------------------------------- | --------- |
| Perfil testado (role, loja)                        |           |
| Entrada (login, primeira rota)                     |           |
| UI (menu/tela/ação visível ou negada)              |           |
| Banco (tabela/RPC e policy aplicável)              |           |
| Positivo (perfil que deve conseguir)               |           |
| Negativo (perfil/loja que deve ser bloqueado)      |           |
| Estados (loading, vazio, erro, sucesso)            |           |
| Repetição (duplo toque, reload, sessão persistida) |           |

# O que NÃO foi testado

<!-- Diga explicitamente. "Nada" só se for verdade. -->

# Evidência do fluxo e participação humana

<!-- Agente executa os testes técnicos. Informe revisão, ambiente, perfis,
cenários, resultados e links de evidência sanitizada; distinga mocks de
persistência real. Documentação apenas: N/A com justificativa.
Avaliação humana é complementar, salvo aceite expressamente solicitado.
Se depender de Rodrigo, descreva a dependência concreta e as alternativas
tentadas; não delegue a ele salvar/reler, validação ou troca de login. -->

# Limite autorizado da entrega

<!-- Registre a instrução que autoriza: plano/draft/preview ou integração e
publicação. Merge na main publica automaticamente. Ativação de fluxo real e
operações críticas devem estar cobertas. Com autorização e gates cumpridos,
o agente integra sem novo OK. Não ampliar limites de tarefas existentes. -->

# Riscos restantes e decisões conscientes

<!-- O que ficou de fora de propósito e por quê. -->
