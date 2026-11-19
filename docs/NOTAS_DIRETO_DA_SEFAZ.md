# Notas direto da SEFAZ

O objetivo é buscar as notas emitidas contra RGF e SF sem depender do notebook,
do e-mail ou de um navegador com o login do dono. A fase 0 apenas consulta e
mede as respostas, sem guardar notas nem lançar parcelas no ERP.

A conversa sai do banco da Supabase porque a SEFAZ pede uma segunda negociação
de segurança durante a conexão, que o servidor das funções não consegue concluir.
A função `sefaz-prova` chama o banco, abre os documentos recebidos e devolve
somente um resumo técnico.

## Onde fica o certificado

Cada empresa tem um certificado A1 e uma chave privada. A chave representa a
empresa perante o fisco. Ela fica sem senha dentro do Vault, o cofre do banco,
e nunca volta para a função do servidor ou para uma resposta de consulta.
Somente o banco usa a chave para se identificar e assinar o evento de teste.

O banco descobre o CNPJ no próprio certificado e confere seus dígitos. Nenhum
CNPJ real fica escrito no código. As únicas empresas permitidas são `rgf` e
`sf`. Os endereços de consulta são fixos. Não há porta para enviar endereço,
mensagem ou conteúdo livre para assinatura. Nesta fase, o único evento é a
Ciência da Operação, código 210210, com nota fictícia e somente em homologação.

A extensão `http` é o componente do banco que faz a conexão. Suas funções
ficam fechadas para os usuários do ERP e para o outro sistema que compartilha
o banco. A chave de serviço chama apenas as três consultas de prova, sem
acesso direto a esse componente ou às funções internas desta frente.

O resumo permite códigos de resposta, NSU, contagens, bytes, duração, memória
e dias para o certificado vencer. Não mostra CNPJ, nome, chave de nota, valor,
XML, certificado, chave privada ou senha. As mensagens da SEFAZ são trocadas
por descrições técnicas fixas. O GitHub e os seus registros são públicos.

## Preparação do Rodrigo no Windows

Faça isto depois de o coordenador confirmar a atualização do banco e da função.
Não envie o certificado nem sua senha a ninguém. A conversão é feita no seu
notebook com o OpenSSL que vem com o Git para Windows.

1. Separe o `.pfx` de cada empresa. Se só estiver instalado no Windows, abra
   `certmgr.msc`, entre em **Pessoal**, **Certificados**, selecione o certificado
   da empresa e escolha **Todas as tarefas**, **Exportar**. Marque **Sim,
   exportar a chave privada**, escolha `.pfx`, defina uma senha nova e salve
   numa pasta temporária. Se a exportação da chave estiver bloqueada, use o
   `.pfx` original ou peça à certificadora; não tente contornar a proteção.
2. Abra o PowerShell. Substitua `<pfx>` pelo caminho completo do arquivo,
   mantendo as aspas. Primeiro copie apenas o certificado:

   ```powershell
   & 'C:\Program Files\Git\usr\bin\openssl.exe' pkcs12 -in '<pfx>' -clcerts -nokeys | Set-Clipboard
   ```

   A senha será pedida pelo próprio OpenSSL, sem aparecer no comando. Não
   use opção para escrever a senha no comando. O texto vai direto para a área
   de transferência, sem gerar outro arquivo.
3. No painel da Supabase, abra o projeto do ERP **PanePedidosLojas**, referência
   `gohluceldchoitihrimw`. Entre no **Vault** e escolha **Add new secret**.
   Cole o conteúdo no valor e use o nome exato correspondente:

   | Empresa | Certificado | Chave privada |
   | --- | --- | --- |
   | RGF | `sefaz_rgf_certificado` | `sefaz_rgf_chave` |
   | SF | `sefaz_sf_certificado` | `sefaz_sf_chave` |

4. Volte ao PowerShell e copie a chave sem senha:

   ```powershell
   & 'C:\Program Files\Git\usr\bin\openssl.exe' pkcs12 -in '<pfx>' -nocerts -nodes | Set-Clipboard
   ```

   Informe novamente a senha no pedido do OpenSSL. No Vault, crie o segredo
   da coluna **Chave privada** e cole o conteúdo. `-nodes` significa não
   cifrar a chave de saída; o OpenSSL 3 também chama essa opção de `-noenc`.
   O banco recusa chave que continue cifrada e orienta a refazer a conversão.
5. Repita os passos para a outra empresa. Cada comando substitui o conteúdo
   da área de transferência. As linhas `Bag Attributes`, `subject=` e
   `issuer=` podem acompanhar o texto; o banco lê só o bloco necessário.
6. Se aparecer erro de algoritmo antigo, repita o comando acrescentando
   `-legacy` depois de `pkcs12`. Não cole um resultado vazio no Vault.
   Se o executável em `usr\bin` não iniciar, use o mesmo comando com
   `C:\Program Files\Git\mingw64\bin\openssl.exe`, o outro caminho do Git.
   Confira que o comando terminou sem erro antes de colar.
7. Ao terminar, limpe a área de transferência:

   ```powershell
   Set-Clipboard -Value ' '
   ```

   Se o histórico da área de transferência estiver ativo, abra **Win+V** e
   limpe também as entradas com certificado/chave. Evite sincronizar a área
   de transferência com outros aparelhos durante a operação. Apague o `.pfx`
   temporário se o exportou só para esta tarefa; preserve a cópia original
   protegida usada pela empresa.

Nunca cole certificado, chave ou senha em conversa, e-mail, WhatsApp, GitHub
ou arquivo de texto. O `.pfx` original continua protegido pela senha; somente
os dois textos necessários ficam no Vault.

## Como o coordenador faz a prova

Depois de conferir as Actions de banco e funções, o coordenador abre **Actions**,
**Prova SEFAZ (fase 0)**, **Run workflow**, usando a branch `main`.
Escolhe as empresas, o modo e o número da distribuição, o NSU do ADN e se quer
ligar o teste de evento em homologação. Não existe opção de evento real.

`distNSU` busca a partir do último NSU informado, com exatamente 15 dígitos.
`consNSU` consulta um NSU específico. Há uma única consulta por empresa,
sem percorrer lotes e sem repetição automática. O ADN usa de 1 a 15 dígitos,
sem informar outro contribuinte, pois o certificado identifica o titular.

Ao fim da fila, resposta 137, NSU final igual ao máximo ou bloqueio 656,
aguarde pelo menos uma hora antes de consultar novamente a distribuição da
mesma empresa. Repetir cedo pode renovar o bloqueio por mais uma hora. Se a
chamada falhar sem resposta, não suponha que ela deixou de chegar à SEFAZ.

A Action cria uma senha aleatória para aquela execução, oculta a senha nos
registros, liga a função e a chama uma vez. O último passo apaga a senha mesmo
quando há erro. Sem senha configurada, a função responde **503, desligada**.
Senha errada responde 401; método diferente de POST, 405; entrada inválida, 400.
O retorno 200 contém o resultado de cada prova, que pode ser `ok`, `falhou`
ou `sem_certificado`. Falta de certificado em uma empresa não impede a outra.

O resumo fica no registro e no resumo do job. Código 138 mostra documentos
localizados; 137 indica fila vazia; 656 indica bloqueio. A Action só fica verde
com 138 nas distribuições, ADN lido e, quando solicitado, evento aceito na
verificação de certificado/assinatura. Uma resposta de negócio desconhecida
não conta como prova da assinatura. O ADN lista só nomes de campos conhecidos;
campos novos são contados como omitidos, sem expor seu conteúdo.

O tempo do banco inclui leitura do cofre, assinatura e conexão. Cada RPC usa
o PostgREST, que tem limite de oito segundos; a conexão tem limite de 1,5 segundo
e a libcurl, 4,5 segundos para a resposta. A função mede também descompactação
e memória. Esses limites precisam ser confirmados na prova real, especialmente
para a assinatura. Não há teste de conexão com o fisco no pgTAP.

## Emergência e renovação

Para desligar a prova imediatamente, o coordenador apaga `SEFAZ_PROVA_TOKEN`
nos segredos das Edge Functions. Se o último passo da Action falhar, faça essa
remoção pelo painel e confira o retorno 503. Cancelar à força uma Action ou
uma indisponibilidade do GitHub pode impedir a limpeza automática.

Para impedir também as consultas pelo banco, Rodrigo apaga os quatro segredos
do Vault. Se houver suspeita de vazamento da chave, revogue o certificado
na certificadora; apagar a cópia local não invalida uma chave copiada.

O certificado da SF vence em **10/12/2026**. Antes dessa data, repita a
conversão com o novo `.pfx` e **troque o valor** de `sefaz_sf_certificado` e
`sefaz_sf_chave` no Vault. Mantenha os nomes e não crie segredos duplicados.
Depois, o coordenador repete a prova respeitando o intervalo da SEFAZ.

Para remover a implementação, o coordenador prepara uma migration nova que
remove estas funções e, depois de conferir dependências, a extensão `http`.
Não se edita uma migration já aplicada nem se altera o banco manualmente.
