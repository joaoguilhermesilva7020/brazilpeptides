import { createOrderHandler, verifyTurnstileToken } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function request(body: unknown, origin = "https://joaoguilhermesilva7020.github.io"): Request {
  return new Request("http://localhost/functions/v1/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

function fakeFactory(onRpc?: () => void) {
  return (_url: string, _key: string, _options: unknown) => ({
    rpc: async (_name: string, _args: Record<string, unknown>) => {
      onRpc?.();
      return { data: { order_id: "test-order", order_number: 123, total: 100 }, error: null };
    },
  });
}

Deno.test("Turnstile sends the secret and response token to siteverify", async () => {
  let submitted = "";
  const ok = await verifyTurnstileToken("challenge-token", null, "secret-value", async (_url, init) => {
    submitted = String(init?.body || "");
    return Response.json({ success: true, hostname: "joaoguilhermesilva7020.github.io", action: "checkout" });
  });
  const params = new URLSearchParams(submitted);
  assert(ok, "valid Turnstile response should pass");
  assert(params.get("secret") === "secret-value", "secret was not sent");
  assert(params.get("response") === "challenge-token", "token was not sent");
  assert(params.get("remoteip") === null, "untrusted client IP header must not be forwarded");
});

Deno.test("Turnstile rejects unsuccessful or failed verification responses", async () => {
  const rejected = await verifyTurnstileToken("bad-token", null, "secret", async () =>
    Response.json({ success: false, hostname: "joaoguilhermesilva7020.github.io", action: "checkout" }));
  const unavailable = await verifyTurnstileToken("token", null, "secret", async () =>
    new Response("unavailable", { status: 503 }));
  assert(!rejected, "unsuccessful challenge must be rejected");
  assert(!unavailable, "siteverify HTTP failure must be rejected");
});

Deno.test("missing challenge token is rejected before Supabase client creation", async () => {
  let created = false;
  const handler = createOrderHandler(
    () => { created = true; throw new Error("client must not be created"); },
    async () => true,
  );
  const response = await handler(request({ items: [] }));
  assert(response.status === 400, "expected HTTP 400");
  assert(!created, "client must not be created without a token");
});

Deno.test("failed challenge is rejected before order RPC", async () => {
  let rpcCalled = false;
  const handler = createOrderHandler(
    fakeFactory(() => { rpcCalled = true; }),
    async () => false,
  );
  const response = await handler(request({ items: [], turnstile_token: "invalid-token" }));
  assert(response.status === 403, "expected HTTP 403");
  assert(!rpcCalled, "order RPC must not run when challenge fails");
});

Deno.test("valid challenge allows order creation", async () => {
  let rpcCalled = false;
  const handler = createOrderHandler(
    fakeFactory(() => { rpcCalled = true; }),
    async (token) => token === "valid-token",
  );
  const response = await handler(request({
    customer_name: "Teste",
    customer_phone: "83999999999",
    payment_method: "other",
    items: [],
    turnstile_token: "valid-token",
  }));
  assert(response.status === 201, "expected HTTP 201");
  assert(rpcCalled, "order RPC should run after successful challenge");
});

Deno.test("unapproved browser origin is rejected", async () => {
  let verified = false;
  const handler = createOrderHandler(
    fakeFactory(),
    async () => { verified = true; return true; },
  );
  const response = await handler(request({ items: [], turnstile_token: "valid-token" }, "https://evil.example"));
  assert(response.status === 403, "expected HTTP 403");
  assert(!verified, "challenge must not run for disallowed origin");
});

Deno.test("oversized request is rejected", async () => {
  const handler = createOrderHandler(fakeFactory(), async () => true);
  const requestWithLargeBody = new Request("http://localhost/functions/v1/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "x".repeat(16_385),
  });
  const response = await handler(requestWithLargeBody);
  assert(response.status === 413, "expected HTTP 413");
});
