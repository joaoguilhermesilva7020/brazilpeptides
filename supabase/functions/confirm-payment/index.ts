import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ error: "Método não permitido." }, { status: 405, headers: corsHeaders });
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return Response.json({ error: "Autenticação obrigatória." }, { status: 401, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    if (typeof body?.order_id !== "string") {
      return Response.json({ error: "ID do pedido inválido." }, { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return Response.json({ error: "Sessão inválida ou expirada." }, { status: 401, headers: corsHeaders });
    }

    const { data, error } = await supabase.rpc("confirm_order_payment", {
      p_order_id: body.order_id,
      p_payment_reference: body.payment_reference ?? null,
      p_notes: body.notes ?? null,
    });

    if (error) {
      const status = error.message.includes("administrador") ? 403 : 400;
      return Response.json({ error: error.message }, { status, headers: corsHeaders });
    }

    return Response.json({ data }, { status: 200, headers: corsHeaders });
  } catch (_error) {
    return Response.json({ error: "Não foi possível confirmar o pagamento." }, { status: 400, headers: corsHeaders });
  }
});
