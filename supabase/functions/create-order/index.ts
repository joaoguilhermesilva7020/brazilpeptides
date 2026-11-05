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

  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || !Array.isArray(body.items)) {
      return Response.json({ error: "Dados do pedido inválidos." }, { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
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
      return Response.json({ error: error.message }, { status: 400, headers: corsHeaders });
    }

    return Response.json({ data }, { status: 201, headers: corsHeaders });
  } catch (_error) {
    return Response.json({ error: "Não foi possível processar o pedido." }, { status: 400, headers: corsHeaders });
  }
});
