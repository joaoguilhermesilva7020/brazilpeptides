import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://joaoguilhermesilva7020.github.io",
]);

function corsHeadersFor(req: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  const origin = req.headers.get("Origin");
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function hasAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("Origin");
  return !origin || allowedOrigins.has(origin);
}

type OrderClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

type OrderClientFactory = (
  url: string,
  anonKey: string,
  options: { auth: { persistSession: false; autoRefreshToken: false } },
) => OrderClient;

type TurnstileVerifier = (token: string, remoteIp: string | null) => Promise<boolean>;

export async function verifyTurnstileToken(
  token: string,
  remoteIp: string | null,
  secret: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set("remoteip", remoteIp);
  const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result?.success === true &&
    result?.hostname === "joaoguilhermesilva7020.github.io" &&
    result?.action === "checkout";
}

export function createOrderHandler(
  createSupabaseClient: OrderClientFactory,
  verifyToken: TurnstileVerifier,
) {
  return async (req: Request): Promise<Response> => {
    const headers = corsHeadersFor(req);
    if (!hasAllowedOrigin(req)) {
      return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
    }
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") {
      return Response.json({ error: "Método não permitido." }, { status: 405, headers });
    }

    try {
      const rawBody = await req.text();
      if (rawBody.length > 16_384) {
        return Response.json({ error: "Requisição muito grande." }, { status: 413, headers });
      }
      const body = JSON.parse(rawBody);
      if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.items)) {
        return Response.json({ error: "Dados do pedido inválidos." }, { status: 400, headers });
      }
      if (typeof body.turnstile_token !== "string" ||
          body.turnstile_token.length < 1 || body.turnstile_token.length > 2048) {
        return Response.json({ error: "Conclua a verificação de segurança." }, { status: 400, headers });
      }

      const verified = await verifyToken(body.turnstile_token, null);
      if (!verified) {
        return Response.json({ error: "Verificação de segurança inválida. Tente novamente." }, { status: 403, headers });
      }

      const supabase = createSupabaseClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      const { data, error } = await supabase.rpc("create_order_from_catalog", {
        p_payload: {
          customer_name: body.customer_name,
          customer_phone: body.customer_phone,
          customer_email: body.customer_email ?? null,
          payment_method: body.payment_method,
          affiliate_ref: body.affiliate_ref ?? null,
          notes: body.notes ?? null,
          items: body.items.map((item: { variant_id: string; quantity: number }) => ({
            variant_id: item.variant_id,
            quantity: item.quantity,
          })),
        },
      });

      if (error) {
        return Response.json({ error: error.message }, { status: 400, headers });
      }
      return Response.json({ data }, { status: 201, headers });
    } catch (_error) {
      return Response.json({ error: "Não foi possível processar o pedido." }, { status: 400, headers });
    }
  };
}

if (import.meta.main) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  const createSupabaseClient = createClient as unknown as OrderClientFactory;
  Deno.serve(createOrderHandler(
    createSupabaseClient,
    async (token, remoteIp) => {
      if (!secret) return false;
      try {
        return await verifyTurnstileToken(token, remoteIp, secret);
      } catch {
        return false;
      }
    },
  ));
}
