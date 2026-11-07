import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const allowedOrigins = new Set(["https://joaoguilhermesilva7020.github.io"]);
function corsHeadersFor(req: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  });
  const origin = req.headers.get("Origin");
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
Deno.serve(async (req) => {
  const headers = corsHeadersFor(req);
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins.has(origin)) return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return Response.json({ error: "Método não permitido." }, { status: 405, headers });
  try {
    const rawBody = await req.text();
    if (rawBody.length > 4096) return Response.json({ error: "Requisição muito grande." }, { status: 413, headers });
    const body = JSON.parse(rawBody);
    if (typeof body?.code !== "string" || body.code.length > 64) return Response.json({ error: "Informe um código válido." }, { status: 400, headers });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc("validate_product_auth_code", { p_code: body.code });
    if (error) return Response.json({ error: "Não foi possível consultar o código agora." }, { status: 500, headers });
    return Response.json({ data }, { status: 200, headers });
  } catch (_error) {
    return Response.json({ error: "Não foi possível processar a consulta." }, { status: 400, headers });
  }
});
