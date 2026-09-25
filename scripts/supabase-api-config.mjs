import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SAFE_SCHEMA = /^[a-z_][a-z0-9_]*$/
const PROJECT_REF = /^[a-z0-9]{20}$/

export function readApiSchemas(configText) {
  let section = null
  let rawSchemas = null

  for (const line of configText.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      continue
    }

    if (section !== 'api') continue

    const schemasMatch = line.match(/^\s*schemas\s*=\s*(\[[^\r\n]*])\s*(?:#.*)?$/)
    if (schemasMatch) {
      if (rawSchemas !== null) {
        throw new Error('A seção [api] contém mais de uma lista schemas')
      }
      rawSchemas = schemasMatch[1]
    }
  }

  if (rawSchemas === null) {
    throw new Error('A seção [api] não contém uma lista schemas válida')
  }

  let schemas
  try {
    schemas = JSON.parse(rawSchemas)
  } catch {
    throw new Error('A lista schemas da seção [api] não é válida')
  }

  if (!Array.isArray(schemas) || schemas.length === 0) {
    throw new Error('A lista schemas da seção [api] deve conter ao menos um schema')
  }

  if (!schemas.every((schema) => typeof schema === 'string' && SAFE_SCHEMA.test(schema))) {
    throw new Error('A lista schemas da seção [api] contém um nome inseguro')
  }

  if (new Set(schemas).size !== schemas.length) {
    throw new Error('A lista schemas da seção [api] contém nomes repetidos')
  }

  if (!schemas.includes('public')) {
    throw new Error('A lista schemas da seção [api] precisa preservar public')
  }

  return schemas
}

export function buildDataApiPayload(configText) {
  return { db_schema: readApiSchemas(configText).join(',') }
}

export async function applyDataApiConfig({
  projectRef,
  accessToken,
  workdir = process.cwd(),
  readFileImpl = readFile,
  fetchImpl = fetch,
}) {
  if (!PROJECT_REF.test(projectRef ?? '')) {
    throw new Error('PROJECT_REF ausente ou inválido')
  }
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('SUPABASE_ACCESS_TOKEN ausente')
  }

  const configPath = resolve(workdir, 'supabase', 'config.toml')
  const configText = await readFileImpl(configPath, 'utf8')
  const payload = buildDataApiPayload(configText)
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/postgrest`

  const response = await fetchImpl(endpoint, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`A Management API recusou a configuração da Data API (HTTP ${response.status})`)
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('A Management API retornou uma resposta inválida')
  }

  if (result?.db_schema !== payload.db_schema) {
    throw new Error('A Management API não confirmou a lista de schemas solicitada')
  }

  return readApiSchemas(configText)
}

async function main() {
  const schemas = await applyDataApiConfig({
    projectRef: process.env.PROJECT_REF,
    accessToken: process.env.SUPABASE_ACCESS_TOKEN,
  })
  console.log(`Schemas publicados pela Data API: ${schemas.join(', ')}`)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Falha desconhecida ao configurar a Data API')
    process.exitCode = 1
  })
}
