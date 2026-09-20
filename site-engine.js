(function () {
  "use strict";

  const palettes = {
    "black-gold": { name:"Black Gold", tags:["dourado","ouro","gold","preto","luxo","premium","elegante"], tokens:{ background:"#090908",surface:"#14120f",primary:"#c99a4f",secondary:"#f3ead9",accent:"#e1bd7a",text:"#f3ead9",muted:"#b7ad9d",border:"#3a3022" } },
    "ivory-gold": { name:"Ivory Gold", tags:["dourado","ouro","gold","marfim","claro","luxo","elegante"], tokens:{ background:"#f4efe5",surface:"#fffdf8",primary:"#9b7133",secondary:"#211b14",accent:"#c79d57",text:"#211b14",muted:"#746b60",border:"#d9cbb5" } },
    "emerald-cream": { name:"Emerald Cream", tags:["verde","esmeralda","cream","creme","natureza","premium"], tokens:{ background:"#f2f0e7",surface:"#fffdf7",primary:"#1f5b49",secondary:"#18352c",accent:"#b68a48",text:"#18352c",muted:"#64736d",border:"#cbd6ce" } },
    "graphite-blue": { name:"Graphite Blue", tags:["grafite","azul","blue","moderno","tecnologia","contemporâneo"], tokens:{ background:"#10151d",surface:"#18212c",primary:"#5c8df6",secondary:"#eef4ff",accent:"#86a9fa",text:"#eef4ff",muted:"#9caabd",border:"#2d3a4a" } },
    "black-white": { name:"Black White", tags:["preto","branco","minimalista","contraste","clean"], tokens:{ background:"#0c0c0c",surface:"#171717",primary:"#f5f5f2",secondary:"#ffffff",accent:"#c8c8c3",text:"#f5f5f2",muted:"#a3a3a0",border:"#333331" } },
    "warm-brown": { name:"Warm Brown", tags:["marrom","quente","barbearia","clássico","tradicional"], tokens:{ background:"#efe6d8",surface:"#faf5ed",primary:"#774b2c",secondary:"#2e2017",accent:"#aa764a",text:"#2e2017",muted:"#77695e",border:"#d4c0aa" } },
    forest: { name:"Forest", tags:["verde","floresta","forest","natural","sóbrio"], tokens:{ background:"#10211b",surface:"#183028",primary:"#94b88c",secondary:"#eef3e8",accent:"#c2a56c",text:"#eef3e8",muted:"#a8b8ae",border:"#345044" } },
    "minimal-white": { name:"Minimal White", tags:["branco","white","clean","minimalista","claro","profissional"], tokens:{ background:"#f7f7f5",surface:"#ffffff",primary:"#171717",secondary:"#282828",accent:"#737373",text:"#171717",muted:"#71716c",border:"#deded9" } },
    "blush-ink": { name:"Blush Ink", tags:["beleza","rosa","blush","editorial","feminino"], tokens:{ background:"#f8efed",surface:"#fffaf8",primary:"#a74f61",secondary:"#39262b",accent:"#d6969e",text:"#39262b",muted:"#826d72",border:"#e6ced0" } },
    "pearl-mauve": { name:"Pearl Mauve", tags:["lash","pérola","malva","delicado","feminino"], tokens:{ background:"#fbf8f6",surface:"#ffffff",primary:"#8b6174",secondary:"#342932",accent:"#c8a2ae",text:"#342932",muted:"#7b7076",border:"#eadfe2" } },
    "sage-spa": { name:"Sage Spa", tags:["estética","spa","sálvia","orgânico","natural"], tokens:{ background:"#f3f1e9",surface:"#fbfaf5",primary:"#66765e",secondary:"#283127",accent:"#b89872",text:"#283127",muted:"#73796f",border:"#d9dccf" } },
    "wine-champagne": { name:"Wine Champagne", tags:["beleza","vinho","champagne","couture","luxo"], tokens:{ background:"#24191d",surface:"#332329",primary:"#d6b176",secondary:"#fff5eb",accent:"#e4cda9",text:"#fff5eb",muted:"#cbbab9",border:"#5b4148" } },
    "powder-lilac": { name:"Powder Lilac", tags:["lash","lilás","suave","studio","delicado"], tokens:{ background:"#f5f1f7",surface:"#fffefe",primary:"#78617f",secondary:"#2f2833",accent:"#bca5c3",text:"#2f2833",muted:"#786f7b",border:"#e2d9e5" } },
  };

  const fonts = {
    "editorial-premium": { name:"Editorial Premium", tags:["elegante","editorial","luxo","serif","premium"], heading:'"Cormorant Garamond",serif', body:'"DM Sans",sans-serif', headingWeight:600, tracking:"-.025em" },
    "modern-sans": { name:"Modern Sans", tags:["moderna","sans","contemporânea","forte"], heading:'"DM Sans",sans-serif', body:'"Nunito Sans",sans-serif', headingWeight:700, tracking:"-.045em" },
    "classic-barber": { name:"Classic Barber", tags:["barbearia","clássica","tradicional","sofisticada"], heading:'"Playfair Display",serif', body:'"DM Sans",sans-serif', headingWeight:700, tracking:"-.02em" },
    "luxury-serif": { name:"Luxury Serif", tags:["luxo","serif","refinada","elegante"], heading:'"Playfair Display",serif', body:'"Nunito Sans",sans-serif', headingWeight:600, tracking:"-.025em" },
    "clean-professional": { name:"Clean Professional", tags:["clean","profissional","legível","minimalista"], heading:'"DM Sans",sans-serif', body:'"DM Sans",sans-serif', headingWeight:700, tracking:"-.035em" },
    "bodoni-soft": { name:"Bodoni Soft", tags:["beleza","editorial","sofisticada","contraste"], heading:'"Bodoni Moda",serif', body:'"Manrope",sans-serif', headingWeight:600, tracking:"-.035em" },
    "italiana-air": { name:"Italiana Air", tags:["lash","delicada","leve","luxo"], heading:'"Italiana",serif', body:'"Montserrat",sans-serif', headingWeight:400, tracking:"-.015em" },
    "fraunces-organic": { name:"Fraunces Organic", tags:["spa","orgânica","acolhedora","estética"], heading:'"Fraunces",serif', body:'"Work Sans",sans-serif', headingWeight:600, tracking:"-.025em" },
    "prata-couture": { name:"Prata Couture", tags:["couture","luxo","beleza","editorial"], heading:'"Prata",serif', body:'"Montserrat",sans-serif', headingWeight:400, tracking:"-.02em" },
    "tenor-studio": { name:"Tenor Studio", tags:["minimalista","delicada","studio","contemporânea"], heading:'"Tenor Sans",sans-serif', body:'"Manrope",sans-serif', headingWeight:400, tracking:"-.02em" },
    "lora-warm": { name:"Lora Warm", tags:["acolhedora","beleza","serif","humana"], heading:'"Lora",serif', body:'"Nunito Sans",sans-serif', headingWeight:600, tracking:"-.025em" },
    "marcellus-refined": { name:"Marcellus Refined", tags:["clássica","refinada","estética","elegante"], heading:'"Marcellus",serif', body:'"Karla",sans-serif', headingWeight:400, tracking:"-.015em" },
  };

  const templates = {
    luxury: { name:"Luxury", tags:["luxo","premium","dourado","elegante","barbearia"], palette:"black-gold", fontPair:"editorial-premium", variants:{ hero:"split",button:"classic",card:"luxury",services:"premium",professionals:"premium",header:"classic",footer:"classic" } },
    clean: { name:"Clean", tags:["clean","branco","minimalista","leve"], palette:"minimal-white", fontPair:"clean-professional", variants:{ hero:"centered",button:"outline",card:"minimal",services:"list",professionals:"minimal",header:"minimal",footer:"minimal" } },
    modern: { name:"Modern", tags:["moderno","grafite","azul","contemporâneo"], palette:"graphite-blue", fontPair:"modern-sans", variants:{ hero:"full-image",button:"pill",card:"elevated",services:"grid",professionals:"grid",header:"modern",footer:"modern" } },
    classic: { name:"Classic", tags:["clássico","tradicional","sofisticado","barbearia"], palette:"warm-brown", fontPair:"classic-barber", variants:{ hero:"minimal",button:"classic",card:"border",services:"cards",professionals:"horizontal",header:"classic",footer:"classic" } },
    "blush-editorial": { name:"Blush Editorial", tags:["beleza","estética","rosa","editorial","feminino"], palette:"blush-ink", fontPair:"bodoni-soft", variants:{ hero:"split",button:"classic",card:"border",services:"image-cards",professionals:"horizontal",header:"classic",footer:"minimal" } },
    "pearl-lash": { name:"Pearl Lash", tags:["lash","cílios","pérola","delicado","feminino"], palette:"pearl-mauve", fontPair:"italiana-air", variants:{ hero:"centered-image",button:"pill",card:"minimal",services:"premium",professionals:"minimal",header:"minimal",footer:"minimal" } },
    "botanical-spa": { name:"Botanical Spa", tags:["estética","spa","natural","orgânico","feminino"], palette:"sage-spa", fontPair:"fraunces-organic", variants:{ hero:"split",button:"outline",card:"elevated",services:"cards",professionals:"grid",header:"minimal",footer:"minimal" } },
    "couture-beauty": { name:"Couture Beauty", tags:["beleza","luxo","editorial","vinho","feminino"], palette:"wine-champagne", fontPair:"prata-couture", variants:{ hero:"luxury",button:"luxury",card:"luxury",services:"premium",professionals:"premium",header:"classic",footer:"classic" } },
    "soft-studio": { name:"Soft Studio", tags:["beleza","lash","lilás","leve","delicado"], palette:"powder-lilac", fontPair:"tenor-studio", variants:{ hero:"minimal",button:"pill",card:"minimal",services:"list",professionals:"horizontal",header:"modern",footer:"minimal" } },
  };

  const variants = {
    hero:["centered","centered-image","split","full-image","minimal","luxury"],
    button:["solid","outline","pill","classic","luxury"],
    card:["minimal","border","elevated","luxury"],
    services:["grid","list","cards","premium","image-cards"],
    professionals:["grid","horizontal","minimal","premium"],
  };
  const variantNames = { centered:"Centralizado","centered-image":"Central com foto",split:"Split","full-image":"Full Image",minimal:"Minimal",luxury:"Luxury",solid:"Solid",outline:"Outline",pill:"Pill",classic:"Classic",border:"Border",elevated:"Elevated",grid:"Grid",list:"Lista",cards:"Cards",premium:"Premium Cards","image-cards":"Image Cards",horizontal:"Horizontal" };
  const defaultSections = ["header","hero","services","about","differentials","professionals","gallery","testimonials","location","hours","final-cta","footer"].map((id) => ({ id, visible:id!=="testimonials" }));
  const sectionNames = { header:"Header",hero:"Hero",services:"Serviços",about:"Sobre",differentials:"Diferenciais",professionals:"Profissionais",gallery:"Galeria",testimonials:"Depoimentos",location:"Localização",hours:"Horários","final-cta":"CTA final",footer:"Footer" };
  const defaultContent = {
    logoUrl:"",hero:{ eyebrow:"Agendamento online",title:"",subtitle:"",ctaLabel:"Agendar horário",imageUrl:"" },
    about:{ eyebrow:"Nossa essência",title:"Atendimento com identidade",body:"Uma experiência cuidada em cada detalhe, do agendamento ao resultado." },
    differentials:["Atendimento com hora marcada","Profissionais especializados","Experiência pensada para você"],
    serviceImages:{},gallery:[], testimonials:[],
    finalCta:{ eyebrow:"Seu próximo horário",title:"Pronto para se cuidar?",body:"Escolha o serviço e reserve seu melhor horário.",label:"Agendar agora" },
    whatsappMessage:"Olá! Vim pelo site e gostaria de mais informações.",
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[char]);
  const safeUrl = (value) => { const url=String(value||"").trim(); return (/^(https?:\/\/|\/|\.\/)[^\s]+$/i.test(url)||/^[a-z0-9][a-z0-9._/-]*$/i.test(url))?escape(url):""; };
  const choice = (value, allowed, fallback) => allowed.includes(value)?value:fallback;
  const mergeContent = (content={}) => ({ ...clone(defaultContent),...content,hero:{...defaultContent.hero,...content.hero},about:{...defaultContent.about,...content.about},serviceImages:{...defaultContent.serviceImages,...content.serviceImages},finalCta:{...defaultContent.finalCta,...content.finalCta} });
  function preset(id="clean", current={}) {
    const template=templates[id]||templates.clean;
    return normalize({ ...current,template:id,palette:template.palette,fontPair:template.fontPair,variants:{...template.variants},sections:current.sections||clone(defaultSections),content:mergeContent(current.content) });
  }
  function normalize(input={}) {
    const template=templates[input.template]?input.template:"clean";
    const base=templates[template];
    const incoming=input.variants||{};
    const sections=Array.isArray(input.sections)?input.sections:clone(defaultSections);
    const unique=[];
    sections.forEach((item)=>{ if(sectionNames[item?.id]&&!unique.some((x)=>x.id===item.id)) unique.push({id:item.id,visible:item.visible!==false}); });
    defaultSections.forEach((item)=>{ if(!unique.some((x)=>x.id===item.id)) unique.push(clone(item)); });
    return {
      version:1,template,
      palette:palettes[input.palette]?input.palette:base.palette,
      fontPair:fonts[input.fontPair]?input.fontPair:base.fontPair,
      variants:{
        hero:choice(incoming.hero,variants.hero,base.variants.hero),button:choice(incoming.button,variants.button,base.variants.button),
        card:choice(incoming.card,variants.card,base.variants.card),services:choice(incoming.services,variants.services,base.variants.services),
        professionals:choice(incoming.professionals,variants.professionals,base.variants.professionals),header:incoming.header||base.variants.header,footer:incoming.footer||base.variants.footer,
      },sections:unique,content:mergeContent(input.content),
    };
  }
  function tokens(config) {
    const palette=palettes[config.palette]||palettes[templates[config.template].palette];
    const font=fonts[config.fontPair]||fonts[templates[config.template].fontPair];
    const soft=["modern","pearl-lash","botanical-spa","soft-studio"].includes(config.template);
    const radius=soft?"24px":config.template==="clean"?"4px":config.template==="blush-editorial"?"14px":"0px";
    const shadow=soft?"0 22px 70px rgba(63,42,55,.12)":config.template==="clean"?"0 12px 34px rgba(0,0,0,.07)":"0 24px 70px rgba(0,0,0,.32)";
    return `${Object.entries(palette.tokens).map(([key,value])=>`--site-${key}:${value}`).join(";")};--site-font-heading:${font.heading};--site-font-body:${font.body};--site-heading-weight:${font.headingWeight};--site-heading-tracking:${font.tracking};--site-radius:${radius};--site-shadow:${shadow}`;
  }
  function theme(config={}) {
    const normalized=normalize(config),palette=palettes[normalized.palette],font=fonts[normalized.fontPair];
    return {template:normalized.template,palette:clone(palette.tokens),font:clone(font)};
  }
  const money = (value) => Number(value||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  function renderSection(id, ctx) {
    const {shop,services,professionals,config,preview}=ctx, c=config.content, v=config.variants,canBook=services.length>0&&professionals.length>0;
    const book=(label,extra="")=>`<button class="site-button site-button-${v.button}" ${preview?"data-preview-book":"data-book"} ${preview?"":extra} ${canBook?"":"disabled"}>${escape(label)}</button>`;
    const logoUrl=safeUrl(c.logoUrl||shop.logo),logo=logoUrl?`<img class="site-logo" src="${logoUrl}" alt="Logo ${escape(shop.name)}">`:`<span class="site-logo site-monogram">${escape(String(shop.name||"C").slice(0,1))}</span>`;
    const instagram=String(shop.instagram||"").replace(/^@/,"");
    const social=instagram?`<a class="site-link-button" target="_blank" rel="noopener" href="https://www.instagram.com/${encodeURIComponent(instagram)}/">${escape(shop.instagram)}</a>`:"";
    const phone=String(shop.phone||"").replace(/\D/g,"");
    const whatsapp=`https://wa.me/${phone}?text=${encodeURIComponent(c.whatsappMessage||defaultContent.whatsappMessage)}`;
    if(id==="header") return `<header class="site-header"><div class="site-container site-header-inner"><div class="site-brand">${logo}<span><b>${escape(shop.name)}</b><small>AGENDA POR CHRONA</small></span></div><nav>${social}<a class="site-link-button" target="_blank" rel="noopener" href="${whatsapp}">WhatsApp</a>${book(c.hero.ctaLabel)}</nav></div></header>`;
    if(id==="hero") { const image=safeUrl(c.hero.imageUrl),backgroundHero=["centered-image","full-image"].includes(v.hero); return `<section class="site-hero site-hero-${v.hero} ${image?"has-site-hero-image":""}" ${backgroundHero&&image?`style="--site-hero-image:url('${image}')"`:""}><div class="site-container site-hero-inner"><div class="site-hero-copy"><span class="site-kicker">${escape(c.hero.eyebrow)}</span><h1>${escape(c.hero.title||shop.name)}</h1><p>${escape(c.hero.subtitle||shop.description)}</p><div class="site-actions">${book(c.hero.ctaLabel)}${social}<a class="site-link-button" target="_blank" rel="noopener" href="${whatsapp}">Falar no WhatsApp</a></div></div>${image&&v.hero!=="centered-image"?`<figure class="site-hero-media"><img src="${image}" alt="${escape(shop.name)}"></figure>`:""}</div></section>`; }
    if(id==="services") { const cards=services.map((service)=>{const image=safeUrl(c.serviceImages?.[service.id]);return `<article class="site-card site-card-${v.card} ${image?"has-site-service-image":""}">${image?`<img class="site-service-image" src="${image}" alt="${escape(service.name)}" loading="lazy">`:""}<div class="site-card-body"><div class="site-card-meta"><span>${escape(service.duration)} MIN</span><b>${money(service.price)}</b></div><h3>${escape(service.name)}</h3><p>${escape(service.desc||"Atendimento personalizado.")}</p>${book("Agendar este serviço",`data-service="${escape(service.id)}"`)}</div></article>`;}).join(""); return `<section class="site-section site-services site-services-${v.services}" id="servicos"><div class="site-container"><div class="site-heading"><span class="site-kicker">Serviços</span><h2>Escolha o seu atendimento</h2><p>Valores e disponibilidade atualizados pela equipe.</p></div><div class="site-service-list">${cards||'<div class="site-empty">Serviços em preparação.</div>'}</div></div></section>`; }
    if(id==="about") return `<section class="site-section site-about"><div class="site-container site-two-column"><span class="site-kicker">${escape(c.about.eyebrow)}</span><div><h2>${escape(c.about.title)}</h2><p>${escape(c.about.body)}</p></div></div></section>`;
    if(id==="differentials") return `<section class="site-section site-differentials"><div class="site-container"><div class="site-feature-grid">${(c.differentials||[]).slice(0,6).map((item,index)=>`<article><span>0${index+1}</span><h3>${escape(item)}</h3></article>`).join("")}</div></div></section>`;
    if(id==="professionals") return `<section class="site-section site-professionals site-professionals-${v.professionals}"><div class="site-container"><div class="site-heading"><span class="site-kicker">Equipe</span><h2>Profissionais</h2><p>Escolha quem combina com o seu momento.</p></div><div class="site-professional-list">${professionals.map((person,index)=>`<article class="site-professional"><span>${String(index+1).padStart(2,"0")}</span><h3>${escape(person.name)}</h3><small>Profissional</small>${book("Agendar",`data-prof="${escape(person.id)}"`)}</article>`).join("")||'<div class="site-empty">Equipe em preparação.</div>'}</div></div></section>`;
    if(id==="gallery") { const photos=(c.gallery||[]).map((item)=>safeUrl(typeof item==="string"?item:item?.url)).filter(Boolean);if(!photos.length)return "";const carouselPhotos=photos.length>1?[...photos,photos[0]]:photos;return `<section class="site-section site-gallery"><div class="site-container site-gallery-layout"><div class="site-gallery-copy"><span class="site-kicker">Feito por aqui</span><h2>Trabalhos recentes</h2><p>Clientes recentes, serviços disponíveis e resultados já realizados pela equipe.</p><div class="site-gallery-tags"><span>Clientes recentes</span><span>Serviços disponíveis</span><span>Trabalhos concluídos</span></div></div><div class="site-gallery-stage" data-site-rotator>${photos.map((url,index)=>`<img class="${index===0?"active":""}" src="${url}" alt="Trabalho recente ${index+1}" loading="lazy">`).join("")}<span class="site-gallery-count">01 / ${String(photos.length).padStart(2,"0")}</span></div></div><div class="site-container site-gallery-carousel" data-site-carousel data-photo-count="${photos.length}" aria-label="Galeria de trabalhos recentes">${carouselPhotos.map((url,index)=>`<figure ${index===photos.length?`aria-hidden="true" data-gallery-clone`:""}><img src="${url}" alt="${index===photos.length?"":`Trabalho realizado ${index+1}`}" loading="lazy"></figure>`).join("")}</div></section>`; }
    if(id==="testimonials") return `<section class="site-section site-testimonials"><div class="site-container"><div class="site-heading"><span class="site-kicker">Experiências</span><h2>O que dizem os clientes</h2></div><div class="site-testimonial-grid">${(c.testimonials||[]).map((item)=>`<blockquote><p>“${escape(item.quote)}”</p><cite>${escape(item.author)}</cite></blockquote>`).join("")}</div></div></section>`;
    if(id==="location") return `<section class="site-section site-location"><div class="site-container site-location-card"><div><span class="site-kicker">Onde encontrar</span><h2>${escape(shop.name)}</h2><p>${escape(shop.address)}</p></div><a class="site-link-button" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(shop.address||"")}">Abrir no mapa</a></div></section>`;
    if(id==="hours") return `<section class="site-section site-hours"><div class="site-container site-two-column"><span class="site-kicker">Horários</span><div><h2>Atendimento organizado</h2><p>De ${escape(shop.open)} às ${escape(shop.close)}${shop.breakStart&&shop.breakEnd?`, com intervalo das ${escape(shop.breakStart)} às ${escape(shop.breakEnd)}`:""}.</p></div></div></section>`;
    if(id==="final-cta") return `<section class="site-section site-final-cta"><div class="site-container"><span class="site-kicker">${escape(c.finalCta.eyebrow)}</span><h2>${escape(c.finalCta.title)}</h2><p>${escape(c.finalCta.body)}</p>${book(c.finalCta.label)}</div></section>`;
    if(id==="footer") return `<footer class="site-footer"><div class="site-container"><div class="site-brand">${logo}<span><b>${escape(shop.name)}</b><small>SITE + AGENDA CHRONA</small></span></div><div>${social}<button class="site-link-button" ${preview?"disabled":"data-admin"}>Área da empresa</button></div></div></footer>`;
    return "";
  }
  function render({shop={},services=[],professionals=[],config={},preview=false}) {
    const normalized=normalize(config);
    const html=normalized.sections.filter((section)=>section.visible).map((section)=>renderSection(section.id,{shop,services,professionals,config:normalized,preview})).join("");
    return `<div class="site-root site-template-${normalized.template}" data-site-template="${normalized.template}" data-site-palette="${normalized.palette}" style="${tokens(normalized)}">${html}</div>`;
  }
  function search(query) {
    const terms=String(query||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").split(/\s+/).filter(Boolean);
    if(!terms.length) return [];
    const records=[];
    Object.entries(templates).forEach(([id,item])=>records.push({type:"template",id,name:item.name,tags:item.tags}));
    Object.entries(palettes).forEach(([id,item])=>records.push({type:"palette",id,name:item.name,tags:item.tags}));
    Object.entries(fonts).forEach(([id,item])=>records.push({type:"fontPair",id,name:item.name,tags:item.tags}));
    Object.entries(variants).forEach(([type,items])=>items.forEach((id)=>records.push({type,id,name:`${type}: ${variantNames[id]||id}`,tags:[type,id,variantNames[id]||id,"botão","card","hero","serviço","profissional"]})));
    return records.filter((record)=>{ const haystack=[record.name,...record.tags].join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""); return terms.every((term)=>haystack.includes(term)); }).slice(0,24);
  }
  let rotationTimer=null,carouselResetTimer=null;
  function startRotators(root=document){
    if(rotationTimer) clearInterval(rotationTimer);
    if(carouselResetTimer) clearTimeout(carouselResetTimer);
    if(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    root.querySelectorAll("[data-site-carousel]").forEach((carousel)=>{carousel.dataset.carouselIndex="0";carousel.scrollLeft=0;});
    rotationTimer=setInterval(()=>{
      root.querySelectorAll("[data-site-rotator]").forEach((rotator)=>{const images=[...rotator.querySelectorAll("img")];if(images.length<2)return;const current=Math.max(0,images.findIndex((image)=>image.classList.contains("active"))),next=(current+1)%images.length;images[current].classList.remove("active");images[next].classList.add("active");const count=rotator.querySelector(".site-gallery-count");if(count)count.textContent=`${String(next+1).padStart(2,"0")} / ${String(images.length).padStart(2,"0")}`;});
      root.querySelectorAll("[data-site-carousel]").forEach((carousel)=>{const count=Number(carousel.dataset.photoCount||0),cards=[...carousel.querySelectorAll("figure")];if(count<2||cards.length<count+1)return;const current=Number(carousel.dataset.carouselIndex||0),next=current+1,target=cards[next];carousel.dataset.carouselIndex=String(next);carousel.scrollTo({left:target.offsetLeft-carousel.offsetLeft,behavior:"smooth"});if(next===count)carouselResetTimer=setTimeout(()=>{carousel.scrollTo({left:0,behavior:"auto"});carousel.dataset.carouselIndex="0";},750);});
    },5000);
  }
  window.ChronaSite={palettes,fonts,templates,variants,variantNames,sectionNames,defaultSections,defaultContent,preset,normalize,theme,render,search,clone,startRotators};
})();
