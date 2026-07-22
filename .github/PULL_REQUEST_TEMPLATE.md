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
- [ ] `Banco Preview` verde (obrigatorio quando houver migration ou seed)
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

# Roteiro de teste para o Rodrigo

<!-- Passos concretos no celular, por perfil e loja afetados:
"Entre como vendas na JA e confira se..." -->

# Riscos restantes e decisões conscientes

<!-- O que ficou de fora de propósito e por quê. -->
