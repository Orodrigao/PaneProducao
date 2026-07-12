# Tarefa: coletor local de vendas do CNM

Pedido aprovado pelo Rodrigo em 11/07/2026: continuar a automação do CNM a
partir da gravação Replay validada e baixar o relatório diário de vendas por
produto da loja JC sem armazenar credenciais no repositório.

## Evidência validada

- Gravação Replay: `18a1d95d-8a8e-4be4-af09-a3b0c2125298`.
- Jira: `KAN-1`.
- Rota do relatório: `#!/relatorio/venda`.
- Agrupamento: `Produto` (`P`).
- Local: `Pane Salute` (`61286`) corresponde a `jc`.
- O XLS só habilita depois de selecionar o local e aplicar os filtros.
- Seletores estáveis confirmados no fluxo real:
  - `input[ng-model="vm.dataInicio"]`;
  - `input[ng-model="vm.dataFim"]`;
  - `#cbTipoAgrupamento`;
  - `#cbLocaisFiltroRelatorioFluxoVendas`;
  - `button[title="Aplicar filtros"]`;
  - `#btnExport`.

## Plano aprovado

- [x] Validar o fluxo real com Chrome + Replay e conferir o XLS baixado.
- [x] Criar perfil de Chrome dedicado e ignorado pelo Git.
- [x] Criar comando de login manual sem usuário/senha no código.
- [x] Criar comando de download por data usando os seletores validados.
- [x] Salvar como `CNM_AAAA-MM-DD_JC.xls` em pasta local ignorada.
- [x] Validar o arquivo com o leitor XLS já implementado.
- [x] Adicionar testes dos argumentos, nomes e condições de erro.
- [x] Documentar setup, renovação de sessão e execução diária.
- [x] Rodar testes, typecheck, lint, build e revisar o diff.
- [x] Autenticar o perfil dedicado e validar um download completo pelo coletor.

## Resultado do teste real

- Data: `2026-07-10`.
- Arquivo: `CNM_2026-07-10_JC.xls`.
- Itens: `81`.
- Quantidade total: `404`.
- Total líquido calculado e informado: `R$ 6.132,40`.
- SHA-256: `a80f6699c7cb19ee3fc1c3c54bba73102554409473c3a38f100ee45459a39b56`.
- Segunda execução: `unchanged`, sem duplicação ou sobrescrita.

## Fora desta entrega

- Tabelas, migrations, RLS ou qualquer escrita no Supabase.
- Importação confirmada e baixa de estoque.
- Tela de upload, prévia ou mapeamento de produtos.
- Armazenamento de senha, cookie ou perfil de navegador no Git.
- Agendamento automático no Windows.
- JA, EX ou outros relatórios do CNM.
