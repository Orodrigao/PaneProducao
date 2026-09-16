import { pathToFileURL } from 'node:url'

/**
 * Aponta o preview da Vercel para o banco de teste daquela pull request.
 *
 * O Supabase ja cria uma ramificacao de banco por PR que mexe em arquivos do
 * Supabase. O que faltava era avisar a Vercel qual banco usar: sem isso, todo
 * preview conversa com o mesmo banco compartilhado e duas PRs se atropelam.
 *
 * A regra e deliberadamente simples:
 *
 * - PR SEM ramificacao (nao mexeu em migration) continua no banco
 *   compartilhado, pelas variaveis genericas de Preview. Nada a fazer aqui.
 * - PR COM ramificacao ganha variaveis amarradas ao nome da branch. Na Vercel,
 *   variavel de branch manda por cima da generica.
 * - PR FECHADA tem a branch travada num destino inerte. Sem isso, um push novo
 *   na branch geraria preview no banco compartilhado, sem ninguem ter
 *   reservado aquele banco. Reabrir destrava; apagar a branch esquece.
 * - Toda execucao decide pelo estado ATUAL da branch no GitHub, nao pelo
 *   evento que a disparou (ver lerEstadoDaBranch).
 *
 * Na duvida este script falha FECHADO: preview vermelho e melhor que preview
 * verde conversando com o banco errado.
 */

export const PRODUCTION_PROJECT_REF = 'gohluceldchoitihrimw'

export const VARIAVEIS_DO_BANCO = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]

/**
 * Para onde vai a branch de uma PR fechada.
 *
 * Apagar as variaveis da branch nao basta: sem elas, a Vercel usa as
 * genericas de Preview, que apontam para o banco compartilhado. Um push depois
 * do fechamento ganharia preview verde num banco que ninguem reservou. Estes
 * valores nao sao um banco: o dominio `.invalid` e reservado e nunca resolve, e
 * a trava de next.config.ts recusa endereco que nao seja `*.supabase.co`. O
 * build desse preview falha, e falha a vista.
 */
export const DESTINO_INERTE = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: 'https://pr-fechada-sem-banco.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'pr-fechada-sem-banco',
})

/**
 * A partir de quantas ramificacoes a listagem do Supabase passa a ser suspeita
 * de truncamento.
 *
 * O endpoint nao documenta paginacao e este numero E UM CHUTE, deliberadamente
 * baixo: chutar alto seria chutar para o lado inseguro, porque uma lista
 * truncada pareceria completa e uma PR com migration acabaria testando no banco
 * compartilhado sem ninguem perceber. O limite de ramificacoes configurado no
 * projeto e 3, entao na pratica uma lista com 20 ja e anomala por si so.
 *
 * Para trocar por um numero verificado: contar quantos itens a API devolve com
 * mais ramificacoes abertas do que este limite. Enquanto isso, o total vem
 * sempre no log justamente para tornar o chute investigavel.
 */
export const LIMITE_PAGINA_RAMIFICACOES = 20

/**
 * Estados em que a ramificacao ainda nao serve.
 *
 * `MIGRATIONS_PASSED` e `FUNCTIONS_DEPLOYING` NAO entram aqui de proposito:
 * este script so escreve o endereco e a chave do BANCO, e nesses dois estados o
 * banco ja esta de pe com o schema aplicado. Esperar as edge functions travaria
 * toda PR cuja ramificacao nao tenha function para publicar, e travar tudo e
 * pior que aceitar uma function ainda subindo.
 */
const ESTADOS_EM_CRIACAO = new Set([
  'CREATING_PROJECT',
  'RUNNING_MIGRATIONS',
])

const ESTADOS_DE_FALHA = new Set([
  'MIGRATIONS_FAILED',
  'FUNCTIONS_FAILED',
])

/**
 * Encontra a ramificacao de banco daquela PR.
 *
 * Devolve `{ situacao: 'encontrada' | 'sem-ramificacao' }` ou lanca. A
 * diferenca importa: "sem ramificacao" e um caminho normal (PR sem migration),
 * enquanto ambiguidade e campo faltando sao erro.
 */
export function escolherRamificacao(ramificacoes, { prNumber, gitBranch }) {
  if (!Array.isArray(ramificacoes)) {
    throw new Error('A listagem de ramificacoes do Supabase nao veio como lista.')
  }
  if (!gitBranch) {
    throw new Error('Nome da branch ausente: nao da para saber qual ramificacao pertence a esta PR.')
  }

  const candidatas = ramificacoes.filter((ramificacao) => {
    if (!ramificacao || ramificacao.is_default === true) return false
    if (prNumber != null && Number(ramificacao.pr_number) === Number(prNumber)) return true
    return ramificacao.git_branch === gitBranch
  })

  if (candidatas.length > 1) {
    const nomes = candidatas.map((c) => c.name ?? c.id ?? '(sem nome)').join(', ')
    throw new Error(
      `Mais de uma ramificacao responde por esta PR (${nomes}); recusado por seguranca.`,
    )
  }

  if (candidatas.length === 0) {
    // Uma lista cheia pode estar truncada. Nesse caso NAO da para concluir que
    // a PR nao tem ramificacao: seria mandar uma PR com migration testar no
    // banco compartilhado, exatamente o erro que este script existe para evitar.
    if (ramificacoes.length >= LIMITE_PAGINA_RAMIFICACOES) {
      throw new Error(
        'A listagem de ramificacoes veio no limite da pagina e pode estar truncada; '
        + 'nao da para afirmar que esta PR nao tem banco proprio.',
      )
    }
    return { situacao: 'sem-ramificacao' }
  }

  const ramificacao = candidatas[0]
  if (!ramificacao.project_ref) {
    throw new Error('A ramificacao encontrada nao informa project_ref; recusado por seguranca.')
  }
  if (ramificacao.project_ref === PRODUCTION_PROJECT_REF) {
    throw new Error('A ramificacao aponta para o projeto de producao; recusado por seguranca.')
  }

  return { situacao: 'encontrada', ramificacao }
}

/** A ramificacao ja pode receber conexao? */
export function ramificacaoEstaPronta(ramificacao) {
  if (!ramificacao) return false
  if (ESTADOS_DE_FALHA.has(ramificacao.status)) {
    throw new Error(
      `A ramificacao desta PR falhou no Supabase (${ramificacao.status}); `
      + 'conserte o banco da PR antes de testar o preview.',
    )
  }
  if (ramificacao.preview_project_status !== 'ACTIVE_HEALTHY') return false
  return !ESTADOS_EM_CRIACAO.has(ramificacao.status)
}

/**
 * Escolhe a chave publica do banco da PR.
 *
 * Prefere a chave nova (`sb_publishable_...`) e aceita a legada `anon` como
 * reserva, porque projetos criados em epocas diferentes expoem uma ou outra.
 */
export function escolherChavePublica(chaves) {
  if (!Array.isArray(chaves)) {
    throw new Error('A listagem de chaves do Supabase nao veio como lista.')
  }

  const publicavel = chaves.find(
    (chave) => chave?.type === 'publishable'
      && typeof chave.api_key === 'string'
      && /^sb_publishable_[A-Za-z0-9._-]+$/.test(chave.api_key),
  )
  if (publicavel) return publicavel.api_key

  const legada = chaves.find(
    (chave) => chave?.name === 'anon'
      && typeof chave.api_key === 'string'
      && papelDoJwt(chave.api_key) === 'anon',
  )
  if (legada) return legada.api_key

  throw new Error('O banco desta PR nao expos nenhuma chave publica utilizavel.')
}

function papelDoJwt(valor) {
  const partes = valor.split('.')
  if (partes.length !== 3) return null

  try {
    // A origem e a Management API autenticada. O papel nao autentica a chave;
    // ele impede publicar uma service_role que venha rotulada como `anon`.
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'))
    return typeof payload?.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

/** O par de variaveis que a Vercel precisa receber para esta branch. */
export function planejarVariaveis({ projectRef, chavePublica, gitBranch }) {
  if (!projectRef) throw new Error('project_ref ausente ao montar as variaveis.')
  if (!chavePublica) throw new Error('Chave publica ausente ao montar as variaveis.')
  if (!gitBranch) throw new Error('Nome da branch ausente ao montar as variaveis.')

  return [
    variavelDaBranch('NEXT_PUBLIC_SUPABASE_URL', `https://${projectRef}.supabase.co`, gitBranch),
    variavelDaBranch('NEXT_PUBLIC_SUPABASE_ANON_KEY', chavePublica, gitBranch),
  ]
}

/** O par de variaveis que trava a branch de uma PR fechada. */
export function planejarBloqueio({ gitBranch }) {
  if (!gitBranch) throw new Error('Nome da branch ausente ao montar o bloqueio.')

  return VARIAVEIS_DO_BANCO.map((chave) => variavelDaBranch(chave, DESTINO_INERTE[chave], gitBranch))
}

function variavelDaBranch(key, value, gitBranch) {
  return {
    key,
    value,
    // `plain` porque tudo que comeca com NEXT_PUBLIC_ viaja no navegador: a
    // propria Vercel recusa marcar essas variaveis como secretas.
    type: 'plain',
    target: ['preview'],
    gitBranch,
  }
}

/**
 * Confere a releitura das variaveis de banco daquela branch.
 *
 * `listadas` ja vem filtrada para a branch; `esperadas` e o que acabou de ser
 * gravado (lista vazia depois de remover). Cada chave esperada precisa aparecer
 * uma vez so e valer para Preview. O valor e comparado quando a Vercel o
 * devolve em claro; quando nao devolve, fica conferida so a existencia, e o
 * retorno diz isso. A mensagem de erro nunca carrega o valor.
 */
export function conferirReleitura(listadas, esperadas) {
  if (!Array.isArray(listadas)) {
    throw new Error('A releitura das variaveis da branch nao veio como lista.')
  }

  let porValor = 0
  for (const chave of VARIAVEIS_DO_BANCO) {
    const achadas = listadas.filter((variavel) => variavel?.key === chave)
    const esperada = esperadas.find((variavel) => variavel.key === chave)

    if (!esperada) {
      if (achadas.length > 0) {
        throw new Error(`Releitura: ${chave} continua gravada nesta branch depois de removida.`)
      }
      continue
    }
    if (achadas.length !== 1) {
      throw new Error(`Releitura: esperava uma ${chave} nesta branch e a Vercel devolveu ${achadas.length}.`)
    }

    const [achada] = achadas
    const alvos = Array.isArray(achada.target) ? achada.target : [achada.target]
    if (!alvos.includes('preview') || alvos.includes('production')) {
      throw new Error(`Releitura: ${chave} desta branch nao esta restrita a Preview.`)
    }

    const valorLegivel = typeof achada.value === 'string'
      && achada.type === 'plain'
      && achada.decrypted !== false
    if (valorLegivel) {
      if (achada.value !== esperada.value) {
        throw new Error(`Releitura: ${chave} desta branch nao tem o valor que acabou de ser gravado.`)
      }
      porValor += 1
    }
  }

  return { porValor }
}

async function pedir(url, { token, method = 'GET', body, fetchImpl = fetch } = {}) {
  const resposta = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '')
    throw new Error(`${method} ${url} respondeu ${resposta.status}. ${detalhe}`.trim())
  }

  if (resposta.status === 204) return null
  return resposta.json()
}

function comEscopo(url, teamId) {
  if (!teamId) return url
  return `${url}${url.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}`
}

export async function apontarPreviewParaRamificacao({
  prNumber,
  gitBranch,
  supabaseToken,
  vercelToken,
  vercelProject,
  vercelTeamId,
  // Se a PR altera qualquer coisa em supabase/, a plataforma cria ramificacao
  // para ela (medido: a PR 292 mexeu so em seed e testes e ganhou a sua). Entao
  // a ausencia de ramificacao deixa de ser caminho normal e vira erro: seguir
  // apontaria uma PR de schema, ou de seed, para o banco compartilhado, que e a
  // mentira que esta ponte existe para acabar.
  prAlteraSupabase = false,
  // Espera propria para a ramificacao nascer, separada da espera para ela ficar
  // pronta. Sao momentos diferentes e o pior caso e a soma das duas.
  esperarRamificacaoSegundos = 300,
  esperarSegundos = 300,
  // Espera propria: o banco nascer no Supabase e o preview aparecer na Vercel
  // sao duas demoras diferentes, com causas diferentes.
  esperarPreviewSegundos = 180,
  intervaloSegundos = 10,
  dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  registrar = console.log,
  fetchImpl = fetch,
}) {
  if (!supabaseToken) throw new Error('SUPABASE_ACCESS_TOKEN ausente.')
  if (!vercelToken) throw new Error('VERCEL_TOKEN ausente.')
  if (!vercelProject) throw new Error('Projeto da Vercel ausente.')

  // A listagem pode chegar como lista pura ou embrulhada em `branches`. Como
  // este script nasceu sem poder bater na API de verdade (o token so existe
  // dentro do GitHub), ele aceita as duas formas em vez de apostar numa.
  const listar = async () => {
    const corpo = await pedir(
      `https://api.supabase.com/v1/projects/${PRODUCTION_PROJECT_REF}/branches`,
      { token: supabaseToken, fetchImpl },
    )
    return Array.isArray(corpo) ? corpo : corpo?.branches
  }

  const primeiraLista = await listar()
  // O total sempre no log: e o que transforma o chute de LIMITE_PAGINA_RAMIFICACOES
  // em algo investigavel em vez de uma suposicao silenciosa.
  registrar(`O Supabase devolveu ${primeiraLista?.length ?? 0} ramificacao(oes).`)

  // "Nao achei" nao e "nao existe". A ramificacao nasce em paralelo com este
  // workflow, entao a primeira consulta pode ser cedo demais. Para PR que
  // altera migration a gente espera antes de desistir; para as outras nao ha o
  // que esperar, porque ramificacao nem deveria nascer.
  const limiteRamificacao = Date.now() + esperarRamificacaoSegundos * 1000
  let ultimoTotal = primeiraLista?.length ?? 0
  let escolha = escolherRamificacao(primeiraLista, { prNumber, gitBranch })

  while (escolha.situacao === 'sem-ramificacao' && prAlteraSupabase) {
    if (Date.now() >= limiteRamificacao) {
      throw new Error(
        `Esta PR altera supabase/ e nenhum banco proprio apareceu em ${esperarRamificacaoSegundos}s. `
        // A cota de ramificacoes do projeto e pequena e compartilhada. Quando
        // ela enche, nenhuma nova nasce ate uma PR fechar, e o vermelho aqui
        // nao e defeito DESTA PR. Nomear a suspeita evita depurar a PR errada.
        + `O Supabase listou ${ultimoTotal} ramificacao(oes) no projeto; se a cota estiver cheia, `
        + 'nenhuma nova nasce ate outra PR ser fechada. '
        + 'Seguir apontaria o preview para o Banco Preview compartilhado, que tem o schema ANTIGO, '
        + 'e o teste sairia verde contra o banco errado. Confira o check "Supabase Preview" desta PR '
        + 'e as ramificacoes abertas no painel, e rode este workflow de novo.',
      )
    }
    registrar('PR que altera supabase/ e ainda sem banco proprio; esperando a ramificacao nascer.')
    await dormir(intervaloSegundos * 1000)
    const lista = await listar()
    ultimoTotal = lista?.length ?? 0
    escolha = escolherRamificacao(lista, { prNumber, gitBranch })
  }

  if (escolha.situacao === 'sem-ramificacao') {
    // Sem banco proprio, qualquer variavel de banco desta branch esta sobrando:
    // e a trava de uma PR fechada que foi reaberta, ou o endereco de um banco
    // que ja morreu. Tirar as duas e o que devolve o preview ao compartilhado.
    await limparVariaveisDaBranch({
      gitBranch,
      vercelToken,
      vercelProject,
      vercelTeamId,
      registrar,
      fetchImpl,
    })
    registrar(
      'Esta PR nao altera supabase/ e nao tem banco proprio, que e o esperado. '
      + 'O preview segue no Banco Preview compartilhado, que espelha a main.',
    )
    return { situacao: 'sem-ramificacao' }
  }

  const limitePronta = Date.now() + esperarSegundos * 1000
  while (!ramificacaoEstaPronta(escolha.ramificacao)) {
    if (Date.now() >= limitePronta) {
      throw new Error(
        `O banco desta PR nao ficou pronto em ${esperarSegundos}s `
        + `(estado ${escolha.ramificacao.status}/${escolha.ramificacao.preview_project_status}).`,
      )
    }
    registrar(`Banco da PR ainda nascendo (${escolha.ramificacao.status}); esperando.`)
    await dormir(intervaloSegundos * 1000)
    escolha = escolherRamificacao(await listar(), { prNumber, gitBranch })
    if (escolha.situacao === 'sem-ramificacao') {
      throw new Error('A ramificacao desta PR desapareceu no meio da espera.')
    }
  }

  const refDaRamificacao = escolha.ramificacao.project_ref
  const chaves = await pedir(
    `https://api.supabase.com/v1/projects/${refDaRamificacao}/api-keys?reveal=true`,
    { token: supabaseToken, fetchImpl },
  )
  // Array tambem possui um metodo nativo chamado `keys`. Conferir o tipo antes
  // de desembrulhar evita passar essa funcao no lugar da lista documentada.
  const listaDeChaves = Array.isArray(chaves) ? chaves : chaves?.keys
  const chavePublica = escolherChavePublica(listaDeChaves)

  const variaveis = planejarVariaveis({
    projectRef: refDaRamificacao,
    chavePublica,
    gitBranch,
  })

  await gravarEReler({ variaveis, gitBranch, vercelToken, vercelProject, vercelTeamId, registrar, fetchImpl })

  registrar(`Preview desta PR apontado para o banco ${refDaRamificacao}.`)

  const redeploy = await reconstruirPreview({
    gitBranch,
    vercelToken,
    vercelProject,
    vercelTeamId,
    esperarSegundos: esperarPreviewSegundos,
    intervaloSegundos,
    dormir,
    registrar,
    fetchImpl,
  })

  return { situacao: 'apontado', projectRef: refDaRamificacao, redeploy }
}

/**
 * Manda a Vercel refazer o preview da branch.
 *
 * Sem isto, o deploy que ja tinha subido continua com as variaveis antigas: um
 * deploy nao se refaz sozinho quando a configuracao muda. Se ainda nao existir
 * deploy nenhum, nao ha nada a refazer e o proximo ja nasce certo.
 */
export async function reconstruirPreview({
  gitBranch,
  vercelToken,
  vercelProject,
  vercelTeamId,
  esperarSegundos = 180,
  intervaloSegundos = 10,
  dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  registrar = console.log,
  fetchImpl = fetch,
}) {
  // O filtro `branch` e feito pelo SERVIDOR (documentado em
  // /v7/deployments). Isso importa: filtrar no cliente uma pagina dos deploys
  // mais recentes do projeto inteiro confundiria "nao esta nesta pagina" com
  // "nao existe", e sobraria um preview verde apontando para o banco errado.
  const procurar = async () => {
    const lista = await pedir(
      comEscopo(
        'https://api.vercel.com/v7/deployments'
        + `?projectId=${encodeURIComponent(vercelProject)}`
        + `&branch=${encodeURIComponent(gitBranch)}`
        + '&limit=1',
        vercelTeamId,
      ),
      { token: vercelToken, fetchImpl },
    )
    return (lista?.deployments ?? [])[0]
  }

  // O outro jeito de confundir ausencia com invisibilidade: a Vercel comeca o
  // deploy no mesmo push que dispara este workflow, entao o deploy pode existir
  // e ainda nao aparecer na API. Esperar e a diferenca entre refazer o deploy
  // que ficou com as variaveis velhas e deixa-lo verde apontando para o banco
  // compartilhado.
  const limite = Date.now() + esperarSegundos * 1000
  let daBranch = await procurar()
  while (!daBranch) {
    if (Date.now() >= limite) {
      throw new Error(
        `Nenhum preview da branch ${gitBranch} apareceu na Vercel em ${esperarSegundos}s. `
        + 'As variaveis ja foram gravadas, mas nao deu para provar que nenhum deploy antigo '
        + 'ficou com a configuracao velha. Confira se a Vercel esta construindo esta branch '
        + 'e rode este workflow de novo.',
      )
    }
    registrar('Preview da branch ainda nao aparece na Vercel; esperando.')
    await dormir(intervaloSegundos * 1000)
    daBranch = await procurar()
  }

  if (daBranch.target === 'production') {
    throw new Error(
      `O deployment encontrado para a branch ${gitBranch} e de producao; recusado por seguranca.`,
    )
  }

  await pedir(
    comEscopo('https://api.vercel.com/v13/deployments?forceNew=1', vercelTeamId),
    {
      token: vercelToken,
      method: 'POST',
      // Na API de deployments, preview e o caminho sem `target`. Esse campo e
      // reservado a production, staging ou ambiente customizado.
      body: { name: vercelProject, deploymentId: daBranch.uid },
      fetchImpl,
    },
  )

  registrar('Preview mandado reconstruir com o banco da PR.')
  return { situacao: 'refeito', deploymentId: daBranch.uid }
}

/** As variaveis de banco gravadas para aquela branch, e so elas. */
async function listarVariaveisDaBranch({ gitBranch, vercelToken, vercelProject, vercelTeamId, fetchImpl }) {
  const lista = await pedir(
    comEscopo(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProject)}/env?gitBranch=${encodeURIComponent(gitBranch)}`,
      vercelTeamId,
    ),
    { token: vercelToken, fetchImpl },
  )

  if (!Array.isArray(lista?.envs)) {
    throw new Error('A listagem de variaveis da Vercel nao veio como lista.')
  }
  // Com pagina seguinte, a trava ou a sobra desta branch podem ter ficado fora
  // do que veio, e "nao achei" deixaria de significar "nao existe".
  if (lista.pagination?.next != null) {
    throw new Error('A listagem de variaveis da Vercel veio paginada; nao da para afirmar o que a branch tem.')
  }

  // A listagem filtrada por branch devolve TAMBEM as genericas de Preview. A
  // comparacao exata de gitBranch e o que impede tocar nelas.
  return lista.envs.filter(
    (variavel) => VARIAVEIS_DO_BANCO.includes(variavel?.key) && variavel.gitBranch === gitBranch,
  )
}

async function gravarEReler({ variaveis, gitBranch, vercelToken, vercelProject, vercelTeamId, registrar, fetchImpl }) {
  for (const variavel of variaveis) {
    await pedir(
      comEscopo(
        `https://api.vercel.com/v10/projects/${encodeURIComponent(vercelProject)}/env?upsert=true`,
        vercelTeamId,
      ),
      { token: vercelToken, method: 'POST', body: variavel, fetchImpl },
    )
  }

  const releitura = conferirReleitura(
    await listarVariaveisDaBranch({ gitBranch, vercelToken, vercelProject, vercelTeamId, fetchImpl }),
    variaveis,
  )
  registrar(
    releitura.porValor === variaveis.length
      ? 'Releitura na Vercel: as duas variaveis da branch tem o valor gravado.'
      : `Releitura na Vercel: as duas variaveis existem; ${releitura.porValor} conferida(s) por valor, `
        + 'as demais a Vercel nao devolveu em claro.',
  )
}

function exigirVercel({ gitBranch, vercelToken, vercelProject }) {
  if (!vercelToken) throw new Error('VERCEL_TOKEN ausente.')
  if (!vercelProject) throw new Error('Projeto da Vercel ausente.')
  if (!gitBranch) throw new Error('Nome da branch ausente: nao da para saber quais variaveis mexer.')
}

/**
 * Trava a branch de uma PR fechada no destino inerte.
 *
 * O Supabase apaga o banco da PR sozinho quando ela fecha. Os previews ja
 * publicados ficam com o endereco morto, o que e inofensivo: o build e
 * estatico e so falha ao conectar. O perigo e o proximo push na branch, que
 * nasceria no banco compartilhado se as variaveis simplesmente sumissem.
 */
export async function bloquearPreviewDaBranch({
  gitBranch,
  vercelToken,
  vercelProject,
  vercelTeamId,
  registrar = console.log,
  fetchImpl = fetch,
}) {
  exigirVercel({ gitBranch, vercelToken, vercelProject })

  const variaveis = planejarBloqueio({ gitBranch })
  await gravarEReler({ variaveis, gitBranch, vercelToken, vercelProject, vercelTeamId, registrar, fetchImpl })

  registrar('Branch da PR fechada travada: um preview novo dela falha no build em vez de usar o banco compartilhado.')
  return { situacao: 'bloqueado' }
}

/**
 * Apaga as variaveis de banco daquela branch e confere que sumiram.
 *
 * Serve a dois momentos: a PR foi reaberta sem banco proprio (destravar, e o
 * preview volta ao compartilhado) e a branch foi apagada (esquecer a trava,
 * para nao acumular variavel de branch que nao existe mais).
 */
export async function limparVariaveisDaBranch({
  gitBranch,
  vercelToken,
  vercelProject,
  vercelTeamId,
  registrar = console.log,
  fetchImpl = fetch,
}) {
  // Mesma exigencia do outro caminho: sem isto a falta de token so aparecia
  // como um 401 no meio do log, em vez de uma frase dizendo o que falta.
  exigirVercel({ gitBranch, vercelToken, vercelProject })

  const alvos = await listarVariaveisDaBranch({ gitBranch, vercelToken, vercelProject, vercelTeamId, fetchImpl })

  for (const alvo of alvos) {
    await pedir(
      comEscopo(
        `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProject)}/env/${encodeURIComponent(alvo.id)}`,
        vercelTeamId,
      ),
      { token: vercelToken, method: 'DELETE', fetchImpl },
    )
  }

  if (alvos.length > 0) {
    conferirReleitura(
      await listarVariaveisDaBranch({ gitBranch, vercelToken, vercelProject, vercelTeamId, fetchImpl }),
      [],
    )
  }

  registrar(`${alvos.length} variavel(is) de banco desta branch removida(s) da Vercel.`)
  return { removidas: alvos.length }
}

const ACOES = new Set(['apontar', 'destravar', 'bloquear', 'esquecer'])

/**
 * O que o GitHub diz AGORA sobre a branch: se ela existe e quais PRs abertas
 * da propria casa saem dela.
 *
 * Existe porque o evento que disparou esta execucao pode estar velho. O
 * GitHub nao garante a ordem das execucoes: um "enviou commit" atrasado pode
 * rodar depois do "fechou", e um "fechou" atrasado depois do "apagou a
 * branch". Quem decide pelo estado atual, e nao pelo evento, deixa o certo
 * mesmo rodando fora de ordem, desde que as execucoes da mesma branch facam
 * fila (ver concurrency no workflow).
 */
export async function lerEstadoDaBranch({ repositorio, gitBranch, githubToken, fetchImpl = fetch }) {
  if (!githubToken) throw new Error('GITHUB_TOKEN ausente: sem ele nao da para conferir o estado atual da branch.')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repositorio ?? '')) {
    throw new Error('GITHUB_REPOSITORY ausente ou invalido: nao da para conferir o estado atual da branch.')
  }
  if (!gitBranch) throw new Error('Nome da branch ausente: nao da para conferir o estado atual.')

  const base = `https://api.github.com/repos/${repositorio}`
  const caminhoDaRef = gitBranch.split('/').map(encodeURIComponent).join('/')

  // `git/ref` (singular) devolve a referencia exata ou 404. So 404 quer dizer
  // "nao existe"; qualquer outra falha interrompe, porque concluir "apagada"
  // por engano apagaria a trava de uma branch viva.
  const respostaDaRef = await fetchImpl(`${base}/git/ref/heads/${caminhoDaRef}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' },
  })
  let branchExiste
  if (respostaDaRef.status === 404) {
    branchExiste = false
  } else if (respostaDaRef.ok) {
    const corpo = await respostaDaRef.json()
    if (corpo?.ref !== `refs/heads/${gitBranch}`) {
      throw new Error('O GitHub devolveu uma referencia que nao e exatamente esta branch; recusado por seguranca.')
    }
    branchExiste = true
  } else {
    throw new Error(`GET da branch no GitHub respondeu ${respostaDaRef.status}.`)
  }

  // So PR contra a main conta: e so ela que o workflow aponta e trava.
  const dono = repositorio.split('/')[0]
  const abertas = await pedir(
    `${base}/pulls?state=open&base=main&per_page=100&head=${encodeURIComponent(`${dono}:${gitBranch}`)}`,
    { token: githubToken, fetchImpl },
  )
  if (!Array.isArray(abertas)) {
    throw new Error('A listagem de PRs abertas do GitHub nao veio como lista.')
  }
  if (abertas.length >= 100) {
    throw new Error('A listagem de PRs abertas veio no limite da pagina; nao da para afirmar o estado da branch.')
  }

  const prsAbertas = abertas
    .filter((pr) => pr?.head?.ref === gitBranch
      && pr?.head?.repo?.full_name === repositorio
      && pr?.base?.ref === 'main')
    .map((pr) => Number(pr.number))

  return { branchExiste, prsAbertas }
}

/**
 * O que fazer, dado o que o evento pediu e o estado atual da branch.
 *
 * - branch apagada: esquecer (nao ha mais push a proteger);
 * - branch viva sem PR aberta: travar, venha o pedido de onde vier;
 * - branch com PR aberta: travar e esquecer nao mexem (quem decide e o
 *   trabalho da PR aberta, que conhece a classificacao dela);
 * - apontar e destravar so seguem se a PR do evento e a que esta aberta. Se
 *   a aberta for outra PR na mesma branch, a execucao dela decide.
 */
export function decidirPeloEstado({ acao, branchExiste, prsAbertas, prNumber }) {
  if (!ACOES.has(acao)) throw new Error(`ACAO desconhecida (${acao ?? 'ausente'}); nada foi alterado.`)
  if (!Array.isArray(prsAbertas)) throw new Error('Estado da branch sem a lista de PRs abertas.')
  if (branchExiste === false) return 'esquecer'
  if (branchExiste !== true) throw new Error('Estado da branch sem a informacao de existencia.')
  if (prsAbertas.length === 0) return 'bloquear'
  if (acao === 'bloquear' || acao === 'esquecer') return 'nada'

  const numero = Number(prNumber)
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error('PR_NUMBER ausente ou invalido: nao da para saber se a PR do evento continua aberta.')
  }
  return prsAbertas.includes(numero) ? acao : 'nada'
}

/** Confere o estado atual e executa a decisao. */
export async function executarAcao({
  acao,
  prNumber,
  gitBranch,
  repositorio,
  githubToken,
  supabaseToken,
  prAlteraSupabase,
  vercelToken,
  vercelProject,
  vercelTeamId,
  registrar = console.log,
  fetchImpl = fetch,
  ...opcoes
}) {
  // Acao desconhecida falha antes de qualquer chamada: cair no caminho de
  // apontar por engano gravaria variaveis numa branch que devia ficar travada.
  if (!ACOES.has(acao)) throw new Error(`ACAO desconhecida (${acao ?? 'ausente'}); nada foi alterado.`)
  const comum = { gitBranch, vercelToken, vercelProject, vercelTeamId, registrar, fetchImpl }
  exigirVercel(comum)

  const estado = await lerEstadoDaBranch({ repositorio, gitBranch, githubToken, fetchImpl })
  const decisao = decidirPeloEstado({ acao, prNumber, ...estado })
  registrar(
    `O evento pediu "${acao}". No GitHub agora a branch ${estado.branchExiste ? 'existe' : 'nao existe'} `
    + `e tem ${estado.prsAbertas.length} PR(s) aberta(s) (${estado.prsAbertas.join(', ') || 'nenhuma'}). Decisao: ${decisao}.`,
  )

  if (decisao === 'nada') return { decisao }
  if (decisao === 'bloquear') return { decisao, ...(await bloquearPreviewDaBranch(comum)) }
  if (decisao === 'esquecer' || decisao === 'destravar') {
    return { decisao, ...(await limparVariaveisDaBranch(comum)) }
  }
  return {
    decisao,
    ...(await apontarPreviewParaRamificacao({
      ...comum,
      ...opcoes,
      prNumber,
      supabaseToken,
      prAlteraSupabase,
    })),
  }
}

async function main() {
  await executarAcao({
    acao: process.env.ACAO,
    prNumber: process.env.PR_NUMBER,
    gitBranch: process.env.GIT_BRANCH,
    repositorio: process.env.GITHUB_REPOSITORY,
    githubToken: process.env.GITHUB_TOKEN,
    supabaseToken: process.env.SUPABASE_ACCESS_TOKEN,
    prAlteraSupabase: process.env.PR_ALTERA_SUPABASE === 'true',
    vercelToken: process.env.VERCEL_TOKEN,
    vercelProject: process.env.VERCEL_PROJECT,
    vercelTeamId: process.env.VERCEL_TEAM_ID,
  })
}

const execucaoDireta = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (execucaoDireta) {
  main().catch((erro) => {
    console.error(erro instanceof Error ? erro.message : 'Falha desconhecida ao apontar o banco da PR.')
    process.exitCode = 1
  })
}
