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

type ConfirmPaymentClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: unknown | null };
      error: unknown | null;
    }>;
  };
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type ConfirmPaymentClientFactory = (
  url: string,
  anonKey: string,
  options: {
    global: { headers: { Authorization: string } };
    auth: { persistSession: false; autoRefreshToken: false };
  },
) => ConfirmPaymentClient;

export function createConfirmPaymentHandler(createSupabaseClient: ConfirmPaymentClientFactory) {
  return async (req: Request): Promise<Response> => {
    const headers = corsHeadersFor(req);
    if (!hasAllowedOrigin(req)) {
      return Response.json({ error: "Origem não autorizada." }, { status: 403 });
    }
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") {
      return Response.json({ error: "Método não permitido." }, { status: 405, headers });
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return Response.json({ error: "Autenticação obrigatória." }, { status: 401, headers });
    }

    try {
      const rawBody = await req.text();
      if (rawBody.length > 8_192) {
        return Response.json({ error: "Requisição muito grande." }, { status: 413, headers });
      }
      const body = JSON.parse(rawBody);
      if (typeof body?.order_id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.order_id)) {
        return Response.json({ error: "ID do pedido inválido." }, { status: 400, headers });
      }
      if (body.payment_reference != null && (typeof body.payment_reference !== "string" || body.payment_reference.length > 200)) {
        return Response.json({ error: "Referência de pagamento inválida." }, { status: 400, headers });
      }
      if (body.notes != null && (typeof body.notes !== "string" || body.notes.length > 1000)) {
        return Response.json({ error: "Observação inválida." }, { status: 400, headers });
      }

      const supabase = createSupabaseClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        return Response.json({ error: "Sessão inválida ou expirada." }, { status: 401, headers });
      }

      const { data, error } = await supabase.rpc("confirm_order_payment", {
        p_order_id: body.order_id,
        p_payment_reference: body.payment_reference ?? null,
        p_notes: body.notes ?? null,
      });

      if (error) {
        const status = error.message.includes("administrador") ? 403 : 400;
        return Response.json({ error: error.message }, { status, headers });
      }
      return Response.json({ data }, { status: 200, headers });
    } catch (_error) {
      return Response.json({ error: "Não foi possível confirmar o pagamento." }, { status: 400, headers });
    }
  };
}

if (import.meta.main) {
  const createSupabaseClient = createClient as unknown as ConfirmPaymentClientFactory;
  Deno.serve(createConfirmPaymentHandler(createSupabaseClient));
}
