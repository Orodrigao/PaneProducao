## Objetivo

Descreva o problema, o resultado esperado e o que ficou fora do escopo.

## O que mudou

- 

## Gate da PR

Marque cada item aplicável. Para item não aplicável, explique em
“Não aplicável e riscos”.

### Base e escopo

- [ ] Branch criada a partir da `origin/main` atualizada.
- [ ] Uma tarefa e um escopo; sem alterações locais ou módulos não relacionados.
- [ ] Diff revisado manualmente.

### Documentação e memória

- [ ] `CURRENT_STATE.md` atualizado se mudou fase, capacidade, risco ou bloqueio.
- [ ] `PLAN.md` atualizado se mudou roadmap ou critério de saída.
- [ ] `PRD.md` atualizado se mudou requisito estável.
- [ ] `AGENTS.md` atualizado somente se mudou regra global e durável.
- [ ] `lessons.md` atualizado somente se surgiu aprendizado reutilizável.
- [ ] Documento novo classificado como canônico, específico ou histórico.

### Banco, autenticação e autorização

- [ ] Migration local alinhada ao histórico remoto.
- [ ] Aplicação em produção confirmada por consulta posterior, quando houver.
- [ ] Autorização testada na interface e no banco por perfil/loja afetados.
- [ ] RLS, grants, funções privilegiadas e acesso de `anon` revisados.
- [ ] Escrita em produção, Auth e Edge Functions tiveram aprovação explícita.

### Verificação e fechamento

- [ ] Lint executado, quando aplicável.
- [ ] TypeScript executado, quando aplicável.
- [ ] Testes executados, quando aplicável.
- [ ] Build executado, quando aplicável.
- [ ] Fluxo testado no navegador, incluindo estados relevantes.
- [ ] Checklist temporário e documentação de estado atualizados.
- [ ] Riscos e pendências restantes estão explícitos.

## Não aplicável e riscos

Liste os itens não aplicáveis, a justificativa, riscos conhecidos e rollback.
