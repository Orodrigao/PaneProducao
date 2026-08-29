import { createHash } from 'node:crypto'

export const PRODUCTION_SUPABASE_PROJECT_REF = 'gohluceldchoitihrimw'

/**
 * O projeto de teste compartilhado. Continua existindo enquanto a migração para
 * um banco por pull request não terminar, mas deixou de ser o ÚNICO endereço
 * aceito fora de produção: cada PR passa a ter projeto próprio, com referência
 * e chave que ninguém conhece de antemão.
 */
export const PREVIEW_SUPABASE_PROJECT_REF = 'tuqzhjsbodoycjbmwuqm'

/**
 * Só produção tem impressão digital fixa. É o único projeto que nunca muda, e é
 * o único em que uma chave trocada por engano custa caro.
 */
const PRODUCTION_PUBLIC_KEY_FINGERPRINT =
  '6a2b9528fa9016d003a2d4e09c2533fef4455214fd8492edcbbe7d493be09336'

interface SupabaseEnvironmentInput {
  supabaseUrl: string | undefined
  vercelEnvironment?: string
}

interface SupabasePublicKeyInput {
  supabaseUrl: string | undefined
  supabaseKey: string | undefined
}

function projectRefFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    const suffix = '.supabase.co'
    return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : null
  } catch {
    return null
  }
}

/**
 * A referência do projeto que a própria chave declara, quando ela declara.
 *
 * Chave em formato JWT traz `ref` no payload. A chave nova do Supabase
 * (`sb_publishable_...`) **não traz nada**: é opaca. Então esta conferência é
 * um bônus quando disponível, nunca a única defesa.
 *
 * Não é validação de assinatura, e não precisa ser: a chave é pública e o que
 * se quer impedir é o par trocado (endereço de um projeto com a chave de
 * outro), não falsificação.
 */
function projectRefFromKey(key: string): string | null {
  const partes = key.split('.')
  if (partes.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'))
    return typeof payload?.ref === 'string' ? payload.ref : null
  } catch {
    return null
  }
}

export function assertSafeSupabaseEnvironment({
  supabaseUrl,
  vercelEnvironment,
}: SupabaseEnvironmentInput): void {
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ausente: o build foi interrompido por seguranca.')
  }

  const projectRef = projectRefFromUrl(supabaseUrl)
  if (!projectRef) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL invalida: informe um projeto Supabase conhecido.')
  }

  if (vercelEnvironment === 'production') {
    if (projectRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
      throw new Error('Producao tentou usar o banco de teste ou um projeto desconhecido.')
    }
    return
  }

  // Fora de producao a regra deixou de ser "tem de ser ESTE projeto" e passou a
  // ser "nao pode ser producao". O objetivo da trava sempre foi esse; o
  // criterio antigo so funcionava num mundo de dois bancos, e com um banco por
  // PR ele recusaria justamente os previews legitimos.
  if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    const environmentName = vercelEnvironment === 'preview' ? 'Preview' : 'Ambiente local'
    throw new Error(`${environmentName} tentou usar o banco de producao.`)
  }
}

export async function assertValidSupabasePublicKey({
  supabaseUrl,
  supabaseKey,
}: SupabasePublicKeyInput): Promise<void> {
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ausente: a chave publica nao pode ser validada.')
  }
  if (!supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY ausente: o build foi interrompido por seguranca.')
  }

  const projectRef = projectRefFromUrl(supabaseUrl)
  if (!projectRef) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL invalida: informe um projeto Supabase conhecido.')
  }

  // Caractere invisivel colado na chave (um retorno de carro que veio junto do painel, por
  // exemplo) ja quebrou build aqui. Recusar com mensagem propria poupa a caca:
  // a chave "parece certa" na tela de quem copiou.
  if (supabaseKey !== supabaseKey.trim()) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY tem espaco ou caractere invisivel nas pontas; '
      + 'o build foi interrompido.',
    )
  }

  // Producao continua presa a impressao digital exata: e o unico projeto que
  // nao muda, e o unico em que a chave errada custa caro.
  if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    const actual = createHash('sha256').update(supabaseKey).digest('hex')
    if (actual !== PRODUCTION_PUBLIC_KEY_FINGERPRINT) {
      throw new Error('Chave publica nao pertence ao projeto Supabase configurado; o build foi interrompido.')
    }
    return
  }

  // Fora de producao o projeto e novo a cada PR, entao nao ha impressao digital
  // a comparar. E a chave nova do Supabase e opaca: `sb_publishable_...` nao
  // diz a que projeto pertence.
  //
  // O QUE SE PERDE, declarado: fora de producao deixa de haver prova de que a
  // chave pertence AQUELE endereco. O prejuizo e pequeno e contido — chave
  // trocada num preview simplesmente nao conecta, e o dado ali e ficticio.
  //
  // O QUE NAO SE PERDE, que e o que a trava existe para proteger: nenhum
  // ambiente fora de producao alcanca o banco de producao, porque isso e
  // decidido pelo ENDERECO em `assertSafeSupabaseEnvironment`, e producao
  // continua exigindo a impressao digital exata logo acima.
  if (!/^(sb_publishable_[A-Za-z0-9_-]{10,}|[\w-]+\.[\w-]+\.[\w-]+)$/.test(supabaseKey)) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY em formato nao reconhecido; o build foi interrompido.',
    )
  }

  // Bonus quando a chave e JWT e declara o projeto: par trocado nao passa.
  const refDaChave = projectRefFromKey(supabaseKey)
  if (refDaChave && refDaChave !== projectRef) {
    throw new Error('Chave publica nao pertence ao projeto Supabase configurado; o build foi interrompido.')
  }
}
