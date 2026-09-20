const SUPABASE_URL = "https://qcjjqdkjfvnbslbpnrgk.supabase.co";
const SUPABASE_KEY = "sb_publishable_27mV2bABNSGQYPkGEF-T4g_XBQtb2r7";
const PAGE_PARAMS = new URLSearchParams(location.search);
const PLATFORM_ENTRY = PAGE_PARAMS.has("platform");
const HOST_TENANTS = Object.freeze({
  "palazzo-barber.vercel.app": "palazzo",
  "palazzo.chronasystem.com.br": "palazzo",
});
const SHOP_SLUG = PAGE_PARAMS.get("tenant") || HOST_TENANTS[location.hostname.toLowerCase()] || null;
const CHRONA_HOME = !SHOP_SLUG && !PLATFORM_ENTRY;
const AUTH_CALLBACK = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : "");
const PASSWORD_FLOW = ["recovery","invite"].includes(AUTH_CALLBACK.get("type")) && !!AUTH_CALLBACK.get("access_token");
document.body.dataset.tenant = SHOP_SLUG || "chrona";
let authSession = JSON.parse(sessionStorage.getItem("chrona-session") || "null");
let loginNotice = sessionStorage.getItem("chrona-login-notice") || "";
const rememberedLoginEmail = sessionStorage.getItem("chrona-login-email") || "";
sessionStorage.removeItem("chrona-login-notice");
async function rpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", ...(authSession?.access_token ? { Authorization:`Bearer ${authSession.access_token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || "Não foi possível concluir a operação");
  return data;
}
async function signIn(email,password) {
  const response=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify({email,password})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error_description || data.msg || "E-mail ou senha inválidos");
  authSession=data; sessionStorage.setItem("chrona-session",JSON.stringify(data)); return data;
}
async function requestPasswordReset(email){
  const redirectTo=`${location.origin}${location.pathname}${location.search}`;
  const response=await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify({email})});
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.msg||data?.message||"Não foi possível enviar o link agora");
}
async function updatePassword(password){
  const response=await fetch(`${SUPABASE_URL}/auth/v1/user`,{method:"PUT",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${AUTH_CALLBACK.get("access_token")}`,"Content-Type":"application/json"},body:JSON.stringify({password})});
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.msg||data?.message||"O link expirou. Solicite um novo.");
  return data;
}
async function rest(path,{method="GET",body,prefer="return=representation"}={}) {
  if(!authSession?.access_token) throw new Error("Sessão expirada. Entre novamente.");
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${authSession.access_token}`,"Content-Type":"application/json",Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body)});
  const data=response.status===204?null:await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.message || data?.hint || "Não foi possível salvar a alteração");
  return data;
}
async function edge(name,body) {
  if(!authSession?.access_token) throw new Error("Sessão expirada. Entre novamente.");
  const response=await fetch(`${SUPABASE_URL}/functions/v1/${name}`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${authSession.access_token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok) {
    const metaCode=data?.metaCode?` (Meta código ${data.metaCode})`:"";
    throw new Error(`${data?.error||data?.message||"Não foi possível concluir a operação"}${metaCode}`);
  }
  return data;
}
let PEOPLE = [];
const tenantDateParts = (date = new Date()) => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: db.settings.timezone || "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
),
  today = () => {
    const parts = tenantDateParts();
    return `${parts.year}-${parts.month}-${parts.day}`;
  },
  uid = () => crypto.randomUUID?.() || Date.now() + Math.random() + "";
const addDays = (n) => {
  const parts = tenantDateParts();
  const d = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const seed = {
  services: [],
  people: [],
  clients: [],
  appointments: [],
  cash: [],
  reminders: [],
  categories: [],
  settings: {
    shop: "Chrona",
    address: "",
    phone: "",
    open: "09:00",
    close: "19:00",
    breakStart: "",
    breakEnd: "",
    greeting: "",
    instagram: "",
    logo: "",
    description: "",
    primaryColor: "#6d5dfb",
    secondaryColor: "#22c3a6",
    visualDirection: "studio",
    timezone: "America/Sao_Paulo",
  },
};
let db = structuredClone(seed);
let booking = {
  step: 0,
  serviceIds: [],
  professional: "any",
  date: addDays(1),
  time: "",
  name: "",
  phone: "",
  birth: "",
  notes: "",
  clientId: "",
  lookupDone: false,
  adminMode: false,
  optIn: false,
};
let adminTab = "dashboard";
let cashTab = "movimentos";
let agendaDate = addDays(1);
let currentProfile=null,currentShop=null,currentSubscription=null,adminLoaded=false,platformTenants=[],platformNotificationSettings=null;
let platformSupportMode=false;
let whatsappConnection=null,automationRules=[],automationRuns=[],notificationSettings=null,personalReminders=[];
// Keep the connection form stable if the admin screen is redrawn while the
// user is typing. The token lives only in memory and is cleared after success.
let whatsappConnectionDraft={businessAccountId:"",phoneNumberId:"",accessToken:""};
let crmPipelines=[],crmStages=[],crmOpportunities=[],activePipelineId="";
let siteConfigRow=null,siteConfigPublished=null,siteConfigDraft=null,siteEditorConfig=null;
const save = () => {};
let remoteSlots = [], slotProfessionals = {}, slotsLoaded = false;
const BOOKING_PROFILE_KEY = () => `chrona-booking-profile:${SHOP_SLUG || "default"}`;
const readBookingProfile = () => {
  try { return JSON.parse(localStorage.getItem(BOOKING_PROFILE_KEY()) || "null"); }
  catch { return null; }
};
const saveBookingProfile = () => {
  if (!booking.adminMode) localStorage.setItem(BOOKING_PROFILE_KEY(), JSON.stringify({ name:booking.name, phone:booking.phone, birth:booking.birth || "" }));
};
const isPastSlot = (date, time) => {
  const now = tenantDateParts();
  const currentDate = `${now.year}-${now.month}-${now.day}`;
  return date < currentDate || (date === currentDate && time <= `${now.hour}:${now.minute}`);
};
const money = (v) =>
  Number(v||0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBR = (d) => d ? new Date(d + "T12:00").toLocaleDateString("pt-BR") : "—";
const dateTimeBR = (d) => d ? new Date(d).toLocaleString("pt-BR", { dateStyle:"short", timeStyle:"short" }) : "Sem próxima ação";
const dateTimeLocal = (d) => d ? new Date(new Date(d).getTime()-new Date(d).getTimezoneOffset()*60000).toISOString().slice(0,16) : "";
const esc = (value) => String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
const initials = (value) => String(value || "Chrona").trim().split(/\s+/).slice(0,2).map((part)=>part[0]).join("").toUpperCase();
const slugify = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const canManageTenant = () => ["owner","platform_admin"].includes(currentProfile?.role);
function readableText(hex){
  const value=String(hex||"").replace("#","");
  if(!/^[0-9a-f]{6}$/i.test(value)) return "#ffffff";
  const [r,g,b]=[0,2,4].map((index)=>parseInt(value.slice(index,index+2),16));
  return (r*299+g*587+b*114)/1000>150?"#0f172a":"#ffffff";
}
function colorProfile(hex){
  const value=String(hex||"").replace("#","");
  const [r,g,b]=[0,2,4].map((index)=>parseInt(value.slice(index,index+2),16)/255);
  const max=Math.max(r,g,b),min=Math.min(r,g,b),light=(max+min)/2;
  const saturation=max===min?0:(max-min)/(1-Math.abs(2*light-1));
  return {light:light*100,saturation:saturation*100};
}
function inferVisualDirection(primary,ink,business="services"){
  const main=colorProfile(primary),text=colorProfile(ink);
  if(main.light<32||text.light>82) return "editorial";
  if(main.saturation<42||["beauty","lash","wellness","health"].includes(business)) return "serene";
  return "studio";
}
const directionLabel=(direction)=>({editorial:"Editorial",studio:"Studio",serene:"Sereno"})[direction]||"Studio";
function applyTenantBrand(shop){
  const direction=["editorial","studio","serene"].includes(shop?.visual_direction)?shop.visual_direction:inferVisualDirection(shop?.primary_color,shop?.secondary_color,shop?.business_type);
  document.body.dataset.direction=direction;
  const primary=shop.primary_color||"#2667ff";
  const secondary=shop.secondary_color||"#152238";
  document.body.style.setProperty("--brand-primary",primary);
  document.body.style.setProperty("--brand-secondary",secondary);
  document.body.style.setProperty("--brand-ink",secondary);
  document.body.style.setProperty("--brand-on-primary",readableText(primary));
  document.body.style.setProperty("--copper",primary);
  document.body.style.setProperty("--copper2",primary);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",primary);
}
const service = (id) => db.services.find((s) => s.id === id);
const total = () =>
  booking.serviceIds.reduce(
    (a, id) => ({
      duration: a.duration + service(id).duration,
      price: a.price + service(id).price,
    }),
    { duration: 0, price: 0 },
  );
const toast = (m) => {
  let e = document.querySelector("#toast");
  e.textContent = m;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 2400);
};
function openAdminForm(kind, id = "") {
  document.querySelector("#admin-form-modal")?.remove();
  let title = "",
    fields = "",
    item;
  if (kind === "client") {
    item = db.clients.find((x) => x.id === id) || {
      name: "",
      phone: "",
      birth: "1990-01-01",
      lastVisit: today(),
    };
    title = id ? "Editar cliente" : "Novo cliente";
    fields = `<label class="field"><span>Nome *</span><input name="name" value="${item.name}" required></label><label class="field"><span>WhatsApp *</span><input name="phone" value="${item.phone}" placeholder="(DDD) 99999-9999" required></label><label class="field"><span>Nascimento</span><input name="birth" type="date" value="${item.birth}"></label><label class="field"><span>Última visita</span><input name="lastVisit" type="date" value="${item.lastVisit}"></label><label class="field full consent-field"><span><input name="optIn" type="checkbox" ${item.optIn?"checked":""}> Cliente autorizou lembretes pelo WhatsApp</span><small class="muted">Obrigatório para receber mensagens automáticas pela Meta.</small></label>`;
  } else if (kind === "service") {
    item = db.services.find((x) => x.id === id) || {
      name: "",
      price: 50,
      duration: 30,
      returnDays: 20,
      desc: "",
    };
    title = id ? "Editar serviço" : "Novo serviço";
    fields = `<label class="field"><span>Nome *</span><input name="name" value="${item.name}" required></label><label class="field"><span>Preço *</span><input name="price" type="number" step="0.01" value="${item.price}" required></label><label class="field"><span>Duração (min) *</span><input name="duration" type="number" step="15" value="${item.duration}" required></label><label class="field"><span>Retorno recomendado (dias)</span><input name="returnDays" type="number" min="1" max="365" value="${item.returnDays??""}" placeholder="Sem lembrete"></label><label class="field full"><span>Descrição</span><textarea name="desc" rows="3">${item.desc || ""}</textarea><small class="muted">Deixe o retorno vazio para não criar lembrete após este serviço.</small></label>`;
  } else if(kind === "professional") {
    item=PEOPLE.find(x=>x.id===id)||{name:"",phone:"",active:true};
    title=id?"Editar profissional":"Novo profissional";
    fields=`<label class="field"><span>Nome *</span><input name="name" value="${item.name}" required></label><label class="field"><span>WhatsApp</span><input name="phone" value="${item.phone||""}"></label>`;
  } else {
    title = "Nova movimentação";
    fields = `<label class="field"><span>Descrição *</span><input name="desc" required></label><label class="field"><span>Tipo</span><select name="type"><option value="entrada">Entrada</option><option value="saida">Saída</option></select></label><label class="field"><span>Valor *</span><input name="value" type="number" step="0.01" required></label><label class="field"><span>Categoria</span><select name="category">${db.categories.map((c) => `<option>${c}</option>`).join("")}</select></label><label class="field"><span>Método</span><select name="method"><option>Pix</option><option>Dinheiro</option><option>Cartão</option></select></label><label class="field"><span>Data</span><input name="date" type="date" value="${today()}"></label>`;
  }
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal" id="admin-form-modal"><div class="modal-card" style="max-width:620px"><div class="modal-head"><div><div class="eyebrow">CHRONA</div><h3 style="font-size:27px">${title}</h3></div><button type="button" class="btn btn-ghost" data-form-close>✕</button></div><form class="modal-body" id="admin-form"><div class="form-grid">${fields}</div><div class="modal-actions"><button type="button" class="btn btn-outline" data-form-close>Cancelar</button><button class="btn btn-dark" type="submit">Salvar</button></div></form></div></div>`,
  );
  document
    .querySelectorAll("[data-form-close]")
    .forEach(
      (x) =>
        (x.onclick = () =>
          document.querySelector("#admin-form-modal")?.remove()),
    );
  document.querySelector("#admin-form").onsubmit = async (event) => {
    event.preventDefault();
    const submit=event.currentTarget.querySelector("button[type=submit]"); submit.disabled=true;
    const form = new FormData(event.currentTarget);
    const value = Object.fromEntries(form.entries());
    try {
      if (kind === "client") {
        const phone=value.phone.replace(/\D/g,""); if(phone.length<10) throw new Error("Informe um WhatsApp válido");
        const optIn=value.optIn==="on";
        const data={barbershop_id:currentProfile.barbershop_id,name:value.name.trim(),phone:value.phone,phone_normalized:phone,birth_date:value.birth||null,last_visit:value.lastVisit||null,whatsapp_opt_in:optIn,whatsapp_opt_in_at:optIn?(item.whatsappOptInAt||new Date().toISOString()):null,updated_at:new Date().toISOString()};
        await rest(id?`clients?id=eq.${id}`:"clients",{method:id?"PATCH":"POST",body:data});
      }
      if (kind === "service") {
        const data={barbershop_id:currentProfile.barbershop_id,name:value.name.trim(),description:value.desc||null,price:Number(value.price),duration_minutes:Number(value.duration),return_interval_days:value.returnDays===""?null:Number(value.returnDays),...(id?{}:{active:true})};
        await rest(id?`services?id=eq.${id}`:"services",{method:id?"PATCH":"POST",body:data});
      }
      if(kind === "professional"){
        const data={barbershop_id:currentProfile.barbershop_id,name:value.name.trim(),phone:value.phone||null,...(id?{}:{active:true})};
        await rest(id?`professionals?id=eq.${id}`:"professionals",{method:id?"PATCH":"POST",body:data});
      }
      if (kind === "cash") await rest("cash_transactions",{method:"POST",body:{barbershop_id:currentProfile.barbershop_id,type:value.type==="entrada"?"income":"expense",description:value.desc.trim(),amount:Number(value.value),category:value.category,payment_method:value.method,transaction_date:value.date,created_by:currentProfile.id}});
      await loadAdminData(); document.querySelector("#admin-form-modal")?.remove(); render(); toast("Alteração salva no sistema");
    } catch(error){toast(error.message);submit.disabled=false;}
  };
}
function openPersonalReminderForm(id=""){
  document.querySelector("#personal-reminder-modal")?.remove();
  const existing=personalReminders.find((item)=>item.id===id);
  const defaultStart=new Date(Date.now()+2*86400000);
  defaultStart.setHours(9,0,0,0);
  const item=existing||{title:"Revisar agenda e pendências",message_body:"Confira os próximos atendimentos e os clientes que precisam de retorno.",starts_at:defaultStart.toISOString(),repeat_every_days:2,active:false};
  document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="personal-reminder-modal"><div class="modal-card" style="max-width:650px"><div class="modal-head"><div><div class="eyebrow">AGENDA PESSOAL</div><h3 style="font-size:27px">${existing?"Editar lembrete":"Novo lembrete"}</h3></div><button type="button" class="btn btn-ghost" data-personal-close>✕</button></div><form class="modal-body" id="personal-reminder-form"><div class="form-grid"><label class="field full"><span>Título *</span><input name="title" value="${esc(item.title)}" maxlength="120" required></label><label class="field full"><span>Mensagem *</span><textarea name="messageBody" rows="3" maxlength="500" required>${esc(item.message_body)}</textarea></label><label class="field"><span>Primeiro aviso *</span><input name="startsAt" type="datetime-local" value="${dateTimeLocal(item.starts_at)}" required></label><label class="field"><span>Repetir a cada</span><select name="repeatEveryDays"><option value="">Uma única vez</option>${[1,2,3,7,14,30].map((days)=>`<option value="${days}" ${Number(item.repeat_every_days)===days?"selected":""}>${days===1?"Todo dia":`A cada ${days} dias`}</option>`).join("")}</select></label><label class="field full consent-field"><span><input name="active" type="checkbox" ${item.active?"checked":""}> Deixar lembrete ativo</span><small class="muted">A fila só será liberada depois da conexão Meta e do template aprovado.</small></label></div><div class="modal-actions"><button type="button" class="btn btn-outline" data-personal-close>Cancelar</button><button class="btn btn-dark" type="submit">Salvar lembrete</button></div></form></div></div>`);
  document.querySelectorAll("[data-personal-close]").forEach((button)=>button.onclick=()=>document.querySelector("#personal-reminder-modal")?.remove());
  document.querySelector("#personal-reminder-form").onsubmit=async(event)=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
    const values=Object.fromEntries(new FormData(event.currentTarget).entries());
    const startsAt=new Date(values.startsAt);
    if(Number.isNaN(startsAt.getTime())){toast("Informe a data do primeiro aviso");button.disabled=false;return;}
    const body={barbershop_id:currentProfile.barbershop_id,title:values.title.trim(),message_body:values.messageBody.trim(),starts_at:startsAt.toISOString(),next_run_at:startsAt.toISOString(),repeat_every_days:values.repeatEveryDays?Number(values.repeatEveryDays):null,active:values.active==="on",created_by:currentProfile.id,updated_at:new Date().toISOString()};
    try{await rest(existing?`personal_reminders?id=eq.${existing.id}`:"personal_reminders",{method:existing?"PATCH":"POST",body});await loadAdminData();document.querySelector("#personal-reminder-modal")?.remove();render();toast("Lembrete pessoal salvo");}
    catch(error){toast(error.message);button.disabled=false;}
  };
}
function currentPipeline(){
  return crmPipelines.find((pipeline)=>pipeline.id===activePipelineId)||crmPipelines.find((pipeline)=>pipeline.active)||crmPipelines[0];
}
function openCrmForm(kind,id="",defaultStageId=""){
  document.querySelector("#crm-form-modal")?.remove();
  const pipeline=currentPipeline();
  let title="",fields="",item;
  if(kind==="opportunity"){
    item=crmOpportunities.find((opportunity)=>opportunity.id===id)||{client_id:db.clients[0]?.id||"",stage_id:defaultStageId||crmStages.find((stage)=>stage.pipeline_id===pipeline?.id)?.id||"",title:"",source:"manual",value:"",next_action_at:"",status:"open",notes:""};
    title=id?"Editar oportunidade":"Nova oportunidade";
    const pipelineStages=crmStages.filter((stage)=>stage.pipeline_id===pipeline?.id).sort((a,b)=>a.position-b.position);
    fields=`<label class="field"><span>Cliente *</span><select name="client_id" required><option value="">Selecione</option>${db.clients.map((client)=>`<option value="${client.id}" ${client.id===item.client_id?"selected":""}>${esc(client.name)} · ${esc(client.phone)}</option>`).join("")}</select></label><label class="field"><span>Etapa *</span><select name="stage_id" required>${pipelineStages.map((stage)=>`<option value="${stage.id}" ${stage.id===item.stage_id?"selected":""}>${esc(stage.name)}</option>`).join("")}</select></label><label class="field full"><span>Título *</span><input name="title" value="${esc(item.title)}" placeholder="Ex.: Retorno para corte e barba" required></label><label class="field"><span>Valor estimado</span><input name="value" type="number" min="0" step="0.01" value="${item.value??""}"></label><label class="field"><span>Próxima ação</span><input name="next_action_at" type="datetime-local" value="${dateTimeLocal(item.next_action_at)}"></label><label class="field"><span>Origem</span><select name="source">${[["manual","Manual"],["whatsapp","WhatsApp"],["instagram","Instagram"],["referral","Indicação"],["appointment","Agendamento"]].map(([value,label])=>`<option value="${value}" ${value===item.source?"selected":""}>${label}</option>`).join("")}</select></label><label class="field"><span>Status</span><select name="status">${[["open","Em aberto"],["won","Ganha"],["lost","Perdida"],["archived","Arquivada"]].map(([value,label])=>`<option value="${value}" ${value===item.status?"selected":""}>${label}</option>`).join("")}</select></label><label class="field full"><span>Observações</span><textarea name="notes" rows="4">${esc(item.notes)}</textarea></label>`;
  }else if(kind==="pipeline"){
    item=crmPipelines.find((pipeline)=>pipeline.id===id)||{name:""};
    title=id?"Editar pipeline":"Novo pipeline";
    fields=`<label class="field full"><span>Nome *</span><input name="name" value="${esc(item.name)}" placeholder="Ex.: Relacionamento" required></label>${id?"":'<p class="muted field full">O novo pipeline começa com quatro etapas que você pode personalizar.</p>'}`;
  }else{
    item=crmStages.find((stage)=>stage.id===id)||{name:"",color:"#9caeff",position:crmStages.filter((stage)=>stage.pipeline_id===pipeline?.id).length+1};
    title=id?"Editar etapa":"Nova etapa";
    fields=`<label class="field"><span>Nome *</span><input name="name" value="${esc(item.name)}" required></label><label class="field"><span>Cor</span><input name="color" type="color" value="${item.color||"#9caeff"}"></label><label class="field"><span>Posição</span><input name="position" type="number" min="1" max="99" value="${item.position}" required></label>`;
  }
  document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="crm-form-modal"><div class="modal-card" style="max-width:680px"><div class="modal-head"><div><div class="eyebrow">CRM CHRONA</div><h3 style="font-size:27px">${title}</h3></div><button type="button" class="btn btn-ghost" data-crm-close>✕</button></div><form class="modal-body" id="crm-form"><div class="form-grid">${fields}</div><div class="modal-actions"><button type="button" class="btn btn-outline" data-crm-close>Cancelar</button><button class="btn btn-dark" type="submit">Salvar</button></div></form></div></div>`);
  document.querySelectorAll("[data-crm-close]").forEach((button)=>button.onclick=()=>document.querySelector("#crm-form-modal")?.remove());
  document.querySelector("#crm-form").onsubmit=async(event)=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
    const values=Object.fromEntries(new FormData(event.currentTarget).entries());
    try{
      if(kind==="opportunity"){
        const body={barbershop_id:currentProfile.barbershop_id,client_id:values.client_id,stage_id:values.stage_id,title:values.title.trim(),source:values.source,value:values.value===""?null:Number(values.value),next_action_at:values.next_action_at?new Date(values.next_action_at).toISOString():null,status:values.status,notes:values.notes.trim()||null,updated_at:new Date().toISOString()};
        await rest(id?`crm_opportunities?id=eq.${id}`:"crm_opportunities",{method:id?"PATCH":"POST",body});
      }else if(kind==="pipeline"){
        if(id) await rest(`crm_pipelines?id=eq.${id}`,{method:"PATCH",body:{name:values.name.trim()}});
        else{
          const created=await rest("crm_pipelines",{method:"POST",body:{barbershop_id:currentProfile.barbershop_id,name:values.name.trim(),active:true}});
          const newPipeline=created?.[0];
          if(newPipeline){
            activePipelineId=newPipeline.id;
            await rest("crm_stages",{method:"POST",body:[["Novo contato","#9caeff"],["Agendamento pendente","#d8b7bd"],["Cliente ativo","#72b88d"],["Reativação","#e5a76f"]].map(([name,color],index)=>({barbershop_id:currentProfile.barbershop_id,pipeline_id:newPipeline.id,name,position:index+1,color}))});
          }
        }
      }else{
        const body={barbershop_id:currentProfile.barbershop_id,pipeline_id:pipeline.id,name:values.name.trim(),position:Number(values.position),color:values.color};
        await rest(id?`crm_stages?id=eq.${id}`:"crm_stages",{method:id?"PATCH":"POST",body});
      }
      await loadAdminData();document.querySelector("#crm-form-modal")?.remove();render();toast("CRM atualizado");
    }catch(error){toast(error.message);button.disabled=false;}
  };
}
async function updateOpportunity(id,body,message){
  try{await rest(`crm_opportunities?id=eq.${id}`,{method:"PATCH",body:{...body,updated_at:new Date().toISOString()}});await loadAdminData();render();toast(message);}
  catch(error){toast(error.message);}
}
function confirmAdmin(message, action) {
  document.querySelector("#admin-confirm")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal" id="admin-confirm"><div class="modal-card" style="max-width:440px"><div class="modal-body"><h3 style="font-size:27px">Confirmar exclusão</h3><p class="muted">${message}</p><div class="modal-actions"><button class="btn btn-outline" data-confirm-no>Cancelar</button><button class="btn btn-dark danger" data-confirm-yes>Excluir</button></div></div></div></div>`,
  );
  document.querySelector("[data-confirm-no]").onclick = () =>
    document.querySelector("#admin-confirm").remove();
  document.querySelector("[data-confirm-yes]").onclick = async () => {
    const button=document.querySelector("[data-confirm-yes]"); button.disabled=true;
    try{await action();await loadAdminData();document.querySelector("#admin-confirm").remove();render();toast("Alteração concluída");}
    catch(error){toast(error.message);button.disabled=false;}
  };
}
function openPaymentForm(appointment){
  document.querySelector("#payment-modal")?.remove();
  document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="payment-modal"><div class="modal-card" style="max-width:500px"><div class="modal-head"><div><div class="eyebrow">CONCLUIR ATENDIMENTO</div><h3 style="font-size:27px">${appointment.client}</h3></div><button class="btn btn-ghost" data-payment-close>✕</button></div><form id="payment-form" class="modal-body"><div class="form-grid"><label class="field"><span>Valor recebido</span><input name="amount" type="number" step="0.01" min="0.01" value="${appointment.total}" required></label><label class="field"><span>Forma de pagamento</span><select name="method"><option>Pix</option><option>Dinheiro</option><option>Débito</option><option>Crédito</option></select></label></div><div class="modal-actions"><button type="button" class="btn btn-outline" data-payment-close>Cancelar</button><button class="btn btn-dark" type="submit">Concluir e lançar no caixa</button></div></form></div></div>`);
  document.querySelectorAll("[data-payment-close]").forEach(x=>x.onclick=()=>document.querySelector("#payment-modal")?.remove());
  document.querySelector("#payment-form").onsubmit=async(e)=>{e.preventDefault();const button=e.currentTarget.querySelector("button[type=submit]");button.disabled=true;const form=new FormData(e.currentTarget);try{await rpc("complete_appointment",{target_appointment:appointment.id,paid_amount:Number(form.get("amount")),paid_method:form.get("method")});await loadAdminData();document.querySelector("#payment-modal")?.remove();render();toast("Atendimento concluído e lançado no caixa");}catch(error){toast(error.message);button.disabled=false;}};
}
async function loadPublicData() {
  try {
    const [payload,publicSiteConfig] = await Promise.all([
      rpc("get_public_shop", { shop_slug: SHOP_SLUG }),
      rpc("get_public_site_config", { shop_slug: SHOP_SLUG }).catch(()=>null),
    ]);
    if (!payload?.shop) throw new Error("Empresa indisponível");
    const shop = payload.shop;
    db.services = (payload.services || []).map((s) => ({ id:s.id, name:s.name, desc:s.description, duration:s.duration_minutes, price:Number(s.price), returnDays:s.return_interval_days, active:s.active }));
    PEOPLE = (payload.professionals || []).map((p) => ({ id:p.id, name:p.name }));
    db.settings = { shop:shop.name, address:shop.address || "Endereço a confirmar", phone:shop.phone || "", open:shop.opening_time?.slice(0,5) || "09:00", close:shop.closing_time?.slice(0,5) || "19:00", breakStart:shop.break_start?.slice(0,5) || "", breakEnd:shop.break_end?.slice(0,5) || "", greeting:shop.whatsapp_message || "Olá! Agende seu horário pela Chrona.", instagram:shop.instagram || "", logo:shop.logo_url || "", description:shop.public_description || "Escolha o serviço, o profissional e o melhor horário para você.", primaryColor:shop.primary_color || "#6d5dfb", secondaryColor:shop.secondary_color || "#22c3a6", visualDirection:shop.visual_direction || "studio", timezone:shop.timezone || "America/Sao_Paulo" };
    siteConfigPublished=ChronaSite.normalize(publicSiteConfig||ChronaSite.preset("clean"));
    applyTenantBrand(shop);
    document.title = `${shop.name} | Agendamento`;
    render();
  } catch (error) {
    app.innerHTML = `<main class="section"><div class="container empty"><h2>Não foi possível carregar a agenda</h2><p>${error.message}</p><button class="btn btn-dark" onclick="location.reload()">Tentar novamente</button></div></main>`;
  }
}
async function loadAvailableSlots() {
  remoteSlots=[]; slotProfessionals={}; slotsLoaded=false;
  const people = (booking.professional === "any" ? PEOPLE : PEOPLE.filter((p)=>p.id===booking.professional)).filter(p=>p.active!==false);
  const results = await Promise.all(people.map(async (p) => ({ p, slots: await rpc("get_available_slots", { shop_slug:SHOP_SLUG, professional:p.id, service_ids:booking.serviceIds, appt_date:booking.date }) })));
  results.forEach(({p,slots}) => (slots || []).forEach((row) => { const value=String(row.slot).slice(0,5); if(!isPastSlot(booking.date,value)) slotProfessionals[value] ||= p.id; }));
  remoteSlots=Object.keys(slotProfessionals).sort();
  slotsLoaded=true;
}
function publicPage() {
  return ChronaSite.render({
    shop:{name:db.settings.shop,address:db.settings.address,phone:db.settings.phone,open:db.settings.open,close:db.settings.close,breakStart:db.settings.breakStart,breakEnd:db.settings.breakEnd,instagram:db.settings.instagram,logo:db.settings.logo,description:db.settings.description},
    services:db.services.filter((service)=>service.active),professionals:PEOPLE.filter((person)=>person.active!==false),
    config:siteConfigPublished||ChronaSite.preset("clean"),preview:false,
  });
}
function chronaHomePage(){
  document.title="Chrona | Agenda e gestão para negócios";
  return `<header class="topbar chrona-site"><div class="container"><div class="brand"><span class="brand-logo" style="display:grid;place-items:center;font-weight:800">C</span><div>CHRONA<small>AGENDA · GESTÃO · IDENTIDADE</small></div></div><div><a class="btn btn-outline" href="#plataforma">Plataforma</a> <a class="btn btn-dark" href="?platform=chrona#admin">Entrar</a></div></div></header><main class="chrona-site"><section class="hero"><div class="container hero-grid"><div><div class="eyebrow">SaaS MULTI-TENANT</div><h1>Tempo organizado. Negócios em movimento.</h1><p>A Chrona conecta agenda, clientes e caixa em uma única plataforma para empresas que trabalham com atendimento por horário.</p><div class="hero-actions"><a class="btn btn-dark" href="#demonstracoes">Ver demonstrações</a><a class="btn btn-outline" href="?platform=chrona#admin">Administração Chrona</a></div></div><div class="hero-card"><div class="eyebrow">UMA PLATAFORMA</div><h2 style="font-size:42px;margin:12px 0">Vários negócios.<br>Dados isolados.</h2><p>Cada empresa possui identidade, serviços, equipe, clientes e operação próprios.</p></div></div></section><section class="section" id="plataforma"><div class="container"><div class="section-head"><div><div class="eyebrow">PLATAFORMA</div><h2>Base pronta para operar</h2></div></div><div class="service-grid"><article class="service-card"><div class="eyebrow">OPERAÇÃO</div><h3>Agenda inteligente</h3><p class="muted">Disponibilidade real, múltiplos serviços e bloqueio contra sobreposição.</p></article><article class="service-card"><div class="eyebrow">GESTÃO</div><h3>Clientes e caixa</h3><p class="muted">Atendimento, histórico, pagamentos e indicadores conectados.</p></article><article class="service-card"><div class="eyebrow">IDENTIDADE</div><h3>Cada empresa é única</h3><p class="muted">Cores, logotipo, contato e experiência pública configurados para cada negócio.</p></article></div></div></section><section class="section" id="demonstracoes"><div class="container"><div class="section-head"><div><div class="eyebrow">AMBIENTES</div><h2>Demonstrações da plataforma</h2></div></div><div class="split"><article class="service-card"><div class="eyebrow">BARBEARIA</div><h3>Palazzo Studio Barber</h3><p class="muted">Primeira empresa real da Chrona.</p><a class="btn btn-outline" href="?tenant=palazzo">Abrir demonstração</a></article><article class="service-card"><div class="eyebrow">LASH DESIGNER</div><h3>Nayara Lash Designer</h3><p class="muted">Ambiente de validação multi-segmento.</p><a class="btn btn-outline" href="?tenant=nayara-lash">Abrir demonstração</a></article></div></div></section></main><footer class="footer chrona-site"><div class="container"><span>© Chrona</span><span class="muted">Uma aplicação. Várias empresas.</span></div></footer>`;
}
async function loadAdminData() {
  if(!authSession) return;
  platformSupportMode=false;
  currentShop=null;
  const profiles=await rest("profiles?select=id,barbershop_id,name,role,active&auth_user_id=eq."+encodeURIComponent(authSession.user.id));
  currentProfile=profiles?.[0];
  if(!currentProfile?.active) throw new Error("Usuário sem acesso ativo.");
  if(currentProfile.role==="platform_admin"&&SHOP_SLUG){
    const shops=await rest(`barbershops?select=*&slug=eq.${encodeURIComponent(SHOP_SLUG)}`);
    currentShop=shops?.[0]||null;
    if(!currentShop) throw new Error("Empresa não encontrada para verificação.");
    currentProfile={...currentProfile,barbershop_id:currentShop.id,support_mode:true};
    platformSupportMode=true;
    const supportLogKey=`chrona-support-log:${authSession.user.id}:${currentShop.id}`;
    if(!sessionStorage.getItem(supportLogKey)){
      await rest("platform_support_access_logs",{method:"POST",body:{barbershop_id:currentShop.id,profile_id:currentProfile.id,auth_user_id:authSession.user.id,context:{tenant_slug:currentShop.slug,entry:"platform_portfolio"}},prefer:"return=minimal"});
      sessionStorage.setItem(supportLogKey,new Date().toISOString());
    }
  }
  if(currentProfile.role==="platform_admin"&&!platformSupportMode){
    const [shops,subscriptions,profilesAll,appointments,servicesAll,professionalsAll,platformSettingsRows]=await Promise.all([
      rest("barbershops?select=*&order=created_at.desc"),
      rest("subscriptions?select=*&order=created_at.desc"),
      rest("profiles?select=id,barbershop_id,role,active"),
      rest("appointments?select=id,barbershop_id,status"),
      rest("services?select=id,barbershop_id,active"),
      rest("professionals?select=id,barbershop_id,active"),
      rest(`platform_notification_settings?select=*&profile_id=eq.${currentProfile.id}`)
    ]);
    platformTenants=(shops||[]).map(shop=>({shop,subscription:(subscriptions||[]).find(s=>s.barbershop_id===shop.id),users:(profilesAll||[]).filter(p=>p.barbershop_id===shop.id&&p.active).length,appointments:(appointments||[]).filter(a=>a.barbershop_id===shop.id).length,services:(servicesAll||[]).filter(s=>s.barbershop_id===shop.id&&s.active).length,professionals:(professionalsAll||[]).filter(p=>p.barbershop_id===shop.id&&p.active).length}));
    platformNotificationSettings=platformSettingsRows?.[0]||null;
    adminLoaded=true; return;
  }
  if(!currentShop){
    const shops=await rest(`barbershops?select=*&id=eq.${currentProfile.barbershop_id}`);
    currentShop=shops?.[0];
  }
  const [services,professionals,clients,appointments,cash,subscriptions,categories,pipelines,stages,opportunities,reminders,connections,rules,runs,notificationRows,personalRows,siteRows]=await Promise.all([
    rest(`services?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=name`),
    rest(`professionals?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=name`),
    rest(`clients?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=name`),
    rpc("get_public_agenda",{shop_slug:currentShop.slug,appt_date:null}),
    rest(`cash_transactions?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=transaction_date.desc,created_at.desc`),
    rest(`subscriptions?select=*&barbershop_id=eq.${currentProfile.barbershop_id}`),
    rest(`cash_categories?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=name`),
    rest(`crm_pipelines?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=created_at`),
    rest(`crm_stages?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=position`),
    rest(`crm_opportunities?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=updated_at.desc`),
    rest(`reminders?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=scheduled_for`),
    rest(`whatsapp_connections?select=id,barbershop_id,provider,phone_number_id,business_account_id,status,verified_at,graph_api_version,display_phone_number,verified_name,quality_rating,last_error&barbershop_id=eq.${currentProfile.barbershop_id}`),
    rest(`automation_rules?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=created_at`),
    rest(`automation_runs?select=id,rule_id,status,scheduled_for,attempt_count,finished_at,error_message&barbershop_id=eq.${currentProfile.barbershop_id}&order=created_at.desc&limit=25`),
    rest(`tenant_notification_settings?select=*&barbershop_id=eq.${currentProfile.barbershop_id}`),
    rest(`personal_reminders?select=*&barbershop_id=eq.${currentProfile.barbershop_id}&order=next_run_at`),
    rest(`tenant_site_configs?select=*&barbershop_id=eq.${currentProfile.barbershop_id}`),
  ]);
  currentSubscription=subscriptions?.[0];
  db.services=(services||[]).map(s=>({id:s.id,name:s.name,desc:s.description,duration:s.duration_minutes,price:Number(s.price),returnDays:s.return_interval_days,active:s.active}));
  PEOPLE=(professionals||[]).map(p=>({id:p.id,name:p.name,phone:p.phone,active:p.active}));
  db.clients=(clients||[]).map(c=>({id:c.id,name:c.name,phone:c.phone,birth:c.birth_date||"",lastVisit:c.last_visit||"",notes:c.notes||"",optIn:c.whatsapp_opt_in,whatsappOptInAt:c.whatsapp_opt_in_at||null}));
  db.appointments=Array.isArray(appointments)?appointments:[];
  db.cash=(cash||[]).map(x=>({id:x.id,appointmentId:x.appointment_id,type:x.type==="income"?"entrada":"saida",desc:x.description,value:Number(x.amount),category:x.category,date:x.transaction_date,method:x.payment_method||""}));
  db.categories=(categories||[]).map(c=>c.name);
  db.reminders=reminders||[];
  crmPipelines=pipelines||[];
  crmStages=stages||[];
  crmOpportunities=(opportunities||[]).map((opportunity)=>({...opportunity,value:opportunity.value===null?null:Number(opportunity.value)}));
  whatsappConnection=connections?.[0]||null;
  automationRules=rules||[];
  automationRuns=runs||[];
  notificationSettings=notificationRows?.[0]||null;
  personalReminders=personalRows||[];
  siteConfigRow=siteRows?.[0]||null;
  siteConfigPublished=ChronaSite.normalize(siteConfigRow?.published_config||ChronaSite.preset("clean"));
  siteConfigDraft=ChronaSite.normalize(siteConfigRow?.draft_config||siteConfigRow?.published_config||siteConfigPublished);
  siteEditorConfig=ChronaSite.clone(siteConfigDraft);
  if(!crmPipelines.some((pipeline)=>pipeline.id===activePipelineId)) activePipelineId=crmPipelines.find((pipeline)=>pipeline.active)?.id||crmPipelines[0]?.id||"";
  if(currentShop){
    db.settings={shop:currentShop.name,address:currentShop.address||"",phone:currentShop.phone||"",open:currentShop.opening_time?.slice(0,5)||"09:00",close:currentShop.closing_time?.slice(0,5)||"19:00",breakStart:currentShop.break_start?.slice(0,5)||"",breakEnd:currentShop.break_end?.slice(0,5)||"",greeting:currentShop.whatsapp_message||"",instagram:currentShop.instagram||"",logo:currentShop.logo_url||"",description:currentShop.public_description||"",primaryColor:currentShop.primary_color||"#6d5dfb",secondaryColor:currentShop.secondary_color||"#22c3a6",visualDirection:currentShop.visual_direction||"studio",timezone:currentShop.timezone||"America/Sao_Paulo"};
    applyTenantBrand(currentShop);
  }
  adminLoaded=true;
}
function loginPage(){
  const company=SHOP_SLUG?db.settings.shop:"Chrona";
  const title=PLATFORM_ENTRY?"Administração da Chrona":`Acessar ${esc(company)}`;
  const description=PLATFORM_ENTRY?"Entre com sua conta de administrador da plataforma.":"Use o e-mail que recebeu o convite para acessar o painel da empresa.";
  const notice=loginNotice?`<div class="auth-notice"><span>✓</span><div><b>Senha criada com sucesso</b><small>${esc(loginNotice)}</small></div></div>`:"";
  return `<main class="section chrona-login"><div class="auth-shell"><section class="auth-copy"><a class="chrona-wordmark" href="${PLATFORM_ENTRY?location.pathname:`${location.pathname}?tenant=${encodeURIComponent(SHOP_SLUG||"")}`}"><span>C</span> CHRONA</a><div><div class="eyebrow">ACESSO SEGURO</div><h1>Seu negócio,<br>no ritmo certo.</h1><p>Agenda, clientes e operação reunidos em um painel simples.</p></div><small>Ambiente protegido pela Chrona</small></section><section class="panel auth-card"><div class="eyebrow">${PLATFORM_ENTRY?"SUPER ADMIN":"PAINEL DA EMPRESA"}</div><h2>${title}</h2><p class="muted">${description}</p>${notice}<form id="login-form"><label class="field"><span>E-mail</span><input name="email" type="email" value="${esc(rememberedLoginEmail)}" autocomplete="username" required></label><label class="field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required></label><button type="button" class="btn btn-ghost auth-forgot" data-forgot>Esqueci minha senha</button><div class="modal-actions"><button type="button" class="btn btn-outline" data-public>Voltar</button><button class="btn btn-dark" type="submit">Entrar no painel</button></div></form></section></div></main>`;
}
function passwordPage(){
  const company=SHOP_SLUG?db.settings.shop:"Chrona";
  return `<main class="section chrona-login"><div class="auth-shell"><section class="auth-copy"><a class="chrona-wordmark" href="${location.pathname}"><span>C</span> CHRONA</a><div><div class="eyebrow">CONVITE ACEITO</div><h1>Falta só<br>uma etapa.</h1><p>Crie sua senha para acessar ${esc(company)} com segurança.</p></div><small>O link é pessoal e de uso único</small></section><section class="panel auth-card"><div class="eyebrow">PRIMEIRO ACESSO</div><h2>Crie sua senha</h2><p class="muted">Use pelo menos oito caracteres. Depois você será levado diretamente para a tela de login correta.</p><form id="password-form"><label class="field"><span>Nova senha</span><input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label class="field"><span>Confirmar senha</span><input name="confirm" type="password" minlength="8" autocomplete="new-password" required></label><div class="modal-actions"><span></span><button class="btn btn-dark" type="submit">Criar senha e continuar</button></div></form></section></div></main>`;
}
function loadingPage(){return `<main class="section"><div class="container empty"><h2>Carregando painel…</h2><p>Sincronizando os dados da empresa.</p></div></main>`}
function suspendedPage(){return `<main class="section"><div class="container"><section class="panel" style="max-width:620px;margin:8vh auto;text-align:center"><div class="eyebrow">CHRONA</div><h2>Assinatura suspensa</h2><p class="muted">A assinatura Chrona deste estabelecimento está suspensa. Os dados permanecem preservados. Entre em contato para regularização.</p><button class="btn btn-outline" data-logout>Sair</button></section></div></main>`}
function tenantAdminGuardPage(){return `<main class="section chrona-login"><div class="container"><section class="panel auth-card" style="max-width:560px;margin:7vh auto"><div class="eyebrow">CONTA DA PLATAFORMA</div><h2>Use o acesso da empresa</h2><p class="muted">Esta conta administra a Chrona inteira e não é o login de ${esc(db.settings.shop)}. Entre com o e-mail que recebeu o convite dessa empresa.</p><div class="modal-actions"><button class="btn btn-outline" data-use-platform>Voltar ao Super Admin</button><button class="btn btn-dark" data-switch-account>Trocar de conta</button></div></section></div></main>`}
function platformPage(){
  const active=platformTenants.filter(t=>t.shop.active&&["active","trial"].includes(t.subscription?.status)).length;
  const trials=platformTenants.filter(t=>t.subscription?.status==="trial").length;
  const expiring=platformTenants.filter((tenant)=>{
    const end=tenant.subscription?.current_period_end||tenant.subscription?.trial_ends_at;
    if(!end)return false;
    const days=(new Date(end)-new Date())/86400000;
    return days>=0&&days<=7;
  }).length;
  const adminReady=!!(platformNotificationSettings?.admin_phone_normalized&&platformNotificationSettings?.whatsapp_opt_in);
  const rows=platformTenants.map((tenant)=>{
    const ready=tenant.users>0&&tenant.services>0&&tenant.professionals>0;
    const missing=[tenant.users?null:"acesso",tenant.services?null:"serviços",tenant.professionals?null:"profissionais"].filter(Boolean).join(", ");
    return `<tr><td><div class="tenant-cell"><span class="tenant-dot" style="background:${esc(tenant.shop.primary_color||"#6d5dfb")}"></span><span><b>${esc(tenant.shop.name)}</b><br><small class="muted">/${esc(tenant.shop.slug)}</small></span></div></td><td>${esc(tenant.shop.business_type||"services")}</td><td>${esc(tenant.subscription?.plan||"—")}</td><td><span class="badge ${tenant.subscription?.status==="suspended"?"red":"green"}">${esc(tenant.subscription?.status||"—")}</span></td><td><span class="badge ${ready?"green":""}">${ready?"Pronto":`Falta ${esc(missing)}`}</span></td><td>${tenant.appointments}</td><td><div class="row-actions"><a class="btn btn-outline" href="?tenant=${encodeURIComponent(tenant.shop.slug)}#admin">Verificar painel</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="?tenant=${encodeURIComponent(tenant.shop.slug)}">Abrir agenda</a>${tenant.users?"":`<button class="btn btn-outline" data-owner-tenant="${tenant.shop.id}">Convidar responsável</button>`}<button class="btn btn-ghost" data-platform-status="${tenant.shop.id}" data-next-status="${tenant.subscription?.status==="suspended"?"active":"suspended"}">${tenant.subscription?.status==="suspended"?"Ativar":"Suspender"}</button></div></td></tr>`;
  }).join("");
  return `<div class="admin chrona-platform"><main class="admin-main platform-main">
    <header class="admin-header platform-header"><div><div class="chrona-wordmark compact"><span>C</span> CHRONA</div><p class="muted">Controle central da operação multi-tenant</p></div><div class="header-actions"><button class="btn btn-outline" data-logout>Sair</button><button class="btn btn-dark" data-new-tenant>+ Nova empresa</button></div></header>
    <section class="platform-hero"><div><div class="eyebrow">VISÃO DA PLATAFORMA</div><h1>Empresas em operação</h1><p>Acompanhe implantação, acesso e saúde dos estabelecimentos em um só lugar.</p></div><div class="platform-orbit"><span>CHRONA</span><i></i><i></i><i></i></div></section>
    <div class="metrics"><div class="metric"><small>Empresas</small><b>${platformTenants.length}</b><span>cadastradas</span></div><div class="metric"><small>Operando</small><b>${active}</b><span>ativas agora</span></div><div class="metric"><small>Em trial</small><b>${trials}</b><span>30 dias de teste</span></div><div class="metric"><small>Vencem em 7 dias</small><b class="${expiring?"danger":""}">${expiring}</b><span>alertas previstos</span></div></div>
    <section class="panel platform-alert-panel ${adminReady?"is-ready":"needs-setup"}" id="platform-alerts">
      <div class="platform-alert-rail" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="platform-alert-body">
        <div class="toolbar platform-alert-head"><div><div class="eyebrow">ALERTAS DA CHRONA</div><h3>Central de vencimentos</h3><p>Um único número administrativo recebe avisos dos planos de todos os tenants.</p></div>${adminReady?'<span class="badge green">Número ativo</span>':'<button class="btn btn-dark" type="button" data-focus-admin-alert>Configurar alertas</button>'}</div>
        <div class="alert-schedule" aria-label="Régua de alertas"><span><b>7 dias</b><small>antecipação</small></span><span><b>3 dias</b><small>acompanhamento</small></span><span><b>1 dia</b><small>prioridade</small></span><span><b>No dia</b><small>vencimento</small></span></div>
        <form id="platform-alert-form"><div class="form-grid"><label class="field"><span>Nome do administrador</span><input name="adminName" value="${esc(platformNotificationSettings?.admin_name||currentProfile.name||"")}" required></label><label class="field"><span>WhatsApp administrativo</span><input name="adminPhone" value="${esc(platformNotificationSettings?.admin_phone||"")}" placeholder="(DDD) 99999-9999" inputmode="tel" required></label><label class="field full consent-field"><span><input name="adminOptIn" type="checkbox" ${platformNotificationSettings?.whatsapp_opt_in?"checked":""}> Autorizo os alertas administrativos neste número</span><small>A empresa, o plano e a data de vencimento serão identificados em cada aviso. O envio usa o número oficial do tenant correspondente e mantém os dados isolados.</small></label></div><div class="platform-alert-footer"><div><b>${adminReady?"Destino configurado":"Falta definir o destino"}</b><small>${adminReady?"A régua será ativada quando a conexão Meta do tenant estiver pronta.":"Cadastre o número e confirme a autorização para preparar os avisos."}</small></div><button class="btn btn-dark" type="submit">${adminReady?"Atualizar número":"Salvar e preparar alertas"}</button></div></form>
      </div>
    </section>
    <section class="panel platform-table"><div class="toolbar"><div><div class="eyebrow">PORTFÓLIO</div><h3 style="margin:5px 0 0">Empresas</h3></div><small class="muted">Use “Verificar painel” para entrar com sua conta Super Admin, sem senha extra.</small></div><div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Segmento</th><th>Plano</th><th>Status</th><th>Preparação</th><th>Agenda</th><th>Ações</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">Nenhuma empresa cadastrada.</td></tr>'}</tbody></table></div></section>
  </main></div>`;
}
function openTenantForm(){
  document.querySelector("#tenant-modal")?.remove();
  document.body.insertAdjacentHTML("beforeend",`<div class="modal onboarding-modal" id="tenant-modal"><div class="modal-card" style="max-width:880px"><div class="modal-head"><div><div class="eyebrow">ATELIÊ DE TENANTS</div><h3>Dar forma à nova empresa</h3><p class="muted">Dois tons definem a identidade; a Chrona compõe o restante.</p></div><button class="btn btn-ghost" data-tenant-close>✕</button></div><form id="tenant-form" class="modal-body"><div class="onboarding-section"><div class="section-number">01</div><div><h4>Essência da empresa</h4><p>Nome, segmento e informações que o cliente encontrará.</p></div></div><div class="form-grid"><label class="field full"><span>Nome da empresa *</span><input name="name" placeholder="Ex.: Raquel Beauty" required></label><label class="field"><span>Slug do link *</span><input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="raquel-beauty" required><small>Endereço curto, sem espaços ou acentos.</small></label><label class="field"><span>Segmento *</span><select name="business"><option value="beauty">Beleza e estética</option><option value="barber">Barbearia</option><option value="lash">Lash Designer</option><option value="wellness">Bem-estar</option><option value="health">Saúde</option><option value="services">Outros serviços</option></select></label><label class="field"><span>WhatsApp *</span><input name="phone" inputmode="tel" placeholder="(34) 99999-9999" required></label><label class="field"><span>Instagram</span><input name="instagram" placeholder="@empresa"></label><label class="field full"><span>Endereço</span><input name="address" placeholder="Rua, número, bairro e cidade"></label><label class="field full"><span>Descrição pública</span><textarea name="description" rows="3" placeholder="Conte em uma frase o que torna este atendimento especial."></textarea></label><label class="field"><span>Link da logo</span><input name="logoUrl" type="url" placeholder="https://..."><small>Opcional. Pode ser configurado depois.</small></label><label class="field"><span>Plano</span><select name="plan"><option value="essential">Essential</option><option value="pro">Pro</option></select></label></div><div class="onboarding-section"><div class="section-number">02</div><div><h4>Assinatura cromática</h4><p>Escolha somente a cor predominante e a cor da tinta.</p></div></div><div class="identity-builder"><div class="identity-colors"><label class="color-field"><input name="primaryColor" type="color" value="#2667ff"><span><b>Cor predominante</b><small>Marca, superfícies e ações</small></span></label><label class="color-field"><input name="secondaryColor" type="color" value="#152238"><span><b>Cor da tinta</b><small>Textos, traços e contraste</small></span></label></div><div class="direction-auto" data-direction-card data-preview-direction="studio"><div class="direction-mini"><i></i><span></span><strong data-preview-initial>NE</strong></div><div><small>DIREÇÃO AUTOMÁTICA</small><b data-direction-name>Studio</b><span data-direction-font>DM Sans · ritmo gráfico</span></div></div></div><p class="identity-note">A tipografia, os fundos e a composição são escolhidos automaticamente para combinar com essas duas cores e com o segmento.</p><div class="onboarding-section"><div class="section-number">03</div><div><h4>Responsável pelo acesso</h4><p>O Supabase enviará o convite para este e-mail.</p></div></div><div class="form-grid"><label class="field"><span>Nome do responsável *</span><input name="ownerName" autocomplete="name" required></label><label class="field"><span>E-mail do responsável *</span><input name="ownerEmail" type="email" autocomplete="email" required></label></div><div class="modal-actions"><button type="button" class="btn btn-outline" data-tenant-close>Cancelar</button><button class="btn btn-dark" type="submit">Criar empresa e enviar convite</button></div></form></div></div>`);
  document.querySelectorAll("[data-tenant-close]").forEach(x=>x.onclick=()=>document.querySelector("#tenant-modal")?.remove());
  const form=document.querySelector("#tenant-form");
  const slug=form.elements.slug;
  const businessField=form.elements.business;
  businessField.name="businessType";
  const preview=form.querySelector("[data-direction-card]");
  let slugEdited=false;
  const directionCopy={editorial:["Editorial","Cormorant Garamond · contraste clássico"],studio:["Studio","DM Sans · ritmo gráfico"],serene:["Sereno","Nunito Sans + Cormorant · respiro suave"]};
  const syncDirection=()=>{const direction=inferVisualDirection(form.elements.primaryColor.value,form.elements.secondaryColor.value,businessField.value);form.dataset.visualDirection=direction;preview.dataset.previewDirection=direction;preview.style.setProperty("--preview-primary",form.elements.primaryColor.value);preview.style.setProperty("--preview-ink",form.elements.secondaryColor.value);preview.querySelector("[data-direction-name]").textContent=directionCopy[direction][0];preview.querySelector("[data-direction-font]").textContent=directionCopy[direction][1];preview.querySelector("[data-preview-initial]").textContent=initials(form.elements.name.value||"Nova empresa");};
  slug.addEventListener("input",()=>{slugEdited=true;slug.value=slugify(slug.value);});
  form.elements.name.addEventListener("input",()=>{if(!slugEdited)slug.value=slugify(form.elements.name.value);syncDirection();});
  [businessField,form.elements.primaryColor,form.elements.secondaryColor].forEach((field)=>field.addEventListener("input",syncDirection));
  syncDirection();
  form.onsubmit=async event=>{event.preventDefault();const button=event.currentTarget.querySelector("button[type=submit]");button.disabled=true;button.textContent="Criando empresa…";const values=Object.fromEntries(new FormData(event.currentTarget).entries());values.visualDirection=event.currentTarget.dataset.visualDirection;try{const result=await edge("tenant-onboarding",{action:"create",...values});await loadAdminData();document.querySelector("#tenant-modal")?.remove();render();showOnboardingSuccess(result);}catch(error){toast(error.message);button.disabled=false;button.textContent="Criar empresa e enviar convite";}};
}
function openTenantOwnerForm(tenant){
  document.querySelector("#owner-modal")?.remove();
  document.body.insertAdjacentHTML("beforeend",`<div class="modal onboarding-modal" id="owner-modal"><div class="modal-card" style="max-width:560px"><div class="modal-head"><div><div class="eyebrow">LIBERAR ACESSO</div><h3>${esc(tenant.shop.name)}</h3></div><button class="btn btn-ghost" data-owner-close>✕</button></div><form id="owner-form" class="modal-body"><p class="muted">O responsável receberá um convite pessoal para criar a senha e entrar diretamente no painel desta empresa.</p><div class="form-grid"><label class="field"><span>Nome do responsável *</span><input name="ownerName" autocomplete="name" required></label><label class="field"><span>E-mail do responsável *</span><input name="ownerEmail" type="email" autocomplete="email" required></label></div><div class="modal-actions"><button type="button" class="btn btn-outline" data-owner-close>Cancelar</button><button class="btn btn-dark" type="submit">Enviar convite</button></div></form></div></div>`);
  document.querySelectorAll("[data-owner-close]").forEach((button)=>button.onclick=()=>document.querySelector("#owner-modal")?.remove());
  document.querySelector("#owner-form").onsubmit=async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent="Enviando…";const values=Object.fromEntries(new FormData(event.currentTarget).entries());try{const result=await edge("tenant-onboarding",{action:"invite-owner",barbershopId:tenant.shop.id,...values});await loadAdminData();document.querySelector("#owner-modal")?.remove();render();showOnboardingSuccess(result);}catch(error){toast(error.message);button.disabled=false;button.textContent="Enviar convite";}};
}
function showOnboardingSuccess(result){
  const slug=result?.tenant?.slug||"";
  const publicUrl=`${location.origin}${location.pathname}?tenant=${encodeURIComponent(slug)}`;
  const direction=result?.tenant?.visualDirection;
  document.querySelector("#onboarding-success")?.remove();
  document.body.insertAdjacentHTML("beforeend",`<div class="modal onboarding-modal" id="onboarding-success"><div class="modal-card success-card"><div class="success-mark">✓</div><div class="eyebrow">EMPRESA PREPARADA</div><h2>Convite enviado</h2><p>Enviamos o primeiro acesso para <b>${esc(result?.owner?.email||"")}</b>. Ao criar a senha, o responsável será levado ao login desta empresa.</p>${direction?`<div class="direction-result"><small>DIREÇÃO CRIADA PELA CHRONA</small><b>${directionLabel(direction)}</b><span>Tipografia e composição definidas a partir das duas cores.</span></div>`:""}<div class="link-preview"><small>Link público</small><b>${esc(publicUrl)}</b></div><div class="modal-actions"><button class="btn btn-outline" data-success-close>Fechar</button><a class="btn btn-dark" target="_blank" rel="noopener" href="${publicUrl}">Abrir agenda</a></div></div></div>`);
  document.querySelector("[data-success-close]").onclick=()=>document.querySelector("#onboarding-success")?.remove();
}
function availableSlots() {
  if (slotsLoaded) return remoteSlots.filter((time) => !isPastSlot(booking.date,time));
  let dur = total().duration || 30,
    out = [];
  for (let h = 9 * 60; h + dur <= 19 * 60; h += 15) {
    if (h < 13 * 60 && h + dur > 12 * 60) continue;
    let time = `${String(Math.floor(h / 60)).padStart(2, "0")}:${String(h % 60).padStart(2, "0")}`;
    let freePeople = PEOPLE.filter(
      (p) =>
        !db.appointments.some(
          (a) =>
            a.date === booking.date &&
            a.professional === p.id &&
            a.status !== "Cancelado" &&
            h <
              parseInt(a.time) * 60 + parseInt(a.time.slice(3)) + a.duration &&
            parseInt(a.time) * 60 + parseInt(a.time.slice(3)) < h + dur,
        ),
    );
    if (
      booking.professional === "any"
        ? freePeople.length
        : freePeople.some((p) => p.id === booking.professional)
    )
      if (!isPastSlot(booking.date,time)) out.push(time);
  }
  return out;
}
function bookingModal() {
  let t = total(),
    titles = [
      "Seu cadastro",
      "Escolha os serviços",
      "Quem vai atender?",
      "Data e horário",
      "Tudo certo!",
    ];
  let body = "";
  if (booking.step === 0)
    body = `<div>${booking.adminMode ? `<div class="field" style="margin-bottom:22px"><span>Selecionar cliente cadastrado</span><div style="display:flex;gap:10px"><select id="admin-client" style="flex:1"><option value="">Escolha pelo nome ou WhatsApp</option>${db.clients.map((c) => `<option value="${c.id}" ${booking.clientId === c.id ? "selected" : ""}>${c.name} · ${c.phone}</option>`).join("")}</select><button class="btn btn-dark" type="button" data-use-client>Usar cliente</button></div></div><div class="eyebrow" style="margin:20px 0">OU CADASTRAR NOVO</div>` : '<p class="muted" style="margin-top:0">Informe seu WhatsApp. Nas próximas visitas, seu cadastro será reconhecido sem criar duplicatas.</p>'}<div class="form-grid"><label class="field"><span>WhatsApp *</span><input id="book-phone" inputmode="tel" autocomplete="tel" value="${booking.phone}" placeholder="(62) 99999-9999"></label><div class="field"><span>&nbsp;</span><button class="btn btn-outline" type="button" data-find-client>Continuar</button></div>${booking.lookupDone ? (booking.clientId ? `<div class="field full"><div class="summary"><span>Bem-vindo novamente, <b>${esc(booking.name)}</b></span><span class="badge green">Cadastro encontrado</span></div></div>` : `<label class="field"><span>Nome completo *</span><input id="book-name" autocomplete="name" value="${esc(booking.name)}" placeholder="Seu nome"></label><label class="field"><span>Data de nascimento</span><input id="book-birth" type="date" value="${booking.birth || ""}"></label>`) : ""}<label class="field full"><span>Observações</span><input id="book-notes" value="${esc(booking.notes)}" placeholder="Opcional"></label><label class="field full"><span><input id="book-optin" type="checkbox" ${booking.optIn ? "checked" : ""}> Aceito receber lembretes e comunicações do estabelecimento pelo WhatsApp.</span></label></div></div>`;
  if (booking.step === 1)
    body = `<div class="choice-grid">${db.services
      .filter((s) => s.active)
      .map(
        (s) =>
          `<button class="choice ${booking.serviceIds.includes(s.id) ? "active" : ""}" data-select-service="${s.id}"><b>${s.name}</b><br><span class="muted">${s.duration} min · ${money(s.price)}</span></button>`,
      )
      .join("")}</div>`;
  if (booking.step === 2)
    body = `<div class="choice-grid"><button class="choice ${booking.professional === "any" ? "active" : ""}" data-prof="any"><b>Qualquer profissional</b><br><span class="muted">Primeiro horário disponível</span></button>${PEOPLE.filter(p=>p.active!==false).map((p) => `<button class="choice ${booking.professional === p.id ? "active" : ""}" data-prof="${p.id}"><b>${p.name}</b><br><span class="muted">Profissional</span></button>`).join("")}</div>`;
  if (booking.step === 3)
    body = `<div class="field" style="margin-bottom:20px"><label>Data</label><input id="book-date" type="date" min="${today()}" value="${booking.date}"></div><div class="slots">${
      availableSlots()
        .map(
          (x) =>
            `<button class="slot-btn ${booking.time === x ? "active" : ""}" data-time="${x}">${x}</button>`,
        )
        .join("") || '<div class="empty">Sem horários nesta data.</div>'
    }</div>`;
  if (booking.step === 4) {
    let p = PEOPLE.find((x) => x.id === booking.professional);
    body = `<div style="text-align:center;padding:22px"><div class="mark" style="margin:auto;background:var(--green);font-size:22px">✓</div><h2 style="margin:18px 0 8px">Agendamento confirmado</h2><p class="muted">${dateBR(booking.date)} às ${booking.time} · ${p?.name || "Profissional disponível"}</p><div class="summary"><b>${booking.serviceIds.map((id) => service(id).name).join(" + ")}</b><b>${money(t.price)}</b></div><a target="_blank" class="btn btn-copper" href="https://wa.me/${db.settings.phone}?text=${encodeURIComponent(`Olá! Confirme meu agendamento na ${db.settings.shop}: ${booking.serviceIds.map((id) => service(id).name).join(" + ")}, dia ${dateBR(booking.date)} às ${booking.time}. Cliente: ${booking.name}.`)}">Enviar resumo pelo WhatsApp</a></div>`;
  }
  return `<div class="modal" id="booking-modal"><div class="modal-card"><div class="modal-head"><div><div class="eyebrow">PASSO ${Math.min(booking.step + 1, 4)} DE 4</div><h3 style="font-size:27px">${titles[booking.step]}</h3></div><button class="btn btn-ghost" data-close>✕</button></div><div class="modal-body"><div class="steps">${[0, 1, 2, 3].map((x) => `<i class="${x <= booking.step ? "on" : ""}"></i>`).join("")}</div>${body}${booking.step < 4 ? `${booking.step > 0 ? `<div class="summary"><span>${t.duration || 0} min · ${booking.serviceIds.length} serviço(s)</span><b>${money(t.price)}</b></div>` : ""}<div class="modal-actions"><button class="btn btn-outline" data-prev ${booking.step === 0 ? "disabled" : ""}>Voltar</button><button class="btn btn-dark" data-next>${booking.step === 3 ? "Confirmar agendamento" : "Continuar"}</button></div>` : ""}</div></div></div>`;
}
const nav = [
  ["dashboard", "Visão geral"],
  ["agenda", "Agenda"],
  ["clientes", "Clientes"],
  ["caixa", "Caixa"],
  ["lembretes", "Lembretes"],
  ["crm", "CRM"],
  ["automacoes", "Automações"],
  ["servicos", "Serviços"],
  ["profissionais", "Profissionais"],
  ["site", "Personalizar Site"],
  ["config", "Configurações"],
];
const siteShop=()=>({name:db.settings.shop,address:db.settings.address,phone:db.settings.phone,open:db.settings.open,close:db.settings.close,breakStart:db.settings.breakStart,breakEnd:db.settings.breakEnd,instagram:db.settings.instagram,logo:db.settings.logo,description:db.settings.description});
const siteOptions=(items,selected)=>Object.entries(items).map(([id,item])=>`<option value="${esc(id)}" ${id===selected?"selected":""}>${esc(item.name||ChronaSite.variantNames[id]||id)}</option>`).join("");
const siteVariantOptions=(type,selected)=>ChronaSite.variants[type].map((id)=>`<option value="${esc(id)}" ${id===selected?"selected":""}>${esc(ChronaSite.variantNames[id]||id)}</option>`).join("");
const SITE_MEDIA_BUCKET="tenant-site-media";
const siteMediaPicker=(kind,url,label,multiple=false)=>`<div class="site-media-upload">${url?`<img src="${esc(url)}" alt="${esc(label)}">`:'<span class="site-media-empty">＋</span>'}<span><b>${esc(label)}</b><input type="file" accept="image/jpeg,.jpg,.jpeg" ${multiple?"multiple":""} data-site-upload="${esc(kind)}"><small>JPG de até 5 MB${multiple?" · até 12 fotos na galeria":""}</small>${url?`<button class="btn btn-ghost danger" type="button" data-site-clear-media="${esc(kind)}">Remover da página</button>`:""}</span></div>`;
async function uploadSiteJpeg(file,kind){
  if(!file||file.type!=="image/jpeg") throw new Error("Envie uma imagem JPG");
  if(file.size>5*1024*1024) throw new Error("A imagem deve ter no máximo 5 MB");
  const safeKind=String(kind||"gallery").replace(/[^a-z0-9-]/gi,"-").toLowerCase();
  const path=`${currentProfile.barbershop_id}/${safeKind}/${Date.now()}-${crypto.randomUUID()}.jpg`;
  const response=await fetch(`${SUPABASE_URL}/storage/v1/object/${SITE_MEDIA_BUCKET}/${path}`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${authSession.access_token}`,"Content-Type":"image/jpeg","cache-control":"31536000","x-upsert":"false"},body:file});
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.message||data?.error||"Não foi possível enviar a imagem");
  return `${SUPABASE_URL}/storage/v1/object/public/${SITE_MEDIA_BUCKET}/${path}`;
}
function siteBuilderContent(){
  const config=ChronaSite.normalize(siteEditorConfig||siteConfigDraft||ChronaSite.preset("clean"));
  siteEditorConfig=config;
  const c=config.content;
  const sectionRows=config.sections.map((section,index)=>`<div class="site-section-row"><span>${esc(ChronaSite.sectionNames[section.id])}</span><button class="badge ${section.visible?"green":""}" data-site-toggle="${section.id}">${section.visible?"Visível":"Oculta"}</button><button class="btn btn-ghost" data-site-move="${section.id}" data-direction="up" ${index===0?"disabled":""}>↑</button><button class="btn btn-ghost" data-site-move="${section.id}" data-direction="down" ${index===config.sections.length-1?"disabled":""}>↓</button></div>`).join("");
  return `<div class="site-builder"><div class="site-builder-controls">
    <section class="site-builder-block"><h3>Biblioteca controlada</h3><label class="field"><span>Buscar estilo</span><input id="site-library-search" placeholder="Ex.: dourado, moderno, serif"></label><div class="site-search-results" id="site-search-results"></div></section>
    <section class="site-builder-block"><h3>Direção visual</h3><label class="field"><span>Template</span><select data-site-field="template">${siteOptions(ChronaSite.templates,config.template)}</select></label><label class="field"><span>Paleta</span><select data-site-field="palette">${siteOptions(ChronaSite.palettes,config.palette)}</select></label><label class="field"><span>Tipografia</span><select data-site-field="fontPair">${siteOptions(ChronaSite.fonts,config.fontPair)}</select></label><div class="form-grid"><label class="field"><span>Hero</span><select data-site-variant="hero">${siteVariantOptions("hero",config.variants.hero)}</select></label><label class="field"><span>Botão</span><select data-site-variant="button">${siteVariantOptions("button",config.variants.button)}</select></label><label class="field"><span>Card</span><select data-site-variant="card">${siteVariantOptions("card",config.variants.card)}</select></label><label class="field"><span>Serviços</span><select data-site-variant="services">${siteVariantOptions("services",config.variants.services)}</select></label><label class="field"><span>Profissionais</span><select data-site-variant="professionals">${siteVariantOptions("professionals",config.variants.professionals)}</select></label></div></section>
    <section class="site-builder-block"><h3>Marca, hero e contato</h3>${siteMediaPicker("logo",c.logoUrl,"Logo da empresa")}${siteMediaPicker("hero",c.hero.imageUrl,"Foto central do hero")}<label class="field"><span>Sobretítulo</span><input data-site-content="hero.eyebrow" value="${esc(c.hero.eyebrow)}"></label><label class="field"><span>Título</span><input data-site-content="hero.title" value="${esc(c.hero.title)}" placeholder="Usa o nome da empresa se vazio"></label><label class="field"><span>Texto</span><textarea rows="3" data-site-content="hero.subtitle">${esc(c.hero.subtitle)}</textarea></label><label class="field"><span>Botão principal</span><input data-site-content="hero.ctaLabel" value="${esc(c.hero.ctaLabel)}"></label><label class="field"><span>Mensagem do WhatsApp</span><textarea rows="3" data-site-content="whatsappMessage">${esc(c.whatsappMessage)}</textarea></label></section>
    <section class="site-builder-block"><h3>Fotos dos serviços</h3><p class="muted">O card continua normal quando não houver foto.</p><div class="site-service-media-list">${db.services.filter((item)=>item.active).map((service)=>siteMediaPicker(`service:${service.id}`,c.serviceImages?.[service.id],service.name)).join("")||'<div class="empty">Cadastre um serviço para adicionar fotos.</div>'}</div></section>
    <section class="site-builder-block"><h3>Conteúdo institucional</h3><label class="field"><span>Sobretítulo</span><input data-site-content="about.eyebrow" value="${esc(c.about.eyebrow)}"></label><label class="field"><span>Título</span><input data-site-content="about.title" value="${esc(c.about.title)}"></label><label class="field"><span>Texto</span><textarea rows="4" data-site-content="about.body">${esc(c.about.body)}</textarea></label><label class="field"><span>Diferenciais (um por linha)</span><textarea rows="4" data-site-list="differentials">${esc((c.differentials||[]).join("\n"))}</textarea></label><label class="field"><span>Depoimentos (Autor | Texto)</span><textarea rows="4" data-site-testimonials>${esc((c.testimonials||[]).map((item)=>`${item.author} | ${item.quote}`).join("\n"))}</textarea></label></section>
    <section class="site-builder-block"><h3>Trabalhos recentes</h3><p class="muted">Estas fotos formam o card quadrado rotativo e o carrossel inferior.</p>${siteMediaPicker("gallery","","Adicionar fotos",true)}<div class="site-gallery-admin">${(c.gallery||[]).map((item,index)=>{const url=typeof item==="string"?item:item?.url;return url?`<figure><img src="${esc(url)}" alt="Foto ${index+1}"><button type="button" title="Remover" data-site-remove-gallery="${index}">×</button></figure>`:"";}).join("")}</div></section>
    <section class="site-builder-block"><h3>Chamada final</h3><label class="field"><span>Sobretítulo</span><input data-site-content="finalCta.eyebrow" value="${esc(c.finalCta.eyebrow)}"></label><label class="field"><span>Título</span><input data-site-content="finalCta.title" value="${esc(c.finalCta.title)}"></label><label class="field"><span>Texto</span><textarea rows="3" data-site-content="finalCta.body">${esc(c.finalCta.body)}</textarea></label><label class="field"><span>Botão</span><input data-site-content="finalCta.label" value="${esc(c.finalCta.label)}"></label></section>
    <section class="site-builder-block"><h3>Seções e ordem</h3><div class="site-section-order">${sectionRows}</div></section>
    <div class="site-builder-actions"><button class="btn btn-outline" data-site-save ${canManageTenant()?"":"disabled"}>Salvar rascunho</button><button class="btn btn-dark" data-site-publish ${canManageTenant()?"":"disabled"}>Publicar alterações</button></div>
  </div><aside class="site-preview-shell"><div class="site-preview-toolbar"><div><button class="btn btn-outline" data-site-viewport="desktop">Desktop</button><button class="btn btn-outline" data-site-viewport="mobile">Celular</button></div><span class="site-builder-status">${siteConfigRow?.published_at?`Publicado em ${dateTimeBR(siteConfigRow.published_at)}`:"Ainda não publicado"}</span></div><div class="site-preview-canvas" id="site-preview-canvas"><div class="site-preview-document" id="site-preview-document">${ChronaSite.render({shop:siteShop(),services:db.services.filter((item)=>item.active),professionals:PEOPLE.filter((item)=>item.active!==false),config,preview:true})}</div></div></aside></div>`;
}
function setSiteContent(path,value){
  const parts=path.split(".");let target=siteEditorConfig.content;
  parts.slice(0,-1).forEach((part)=>target=target[part]);target[parts.at(-1)]=value;
}
function updateSitePreview(){
  const preview=document.querySelector("#site-preview-document");
  if(preview){preview.innerHTML=ChronaSite.render({shop:siteShop(),services:db.services.filter((item)=>item.active),professionals:PEOPLE.filter((item)=>item.active!==false),config:siteEditorConfig,preview:true});ChronaSite.startRotators();}
}
async function persistSiteConfig(publish){
  const normalized=ChronaSite.normalize(siteEditorConfig),now=new Date().toISOString();
  const body={barbershop_id:currentProfile.barbershop_id,draft_config:normalized,updated_by:authSession.user.id,updated_at:now};
  if(publish){body.published_config=normalized;body.published_at=now;}
  const rows=await rest("tenant_site_configs?on_conflict=barbershop_id",{method:"POST",body,prefer:"resolution=merge-duplicates,return=representation"});
  siteConfigRow=rows?.[0]||{...siteConfigRow,...body};siteConfigDraft=ChronaSite.clone(normalized);siteEditorConfig=ChronaSite.clone(normalized);
  if(publish) siteConfigPublished=ChronaSite.clone(normalized);
}
function adminPage() {
  const logo=db.settings.logo?`<img class="brand-logo" src="${esc(db.settings.logo)}" alt="Logo ${esc(db.settings.shop)}">`:`<span class="brand-logo logo-fallback">${initials(db.settings.shop)}</span>`;
  const supportBanner=platformSupportMode?`<div class="support-mode"><span><i></i><b>Modo de verificação Chrona</b><small>Você está administrando ${esc(db.settings.shop)} com a conta Super Admin.</small></span><button class="btn btn-outline" data-use-platform>Voltar à plataforma</button></div>`:"";
  return `<div class="admin"><div class="admin-shell"><aside class="sidebar"><div class="brand">${logo}<div>${db.settings.shop}<small>GESTÃO CHRONA</small></div></div><nav class="nav">${nav.map((n) => `<button class="${adminTab === n[0] ? "active" : ""}" data-tab="${n[0]}">${n[1]}</button>`).join("")}<button data-public>↗ Página pública</button>${platformSupportMode?'<button data-use-platform>← Super Admin</button>':""}<button data-logout>Sair</button></nav></aside><main class="admin-main">${supportBanner}<header class="admin-header"><div><div class="eyebrow">${db.settings.shop} · CHRONA</div><h1>${nav.find((n) => n[0] === adminTab)[1]}</h1></div>${adminTab==="site"?`<a class="btn btn-outline" target="_blank" rel="noopener" href="?tenant=${encodeURIComponent(currentShop.slug)}">Ver site publicado</a>`:'<button class="btn btn-dark" data-quick>+ Novo</button>'}</header>${adminContent()}</main></div><nav class="mobile-nav">${nav.map((n) => `<button class="${adminTab === n[0] ? "active" : ""}" data-tab="${n[0]}">${n[1]}</button>`).join("")}</nav></div>`;
}
function crmContent(){
  const pipeline=currentPipeline();
  if(!pipeline) return `<section class="panel"><div class="empty"><h3>Crie seu primeiro pipeline</h3><p>Organize contatos, agendamentos e ações de relacionamento.</p><button class="btn btn-dark" data-add-pipeline>+ Criar pipeline</button></div></section>`;
  const stages=crmStages.filter((stage)=>stage.pipeline_id===pipeline.id).sort((a,b)=>a.position-b.position);
  const stageIds=new Set(stages.map((stage)=>stage.id));
  const opportunities=crmOpportunities.filter((opportunity)=>stageIds.has(opportunity.stage_id)&&opportunity.status!=="archived");
  const open=opportunities.filter((opportunity)=>opportunity.status==="open");
  const won=opportunities.filter((opportunity)=>opportunity.status==="won");
  const overdue=open.filter((opportunity)=>opportunity.next_action_at&&new Date(opportunity.next_action_at)<new Date());
  const sourceLabels={manual:"Manual",whatsapp:"WhatsApp",instagram:"Instagram",referral:"Indicação",appointment:"Agendamento"};
  const statusLabels={open:"Em aberto",won:"Ganha",lost:"Perdida"};
  const board=stages.map((stage)=>{
    const cards=opportunities.filter((opportunity)=>opportunity.stage_id===stage.id);
    return `<section class="crm-column" style="--stage-color:${stage.color||"#9caeff"}"><header class="crm-column-head"><div><span class="crm-stage-dot"></span><b>${esc(stage.name)}</b><small>${cards.length}</small></div><div><button class="btn btn-ghost" title="Editar etapa" data-edit-stage="${stage.id}">Editar</button><button class="btn btn-ghost danger" title="Excluir etapa" data-delete-stage="${stage.id}">×</button><button class="btn btn-ghost" title="Nova oportunidade nesta etapa" data-add-opportunity="${stage.id}">+</button></div></header><div class="crm-cards">${cards.map((opportunity)=>{
      const client=db.clients.find((item)=>item.id===opportunity.client_id);
      const isOverdue=opportunity.status==="open"&&opportunity.next_action_at&&new Date(opportunity.next_action_at)<new Date();
      return `<article class="crm-card ${opportunity.status}"><button class="crm-card-main" data-edit-opportunity="${opportunity.id}"><span class="badge ${opportunity.status==="won"?"green":opportunity.status==="lost"?"red":""}">${statusLabels[opportunity.status]||opportunity.status}</span><h4>${esc(opportunity.title)}</h4><p>${esc(client?.name||"Cliente removido")}</p>${opportunity.value!==null?`<b class="crm-value">${money(opportunity.value)}</b>`:""}<small class="${isOverdue?"danger":"muted"}">${isOverdue?"Ação atrasada · ":""}${dateTimeBR(opportunity.next_action_at)}</small><small class="muted">Origem: ${sourceLabels[opportunity.source]||esc(opportunity.source)}</small></button><div class="crm-card-actions"><select data-move-opportunity="${opportunity.id}" aria-label="Mover oportunidade">${stages.map((target)=>`<option value="${target.id}" ${target.id===opportunity.stage_id?"selected":""}>${esc(target.name)}</option>`).join("")}</select>${opportunity.status!=="won"?`<button class="btn btn-ghost" data-opportunity-status="won" data-opportunity-id="${opportunity.id}">Ganhar</button>`:`<button class="btn btn-ghost" data-opportunity-status="open" data-opportunity-id="${opportunity.id}">Reabrir</button>`}${opportunity.status!=="lost"?`<button class="btn btn-ghost danger" data-opportunity-status="lost" data-opportunity-id="${opportunity.id}">Perder</button>`:""}${client?.phone?`<button class="btn btn-ghost" data-whatsapp="${esc(client.phone)}">WhatsApp</button>`:""}<button class="btn btn-ghost danger" data-delete-opportunity="${opportunity.id}">Excluir</button></div></article>`;
    }).join("")||'<div class="crm-empty">Nenhuma oportunidade<br><button class="btn btn-ghost" data-add-opportunity="'+stage.id+'">Adicionar</button></div>'}</div></section>`;
  }).join("");
  return `<div class="metrics"><div class="metric"><small>Em aberto</small><b>${open.length}</b></div><div class="metric"><small>Previsão</small><b>${money(open.reduce((sum,item)=>sum+(item.value||0),0))}</b></div><div class="metric"><small>Ganhas</small><b>${won.length}</b></div><div class="metric"><small>Ações atrasadas</small><b class="${overdue.length?"danger":""}">${overdue.length}</b></div></div><section class="panel crm-panel"><div class="toolbar"><div><h3 style="margin:0">Pipeline de relacionamento</h3><small class="muted">Acompanhe cada cliente até a próxima ação.</small></div><div class="crm-toolbar"><select id="crm-pipeline">${crmPipelines.map((item)=>`<option value="${item.id}" ${item.id===pipeline.id?"selected":""}>${esc(item.name)}${item.active?"":" · arquivado"}</option>`).join("")}</select><button class="btn btn-outline" data-edit-pipeline="${pipeline.id}">Editar</button><button class="btn btn-outline" data-toggle-pipeline="${pipeline.id}">${pipeline.active?"Arquivar":"Ativar"}</button><button class="btn btn-ghost danger" data-delete-pipeline="${pipeline.id}">Excluir</button><button class="btn btn-outline" data-add-stage>+ Etapa</button><button class="btn btn-dark" data-add-opportunity>+ Oportunidade</button><button class="btn btn-ghost" data-add-pipeline>+ Pipeline</button></div></div>${stages.length?`<div class="crm-board">${board}</div>`:'<div class="empty">Este pipeline ainda não tem etapas.<br><button class="btn btn-outline" data-add-stage>Adicionar primeira etapa</button></div>'}</section>`;
}
function adminContent() {
  let revenue = db.cash
      .filter((x) => x.type === "entrada")
      .reduce((a, x) => a + x.value, 0),
    expense = db.cash
      .filter((x) => x.type === "saida")
      .reduce((a, x) => a + x.value, 0);
  if(adminTab === "site") return siteBuilderContent();
  if (adminTab === "dashboard")
    return `<div class="metrics"><div class="metric"><small>Faturamento hoje</small><b>${money(db.cash.filter((x) => x.type === "entrada" && x.date === today()).reduce((a, x) => a + x.value, 0))}</b></div><div class="metric"><small>Saldo do caixa</small><b>${money(revenue - expense)}</b></div><div class="metric"><small>Agendamentos</small><b>${db.appointments.length}</b></div><div class="metric"><small>Ticket médio</small><b>${money(revenue / Math.max(1, db.cash.filter((x) => x.type === "entrada").length))}</b></div></div><div class="split"><section class="panel"><h3>Faturamento — últimos 7 dias</h3><div class="chart">${[42, 68, 55, 82, 64, 92, 73].map((x, i) => `<div class="bar-col"><div class="bar" style="height:${x}%"></div>${["S", "T", "Q", "Q", "S", "S", "D"][i]}</div>`).join("")}</div></section><section class="panel"><h3>Próximos atendimentos</h3>${
      db.appointments
        .filter((a) => a.status === "Agendado")
        .slice(0, 4)
        .map(
          (a) =>
            `<div class="list-card"><span><b>${a.time} · ${a.client}</b><br><small class="muted">${service(a.serviceIds[0])?.name}</small></span><span class="badge green">Agendado</span></div>`,
        )
        .join("") || '<div class="empty">Nenhum atendimento agendado.</div>'
    }<h3 style="margin-top:24px">Próximos horários livres</h3><div class="slots">${[
      "09:00",
      "09:30",
      "10:00",
      "10:30",
      "11:00",
      "13:00",
      "13:30",
      "14:00",
    ]
      .filter(
        (time) =>
          !db.appointments.some(
            (a) =>
              a.date === addDays(1) &&
              a.time === time &&
              a.status !== "Cancelado",
          ),
      )
      .slice(0, 6)
      .map((time) => `<span class="slot-btn">${time}</span>`)
      .join(
        "",
      )}</div><small class="muted">Disponibilidade de amanhã para atendimentos de 30 min.</small></section></div>`;
  if (adminTab === "agenda")
    return `<section class="panel"><div class="toolbar"><input id="agenda-date" type="date" value="${agendaDate}"><button class="btn btn-dark" data-add-appt>+ Agendamento</button></div><div class="table-wrap"><table><thead><tr><th>Data/hora</th><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Status</th><th>Ações</th></tr></thead><tbody>${
      db.appointments
        .filter((a) => a.date === agendaDate)
        .map(
          (a) =>
            `<tr><td>${dateBR(a.date)} · ${a.time}</td><td>${a.client}</td><td>${a.serviceIds.map((x) => service(x)?.name).filter(Boolean).join(", ")}</td><td>${PEOPLE.find((p) => p.id === a.professional)?.name||"—"}</td><td><span class="badge ${a.status === "Concluído" ? "green" : ""}">${a.status}</span></td><td>${a.status==="Agendado"?`<button class="btn btn-ghost" data-confirm-appt="${a.id}">Confirmar</button>`:""}${["Agendado","Confirmado"].includes(a.status)?`<button class="btn btn-dark" data-complete-appt="${a.id}">Concluir</button><button class="btn btn-ghost" data-noshow-appt="${a.id}">Falta</button><button class="btn btn-ghost danger" data-delete-appt="${a.id}">Cancelar</button>`:""}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="6" class="empty">Nenhum atendimento nesta data.</td></tr>'
    }</tbody></table></div></section>`;
  if (adminTab === "clientes")
    return `<section class="panel"><div class="toolbar"><input id="search" placeholder="Buscar cliente"><button class="btn btn-dark" data-add-client>+ Cliente</button></div><div id="client-list" class="list-cards">${db.clients.map((c) => `<div class="list-card"><span><b>${c.name}</b><br><small class="muted">${c.phone} · última visita ${dateBR(c.lastVisit)}</small></span><span><button class="btn btn-ghost" data-edit-client="${c.id}">Editar</button><button class="btn btn-outline" data-whatsapp="${c.phone}">WhatsApp</button><button class="btn btn-ghost danger" data-delete-client="${c.id}">Excluir</button></span></div>`).join("")}</div></section>`;
  if (adminTab === "caixa")
    return `<div class="metrics"><div class="metric"><small>Entradas</small><b>${money(revenue)}</b></div><div class="metric"><small>Saídas</small><b class="danger">${money(expense)}</b></div><div class="metric"><small>Saldo</small><b>${money(revenue - expense)}</b></div><div class="metric"><small>Movimentos</small><b>${db.cash.length}</b></div></div><section class="panel"><div class="tabs"><button class="${cashTab === "movimentos" ? "active" : ""}" data-cash-tab="movimentos">Movimentações</button><button class="${cashTab === "categorias" ? "active" : ""}" data-cash-tab="categorias">Categorias editáveis</button></div>${cashTab === "movimentos" ? `<div class="toolbar"><span class="muted">Entradas e saídas organizadas</span><button class="btn btn-dark" data-add-cash>+ Movimentação</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Método</th><th>Valor</th><th></th></tr></thead><tbody>${db.cash.map((x) => `<tr><td>${dateBR(x.date)}</td><td>${x.desc}</td><td>${x.category}</td><td>${x.method}</td><td class="${x.type === "saida" ? "danger" : ""}">${x.type === "saida" ? "-" : "+"} ${money(x.value)}</td><td><button class="btn btn-ghost danger" data-delete-cash="${x.id}">Excluir</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="toolbar"><span class="muted">Categorias usadas nas movimentações</span><button class="btn btn-dark" data-add-category>+ Categoria</button></div><div class="list-cards">${db.categories.map((c) => `<div class="list-card"><b>${c}</b><button class="btn btn-ghost danger" data-delete-category="${c}">Excluir</button></div>`).join("")}</div>`}</section>`;
  if (adminTab === "lembretes") {
    const birth = db.clients.filter(
        (c) => c.birth.slice(5, 7) === today().slice(5, 7),
      ), returns=db.reminders.filter((item)=>item.type==="return"&&item.status==="pending"),
      due=returns.filter((item)=>item.scheduled_for<=today()),
      upcoming=returns.filter((item)=>item.scheduled_for>today());
    const returnCard=(item)=>{
      const client=db.clients.find((candidate)=>candidate.id===item.client_id);
      return client?reminder(client,`Olá, ${client.name}! Chegou o momento recomendado para o seu próximo atendimento. Que tal agendar um horário?`,`Retorno previsto: ${dateBR(item.scheduled_for)}`,item.scheduled_for<=today()?"danger":""):"";
    };
    return `<div class="metrics"><div class="metric"><small>Retornos vencidos</small><b class="${due.length?"danger":""}">${due.length}</b></div><div class="metric"><small>Próximos retornos</small><b>${upcoming.length}</b></div><div class="metric"><small>Aniversariantes</small><b>${birth.length}</b></div><div class="metric"><small>Com consentimento</small><b>${db.clients.filter((client)=>client.optIn).length}</b></div></div><div class="split"><section class="panel"><h3>🎂 Aniversariantes do mês</h3>${birth.map((c) => reminder(c, `Parabéns pelo seu aniversário! A ${db.settings.shop} deseja um dia incrível.`)).join("") || '<div class="empty">Nenhum aniversariante.</div>'}</section><section class="panel"><h3>✨ Retornos por serviço</h3><div class="eyebrow" style="margin-bottom:10px">PRONTOS PARA CONTATO</div>${due.map(returnCard).join("")||'<div class="empty">Nenhum retorno vencido.</div>'}<div class="eyebrow" style="margin:24px 0 10px">PROGRAMADOS</div>${upcoming.map(returnCard).join("")||'<div class="empty">Nenhum retorno futuro.</div>'}</section></div>`;
  }
  if (adminTab === "servicos")
    return `<section class="panel"><div class="toolbar"><span class="muted">Nome, preço, duração e ciclo de retorno</span><button class="btn btn-dark" data-add-service>+ Serviço</button></div><div class="list-cards">${db.services.map((s) => `<div class="list-card"><span><b>${s.name}</b><br><small class="muted">${s.duration} min · ${money(s.price)} · ${s.returnDays?`retorno em ${s.returnDays} dias`:"sem lembrete de retorno"}</small></span><span><button class="btn btn-ghost" data-edit-service="${s.id}">Editar</button><button class="badge ${s.active ? "green" : "red"}" data-toggle-service="${s.id}">${s.active ? "Ativo" : "Inativo"}</button><button class="btn btn-ghost danger" data-delete-service="${s.id}">Excluir</button></span></div>`).join("")}</div></section>`;
  if(adminTab === "crm") return crmContent();
  if(adminTab === "automacoes") {
    const connected=whatsappConnection?.status==="connected";
    const queued=automationRuns.filter((run)=>run.status==="queued").length;
    const sent=automationRuns.filter((run)=>run.status==="sent").length;
    const failed=automationRuns.filter((run)=>run.status==="failed").length;
    const eligibleClients=db.clients.filter((client)=>client.optIn&&client.phone.replace(/\D/g,"").length>=10).length;
    const ownerReady=Boolean(notificationSettings?.owner_phone_normalized&&notificationSettings?.owner_whatsapp_opt_in);
    const ruleCards=automationRules.map((rule)=>{
      const recipient=rule.recipient_type==="platform_admin"?"Admin Chrona":rule.recipient_type==="owner"?"Responsável":"Cliente";
      const timing=({appointment_created:"Ao marcar",appointment_reminder:`${rule.lead_minutes||0} min antes`,personal_reminder:"Agenda pessoal",birthday:"No aniversário, às 09h",return_due:"20 dias após o serviço",subscription_expiring:"7, 3, 1 e 0 dias antes"})[rule.trigger_type]||rule.trigger_type;
      const template=rule.conditions?.meta_template_name?`Template ${esc(rule.conditions.meta_template_name)}`:"Template Meta pendente";
      return `<div class="list-card"><span><b>${esc(rule.name)}</b><br><small class="muted">${recipient} · ${timing} · ${template}</small></span><span class="badge ${rule.active?"green":""}">${rule.active?"Ativa":"Preparada"}</span></div>`;
    }).join("")||'<div class="empty">Nenhuma regra cadastrada.</div>';
    const draftBusinessAccountId=whatsappConnectionDraft.businessAccountId||whatsappConnection?.business_account_id||"";
    const draftPhoneNumberId=whatsappConnectionDraft.phoneNumberId||whatsappConnection?.phone_number_id||"";
    const connectionForm=canManageTenant()?`<form id="whatsapp-connect-form" autocomplete="off"><div class="form-grid"><label class="field"><span>ID da conta WhatsApp Business</span><input name="businessAccountId" type="text" inputmode="numeric" pattern="[0-9]{5,30}" value="${esc(draftBusinessAccountId)}" autocomplete="off" autocapitalize="none" spellcheck="false" data-1p-ignore data-lpignore="true" required></label><label class="field"><span>ID do número de telefone</span><input name="phoneNumberId" type="text" inputmode="numeric" pattern="[0-9]{5,30}" value="${esc(draftPhoneNumberId)}" autocomplete="off" autocapitalize="none" spellcheck="false" data-1p-ignore data-lpignore="true" required></label><label class="field full"><span>Token permanente da Meta</span><input name="accessToken" type="password" value="${esc(whatsappConnectionDraft.accessToken)}" autocomplete="new-password" autocapitalize="none" spellcheck="false" data-1p-ignore data-lpignore="true" placeholder="Cole o token para validar e guardar no cofre" required><small class="muted">O token segue direto para a função segura, é criptografado no Supabase Vault e nunca volta para esta página.</small></label></div><div class="modal-actions"><span></span><button class="btn btn-dark" type="submit">${connected?"Revalidar conexão":"Conectar com a Meta"}</button></div></form>`:'<div class="empty">Somente o proprietário pode configurar as credenciais da Meta.</div>';
    const ownerForm=canManageTenant()?`<form id="notification-owner-form"><div class="form-grid"><label class="field"><span>Nome do responsável</span><input name="ownerName" value="${esc(notificationSettings?.owner_name||currentProfile.name||"")}" required></label><label class="field"><span>WhatsApp do responsável</span><input name="ownerPhone" value="${esc(notificationSettings?.owner_phone||"")}" placeholder="(DDD) 99999-9999" required></label><label class="field full consent-field"><span><input name="ownerOptIn" type="checkbox" ${notificationSettings?.owner_whatsapp_opt_in?"checked":""}> Autorizo lembretes operacionais neste número</span><small class="muted">Usado para avisos da agenda e lembretes pessoais; nunca substitui o número oficial conectado à Meta.</small></label></div><div class="modal-actions"><span></span><button class="btn btn-dark" type="submit">Salvar responsável</button></div></form>`:'<div class="empty">Somente o proprietário pode alterar o destinatário responsável.</div>';
    const personalCards=personalReminders.map((item)=>`<div class="list-card"><span><b>${esc(item.title)}</b><br><small class="muted">Próximo: ${dateTimeBR(item.next_run_at)} · ${item.repeat_every_days?`a cada ${item.repeat_every_days} dias`:"uma vez"}</small></span><span><button class="btn btn-ghost" data-edit-personal="${item.id}">Editar</button><button class="badge ${item.active?"green":""}" data-toggle-personal="${item.id}">${item.active?"Ativo":"Pausado"}</button><button class="btn btn-ghost danger" data-delete-personal="${item.id}">Excluir</button></span></div>`).join("")||'<div class="empty">Nenhum lembrete pessoal criado.</div>';
    return `<div class="metrics"><div class="metric"><small>Conexão Meta</small><b class="${connected?"":"danger"}">${connected?"Ativa":"Pendente"}</b></div><div class="metric"><small>Responsável</small><b class="${ownerReady?"":"danger"}">${ownerReady?"Pronto":"Pendente"}</b></div><div class="metric"><small>Clientes elegíveis</small><b>${eligibleClients}</b></div><div class="metric"><small>Fila / enviadas / falhas</small><b>${queued} / ${sent} / <span class="${failed?"danger":""}">${failed}</span></b></div></div><div class="automation-readiness"><b>Base Meta universal preparada</b><span>Confirmação de horário · 15 min antes · aniversário · retorno em 20 dias · agenda pessoal · vencimento de plano para o admin Chrona.</span></div><div class="split"><section class="panel"><div class="toolbar"><div><h3 style="margin:0">Destinatário responsável</h3><small class="muted">Número que recebe lembretes internos da empresa.</small></div><span class="badge ${ownerReady?"green":""}">${ownerReady?"Elegível":"Configurar"}</span></div>${ownerForm}</section><section class="panel"><div class="toolbar"><div><h3 style="margin:0">Agenda pessoal</h3><small class="muted">Avisos pontuais ou repetidos, como a cada 2 dias.</small></div>${canManageTenant()?'<button class="btn btn-dark" data-add-personal>+ Lembrete</button>':""}</div><div class="list-cards">${personalCards}</div></section></div><div class="split automation-lower"><section class="panel"><div class="toolbar"><div><h3 style="margin:0">Regras de lembrete</h3><small class="muted">Modelos replicados automaticamente para cada empresa.</small></div><span class="badge ${currentSubscription?.plan==="pro"?"green":""}">${currentSubscription?.plan==="pro"?"Plano Pro":"Recurso Pro"}</span></div><div class="list-cards">${ruleCards}</div><div class="empty">As regras continuam desligadas até vincularmos os templates aprovados pela Meta.</div></section><section class="panel"><div class="toolbar"><div><h3 style="margin:0">WhatsApp oficial</h3><small class="muted">Meta Cloud API ${esc(whatsappConnection?.graph_api_version||"v26.0")}</small></div><span class="badge ${connected?"green":"red"}">${connected?"Conectado":"Amanhã"}</span></div>${connected?`<div class="list-card"><span><b>${esc(whatsappConnection.verified_name||db.settings.shop)}</b><br><small class="muted">${esc(whatsappConnection.display_phone_number||whatsappConnection.phone_number_id)}${whatsappConnection.quality_rating?` · qualidade ${esc(whatsappConnection.quality_rating)}`:""}</small></span><span class="badge green">Verificado</span></div>`:"<div class=\"empty\">A estrutura está pronta. A credencial e os IDs da Meta serão ligados na próxima etapa.</div>"}${connectionForm}</section></div>`;
  }
  if(adminTab === "profissionais") return `<section class="panel"><div class="toolbar"><span class="muted">Equipe e disponibilidade para agendamentos</span><button class="btn btn-dark" data-add-professional>+ Profissional</button></div><div class="list-cards">${PEOPLE.map(p=>`<div class="list-card"><span><b>${p.name}</b><br><small class="muted">${p.phone||"Sem telefone"}</small></span><span><button class="btn btn-ghost" data-edit-professional="${p.id}">Editar</button><button class="badge ${p.active?"green":"red"}" data-toggle-professional="${p.id}">${p.active?"Ativo":"Inativo"}</button></span></div>`).join("")||'<div class="empty">Nenhum profissional cadastrado.</div>'}</div></section>`;
  return `<section class="panel"><div class="toolbar"><div><div class="eyebrow">IDENTIDADE DA EMPRESA</div><h3 style="margin:5px 0 0">Página pública e operação</h3></div><a class="btn btn-outline" target="_blank" rel="noopener" href="?tenant=${encodeURIComponent(currentShop.slug)}">Visualizar página</a></div><div class="form-grid"><label class="field"><span>Nome da empresa</span><input id="set-shop" value="${esc(db.settings.shop)}"></label><label class="field"><span>WhatsApp</span><input id="set-phone" value="${esc(db.settings.phone)}"></label><label class="field"><span>Instagram</span><input id="set-instagram" value="${esc(db.settings.instagram)}" placeholder="@empresa"></label><label class="field"><span>Link da logo</span><input id="set-logo" value="${esc(db.settings.logo)}" placeholder="https://..."></label><label class="field full"><span>Endereço</span><input id="set-address" value="${esc(db.settings.address)}"></label><label class="field full"><span>Descrição da página pública</span><textarea id="set-description" rows="3">${esc(db.settings.description)}</textarea></label><label class="color-field"><input id="set-primary-color" type="color" value="${esc(db.settings.primaryColor)}"><span><b>Cor predominante</b><small>Marca, superfícies e ações</small></span></label><label class="color-field"><input id="set-secondary-color" type="color" value="${esc(db.settings.secondaryColor)}"><span><b>Cor da tinta</b><small>Textos, traços e contraste</small></span></label><div class="direction-config-note"><small>DIREÇÃO AUTOMÁTICA</small><b>${directionLabel(db.settings.visualDirection)}</b><span>A fonte e a composição acompanham as duas cores.</span></div><label class="field"><span>Abertura</span><input id="set-open" type="time" value="${db.settings.open}"></label><label class="field"><span>Fechamento</span><input id="set-close" type="time" value="${db.settings.close}"></label><label class="field"><span>Início do intervalo</span><input id="set-break-start" type="time" value="${db.settings.breakStart}"></label><label class="field"><span>Fim do intervalo</span><input id="set-break-end" type="time" value="${db.settings.breakEnd}"></label><label class="field full"><span>Saudação do WhatsApp</span><textarea id="set-greeting" rows="4">${esc(db.settings.greeting)}</textarea></label></div><div class="modal-actions"><span></span><button class="btn btn-dark" data-save-settings>Salvar configurações</button></div></section>`;
}
function reminder(c,msg,detail="",badgeClass="") {
  const digits=c.phone.replace(/\D/g,"");
  const whatsapp=digits.startsWith("55")?digits:`55${digits}`;
  const action=c.optIn?`<a class="btn btn-outline ${badgeClass}" target="_blank" href="https://wa.me/${whatsapp}?text=${encodeURIComponent(msg)}">Enviar</a>`:'<span class="badge">Sem consentimento</span>';
  return `<div class="list-card"><span><b>${c.name}</b><br><small class="muted">${detail?`${detail} · `:""}${c.phone}</small></span>${action}</div>`;
}
function render() {
  if(PLATFORM_ENTRY) document.title="Chrona | Administração da plataforma";
  app.innerHTML = PASSWORD_FLOW ? passwordPage() : location.hash === "#admin" ? (!authSession ? loginPage() : !adminLoaded ? loadingPage() : currentProfile?.role==="platform_admin" ? (platformSupportMode?adminPage():PLATFORM_ENTRY?platformPage():tenantAdminGuardPage()) : currentSubscription?.status==="suspended" ? suspendedPage() : adminPage()) : CHRONA_HOME ? chronaHomePage() : publicPage();
  bind();
  ChronaSite.startRotators();
}
function bindSiteBuilder(){
  if(adminTab!=="site"||!siteEditorConfig) return;
  document.querySelectorAll("[data-site-field]").forEach((field)=>field.addEventListener("change",()=>{
    if(field.dataset.siteField==="template"){siteEditorConfig=ChronaSite.preset(field.value,siteEditorConfig);render();return;}
    siteEditorConfig[field.dataset.siteField]=field.value;updateSitePreview();
  }));
  document.querySelectorAll("[data-site-variant]").forEach((field)=>field.addEventListener("change",()=>{siteEditorConfig.variants[field.dataset.siteVariant]=field.value;updateSitePreview();}));
  document.querySelectorAll("[data-site-content]").forEach((field)=>field.addEventListener("input",()=>{setSiteContent(field.dataset.siteContent,field.value);updateSitePreview();}));
  document.querySelectorAll("[data-site-list]").forEach((field)=>field.addEventListener("input",()=>{siteEditorConfig.content[field.dataset.siteList]=field.value.split(/\r?\n/).map((item)=>item.trim()).filter(Boolean);updateSitePreview();}));
  document.querySelector("[data-site-testimonials]")?.addEventListener("input",(event)=>{siteEditorConfig.content.testimonials=event.currentTarget.value.split(/\r?\n/).map((line)=>{const [author,...quote]=line.split("|");return {author:(author||"").trim(),quote:quote.join("|").trim()};}).filter((item)=>item.author&&item.quote);updateSitePreview();});
  document.querySelectorAll("[data-site-upload]").forEach((input)=>input.addEventListener("change",async()=>{
    const kind=input.dataset.siteUpload,files=[...(input.files||[])];if(!files.length)return;
    input.disabled=true;
    try{
      if(kind==="gallery"){
        const remaining=Math.max(0,12-(siteEditorConfig.content.gallery||[]).length);
        if(!remaining) throw new Error("A galeria já possui o limite de 12 fotos");
        const urls=[];for(const file of files.slice(0,remaining))urls.push(await uploadSiteJpeg(file,"gallery"));
        siteEditorConfig.content.gallery=[...(siteEditorConfig.content.gallery||[]),...urls];
        const gallerySection=siteEditorConfig.sections.find((item)=>item.id==="gallery");if(gallerySection)gallerySection.visible=true;
      }else{
        const url=await uploadSiteJpeg(files[0],kind.startsWith("service:")?"services":kind);
        if(kind==="logo")siteEditorConfig.content.logoUrl=url;
        else if(kind==="hero"){siteEditorConfig.content.hero.imageUrl=url;siteEditorConfig.variants.hero="centered-image";}
        else if(kind.startsWith("service:"))siteEditorConfig.content.serviceImages[kind.slice(8)]=url;
      }
      render();toast(files.length>1?"Fotos adicionadas ao rascunho":"Foto adicionada ao rascunho");
    }catch(error){toast(error.message);input.disabled=false;input.value="";}
  }));
  document.querySelectorAll("[data-site-clear-media]").forEach((button)=>button.addEventListener("click",()=>{const kind=button.dataset.siteClearMedia;if(kind==="logo")siteEditorConfig.content.logoUrl="";else if(kind==="hero")siteEditorConfig.content.hero.imageUrl="";else if(kind.startsWith("service:"))delete siteEditorConfig.content.serviceImages[kind.slice(8)];render();}));
  document.querySelectorAll("[data-site-remove-gallery]").forEach((button)=>button.addEventListener("click",()=>{siteEditorConfig.content.gallery.splice(Number(button.dataset.siteRemoveGallery),1);render();}));
  document.querySelectorAll("[data-site-toggle]").forEach((button)=>button.addEventListener("click",()=>{const section=siteEditorConfig.sections.find((item)=>item.id===button.dataset.siteToggle);if(section)section.visible=!section.visible;render();}));
  document.querySelectorAll("[data-site-move]").forEach((button)=>button.addEventListener("click",()=>{const index=siteEditorConfig.sections.findIndex((item)=>item.id===button.dataset.siteMove),target=index+(button.dataset.direction==="up"?-1:1);if(index<0||target<0||target>=siteEditorConfig.sections.length)return;[siteEditorConfig.sections[index],siteEditorConfig.sections[target]]=[siteEditorConfig.sections[target],siteEditorConfig.sections[index]];render();}));
  document.querySelectorAll("[data-site-viewport]").forEach((button)=>button.addEventListener("click",()=>document.querySelector("#site-preview-canvas")?.classList.toggle("mobile",button.dataset.siteViewport==="mobile")));
  const search=document.querySelector("#site-library-search"),results=document.querySelector("#site-search-results");
  search?.addEventListener("input",()=>{results.innerHTML=ChronaSite.search(search.value).map((item)=>`<button class="site-search-result" data-site-result-type="${esc(item.type)}" data-site-result-id="${esc(item.id)}"><b>${esc(item.name)}</b><small>${esc(item.type)}</small></button>`).join("")||`<small class="muted">${search.value.trim()?"Nenhum item encontrado.":"Digite para buscar templates, paletas, fontes e variantes."}</small>`;results.querySelectorAll("[data-site-result-type]").forEach((button)=>button.addEventListener("click",()=>{const type=button.dataset.siteResultType,id=button.dataset.siteResultId;if(type==="template")siteEditorConfig=ChronaSite.preset(id,siteEditorConfig);else if(type==="palette"||type==="fontPair")siteEditorConfig[type]=id;else if(ChronaSite.variants[type])siteEditorConfig.variants[type]=id;render();}));});
  search?.dispatchEvent(new Event("input"));
  document.querySelector("[data-site-save]")?.addEventListener("click",async(event)=>{const button=event.currentTarget;button.disabled=true;button.textContent="Salvando…";try{await persistSiteConfig(false);render();toast("Rascunho salvo. O site publicado não mudou.");}catch(error){toast(error.message);button.disabled=false;button.textContent="Salvar rascunho";}});
  document.querySelector("[data-site-publish]")?.addEventListener("click",async(event)=>{const button=event.currentTarget;button.disabled=true;button.textContent="Publicando…";try{await persistSiteConfig(true);render();toast("Site publicado com sucesso.");}catch(error){toast(error.message);button.disabled=false;button.textContent="Publicar alterações";}});
}
function bind() {
  bindSiteBuilder();
  document.querySelector("#password-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=new FormData(event.currentTarget),password=form.get("password"),confirm=form.get("confirm"),button=event.currentTarget.querySelector("button[type=submit]");if(password!==confirm)return toast("As senhas precisam ser iguais");button.disabled=true;button.textContent="Salvando…";try{const user=await updatePassword(password);const tenant=SHOP_SLUG||user?.user_metadata?.tenant_slug||"";sessionStorage.removeItem("chrona-session");sessionStorage.setItem("chrona-login-email",user?.email||AUTH_CALLBACK.get("email")||"");sessionStorage.setItem("chrona-login-notice",`Agora entre para acessar ${tenant?db.settings.shop:"a Chrona"}.`);const destination=tenant?`${location.pathname}?tenant=${encodeURIComponent(tenant)}#admin`:`${location.pathname}?platform=chrona#admin`;location.replace(destination);}catch(error){toast(error.message);button.disabled=false;button.textContent="Criar senha e continuar";}});
  document.querySelector("#login-form")?.addEventListener("submit",async(event)=>{event.preventDefault();const button=event.currentTarget.querySelector("button[type=submit]");button.disabled=true;button.textContent="Entrando…";try{const form=new FormData(event.currentTarget);sessionStorage.setItem("chrona-login-email",String(form.get("email")||""));await signIn(form.get("email"),form.get("password"));await loadAdminData();loginNotice="";render();toast("Acesso autorizado");}catch(error){toast(error.message);button.disabled=false;button.textContent="Entrar no painel";}});
  document.querySelector("[data-forgot]")?.addEventListener("click",async()=>{const email=document.querySelector('#login-form [name=email]').value.trim();if(!email)return toast("Digite seu e-mail primeiro");try{await requestPasswordReset(email);toast("Se o e-mail estiver cadastrado, o link será enviado");}catch(error){toast(error.message);}});
  document.querySelector("[data-logout]")?.addEventListener("click",()=>{authSession=null;adminLoaded=false;platformSupportMode=false;currentProfile=currentShop=currentSubscription=platformNotificationSettings=null;sessionStorage.removeItem("chrona-session");render();});
  document.querySelector("[data-new-tenant]")?.addEventListener("click",openTenantForm);
  document.querySelectorAll("[data-owner-tenant]").forEach((button)=>button.addEventListener("click",()=>{const tenant=platformTenants.find((item)=>item.shop.id===button.dataset.ownerTenant);if(tenant)openTenantOwnerForm(tenant);}));
  document.querySelectorAll("[data-use-platform]").forEach((button)=>button.addEventListener("click",()=>{location.href=`${location.pathname}?platform=chrona#admin`;}));
  document.querySelector("[data-switch-account]")?.addEventListener("click",()=>{authSession=null;adminLoaded=false;platformSupportMode=false;currentProfile=currentShop=currentSubscription=platformNotificationSettings=null;sessionStorage.removeItem("chrona-session");render();});
  document.querySelectorAll("[data-platform-status]").forEach(x=>x.onclick=async()=>{try{await rest(`subscriptions?barbershop_id=eq.${x.dataset.platformStatus}`,{method:"PATCH",body:{status:x.dataset.nextStatus}});await loadAdminData();render();toast(x.dataset.nextStatus==="suspended"?"Empresa suspensa; dados preservados":"Empresa reativada");}catch(error){toast(error.message);}});
  document.querySelector("[data-focus-admin-alert]")?.addEventListener("click",()=>{const input=document.querySelector('#platform-alert-form [name="adminPhone"]');input?.scrollIntoView({behavior:"smooth",block:"center"});setTimeout(()=>input?.focus(),280);});
  document.querySelector("#platform-alert-form")?.addEventListener("submit",async(event)=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
    const values=Object.fromEntries(new FormData(event.currentTarget).entries());
    const digits=String(values.adminPhone||"").replace(/\D/g,"");
    if(digits.length<10){toast("Informe seu WhatsApp com DDD");button.disabled=false;return;}
    const body={profile_id:currentProfile.id,admin_name:String(values.adminName||"").trim(),admin_phone:String(values.adminPhone||"").trim(),whatsapp_opt_in:values.adminOptIn==="on",default_country_code:platformNotificationSettings?.default_country_code||"55"};
    try{await rest("platform_notification_settings?on_conflict=profile_id",{method:"POST",body,prefer:"resolution=merge-duplicates,return=representation"});await loadAdminData();render();toast("Número administrativo salvo para os alertas da Chrona");}
    catch(error){toast(error.message);button.disabled=false;}
  });
  document.querySelectorAll("[data-book]").forEach(
    (b) =>
      (b.onclick = () => {
        const saved = readBookingProfile();
        booking = {
          step: 0,
          serviceIds: b.dataset.service ? [b.dataset.service] : [],
          professional: "any",
          date: addDays(1),
          time: "",
          name: saved?.name || "",
          phone: saved?.phone || "",
          birth: saved?.birth || "",
          notes: "",
          clientId: saved?.phone ? "local" : "",
          lookupDone: Boolean(saved?.phone && saved?.name),
          adminMode: false,
          optIn: false,
        };
        document.body.insertAdjacentHTML("beforeend", bookingModal());
        bindBooking();
      }),
  );
  document.querySelector("[data-admin]")?.addEventListener("click", () => {
    location.hash = "admin";
  });
  document.querySelector("[data-public]")?.addEventListener("click", () => {
    location.href = PLATFORM_ENTRY ? location.pathname : `${location.pathname}?tenant=${currentShop?.slug||SHOP_SLUG}`;
  });
  document.querySelectorAll("[data-tab]").forEach(
    (x) =>
      (x.onclick = () => {
        adminTab = x.dataset.tab;
        render();
      }),
  );
  document.querySelector("#crm-pipeline")?.addEventListener("change",(event)=>{activePipelineId=event.target.value;render();});
  document.querySelectorAll("[data-add-pipeline]").forEach((button)=>button.addEventListener("click",()=>openCrmForm("pipeline")));
  document.querySelectorAll("[data-edit-pipeline]").forEach((button)=>button.addEventListener("click",()=>openCrmForm("pipeline",button.dataset.editPipeline)));
  document.querySelectorAll("[data-toggle-pipeline]").forEach((button)=>button.addEventListener("click",async()=>{
    const pipeline=crmPipelines.find((item)=>item.id===button.dataset.togglePipeline);
    try{await rest(`crm_pipelines?id=eq.${pipeline.id}`,{method:"PATCH",body:{active:!pipeline.active}});await loadAdminData();render();toast(pipeline.active?"Pipeline arquivado":"Pipeline ativado");}catch(error){toast(error.message);}
  }));
  document.querySelectorAll("[data-delete-pipeline]").forEach((button)=>button.addEventListener("click",()=>confirmAdmin("O pipeline e suas etapas serão excluídos. Se houver oportunidades vinculadas, a exclusão será bloqueada.",()=>rest(`crm_pipelines?id=eq.${button.dataset.deletePipeline}`,{method:"DELETE"}))));
  document.querySelectorAll("[data-add-stage]").forEach((button)=>button.addEventListener("click",()=>openCrmForm("stage")));
  document.querySelectorAll("[data-edit-stage]").forEach((button)=>button.addEventListener("click",()=>openCrmForm("stage",button.dataset.editStage)));
  document.querySelectorAll("[data-delete-stage]").forEach((button)=>button.addEventListener("click",()=>confirmAdmin("A etapa será excluída somente se não possuir oportunidades.",()=>rest(`crm_stages?id=eq.${button.dataset.deleteStage}`,{method:"DELETE"}))));
  document.querySelectorAll("[data-add-opportunity]").forEach((button)=>button.addEventListener("click",()=>{
    if(!db.clients.length) return toast("Cadastre um cliente antes da oportunidade");
    if(!crmStages.some((stage)=>stage.pipeline_id===currentPipeline()?.id)) return toast("Adicione uma etapa primeiro");
    openCrmForm("opportunity","",button.dataset.addOpportunity||"");
  }));
  document.querySelectorAll("[data-edit-opportunity]").forEach((button)=>button.addEventListener("click",()=>openCrmForm("opportunity",button.dataset.editOpportunity)));
  document.querySelectorAll("[data-move-opportunity]").forEach((select)=>select.addEventListener("change",()=>updateOpportunity(select.dataset.moveOpportunity,{stage_id:select.value},"Oportunidade movida")));
  document.querySelectorAll("[data-opportunity-status]").forEach((button)=>button.addEventListener("click",()=>updateOpportunity(button.dataset.opportunityId,{status:button.dataset.opportunityStatus},button.dataset.opportunityStatus==="won"?"Oportunidade ganha":button.dataset.opportunityStatus==="lost"?"Oportunidade perdida":"Oportunidade reaberta")));
  document.querySelectorAll("[data-delete-opportunity]").forEach((button)=>button.addEventListener("click",()=>confirmAdmin("A oportunidade será excluída definitivamente.",()=>rest(`crm_opportunities?id=eq.${button.dataset.deleteOpportunity}`,{method:"DELETE"}))));
  const whatsappConnectForm=document.querySelector("#whatsapp-connect-form");
  whatsappConnectForm?.querySelectorAll("input").forEach((input)=>input.addEventListener("input",()=>{
    whatsappConnectionDraft[input.name]=input.value;
  }));
  whatsappConnectForm?.addEventListener("submit",async(event)=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector("button[type=submit]");
    button.disabled=true;
    const form=new FormData(event.currentTarget);
    try{
      await edge("whatsapp-connection",{barbershopId:currentProfile.barbershop_id,businessAccountId:String(form.get("businessAccountId")||"").trim(),phoneNumberId:String(form.get("phoneNumberId")||"").trim(),accessToken:String(form.get("accessToken")||"").trim()});
      whatsappConnectionDraft={businessAccountId:"",phoneNumberId:"",accessToken:""};
      await loadAdminData();render();toast("WhatsApp oficial conectado com segurança");
    }catch(error){toast(error.message);button.disabled=false;}
  });
  document.querySelector("#notification-owner-form")?.addEventListener("submit",async(event)=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector("button[type=submit]");button.disabled=true;
    const values=Object.fromEntries(new FormData(event.currentTarget).entries());
    const digits=String(values.ownerPhone||"").replace(/\D/g,"");
    if(digits.length<10){toast("Informe o WhatsApp do responsável com DDD");button.disabled=false;return;}
    const body={barbershop_id:currentProfile.barbershop_id,owner_name:String(values.ownerName||"").trim(),owner_phone:String(values.ownerPhone||"").trim(),owner_whatsapp_opt_in:values.ownerOptIn==="on",default_country_code:notificationSettings?.default_country_code||"55",timezone:notificationSettings?.timezone||"America/Sao_Paulo"};
    try{await rest("tenant_notification_settings?on_conflict=barbershop_id",{method:"POST",body,prefer:"resolution=merge-duplicates,return=representation"});await loadAdminData();render();toast("Responsável salvo para os lembretes");}
    catch(error){toast(error.message);button.disabled=false;}
  });
  document.querySelector("[data-add-personal]")?.addEventListener("click",()=>openPersonalReminderForm());
  document.querySelectorAll("[data-edit-personal]").forEach((button)=>button.addEventListener("click",()=>openPersonalReminderForm(button.dataset.editPersonal)));
  document.querySelectorAll("[data-toggle-personal]").forEach((button)=>button.addEventListener("click",async()=>{
    const item=personalReminders.find((candidate)=>candidate.id===button.dataset.togglePersonal);
    if(!item)return;
    const nextRunAt=!item.active&&new Date(item.next_run_at)<new Date()?new Date().toISOString():item.next_run_at;
    try{await rest(`personal_reminders?id=eq.${item.id}`,{method:"PATCH",body:{active:!item.active,next_run_at:nextRunAt,updated_at:new Date().toISOString()}});await loadAdminData();render();toast(item.active?"Lembrete pausado":"Lembrete ativado");}
    catch(error){toast(error.message);}
  }));
  document.querySelectorAll("[data-delete-personal]").forEach((button)=>button.addEventListener("click",()=>confirmAdmin("O lembrete pessoal será excluído definitivamente.",()=>rest(`personal_reminders?id=eq.${button.dataset.deletePersonal}`,{method:"DELETE"}))));
  document.querySelectorAll("[data-confirm-appt]").forEach(x=>x.onclick=async()=>{try{await rest(`appointments?id=eq.${x.dataset.confirmAppt}`,{method:"PATCH",body:{status:"confirmed",updated_at:new Date().toISOString()}});await loadAdminData();render();toast("Agendamento confirmado");}catch(error){toast(error.message);}});
  document.querySelectorAll("[data-complete-appt]").forEach(x=>x.onclick=()=>openPaymentForm(db.appointments.find(a=>a.id===x.dataset.completeAppt)));
  document.querySelectorAll("[data-noshow-appt]").forEach(x=>x.onclick=()=>confirmAdmin("O agendamento será marcado como falta e o horário será encerrado.",()=>rest(`appointments?id=eq.${x.dataset.noshowAppt}`,{method:"PATCH",body:{status:"no_show",updated_at:new Date().toISOString()}})));
  document.querySelector("#agenda-date")?.addEventListener("change", (e) => {
    agendaDate = e.target.value;
    render();
  });
  document.querySelector("[data-add-appt]")?.addEventListener("click", () => {
    booking = {
      step: 0,
      serviceIds: [],
      professional: "any",
      date: agendaDate,
      time: "",
      name: "",
      phone: "",
      birth: "",
      notes: "",
      clientId: "",
      lookupDone: false,
      adminMode: true,
      optIn: false,
    };
    document.body.insertAdjacentHTML("beforeend", bookingModal());
    bindBooking();
  });
  document.querySelectorAll("[data-delete-appt]").forEach(x=>x.addEventListener("click",()=>confirmAdmin("O horário será liberado e o agendamento ficará como cancelado.",()=>rest(`appointments?id=eq.${x.dataset.deleteAppt}`,{method:"PATCH",body:{status:"cancelled",updated_at:new Date().toISOString()}}))));
  document
    .querySelectorAll("[data-whatsapp]")
    .forEach(
      (x) =>
        (x.onclick = () =>
          open(`https://wa.me/55${x.dataset.whatsapp}`, "_blank")),
    );
  document.querySelectorAll("[data-toggle-service]").forEach(
    (x) =>
      (x.onclick = async () => {
        let s = service(x.dataset.toggleService);
        try{await rest(`services?id=eq.${s.id}`,{method:"PATCH",body:{active:!s.active,updated_at:new Date().toISOString()}});await loadAdminData();render();toast("Serviço atualizado");}catch(error){toast(error.message);}
      }),
  );
  document.querySelectorAll("[data-cash-tab]").forEach((x) =>
    x.addEventListener("click", () => {
      cashTab = x.dataset.cashTab;
      render();
    }),
  );
  document
    .querySelector("[data-add-cash]")
    ?.addEventListener("click", () => openAdminForm("cash"));
  document
    .querySelector("[data-add-client]")
    ?.addEventListener("click", () => openAdminForm("client"));
  document.querySelectorAll("[data-edit-client]").forEach((x) =>
    x.addEventListener("click", () => {
      openAdminForm("client", x.dataset.editClient);
    }),
  );
  document.querySelectorAll("[data-delete-client]").forEach((x) =>
    x.addEventListener("click", () => {
      confirmAdmin("O cadastro será removido somente se não possuir histórico de atendimentos.", () => rest(`clients?id=eq.${x.dataset.deleteClient}`,{method:"DELETE"}));
    }),
  );
  document
    .querySelector("[data-add-service]")
    ?.addEventListener("click", () => openAdminForm("service"));
  document.querySelectorAll("[data-edit-service]").forEach((x) =>
    x.addEventListener("click", () => {
      openAdminForm("service", x.dataset.editService);
    }),
  );
  document.querySelectorAll("[data-delete-service]").forEach((x) =>
    x.addEventListener("click", () => {
      confirmAdmin("O serviço será desativado e deixará de aparecer no catálogo.", () => rest(`services?id=eq.${x.dataset.deleteService}`,{method:"PATCH",body:{active:false,updated_at:new Date().toISOString()}}));
    }),
  );
  document.querySelector("[data-add-professional]")?.addEventListener("click",()=>openAdminForm("professional"));
  document.querySelectorAll("[data-edit-professional]").forEach(x=>x.addEventListener("click",()=>openAdminForm("professional",x.dataset.editProfessional)));
  document.querySelectorAll("[data-toggle-professional]").forEach(x=>x.addEventListener("click",async()=>{const p=PEOPLE.find(p=>p.id===x.dataset.toggleProfessional);try{await rest(`professionals?id=eq.${p.id}`,{method:"PATCH",body:{active:!p.active}});await loadAdminData();render();toast("Profissional atualizado");}catch(error){toast(error.message);}}));
  document.querySelectorAll("[data-delete-cash]").forEach((x) =>
    x.addEventListener("click", () => {
      confirmAdmin(
        "A movimentação será removida e o saldo recalculado.",
        () => rest(`cash_transactions?id=eq.${x.dataset.deleteCash}&appointment_id=is.null`,{method:"DELETE"}),
      );
    }),
  );
  document
    .querySelector("[data-add-category]")
    ?.addEventListener("click", async () => {
      const name = prompt("Nome da nova categoria:");
      if (name && !db.categories.includes(name)) {
        try{await rest("cash_categories",{method:"POST",body:{barbershop_id:currentProfile.barbershop_id,name:name.trim()}});await loadAdminData();render();toast("Categoria salva");}catch(error){toast(error.message);}
      }
    });
  document.querySelectorAll("[data-delete-category]").forEach((x) =>
    x.addEventListener("click", async () => {
      if (db.cash.some((m) => m.category === x.dataset.deleteCategory))
        return toast("Categoria em uso; altere as movimentações primeiro");
      try{await rest(`cash_categories?barbershop_id=eq.${currentProfile.barbershop_id}&name=eq.${encodeURIComponent(x.dataset.deleteCategory)}`,{method:"DELETE"});await loadAdminData();render();toast("Categoria removida");}catch(error){toast(error.message);}
    }),
  );
  document
    .querySelector("[data-save-settings]")
    ?.addEventListener("click", async () => {
      const button=document.querySelector("[data-save-settings]");button.disabled=true;
      const primaryColor=document.querySelector("#set-primary-color").value.toLowerCase(),secondaryColor=document.querySelector("#set-secondary-color").value.toLowerCase();
      const data={name:document.querySelector("#set-shop").value.trim(),phone:document.querySelector("#set-phone").value.replace(/\D/g,""),instagram:document.querySelector("#set-instagram").value.trim()||null,logo_url:document.querySelector("#set-logo").value.trim()||null,address:document.querySelector("#set-address").value.trim(),public_description:document.querySelector("#set-description").value.trim(),primary_color:primaryColor,secondary_color:secondaryColor,visual_direction:inferVisualDirection(primaryColor,secondaryColor,currentShop.business_type),opening_time:document.querySelector("#set-open").value,closing_time:document.querySelector("#set-close").value,break_start:document.querySelector("#set-break-start").value||null,break_end:document.querySelector("#set-break-end").value||null,whatsapp_message:document.querySelector("#set-greeting").value.trim(),updated_at:new Date().toISOString()};
      try{await rest(`barbershops?id=eq.${currentShop.id}`,{method:"PATCH",body:data});const hours=Array.from({length:7},(_,weekday)=>({barbershop_id:currentShop.id,weekday,is_open:weekday>0,opening_time:weekday>0?data.opening_time:null,closing_time:weekday>0?data.closing_time:null,break_start:weekday>0?data.break_start:null,break_end:weekday>0?data.break_end:null}));await rest("business_hours?on_conflict=barbershop_id,weekday",{method:"POST",body:hours,prefer:"resolution=merge-duplicates,return=minimal"});await loadAdminData();render();toast("Configurações salvas no sistema");}catch(error){toast(error.message);button.disabled=false;}
    });
  document.querySelector("#search")?.addEventListener("input", (e) => {
    document
      .querySelectorAll("#client-list .list-card")
      .forEach(
        (x) =>
          (x.style.display = x.innerText
            .toLowerCase()
            .includes(e.target.value.toLowerCase())
            ? ""
            : "none"),
      );
  });
  document.querySelector("[data-quick]")?.addEventListener("click", () => {
    const targets = {
      agenda: "[data-add-appt]",
      clientes: "[data-add-client]",
      caixa: "[data-add-cash]",
      servicos: "[data-add-service]",
      profissionais: "[data-add-professional]",
      crm: "[data-add-opportunity]",
      automacoes: "[data-add-personal]",
    };
    if (targets[adminTab]) document.querySelector(targets[adminTab])?.click();
    else if (adminTab === "dashboard") {
      adminTab = "agenda";
      render();
      document.querySelector("[data-add-appt]")?.click();
    } else
      toast(
        adminTab === "config"
          ? "Edite os campos e clique em Salvar"
          : "Use os botões de WhatsApp ao lado de cada lembrete",
      );
  });
}
function bindBooking() {
  let modal = document.querySelector("#booking-modal");
  modal.querySelector("[data-close]").onclick = () => modal.remove();
  modal.querySelector("#book-phone")?.addEventListener("input", (event) => {
    const phone = event.target.value.replace(/\D/g, "");
    if (phone !== booking.phone) { booking.lookupDone=false; booking.clientId=""; }
  });
  modal.querySelector("[data-find-client]")?.addEventListener("click", async () => {
    const phone = modal.querySelector("#book-phone").value.replace(/\D/g, "");
    if (phone.length < 10) return toast("Digite um WhatsApp válido");
    const localFound = db.clients.find((c) => c.phone.replace(/\D/g, "") === phone);
    let found = localFound;
    if (!found && !booking.adminMode) {
      try {
        const result = await rpc("get_returning_client", { shop_slug:SHOP_SLUG, client_phone:phone });
        if (result?.found) found = { id:"returning", name:result.name, phone };
      } catch (error) { return toast(error.message); }
    }
    booking.phone = phone;
    booking.lookupDone = true;
    booking.clientId = found?.id || "";
    booking.name = found?.name || "";
    booking.birth = found?.birth || "";
    booking.notes = modal.querySelector("#book-notes")?.value || "";
    refreshModal();
    toast(
      found ? "Cadastro encontrado" : "Primeiro acesso: complete seu cadastro",
    );
  });
  modal.querySelector("[data-use-client]")?.addEventListener("click", () => {
    const id = modal.querySelector("#admin-client").value;
    const found = db.clients.find((c) => c.id === id);
    if (!found) return toast("Selecione um cliente cadastrado");
    booking.clientId = found.id;
    booking.lookupDone = true;
    booking.name = found.name;
    booking.phone = found.phone.replace(/\D/g, "");
    booking.birth = found.birth || "";
    refreshModal();
    toast("Cliente selecionado");
  });
  modal.querySelectorAll("[data-select-service]").forEach(
    (x) =>
      (x.onclick = () => {
        slotsLoaded = false;
        booking.serviceIds = booking.serviceIds.includes(
          x.dataset.selectService,
        )
          ? booking.serviceIds.filter((i) => i !== x.dataset.selectService)
          : [...booking.serviceIds, x.dataset.selectService];
        refreshModal();
      }),
  );
  modal.querySelectorAll("[data-prof]").forEach(
    (x) =>
      (x.onclick = () => {
        slotsLoaded = false;
        booking.professional = x.dataset.prof;
        refreshModal();
      }),
  );
  modal.querySelectorAll("[data-time]").forEach(
    (x) =>
      (x.onclick = () => {
        booking.time = x.dataset.time;
        refreshModal();
      }),
  );
  modal.querySelector("#book-date")?.addEventListener("change", async (e) => {
    if (e.target.value < today()) {
      booking.date = today();
      booking.time = "";
      refreshModal();
      return toast("Escolha hoje ou uma data futura");
    }
    booking.date = e.target.value;
    booking.time = "";
    await loadAvailableSlots().catch((error) => toast(error.message));
    refreshModal();
  });
  modal.querySelector("[data-prev]")?.addEventListener("click", () => {
    booking.step--;
    refreshModal();
  });
  modal.querySelector("[data-next]")?.addEventListener("click", async () => {
    if (booking.step === 0) {
      booking.phone = modal
        .querySelector("#book-phone")
        .value.replace(/\D/g, "");
      if (!booking.lookupDone)
        return toast("Busque o cadastro pelo WhatsApp primeiro");
      booking.name =
        modal.querySelector("#book-name")?.value.trim() || booking.name;
      booking.phone = modal
        .querySelector("#book-phone")
        .value.replace(/\D/g, "");
      booking.birth =
        modal.querySelector("#book-birth")?.value || booking.birth;
      booking.notes = modal.querySelector("#book-notes").value;
      booking.optIn = modal.querySelector("#book-optin")?.checked || false;
      if (!booking.name || booking.phone.length < 10)
        return toast("Preencha seu nome e WhatsApp");
    }
    if (booking.step === 1 && !booking.serviceIds.length)
      return toast("Selecione ao menos um serviço");
    if (booking.step === 2) {
      try { await loadAvailableSlots(); }
      catch (error) { return toast(error.message); }
    }
    if (booking.step === 3 && (!booking.time || isPastSlot(booking.date,booking.time))) return toast("Escolha um horário futuro");
    if (booking.step === 3) {
      const prof = booking.professional === "any" ? slotProfessionals[booking.time] : booking.professional;
      try {
        await rpc("create_public_appointment", { shop_slug:SHOP_SLUG, client_name:booking.name, client_phone:booking.phone, client_birth:booking.birth || null, opt_in:booking.optIn, professional:prof, service_ids:booking.serviceIds, appt_date:booking.date, appt_start:booking.time, appt_notes:booking.notes || null });
        saveBookingProfile();
        if(booking.adminMode) await loadAdminData();
      } catch (error) {
        await loadAvailableSlots().catch(() => {});
        refreshModal();
        return toast(error.message);
      }
    }
    booking.step++;
    refreshModal();
  });
}
function refreshModal() {
  document.querySelector("#booking-modal").outerHTML = bookingModal();
  bindBooking();
}
window.addEventListener("hashchange", render);
app.innerHTML = `<main class="section"><div class="container empty"><h2>Carregando…</h2><p>Preparando o ambiente Chrona.</p></div></main>`;
((PLATFORM_ENTRY||CHRONA_HOME)?Promise.resolve():loadPublicData()).then(async()=>{if(PLATFORM_ENTRY) location.hash="admin";if(authSession&&location.hash==="#admin"){try{await loadAdminData();render();}catch(error){authSession=null;sessionStorage.removeItem("chrona-session");render();toast(error.message);}}else render();});
