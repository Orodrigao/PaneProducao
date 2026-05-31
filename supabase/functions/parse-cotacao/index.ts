// Edge Function: parse-cotacao
//
// Recebe um texto colado da resposta de cotação de um fornecedor (WhatsApp,
// e-mail, etc.) e devolve JSON estruturado com preço/disponibilidade por
// item, usando Gemini Flash (modelo barato e rápido).
//
// Deploy:
//   supabase functions deploy parse-cotacao
//
// Secrets necessárias:
//   GEMINI_API_KEY — chave do Google AI Studio (https://aistudio.google.com/apikey)
//
// Request body:
//   {
//     "text": "...resposta colada...",
//     "products": [{ "id": "uuid", "name": "Farinha", "unit": "kg" }, ...]
//   }
//
// Response body (200):
//   { "items": [{ "product_id": "uuid|null", "product_name": "...",
//                 "unit_price": 1.23, "unit": "kg", "available": true,
//                 "notes": "..." }] }
//
// Em erro, devolve 4xx/5xx com { error, detail? }.

const GEMINI_MODEL = "gemini-2.5-flash"
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" }

interface CatalogProduct { id: string; name: string; unit?: string | null }

function buildPrompt(text: string, products: CatalogProduct[]): string {
  const catalog = products.slice(0, 200).map((p, i) =>
    `${i + 1}. ${p.name}${p.unit ? ` (${p.unit})` : ""} [id:${p.id}]`
  ).join("\n") || "(catálogo não fornecido — devolva product_id null em todos os itens)"

  return [
    "Você é um assistente que extrai preços de respostas de cotação de fornecedores de uma padaria.",
    "",
    "CATÁLOGO de produtos esperados (use o id como referência quando reconhecer):",
    catalog,
    "",
    "TEXTO da resposta do fornecedor:",
    '"""',
    text,
    '"""',
    "",
    "Extraia cada produto cotado e responda APENAS com JSON válido (sem markdown, sem explicação) no formato:",
    "{",
    '  "items": [',
    '    { "product_id": "uuid-do-catálogo-ou-null", "product_name": "nome como veio na resposta",',
    '      "unit_price": 1.23, "unit": "kg" | "un" | null, "available": true, "notes": "opcional ou null" }',
    "  ]",
    "}",
    "",
    "REGRAS:",
    "- Se reconhece o produto no catálogo, use o product_id correspondente. Senão, product_id=null.",
    "- unit_price é number com ponto decimal (não vírgula). Se vier vírgula no texto, converta.",
    "- Se o item está indisponível (palavras tipo 'indisponível', 'não tenho', 'sem', 'esgotado', 'sem estoque', 'não tem'), use available=false e unit_price=0.",
    "- Se algum item do catálogo não foi mencionado, NÃO inclua (deixa de fora).",
    "- Se o texto não tem preços ou está irrelevante, retorne {\"items\": []}.",
    "- Não invente nomes nem preços: melhor deixar de fora do que chutar.",
  ].join("\n")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: jsonHeaders })
  }
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "missing_gemini_key", detail: "Configure GEMINI_API_KEY em Supabase Edge Functions Secrets" }), {
      status: 500, headers: jsonHeaders,
    })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: jsonHeaders }) }

  const { text, products } = (body as { text?: string; products?: CatalogProduct[] }) || {}
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return new Response(JSON.stringify({ error: "text_required" }), { status: 400, headers: jsonHeaders })
  }

  const prompt = buildPrompt(text, products || [])
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    })

    if (!resp.ok) {
      const detail = await resp.text()
      return new Response(JSON.stringify({ error: "gemini_api_error", status: resp.status, detail: detail.slice(0, 800) }), {
        status: 502, headers: jsonHeaders,
      })
    }

    const data = await resp.json()
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || ""
    let parsed: { items?: unknown }
    try { parsed = JSON.parse(raw) }
    catch {
      return new Response(JSON.stringify({ error: "gemini_non_json", raw: raw.slice(0, 800) }), {
        status: 502, headers: jsonHeaders,
      })
    }

    const items = Array.isArray(parsed.items)
      ? parsed.items.filter((it: unknown) => it && typeof it === "object").map((it: any) => ({
        product_id: typeof it.product_id === "string" ? it.product_id : null,
        product_name: typeof it.product_name === "string" ? it.product_name : "",
        unit_price: typeof it.unit_price === "number" ? it.unit_price : Number(it.unit_price) || 0,
        unit: typeof it.unit === "string" ? it.unit : null,
        available: it.available === false ? false : true,
        notes: typeof it.notes === "string" ? it.notes : null,
      }))
      : []

    return new Response(JSON.stringify({ items }), { status: 200, headers: jsonHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: "fetch_failed", detail: (e as Error).message || String(e) }), {
      status: 500, headers: jsonHeaders,
    })
  }
})
