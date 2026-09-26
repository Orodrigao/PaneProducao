# Pane&Salute ERP

ERP interno da Pane&Salute, padaria artesanal com três lojas em Caxias do Sul.
O sistema complementa o PDV fiscal e busca responder:

> Para onde vai o dinheiro da Pane&Salute?

Porta de entrada única de onboarding — regras de trabalho, arquitetura,
segurança e fluxo, para agentes e humanos: [AGENTS.md](AGENTS.md), que aciona
as regras de [docs/regras/](docs/regras/). Estado real do
projeto: [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md).

## Desenvolvimento local

```bash
npm install
npm run dev
npm run lint
npx tsc --noEmit
npm test
npm run build
```

O build estático é gerado em `out/`.

As variáveis públicas necessárias ficam em `.env.local`, que não pode ser
versionado:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Valores `NEXT_PUBLIC_*` entram no bundle do navegador. Nunca use esse prefixo
para service role, senha, token administrativo ou qualquer segredo.

## Deploy

O push na `main` publica pela Vercel. Fluxo de branch, PR e aprovações:
[AGENTS.md](AGENTS.md).

## Revisão automática de PRs

O repositório público `Orodrigao/PaneProducao` usa o CodeRabbit para revisar
PRs novas elegíveis. PR em rascunho pode ser ignorada automaticamente; nesse caso,
o responsável pede a leitura completa com `@coderabbitai full review` depois que o
diff estiver estável. A instalação está restrita a este repositório; nenhum
repositório privado, inclusive o Rotineo, faz parte dela.

Na configuração adotada, o serviço atua como parecerista. Aprovação automática está
desligada, e correções, testes ou commits gerados exigem pedido explícito. Como a
revisão acontece depois do push, ela é evidência adicional e não substitui a revisão
independente anterior à PR, CI, testes nem as regras de integração descritas em
[AGENTS.md](AGENTS.md).

Embora o uso adotado seja de revisão, o aplicativo pediu ao GitHub leitura e escrita
em código, status de commits, issues e PRs, além de leitura de actions, checks,
discussões, filas de merge e metadados. O risco foi limitado autorizando o aplicativo
somente neste repositório público.

Na tela de cadastro conferida em 19/09/2026, não havia cartão, fatura nem produto
cobrado por uso habilitado; o painel atual do fornecedor sempre prevalece sobre este
registro datado. As revisões do repositório público seguem a modalidade gratuita
divulgada na [página oficial de preços](https://www.coderabbit.ai/pricing). A conta
pode exibir um teste temporário de plano pago; antes de adicionar repositório privado,
assento, agente, varredura ou consumo adicional, confira o preço vigente e obtenha
autorização explícita do Rodrigo.
