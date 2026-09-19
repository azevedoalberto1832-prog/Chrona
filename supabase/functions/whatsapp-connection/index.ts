import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  // Authentication is enforced with the caller's Supabase bearer token. A
  // wildcard keeps the function usable after the custom domain goes live.
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const GRAPH_API_VERSION = "v26.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function environmentKey(group: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS", fallbacks: string[]) {
  const encodedKeys = Deno.env.get(group);
  if (encodedKeys) {
    try {
      const keys = JSON.parse(encodedKeys) as Record<string, string>;
      const key = keys.default ?? Object.values(keys)[0];
      if (key) return key;
    } catch {
      // Fall through to legacy variables during the API-key migration.
    }
  }
  return fallbacks.map((name) => Deno.env.get(name)).find(Boolean);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { status: 204, headers: JSON_HEADERS });
  if (request.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (Number(request.headers.get("content-length") ?? 0) > 16_000) {
    return json({ error: "Corpo da requisição muito grande" }, 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = environmentKey("SUPABASE_PUBLISHABLE_KEYS", ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]);
  const secretKey = environmentKey("SUPABASE_SECRET_KEYS", ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  const authorization = request.headers.get("authorization") ?? "";
  if (!supabaseUrl || !publishableKey || !secretKey) return json({ error: "Servidor não configurado" }, 503);
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sessão obrigatória" }, 401);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Sessão inválida" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const barbershopId = typeof body.barbershopId === "string" ? body.barbershopId : "";
  const businessAccountId = typeof body.businessAccountId === "string" ? body.businessAccountId.trim() : "";
  const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId.trim() : "";
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(barbershopId) || !/^\d{5,30}$/.test(businessAccountId) || !/^\d{5,30}$/.test(phoneNumberId)) {
    return json({ error: "Identificadores da Meta inválidos" }, 400);
  }
  if (accessToken.length < 20 || accessToken.length > 4096) return json({ error: "Token de acesso inválido" }, 400);

  const [phoneResponse, businessResponse] = await Promise.all([
    fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ),
    fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${businessAccountId}?fields=id,name`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ),
  ]);
  const [phoneData, businessData] = await Promise.all([
    phoneResponse.json().catch(() => ({})),
    businessResponse.json().catch(() => ({})),
  ]);
  if (!phoneResponse.ok || !businessResponse.ok || phoneData.id !== phoneNumberId || businessData.id !== businessAccountId) {
    return json({
      error: "A Meta recusou o token ou os identificadores informados",
      metaCode: phoneData?.error?.code ?? businessData?.error?.code ?? null,
    }, 400);
  }

  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await adminClient.rpc("store_meta_whatsapp_connection", {
    actor_auth_user_id: userData.user.id,
    target_barbershop_id: barbershopId,
    meta_business_account_id: businessAccountId,
    meta_phone_number_id: phoneNumberId,
    meta_access_token: accessToken,
    meta_display_phone_number: phoneData.display_phone_number ?? null,
    meta_verified_name: phoneData.verified_name ?? businessData.name ?? null,
    meta_quality_rating: phoneData.quality_rating ?? null,
    meta_graph_api_version: GRAPH_API_VERSION,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    return json({ error: error.message, code: error.code }, status);
  }

  return json({ connection: data });
});
