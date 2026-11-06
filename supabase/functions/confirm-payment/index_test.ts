import { createConfirmPaymentHandler } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json();
}

function request(
  method = "POST",
  body?: unknown,
  authorization = "Bearer test-access-token",
  origin?: string,
): Request {
  return new Request("http://localhost/functions/v1/confirm-payment", {
    method,
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function fakeFactory(options: {
  user?: unknown | null;
  authError?: unknown | null;
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  onRpc?: (name: string, args: Record<string, unknown>) => void;
  onCreate?: (url: string, key: string, config: unknown) => void;
} = {}) {
  return (url: string, key: string, config: unknown) => {
    options.onCreate?.(url, key, config);
    return {
      auth: {
        getUser: async () => ({
          data: { user: options.user === undefined ? { id: "admin-test-user" } : options.user },
          error: options.authError ?? null,
        }),
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        options.onRpc?.(name, args);
        return {
          data: options.rpcData ?? { status: "paid", payment_status: "confirmed", already_confirmed: false },
          error: options.rpcError ?? null,
        };
      },
    };
  };
}

Deno.test("OPTIONS returns CORS preflight response without creating a client", async () => {
  let created = false;
  const handler = createConfirmPaymentHandler((_url, _key, _config) => {
    created = true;
    throw new Error("client should not be created");
  });

  const response = await handler(request("OPTIONS"));
  assert(response.status === 200, "expected HTTP 200");
  assert(response.headers.get("Access-Control-Allow-Origin") === null, "originless request must not receive wildcard CORS");
  assert(!created, "preflight must not create a Supabase client");
});


Deno.test("approved site origin receives an explicit CORS allow-origin header", async () => {
  const handler = createConfirmPaymentHandler(fakeFactory());
  const response = await handler(request("OPTIONS", undefined, "Bearer test-access-token", "https://joaoguilhermesilva7020.github.io"));
  assert(response.status === 200, "expected HTTP 200");
  assert(response.headers.get("Access-Control-Allow-Origin") === "https://joaoguilhermesilva7020.github.io", "approved origin was not echoed");
});

Deno.test("unapproved origin is rejected before authentication or RPC", async () => {
  let created = false;
  const handler = createConfirmPaymentHandler((_url, _key, _config) => {
    created = true;
    throw new Error("client must not be created");
  });
  const response = await handler(request("POST", { order_id: "order-test" }, "Bearer test-access-token", "https://evil.example"));
  assert(response.status === 403, "expected HTTP 403");
  assert(!created, "unapproved origin must be rejected before client creation");
});

Deno.test("non-POST methods are rejected", async () => {
  const handler = createConfirmPaymentHandler(fakeFactory());
  const response = await handler(request("GET"));
  assert(response.status === 405, "expected HTTP 405");
});

Deno.test("missing bearer token is rejected before client creation", async () => {
  let created = false;
  const handler = createConfirmPaymentHandler((_url, _key, _config) => {
    created = true;
    throw new Error("client should not be created");
  });

  const response = await handler(request("POST", { order_id: "order-test" }, ""));
  assert(response.status === 401, "expected HTTP 401");
  assert(!created, "missing token must not create a Supabase client");
});

Deno.test("invalid or expired session is rejected and RPC is not called", async () => {
  let rpcCalled = false;
  const handler = createConfirmPaymentHandler(fakeFactory({
    user: null,
    onRpc: () => { rpcCalled = true; },
  }));

  const response = await handler(request("POST", { order_id: "order-test" }));
  assert(response.status === 401, "expected HTTP 401");
  assert(!rpcCalled, "RPC must not run without an authenticated user");
});

Deno.test("malformed order payload is rejected", async () => {
  const handler = createConfirmPaymentHandler(fakeFactory());
  const response = await handler(request("POST", { order_id: 123 }));
  assert(response.status === 400, "expected HTTP 400");
});

Deno.test("non-administrator RPC rejection maps to HTTP 403", async () => {
  const handler = createConfirmPaymentHandler(fakeFactory({
    rpcError: { message: "Apenas administrador pode confirmar pagamento." },
  }));

  const response = await handler(request("POST", { order_id: "order-test" }));
  const body = await responseBody(response);
  assert(response.status === 403, "expected HTTP 403");
  assert(body.error === "Apenas administrador pode confirmar pagamento.", "unexpected error body");
});

Deno.test("other database errors map to HTTP 400", async () => {
  const handler = createConfirmPaymentHandler(fakeFactory({
    rpcError: { message: "Estoque insuficiente." },
  }));

  const response = await handler(request("POST", { order_id: "order-test" }));
  assert(response.status === 400, "expected HTTP 400");
});

Deno.test("authenticated request forwards bearer token and RPC arguments", async () => {
  let receivedConfig: unknown;
  let receivedRpcName = "";
  let receivedArgs: Record<string, unknown> = {};
  const handler = createConfirmPaymentHandler(fakeFactory({
    onCreate: (_url, _key, config) => { receivedConfig = config; },
    onRpc: (name, args) => {
      receivedRpcName = name;
      receivedArgs = args;
    },
    rpcData: { status: "paid", payment_status: "confirmed", already_confirmed: false },
  }));

  const response = await handler(request("POST", {
    order_id: "order-test",
    payment_reference: "PIX-TEST-001",
    notes: "Confirmação de teste",
  }));
  const body = await responseBody(response);
  const config = receivedConfig as { global?: { headers?: { Authorization?: string } } };

  assert(response.status === 200, "expected HTTP 200");
  assert(receivedRpcName === "confirm_order_payment", "unexpected RPC function");
  assert(receivedArgs.p_order_id === "order-test", "order ID was not forwarded");
  assert(receivedArgs.p_payment_reference === "PIX-TEST-001", "payment reference was not forwarded");
  assert(receivedArgs.p_notes === "Confirmação de teste", "notes were not forwarded");
  assert(config.global?.headers?.Authorization === "Bearer test-access-token", "bearer token was not forwarded");
  assert((body.data as Record<string, unknown>).payment_status === "confirmed", "unexpected response data");
});

Deno.test("already-confirmed RPC result is returned without changing its idempotent marker", async () => {
  const handler = createConfirmPaymentHandler(fakeFactory({
    rpcData: { status: "paid", payment_status: "confirmed", already_confirmed: true },
  }));

  const response = await handler(request("POST", { order_id: "order-already-paid" }));
  const body = await responseBody(response);
  const data = body.data as Record<string, unknown>;

  assert(response.status === 200, "expected HTTP 200");
  assert(data.already_confirmed === true, "idempotent result marker was not preserved");
});
