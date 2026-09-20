import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const JSON_HEADERS = { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers:JSON_HEADERS });

function databaseSecretKey() {
  const keys=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(keys){ try { const parsed=JSON.parse(keys) as Record<string,string>; return parsed.default ?? Object.values(parsed)[0]; } catch { /* legacy fallback */ } }
  return Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

Deno.serve(async (request: Request) => {
  if(request.method!=="POST") return json({ error:"Método não permitido" },405);
  if(Number(request.headers.get("content-length")??0)>64_000) return json({ error:"Corpo muito grande" },413);

  const hookSecret=Deno.env.get("CUSTOMER_AUTH_SMS_HOOK_SECRET")?.replace("v1,whsec_","");
  const supabaseUrl=Deno.env.get("SUPABASE_URL");
  const secretKey=databaseSecretKey();
  if(!hookSecret||!supabaseUrl||!secretKey) return json({ error:"Envio de acesso ainda não configurado" },503);

  const rawBody=await request.text();
  let payload: { user?: { phone?: string }, sms?: { otp?: string } };
  try {
    payload=new Webhook(hookSecret).verify(rawBody,{
      "webhook-id":request.headers.get("webhook-id")??"",
      "webhook-timestamp":request.headers.get("webhook-timestamp")??"",
      "webhook-signature":request.headers.get("webhook-signature")??"",
    }) as typeof payload;
  } catch {
    return json({ error:"Assinatura inválida" },401);
  }

  const phone=String(payload.user?.phone??"").replace(/\D/g,"");
  const otp=String(payload.sms?.otp??"");
  if(!/^[0-9]{10,15}$/.test(phone)||!/^[0-9]{6,8}$/.test(otp)) return json({ error:"Solicitação inválida" },400);

  const supabase=createClient(supabaseUrl,secretKey,{ auth:{ persistSession:false,autoRefreshToken:false } });
  const { data:context,error:contextError }=await supabase.rpc("get_customer_auth_delivery_context",{ target_phone:phone });
  if(contextError||!context) return json({ error:"Acesso pelo WhatsApp indisponível" },503);

  const metaResponse=await fetch(`https://graph.facebook.com/${context.graphApiVersion}/${context.phoneNumberId}/messages`,{
    method:"POST",
    headers:{ Authorization:`Bearer ${context.accessToken}`,"content-type":"application/json" },
    body:JSON.stringify({
      messaging_product:"whatsapp",
      recipient_type:"individual",
      to:phone,
      type:"template",
      template:{
        name:context.templateName,
        language:{ code:context.templateLanguage },
        components:[{ type:"body",parameters:[
          { type:"text",text:String(context.tenantName).slice(0,120) },
          { type:"text",text:otp },
        ]}],
      },
    }),
  });
  const metaData=await metaResponse.json().catch(()=>({}));
  const delivered=metaResponse.ok&&Boolean(metaData?.messages?.[0]?.id);
  await supabase.rpc("finish_customer_auth_delivery",{
    target_request_id:context.requestId,
    outcome:delivered?"delivered":"failed",
    failure_code:delivered?null:`meta_${metaData?.error?.code??metaResponse.status}`,
  });
  if(!delivered) return json({ error:"Não foi possível enviar o código agora" },503);
  return json({});
});

