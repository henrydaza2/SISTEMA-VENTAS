// =====================================================================
//  Estado
// =====================================================================
const S = { menu:[], adds:[], loaded:false, tieneClave:false, pidePin:false, pideMesero:false, descMax:100, caja:{abierta:false} };
const A = { key:null, role:null, pin:null, products:[], sales:[], cajas:[], consumo:[] };     // sesión de administrador (solo en memoria)
let sb = null;
const SHOP = 'OBLEAS MATILDE';
const ADMIN_TABS = { inventario:'Para entrar al inventario.', cierre:'Para entrar a la caja. Siempre se pide el código.', ajustes:'Para entrar a los ajustes.' };

const $ = id => document.getElementById(id);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const fmt = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Math.round(+n||0));
const money = n => '$'+new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(Math.round(+n||0));
const num = (n,d=1) => new Intl.NumberFormat('es-CO',{maximumFractionDigits:d}).format(+n||0);
// solo números y unidades conocidas: lo que devuelven se puede insertar en la página sin riesgo
const unitOf = u => ({g:'g',ml:'ml',u:'u'})[u]||'g';
const qtyU = (n,u) => { n=+n||0; u=unitOf(u); return u==='u' ? num(n,1)+' u' : (Math.abs(n)>=1000 ? num(n/1000,2)+(u==='ml'?' L':' kg') : num(n,0)+' '+u); };
const int = n => Math.round(+n||0);
const pct = (g,v) => v>0 ? Math.round(g/v*100)+' %' : '—';
const tracked = p => p.stock!=null && p.stock!=='';
const pad3 = n => String(Math.max(0,int(n))).padStart(3,'0');
const bogotaDay = (d=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(d);
const fDate = d => new Date(d).toLocaleDateString('es-CO',{timeZone:'America/Bogota',day:'2-digit',month:'2-digit',year:'numeric'});
const fTime = d => new Date(d).toLocaleTimeString('es-CO',{timeZone:'America/Bogota',hour:'2-digit',minute:'2-digit'});
function toast(m){ const t=$('toast'); t.innerHTML=icon('check')+esc(m); t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),3000); }
function banner(msg){ $('banner').hidden=!msg; $('bannerTxt').textContent=msg||''; }
function setSync(ok,txt){ ['syncState','tbSync'].forEach(id=>{ const s=$(id); if(!s) return; s.classList.toggle('off',!ok); s.querySelector('span').textContent=txt; }); }
// En el teléfono las tablas se ven como tarjetas: cada celda lleva el nombre de su columna
function labelTables(){
  document.querySelectorAll('table.rt').forEach(t=>{
    const heads=[...t.querySelectorAll('thead th')].map(th=>th.querySelector('.sr')?null:th.textContent.trim());
    t.querySelectorAll('tbody tr, tfoot tr').forEach(tr=>{ let i=0; [...tr.children].forEach(td=>{
      const span=td.colSpan||1, h=heads[i];
      td.dataset.label = span>1 ? '' : (h??''); td.classList.toggle('act', h===null && span===1); i+=span; }); });
  });
}
let labelQueued=false;
new MutationObserver(()=>{ if(labelQueued) return; labelQueued=true; queueMicrotask(()=>{ labelQueued=false; labelTables(); }); })
  .observe(document.querySelector('main'),{childList:true,subtree:true});

// =====================================================================
//  Servidor
// =====================================================================
async function rpc(fn, args){
  if(!sb) throw new Error('SIN_CONEXION');
  const { data, error } = await sb.rpc(fn, args||{});
  if(error) throw new Error([error.message, error.code, error.details].filter(Boolean).join(' '));
  // contraseña, PIN o código malos: el servidor responde {"error": "..."} para poder contar el intento
  if(data && typeof data==='object' && !Array.isArray(data) && typeof data.error==='string') throw new Error(data.error);
  return data;
}
const isNetErr = m => /SIN_CONEXION|Failed to fetch|NetworkError|Load failed|fetch/i.test(m) && !/[A-Z]{4,}_[A-Z]/.test(m);
function errText(e){
  const m=String((e&&e.message)||e||'');
  if(m.includes('BLOQUEADO')){ const s=+(m.split('BLOQUEADO:')[1]||900); return `Demasiados intentos fallidos. Espera ${Math.max(1,Math.ceil(s/60))} min y vuelve a intentar.`; }
  const map = {
    PIN_INCORRECTO:'PIN de vendedor incorrecto.', CLAVE_INCORRECTA:'Contraseña incorrecta.', SIN_CLAVE:'Aún no hay contraseña de administrador.',
    CAJA_CERRADA:'La caja está cerrada. Ábrela para vender.', CAJA_YA_ABIERTA:'La caja ya está abierta en otro dispositivo.', cajas_solo_una_abierta:'La caja ya está abierta en otro dispositivo.',
    SIN_CODIGO_MESERO:'El administrador aún no ha creado el código de meseros.', CODIGO_MESERO_INCORRECTO:'Código de mesero incorrecto.',
    DESCUENTO_MAYOR:'El descuento no puede ser mayor que el subtotal.', DESCUENTO_MAXIMO:'El descuento supera el máximo permitido.',
    DESCUENTO_INVALIDO:'Descuento no válido.', NO_ACEPTA_ADICIONALES:'Ese producto no lleva adicionales.',
    PRODUCTO_NO_EXISTE:'Un producto ya no existe. Actualiza la página.', VENTA_ANULADA:'Esa venta está anulada.', VENTA_NO_EXISTE:'Esa venta ya no existe.',
    VENTA_VACIA:'La venta no tiene productos.', PAGO_INVALIDO:'Elige el método de pago.', VALOR_INVALIDO:'Hay un valor fuera de lo permitido.',
    DESCARTE_NO_EXISTE:'Ese descarte ya no existe.',
    NO_CAMBIAR_TIPO:'No se puede cambiar el tipo de un producto que ya existe. Crea uno nuevo.',
    YA_EXISTE_CLAVE:'La contraseña ya fue creada desde otro dispositivo.', CLAVE_CORTA:'La contraseña debe tener al menos 8 caracteres.',
    PIN_CORTO:'Debe tener al menos 6 caracteres.', CANTIDAD_INVALIDA:'Cantidad no válida.', NOMBRE_VACIO:'Escribe un nombre.',
    '40P01':'Otro dispositivo estaba guardando al mismo tiempo. Intenta de nuevo.', deadlock:'Otro dispositivo estaba guardando al mismo tiempo. Intenta de nuevo.'
  };
  for(const k in map) if(m.includes(k)) return map[k];
  if(m.includes('SIN_STOCK')) return 'No hay suficiente stock de '+(m.split('SIN_STOCK:')[1]||'un producto').trim()+'.';
  if(isNetErr(m)) return 'Sin conexión. Revisa el internet e intenta de nuevo.';
  if(m.includes('Could not find the function')||m.includes('PGRST202')) return 'Falta actualizar la base de datos (supabase-v3.sql).';
  return 'No se pudo completar. Intenta de nuevo.';
}
// quiet: no repite el aviso de "sin conexión" (para las actualizaciones automáticas)
async function run(fn, okMsg, quiet){
  try{ const r=await fn(); if(okMsg) toast(okMsg); return r===undefined?true:r; }
  catch(e){
    const m=String(e&&e.message);
    if(m.includes('CLAVE_INCORRECTA')||m.includes('BLOQUEADO')||(A.role==='vend'&&m.includes('PIN_INCORRECTO'))) lockAdmin(true);
    if(!(quiet && isNetErr(m))) toast(errText(e));
    return false;
  }
}

let menuSeq = 0;     // descarta respuestas viejas si llegan después de una más nueva
async function loadMenu(){
  const seq = ++menuSeq;
  try{
    const [st, cat] = await Promise.all([rpc('estado'), rpc('catalogo')]);
    if(seq!==menuSeq) return;
    S.tieneClave=!!st.tiene_clave; S.pidePin=!!st.pide_pin; S.pideMesero=!!st.pide_mesero; S.descMax=+st.descuento_max||100; S.caja=st.caja||{abierta:false};
    S.menu=cat.productos||[]; S.adds=cat.adicionales||[]; S.loaded=true;
    banner(''); setSync(true,'En línea');
  }catch(e){
    if(seq!==menuSeq) return;
    setSync(false,'Sin conexión');
    if(!S.loaded) banner(errText(e).includes('supabase-v3') ? 'Falta actualizar la base de datos: ejecuta supabase-v3.sql en Supabase.' : 'No se pudo conectar con la base de datos. Revisa el internet y recarga la página.');
  }
  renderCaja(); renderProducts(); renderCart();
}

// =====================================================================
//  Diálogos
// =====================================================================
function askConfirm(title, text, yes='Confirmar'){
  return new Promise(res=>{
    const d=$('confirmDialog'); $('cfTitle').textContent=title; $('cfText').textContent=text; $('cfYes').textContent=yes;
    let done=false; const fin=v=>{ if(done) return; done=true; d.close(); res(v); };
    $('cfYes').onclick=()=>fin(true); $('cfNo').onclick=()=>fin(false); d.oncancel=e=>{e.preventDefault();fin(false);};
    d.showModal(); $('cfNo').focus();
  });
}
// Pide un texto secreto. opts: {title, text, label, twice, check(valor) -> '' o mensaje de error}
function askSecret(opts){
  return new Promise(resolve=>{
    const dlg=$('pwDialog');
    $('pwTitle').textContent=opts.title; $('pwText').textContent=opts.text||''; $('pw1Lbl').textContent=opts.label||'Contraseña';
    $('pw2Box').hidden=!opts.twice; $('pw1').value=''; $('pw2').value=''; $('pwErr').textContent=''; $('pwOk').disabled=false;
    let done=false; const finish=v=>{ if(done) return; done=true; dlg.close(); resolve(v); };
    $('pwCancel').onclick=$('pwCancel2').onclick=()=>finish(null);
    dlg.oncancel=e=>{e.preventDefault();finish(null);};
    $('pwForm').onsubmit=async e=>{
      e.preventDefault();
      const a=$('pw1').value;
      if(opts.twice){
        const min=opts.min||8; if(a.length<min){ $('pwErr').textContent=`Debe tener al menos ${min} caracteres.`; return; }
        if(a!==$('pw2').value){ $('pwErr').textContent='No coinciden.'; return; }
      } else if(!a){ return; }
      $('pwOk').disabled=true; $('pwErr').textContent='';
      const err = opts.check ? await opts.check(a) : '';
      $('pwOk').disabled=false;
      if(err){ $('pwErr').textContent=err; $('pw1').select(); return; }
      finish(a);
    };
    dlg.showModal(); $('pw1').focus();
  });
}
// Formulario corto. fields: [{id,label,type,value,hint,placeholder,step,min}]; validate(vals) -> '' o error
function askForm({title, text, fields, ok='Aceptar', validate}){
  return new Promise(resolve=>{
    const dlg=$('formDialog');
    $('fmTitle').textContent=title; $('fmText').textContent=text||''; $('fmText').hidden=!text; $('fmOk').textContent=ok; $('fmErr').textContent='';
    $('fmFields').innerHTML=fields.map(f=>`<div class="field"><label for="fm_${f.id}">${esc(f.label)}</label>
      <input id="fm_${f.id}" class="input" type="${f.type||'number'}" ${f.type==='text'?'':`inputmode="${f.step&&f.step!=='1'?'decimal':'numeric'}" step="${f.step||'any'}"`} ${f.min!=null?`min="${f.min}"`:''} placeholder="${esc(f.placeholder||'')}" value="${esc(f.value??'')}" autocomplete="off">
      ${f.hint?`<div class="hint">${esc(f.hint)}</div>`:''}</div>`).join('');
    let done=false; const finish=v=>{ if(done) return; done=true; dlg.close(); resolve(v); };
    $('fmClose').onclick=$('fmCancel').onclick=()=>finish(null);
    dlg.oncancel=e=>{e.preventDefault();finish(null);};
    $('fmForm').onsubmit=e=>{
      e.preventDefault();
      const vals={}; fields.forEach(f=>{ const v=$('fm_'+f.id).value.trim(); vals[f.id]= f.type==='text' ? v : (v===''?null:+v); });
      const err = validate ? validate(vals) : '';
      if(err){ $('fmErr').textContent=err; return; }
      finish(vals);
    };
    dlg.showModal(); const first=$('fm_'+fields[0].id); first.focus(); first.select();
  });
}

// =====================================================================
//  Sesión de administrador
// =====================================================================
async function ensureAdmin(text){
  if(A.key) return true;
  if(!S.loaded){ toast('Sin conexión con la base de datos.'); return false; }
  const tryRpc = (fn,args) => async v => { try{ await rpc(fn, args(v)); return ''; }catch(e){ return errText(e); } };
  const pass = S.tieneClave
    ? await askSecret({title:'Contraseña de administrador', text, check:tryRpc('admin_entrar', v=>({p_clave:v}))})
    : await askSecret({title:'Crea la contraseña de administrador', text:'Protege el inventario, el cierre y los ajustes en todos los dispositivos. Guárdala bien.', label:'Nueva contraseña (mínimo 8 caracteres)', twice:true, min:8, check:tryRpc('crear_clave', v=>({p_clave:v}))});
  if(!pass) return false;
  A.key=pass; A.role='admin'; A.pin=null; S.tieneClave=true; setRole();
  return true;
}
// Inventario y Cierre: el administrador entra con su contraseña; un vendedor puede entrar
// solo a mirar con su PIN (sin cambiar nada y sin ver costos ni el resultado de la caja)
// force: pedir el código aunque ya haya una sesión abierta (la Caja lo pide siempre)
async function ensureView(text, force){
  if(!force && (A.key || A.role==='vend')) return true;
  if(force){ A.key=null; A.role=null; A.pin=null; A.products=[]; A.sales=[]; A.cajas=[]; A.consumo=[]; setRole(); }
  if(!S.loaded){ toast('Sin conexión con la base de datos.'); return false; }
  const who = await askRole(text);
  if(who==='admin') return ensureAdmin(text);
  if(who!=='vend') return false;
  // el vendedor escribe su PIN cada vez que entra
  let data=null;
  const pin = !S.pidePin ? '' : await askSecret({title:'PIN de vendedor', text:(text||'')+' Solo podrás ver, sin hacer cambios.', label:'PIN',
    check: async v=>{ try{ data=await rpc('vend_inventario',{p_pin:v}); return ''; }catch(e){ return errText(e); } }});
  if(pin===null) return false;
  if(!data){ try{ data=await rpc('vend_inventario',{p_pin:pin}); }catch(e){ toast(errText(e)); return false; } }
  A.role='vend'; A.pin=pin; A.products=data||[]; setRole();
  return true;
}
function askRole(text){
  return new Promise(res=>{
    const d=$('roleDialog'); $('roleText').textContent=text||'';
    let done=false; const fin=v=>{ if(done) return; done=true; d.close(); res(v); };
    $('roleAdmin').onclick=()=>fin('admin'); $('roleVend').onclick=()=>fin('vend');
    $('roleClose').onclick=()=>fin(null); d.oncancel=e=>{e.preventDefault();fin(null);};
    d.showModal(); $('roleVend').focus();
  });
}
// Modo solo lectura para vendedores
function setRole(){
  const ro = A.role==='vend';
  document.body.classList.toggle('ro', ro);
  document.querySelectorAll('.adminbar .msg').forEach(m=>m.innerHTML = ro
    ? icon('lock')+'Modo vendedor: solo puedes ver'
    : icon('unlock')+'Sesión de administrador abierta');
  $('closeDate').disabled = ro;
}
function lockAdmin(silent){
  A.key=null; A.role=null; A.pin=null; A.products=[]; A.sales=[]; A.cajas=[]; A.consumo=[]; setRole(); descLoaded=false; A.descartes=[];
  ['prodDialog','receiptDialog','descDialog'].forEach(id=>{ if($(id).open) $(id).close(); });
  if(!$('page-vender').classList.contains('active')) show('vender');
  if(!silent) toast('Sesión cerrada');
}
document.querySelectorAll('[data-lock]').forEach(b=>b.onclick=()=>lockAdmin());

// =====================================================================
//  Navegación
// =====================================================================
function show(tab){
  document.querySelectorAll('[data-tab]').forEach(x=>{ if(x.dataset.tab===tab) x.setAttribute('aria-current','page'); else x.removeAttribute('aria-current'); });
  document.querySelectorAll('.page').forEach(s=>s.classList.toggle('active',s.id==='page-'+tab));
  closeSheet(); window.scrollTo(0,0);
}
async function go(tab){
  if(ADMIN_TABS[tab]){
    // Ajustes es solo del administrador; Inventario y Cierre también los puede ver un vendedor
    if(!(tab==='ajustes' ? await ensureAdmin(ADMIN_TABS[tab]) : await ensureView(ADMIN_TABS[tab], tab==='cierre'))) return;
    show(tab);
    if(tab==='inventario') await loadAdminProducts();
    // con la caja abierta desde ayer (pasada la medianoche), el cierre muestra el día de la caja
    if(tab==='cierre'){ $('closeDate').value = S.caja.abierta && S.caja.dia ? S.caja.dia : bogotaDay(); await loadSales(); }
    if(tab==='ajustes') renderSettings();
  } else {
    A.key=null; A.role=null; A.pin=null; A.products=[]; A.sales=[]; A.cajas=[]; A.consumo=[]; setRole();     // al volver a Vender se cierra la sesión
    show(tab); loadMenu();
  }
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tab));
function catColor(c, list){ const all=[...new Set((list||S.menu).map(p=>p.cat||'Sin categoría'))].sort(); return `var(--c${(Math.max(0,all.indexOf(c||'Sin categoría'))%6)+1})`; }

// =====================================================================
//  PIN de vendedor (se recuerda en este dispositivo)
// =====================================================================
// el PIN se recuerda solo mientras la pestaña esté abierta (sessionStorage), no queda guardado en el aparato
const pinStore = { get(){ try{ return sessionStorage.getItem('om_pin')||this._v||''; }catch(e){ return this._v||''; } }, set(v){ this._v=v; try{ v?sessionStorage.setItem('om_pin',v):sessionStorage.removeItem('om_pin'); localStorage.removeItem('om_pin'); }catch(e){} } };
try{ localStorage.removeItem('om_pin'); }catch(e){}     // borra el PIN que guardaban las versiones anteriores
async function getPin(force){
  if(!S.pidePin) return '';
  if(!force && pinStore.get()) return pinStore.get();
  const p = await askSecret({title:'PIN de vendedor', text:'Escribe el PIN para usar la caja en este dispositivo.', label:'PIN'});
  if(p) pinStore.set(p);
  return p;
}
// Ejecuta fn(pin); si el PIN guardado está mal, lo vuelve a pedir
async function withPin(fn){
  let pin = await getPin(false); if(pin===null) return null;
  for(let i=0;i<3;i++){
    try{ return await fn(pin); }
    catch(e){
      if(String(e.message).includes('PIN_INCORRECTO')){ pinStore.set(''); S.pidePin=true; toast('PIN de vendedor incorrecto.'); pin=await getPin(true); if(!pin) return null; }
      else throw e;
    }
  }
  return null;
}

// =====================================================================
//  Caja
// =====================================================================
function renderCaja(){
  const c=S.caja||{};
  const editing=!!editMode;
  $('cajaBar').innerHTML = !S.loaded ? '' : c.abierta
    ? `<span class="cajachip"><i class="dot cash"></i>Caja abierta · ${fTime(c.desde)}</span><button class="btn ghost sm" id="closeCajaBtn">${icon('lock')}Cerrar caja</button>`
    : `<span class="cajachip off"><i class="dot" style="background:var(--danger)"></i>Caja cerrada</span>${editing?`<button class="btn sm" data-open-caja>${icon('store')}Abrir caja</button>`:''}`;
  $('cajaClosed').hidden = !S.loaded || c.abierta || editing;
  document.querySelectorAll('[data-open-caja]').forEach(b=>b.onclick=abrirCaja);
  if($('closeCajaBtn')) $('closeCajaBtn').onclick=cerrarCaja;
}
async function abrirCaja(){
  const v = await askForm({title:'Abrir caja', text:'Escribe con cuánto efectivo empiezas el día (la base para dar cambio).',
    fields:[{id:'base',label:'Efectivo inicial',value:'',placeholder:'0',min:0,step:'1'}], ok:'Abrir caja',
    validate:x=> x.base!=null && x.base<0 ? 'No puede ser negativo.' : ''});
  if(!v) return;
  try{
    const r = await withPin(pin=>rpc('abrir_caja',{p_pin:pin,p_base:v.base||0}));
    if(r){ toast('Caja abierta'); }
  }catch(e){ toast(errText(e)); }
  loadMenu();
}
async function cerrarCaja(){
  const v = await askForm({title:'Cerrar caja', text:'Cuenta el efectivo que hay en la caja (incluida la base) y escríbelo. El resultado lo ve el administrador en el cierre del día.',
    fields:[{id:'contado',label:'Efectivo contado',value:'',placeholder:'0',min:0,step:'1'},{id:'notas',label:'Notas (opcional)',type:'text',value:'',placeholder:'Ej: se pagó un domicilio con la caja'}],
    ok:'Cerrar caja', validate:x=> x.contado==null ? 'Escribe cuánto efectivo contaste.' : (x.contado<0?'No puede ser negativo.':'')});
  if(!v) return;
  try{
    const r = await withPin(pin=>rpc('cerrar_caja',{p_pin:pin,p_contado:v.contado,p_notas:v.notas||''}));
    if(r){ toast('Caja cerrada. ¡Buen trabajo!'); }
  }catch(e){ toast(errText(e)); }
  loadMenu();
}

// =====================================================================
//  Vender
// =====================================================================
// cart: { "<id>|<adicionales>": {id, adds:[ids], qty} }
let cart = {}; let pay = null; let cat = 'Todas'; let saving=false; let lastSale=null;
let discount = null;      // {amount, code}
let editMode = null;      // {uid, order, day, key}
const findM = id => S.menu.find(x=>x.id===id);
const findAdd = id => S.adds.find(x=>x.id===id);
const lineKey = (id,adds) => id+'|'+adds.join(',');
const MAXQ = 1000;      // tope por producto (igual que el servidor)
let saleRef = null;     // identificador de la venta en curso: si se cobra dos veces sin señal, el servidor no la repite
const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
// Detalle de adicionales con precio: las primeras salsas elegidas van incluidas si el producto las trae
function addsDetail(p, adds){
  let incl=p?.incl||0;
  return adds.map(id=>{ const a=findAdd(id); if(!a) return null;   // en el orden en que se marcaron
    if(a.salsa && incl>0){ incl--; return {...a, price:0, incl:true}; }
    return {...a, incl:false}; }).filter(Boolean);
}
const linePrice = l => { const p=findM(l.id); return p ? p.price + addsDetail(p,l.adds).reduce((s,a)=>s+a.price,0) : 0; };
const addLabel = a => a.name + (a.incl ? ' (incluida)' : '');
const plS = n => n===1 ? '1 salsa' : n+' salsas';
const qtyInCart = id => Object.values(cart).filter(l=>l.id===id).reduce((s,l)=>s+l.qty,0);
const cartSub = () => Object.values(cart).reduce((s,l)=>s+linePrice(l)*l.qty,0);
const discAmount = () => discount ? Math.min(discount.amount, cartSub()) : 0;

function renderProducts(){
  if(!S.loaded) return;
  const q = $('search').value.toLowerCase().trim();
  const counts = {}; S.menu.forEach(p=>{const c=p.cat||'Sin categoría';counts[c]=(counts[c]||0)+1;});
  const catRank = c => (/oblea/i.test(c)?0:1);
  const cats = Object.keys(counts).sort((a,b)=>catRank(a)-catRank(b)||a.localeCompare(b));
  if(cat!=='Todas' && !counts[cat]) cat='Todas';
  $('catChips').innerHTML = ['Todas',...cats].map(c=>`<button class="chip" aria-pressed="${c===cat}" data-c="${esc(c)}">${esc(c)} <span class="n">${c==='Todas'?S.menu.length:counts[c]}</span></button>`).join('');
  $('catChips').querySelectorAll('.chip').forEach(b=>b.onclick=()=>{cat=b.dataset.c;renderProducts();});
  const list = S.menu.filter(p=>(cat==='Todas'||(p.cat||'Sin categoría')===cat) && (p.name+' '+(p.cat||'')).toLowerCase().includes(q))
    .sort((a,b)=>cats.indexOf(a.cat||'Sin categoría')-cats.indexOf(b.cat||'Sin categoría'));
  $('prodGrid').innerHTML = list.length ? list.map(p=>{
    const inCart = qtyInCart(p.id);
    const left = tracked(p) ? p.stock-inCart : null;
    const out = tracked(p) && left<=0 && !editMode;
    const low = tracked(p) && left>0 && left<=p.min;
    return `<button class="prod" style="--c:${catColor(p.cat)}" data-id="${esc(p.id)}" ${out?'disabled':''} aria-label="Agregar ${esc(p.name)}, ${fmt(p.price)}${out?', agotado':tracked(p)?`, ${esc(left)} disponibles`:''}${inCart?`, ${esc(inCart)} en la venta`:''}">
      <span class="prod-cat">${esc(p.cat||'')}</span>
      <span class="prod-name">${esc(p.name)}</span>
      ${p.adds_ok&&S.adds.length?`<span class="prod-extra">${p.incl?`Elige ${plS(p.incl)} · + adicionales`:'+ salsas y adicionales'}</span>`:''}
      ${tracked(p)?`<span class="prod-stock ${low||out?'low':''}">${out?'Agotado':esc(left)+' disponibles'}</span>`
        :p.alcanza!=null?`<span class="prod-stock ${p.alcanza<=p.min?'low':''}">≈ ${esc(p.alcanza)} disponibles</span>`:''}
      <span class="prod-foot"><span class="prod-price">${fmt(p.price)}</span>${inCart?`<span class="prod-qty">${inCart}</span>`:`<span class="prod-add">${icon('plus')}</span>`}</span>
    </button>`;
  }).join('') : `<div class="empty" style="grid-column:1/-1">${S.menu.length?'No hay productos que coincidan.':'Aún no hay productos a la venta.'}</div>`;
  $('prodGrid').querySelectorAll('.prod').forEach(b=>b.onclick=()=>pickProduct(b.dataset.id));
}
function pickProduct(id){
  const p=findM(id); if(!p) return;
  if(p.adds_ok && S.adds.length) openAdds(p); else addLine(id,[],1);
}
function addLine(id, adds, qty){
  const p=findM(id); if(!p) return;
  if(tracked(p) && !editMode && qtyInCart(id)+qty>p.stock){ toast('No hay más stock de '+p.name); return; }
  const k=lineKey(id,adds);
  if((cart[k]?.qty||0)+qty>MAXQ){ toast(`Máximo ${MAXQ} unidades por producto.`); return; }
  if(cart[k]) cart[k].qty+=qty; else cart[k]={id,adds:[...adds],qty};
  saleRef=null;
  renderCart(); renderProducts();
}
function changeLine(k,d){
  const l=cart[k]; if(!l) return;
  if(d>0){ const p=findM(l.id); if(p && tracked(p) && !editMode && qtyInCart(l.id)+1>p.stock){ toast('No hay más stock de '+p.name); return; } }
  if(d>0 && l.qty+d>MAXQ){ toast(`Máximo ${MAXQ} unidades por producto.`); return; }
  saleRef=null;
  l.qty+=d; if(l.qty<=0) delete cart[k];
  renderCart(); renderProducts();
}

// ---- ventana de adicionales ----
let addsFor=null, addsSel=new Set(), addsQty=1;
function openAdds(p){
  addsFor=p; addsSel=new Set(); addsQty=1;
  $('addsTitle').textContent=p.name;
  const salsas=S.adds.filter(a=>a.salsa), otros=S.adds.filter(a=>!a.salsa);
  const chk=a=>`<label class="chk" data-a="${esc(a.id)}"><input type="checkbox" value="${esc(a.id)}"><span>${esc(a.name)}</span><span class="p" data-p="${esc(a.id)}">+${fmt(a.price)}</span></label>`;
  $('addsHint').textContent = p.incl
    ? `Incluye ${plS(p.incl)}: elige ${p.incl===1?'cuál':'cuáles'}. Las demás cuestan aparte.`
    : 'Marca lo que quiera el cliente. Si no quiere nada, presiona Agregar.';
  $('addsList').innerHTML =
    (salsas.length?`<div class="small muted" style="font-weight:700;margin-top:4px">SALSAS</div>${salsas.map(chk).join('')}`:'')
    + (otros.length?`<div class="small muted" style="font-weight:700;margin-top:8px">OTROS ADICIONALES</div>${otros.map(chk).join('')}`:'');
  $('addsList').querySelectorAll('input').forEach(i=>i.onchange=()=>{ i.checked?addsSel.add(i.value):addsSel.delete(i.value); i.closest('.chk').classList.toggle('on',i.checked); renderAddsTotal(); });
  renderAddsTotal(); $('addsDialog').showModal(); $('addsOk').focus();
}
function renderAddsTotal(){
  const det=addsDetail(addsFor,[...addsSel]);
  const unit = addsFor.price + det.reduce((s,a)=>s+a.price,0);
  // muestra "Incluida" en las salsas que no se cobran
  $('addsList').querySelectorAll('[data-p]').forEach(el=>{ const d=det.find(x=>x.id===el.dataset.p); const a=findAdd(el.dataset.p);
    el.textContent = d&&d.incl ? 'Incluida' : '+'+fmt(a?.price); el.style.color = d&&d.incl ? 'var(--cash)' : ''; });
  const chosen=det.filter(a=>a.salsa).length, falta=Math.max(0,(addsFor.incl||0)-chosen);
  $('addsQty').textContent=addsQty; $('addsTotal').textContent=fmt(unit*addsQty);
  $('addsOk').disabled = falta>0;
  $('addsOk').innerHTML = falta>0 ? `Elige ${plS(falta)} más` : `${icon('cart-plus')}Agregar${addsQty>1?' '+addsQty:''}`;
}
$('addsMinus').onclick=()=>{ if(addsQty>1){addsQty--;renderAddsTotal();} };
$('addsPlus').onclick=()=>{ if(addsQty<MAXQ){ addsQty++; renderAddsTotal(); } };
$('addsClose').onclick=$('addsCancel').onclick=()=>$('addsDialog').close();
$('addsOk').onclick=()=>{ $('addsDialog').close(); addLine(addsFor.id,[...addsSel],addsQty); };

function renderCart(){
  if(S.loaded) Object.keys(cart).forEach(k=>{ const l=cart[k]; if(!findM(l.id)) delete cart[k]; else l.adds=l.adds.filter(findAdd); });
  const keys = Object.keys(cart);
  $('cart').innerHTML = keys.length ? keys.map(k=>{
    const l=cart[k], p=findM(l.id); if(!p) return '';
    const addNames=addsDetail(p,l.adds).map(addLabel);
    const up=linePrice(l);
    return `<div class="ci">
      <div><div class="ci-name">${esc(p.name)}</div>${addNames.length?`<div class="ci-adds">+ ${esc(addNames.join(', '))}</div>`:''}<div class="ci-sub">${fmt(up)} c/u</div></div>
      <div class="ci-total">${fmt(up*l.qty)}</div>
      <div></div>
      <div class="stepper"><button data-k="${esc(k)}" data-d="-1" aria-label="Quitar uno">${icon('minus')}</button><span>${esc(l.qty)}</span><button data-k="${esc(k)}" data-d="1" aria-label="Agregar uno">${icon('plus')}</button></div>
    </div>`;
  }).join('') : `<div class="empty">${icon('cart')}<br>Aún no hay productos</div>`;
  $('cart').querySelectorAll('.stepper button').forEach(b=>b.onclick=()=>changeLine(b.dataset.k,+b.dataset.d));
  if(!keys.length && discount && !editMode) discount=null;
  const sub=cartSub(), d=discAmount(), t=sub-d, count=Object.values(cart).reduce((s,l)=>s+l.qty,0);
  $('cartSub').textContent=fmt(sub);
  $('discRow').hidden=!d; $('discVal').textContent='−'+fmt(d);
  $('discBtn').hidden=!!discount || !keys.length;
  $('cartTotal').textContent=fmt(t);
  document.querySelectorAll('.pay button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.pay===pay));
  $('cashBox').hidden = pay!=='efectivo';
  const bills=[2000,5000,10000,20000,50000,100000].filter(b=>b>t).slice(0,4);
  $('quick').innerHTML = t ? [`<button data-v="${t}">Exacto</button>`,...bills.map(b=>`<button data-v="${b}">${fmt(b)}</button>`)].join('') : '';
  $('quick').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('received').value=b.dataset.v;renderCart();});
  const r = +$('received').value;
  $('change').innerHTML = pay==='efectivo' && r ? (r>=t?`Cambio: <span style="color:var(--cash)">${fmt(r-t)}</span>`:`<span style="color:var(--danger)">Faltan ${fmt(t-r)}</span>`) : '';
  const cajaOk = editMode || S.caja.abierta;
  $('checkout').disabled = !keys.length || !pay || saving || !S.loaded || !cajaOk;
  $('checkoutTxt').textContent = saving ? 'Guardando…' : !cajaOk ? 'Abre la caja para vender' : !keys.length ? (editMode?'Guardar cambios':'Cobrar') : !pay ? 'Elige el método de pago' : (editMode?'Guardar cambios ':'Cobrar ')+fmt(t);
  $('cartTitle').textContent = editMode ? `Orden N.º ${pad3(editMode.order)}` : 'Venta actual';
  $('editBar').hidden=!editMode;
  if(editMode) $('editTitle').textContent=`Editando la orden N.º ${pad3(editMode.order)} del ${fDate(editMode.date)}`;
  $('cartCount').textContent = count; $('cartBarTotal').textContent = fmt(t);
  $('cartBar').classList.toggle('show', count>0);
  renderCaja();
}
// En el celular la venta es una hoja que sube desde abajo: cerrada, queda "inert" para que el teclado
// y los lectores de pantalla no entren en ella.
const sheetMQ = matchMedia('(max-width:860px)');
function syncSheet(){ $('cartPanel').inert = sheetMQ.matches && !$('cartPanel').classList.contains('open'); }
function openSheet(){ $('cartPanel').classList.add('open'); $('backdrop').classList.add('show'); syncSheet(); $('closeSheet').focus(); }
function closeSheet(){ const was=$('cartPanel').classList.contains('open'); $('cartPanel').classList.remove('open'); $('backdrop').classList.remove('show'); syncSheet(); if(was && sheetMQ.matches && $('cartBar').classList.contains('show')) $('cartBar').focus(); }
sheetMQ.addEventListener('change', syncSheet);
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && $('cartPanel').classList.contains('open') && !document.querySelector('dialog[open]')) closeSheet(); });
$('cartBar').onclick=openSheet; $('closeSheet').onclick=closeSheet; $('backdrop').onclick=closeSheet;
document.querySelectorAll('.pay button').forEach(b=>b.onclick=()=>{pay=b.dataset.pay;saleRef=null;renderCart();});
$('received').oninput = renderCart;
$('search').oninput = renderProducts;
function resetSale(){ cart={}; pay=null; discount=null; saleRef=null; $('received').value=''; }
$('clearCart').onclick = ()=>{ resetSale(); renderCart(); renderProducts(); };

// ---- descuento de meseros ----
$('discBtn').onclick=async()=>{
  const sub=cartSub(); if(!sub) return;
  let code=null;
  if(!editMode){
    if(!S.pideMesero){ toast('El administrador aún no ha creado el código de meseros (Ajustes).'); return; }
    code = await askSecret({title:'Descuento mesero', text:'Escribe el código de meseros.', label:'Código',
      check: async v=>{ try{ await rpc('verificar_mesero',{p_codigo:v}); return ''; }catch(e){ return errText(e); } }});
    if(!code) return;
  }
  const v = await askForm({title:'Valor del descuento', text:`Subtotal de la venta: ${fmt(sub)}.`, ok:'Aplicar descuento',
    fields:[{id:'amount',label:'Descuento en pesos',value:'',placeholder:'Ej: 1000',min:0,step:'1'}],
    validate:x=> !x.amount||x.amount<=0 ? 'Escribe un valor mayor que cero.' : (x.amount>sub?'No puede ser mayor que el subtotal.'
      : (!editMode && x.amount>Math.round(sub*S.descMax/100) ? `El máximo es ${S.descMax} % (${fmt(Math.round(sub*S.descMax/100))}).` : ''))});
  if(!v) return;
  discount={amount:Math.round(v.amount), code}; saleRef=null;
  renderCart();
};
$('discRemove').onclick=()=>{ discount=null; saleRef=null; renderCart(); };

// ---- cobrar ----
$('checkout').onclick = async ()=>{
  const items = Object.values(cart).filter(l=>findM(l.id)).map(l=>({id:l.id,qty:l.qty,adds:l.adds}));
  if(!items.length || !pay || saving) return;
  const rec = +$('received').value||0, method = pay, d = discAmount();
  saving=true; renderCart();
  try{
    if(editMode){
      // la contraseña se pide al guardar: no se deja guardada en la pantalla de vender
      let sale=null;
      const key = await askSecret({title:'Contraseña de administrador', text:`Para guardar los cambios de la orden N.º ${pad3(editMode.order)}.`,
        check: async v=>{ try{ sale = await rpc('admin_editar_venta',{p_clave:v,p_uid:editMode.uid,p_items:items,p_pago:method,p_recibido:rec,p_descuento:d}); return ''; }
                          catch(e){ const m=String(e.message); return (m.includes('CLAVE_INCORRECTA')||m.includes('BLOQUEADO')) ? errText(e) : 'No se guardó: '+errText(e); } }});
      if(key && sale){ editMode=null; resetSale(); lastSale=sale; $('lastReceipt').hidden=false; closeSheet(); showSold(sale,'¡Venta actualizada!'); }
    } else {
      if(!saleRef) saleRef=newRef();
      const ref=saleRef;
      const sale = await withPin(pin=>rpc('registrar_venta',{p_pin:pin,p_items:items,p_pago:method,p_recibido:rec,p_descuento:d,p_codigo:d?discount.code:null,p_ref:ref}));
      if(sale){ resetSale(); lastSale=sale; $('lastReceipt').hidden=false; closeSheet(); showSold(sale,'¡Venta registrada!'); }
    }
  }catch(e){
    const m=String(e.message);
    if(m.includes('CODIGO_MESERO')){ discount=null; saleRef=null; }
    // sin señal: se conserva saleRef; si la venta alcanzó a guardarse, cobrar de nuevo no la repite
    toast(isNetErr(m) ? 'Sin conexión. Vuelve a presionar Cobrar cuando haya señal: la venta no se repetirá.' : errText(e));
  }
  saving=false;
  await loadMenu();
};

// ---- editar una venta (desde el cierre) ----
function startEdit(s){
  editMode={uid:s.uid, order:s.order, date:s.date};
  resetSale();
  let missing=0;
  s.items.forEach(i=>{
    if(!findM(i.id)){ missing++; return; }
    const adds=(i.adds||[]).map(a=>a.id).filter(findAdd);
    const k=lineKey(i.id,adds);
    const q=Math.min(MAXQ,int(i.qty)); if(cart[k]) cart[k].qty=Math.min(MAXQ,cart[k].qty+q); else cart[k]={id:i.id,adds,qty:q};
  });
  pay=s.pay; $('received').value=s.received||'';
  if(+s.discount>0) discount={amount:+s.discount, code:null};
  A.key=null; A.products=[]; A.sales=[]; A.cajas=[];
  show('vender'); renderCart(); renderProducts();
  if(missing) toast('Algunos productos de esa venta ya no existen en el menú.');
}
$('editCancel').onclick=()=>{ editMode=null; resetSale(); renderCart(); renderProducts(); toast('Edición cancelada'); };

// =====================================================================
//  Venta registrada (ventana emergente) y recibo
// =====================================================================
const addsTxt = i => (i.adds||[]).map(addLabel).join(', ');
function showSold(s, title){
  $('soldTitle').textContent=title;
  $('soldOrder').textContent = `Orden N.º ${pad3(s.order)} · ${fDate(s.date)} ${fTime(s.date)}`;
  $('soldTotal').textContent = fmt(s.total);
  $('soldPay').innerHTML = s.pay==='efectivo' ? '<span class="badge cash">Efectivo</span>' : '<span class="badge transfer">Transferencia</span>';
  $('soldDisc').hidden = !(+s.discount>0); $('soldDisc').textContent = `Subtotal ${fmt(s.subtotal)} · Descuento mesero −${fmt(s.discount)}`;
  const ch=$('soldChange'); ch.hidden = !(s.received>0);
  if(s.received>0) ch.textContent = `Recibido ${fmt(s.received)} · Cambio ${fmt(s.received-s.total)}`;
  $('soldItems').innerHTML = s.items.map(i=>`<li><span>${esc(i.qty)} × ${esc(i.name)}${addsTxt(i)?`<small>+ ${esc(addsTxt(i))}</small>`:''}</span><span>${fmt(i.price*i.qty)}</span></li>`).join('');
  $('soldDialog').showModal(); $('soldNew').focus();
}
$('soldNew').onclick=()=>$('soldDialog').close();
$('soldPrint').onclick=()=>printReceipt(lastSale);
$('lastReceipt').onclick=()=>openReceipt(lastSale);

let rcSale=null;
// Recibo compacto para rollo de 80 mm: lo mismo en menos líneas (gasta menos papel)
const fDateShort = d => new Date(d).toLocaleDateString('es-CO',{timeZone:'America/Bogota',day:'2-digit',month:'2-digit',year:'2-digit'});
function receiptHtml(s){
  const sub = s.subtotal ?? s.total;
  const addsLine = i => (i.adds||[]).map(a=>esc(a.name)+(a.incl?' (incl.)':'')).join(', ');
  return `${s.void?'<div class="void">VENTA ANULADA</div>':''}
    <div class="c shop">${SHOP}</div>
    <div class="r tot"><span>Orden N.º ${pad3(s.order)}</span><span class="when">${fDateShort(s.date)} ${fTime(s.date)}</span></div>
    ${s.edited?`<div class="in">Modificada ${fTime(s.edited)}</div>`:''}
    <div class="hr"></div>
    ${s.items.map(i=>`<div class="item"><div class="r"><span>${esc(i.qty)} ${esc(i.name)}</span><span>${money(i.price*i.qty)}</span></div>${addsLine(i)?`<div class="in">+ ${addsLine(i)}</div>`:''}${int(i.qty)>1?`<div class="in">${money(i.price)} c/u</div>`:''}</div>`).join('')}
    <div class="hr"></div>
    ${+s.discount>0?`<div class="r"><span>Subtotal</span><span>${money(sub)}</span></div><div class="r"><span>Descuento</span><span>-${money(s.discount)}</span></div>`:''}
    <div class="r tot"><span>TOTAL</span><span>${money(s.total)}</span></div>
    <div class="r"><span>${s.pay==='efectivo'?'Efectivo':'Transferencia'}${s.received>0?` · Recibió ${money(s.received)}`:''}</span><span>${s.received>0?`Cambio ${money(s.received-s.total)}`:''}</span></div>
    <div class="hr"></div>
    <div class="c">¡Gracias por tu compra!</div>`;
}
function openReceipt(s){ if(!s) return; rcSale=s; $('receipt').innerHTML=receiptHtml(s); $('receiptDialog').showModal(); }
function printReceipt(s){ if(!s) return; $('printArea').innerHTML=`<div class="receipt">${receiptHtml(s)}</div>`; window.print(); }
$('rcClose').onclick=$('rcClose2').onclick=()=>$('receiptDialog').close();
$('rcPrint').onclick=()=>printReceipt(rcSale);

// =====================================================================
//  Inventario (administrador)
// =====================================================================
let invFilter='venta';
const findA = id => A.products.find(x=>x.id===id);
const insumos = () => A.products.filter(p=>p.type==='insumo');
const unitCostIns = i => (+i.content>0) ? (+i.price)/(+i.content) : 0;
function alcanzaIns(i){
  if(i.qty==null) return null;
  const usan = A.products.filter(p=>p.type==='venta' && (p.recipe||[]).some(r=>r.id===i.id));
  if(!usan.length) return null;
  const gasto = usan.map(p=>+(p.recipe.find(r=>r.id===i.id).qty) * (i.unit==='u' ? 1 : 1+(+p.merma||0)/100));
  if(new Set(gasto.map(x=>x.toFixed(4))).size!==1 || !(gasto[0]>0)) return null;
  return { n: Math.max(0, Math.floor(+i.qty/gasto[0])), que: usan.every(p=>/oblea/i.test(p.name+' '+(p.cat||''))) ? 'obleas' : 'productos' };
}
async function loadAdminProducts(){
  const r = await run(()=> A.role==='vend' ? rpc('vend_inventario',{p_pin:A.pin}) : rpc('admin_productos',{p_clave:A.key}));
  if(r!==false){ A.products=r||[]; }
  renderInventory();
}
$('invSeg').querySelectorAll('button').forEach(b=>b.onclick=()=>{invFilter=b.dataset.f;$('invSeg').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));renderInventory();});
$('invSearch').oninput=()=>renderInventory();
// Aviso: insumos que no se descuentan al vender porque nunca se contaron (o les falta el precio)
function renderInvAlert(){
  if(A.role==='vend'){ $('invAlert').hidden=true; return; }
  const ins = insumos();
  const usado = id => A.products.some(p=>(p.recipe||[]).some(r=>r.id===id));
  const sinContar = ins.filter(p=>p.qty==null && usado(p.id));
  const sinPrecio = ins.filter(p=>!(+p.price>0) && usado(p.id));
  const box = $('invAlert');
  if(!sinContar.length && !sinPrecio.length){ box.hidden=true; box.innerHTML=''; return; }
  const lista = l => l.map(p=>esc(p.name)).join(', ');
  box.innerHTML = `${icon('info')}<div class="t">
      ${sinContar.length?`<b>${sinContar.length===1?'1 insumo no se descuenta':sinContar.length+' insumos no se descuentan'} al vender porque no se ${sinContar.length===1?'ha':'han'} contado.</b>
        <div class="names">${lista(sinContar)}. Toca <b>Contar</b> en cada uno y escribe cuánto hay ahora; desde ahí cada venta lo va bajando.</div>`:''}
      ${sinPrecio.length?`<div class="names" style="margin-top:6px"><b>Sin precio:</b> ${lista(sinPrecio)}. Su costo sale en $0: registra una <b>Compra</b> con el precio.</div>`:''}
    </div>
    ${invFilter!=='insumo'?'<button class="btn sm" id="invAlertGo">Ir a Insumos</button>':''}`;
  box.hidden=false;
  const go=$('invAlertGo');
  if(go) go.onclick=()=>{ invFilter='insumo'; $('invSeg').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.f==='insumo')); renderInventory(); };
}
function renderInventory(){
  if(A.role==='vend' && invFilter==='descarte') invFilter='venta';
  $('invSeg').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.f===invFilter));
  const desc = invFilter==='descarte';
  $('invTableWrap').hidden = desc; $('descView').hidden = !desc;
  renderInvAlert();
  if(desc){ $('invHint').textContent='Saca del inventario lo que se dañó o no cumplió la calidad. La pérdida es lo que costó producirlo.'; descLoaded ? renderDescartes() : loadDescartes(); return; }
  const n=t=>A.products.filter(p=>p.type===t).length;
  $('invSub').textContent=`${n('venta')} productos · ${n('adicional')} adicionales · ${n('insumo')} insumos`;
  const q=$('invSearch').value.toLowerCase();
  const list=A.products.filter(p=>p.type===invFilter && (p.name+' '+(p.cat||'')).toLowerCase().includes(q))
    .sort((a,b)=>(/oblea/i.test(b.cat||'')-/oblea/i.test(a.cat||''))||(a.cat||'').localeCompare(b.cat||'')||a.name.localeCompare(b.name));   // obleas primero
  const ro = A.role==='vend';
  const actions = p => ro ? '' : `<div class="actions">
      ${p.type==='insumo'?`<button class="btn ghost sm" data-buy="${esc(p.id)}">${icon('plus')}Compra</button><button class="btn ghost sm" data-count="${esc(p.id)}">Contar</button>`:''}
      ${p.type==='venta'&&tracked(p)?`<button class="btn ghost sm" data-adj="${esc(p.id)}">± Stock</button>`:''}
      <button class="icon-btn" data-edit="${esc(p.id)}" aria-label="Editar ${esc(p.name)}" title="Editar">${icon('edit')}</button>
      <button class="icon-btn del" data-del="${esc(p.id)}" aria-label="Eliminar ${esc(p.name)}" title="Eliminar">${icon('trash')}</button></div>`;
  const actTh = ro ? '' : '<th class="num"><span class="sr">Acciones</span></th>';
  const actTd = p => ro ? '' : `<td class="num">${actions(p)}</td>`;
  // Stock: si el producto tiene receta, se calcula solo con los insumos que quedan; si no, es el que se escribe a mano
  const stockCell = p => tracked(p) ? (p.stock<=p.min?`<span class="badge low">${esc(p.stock)} · bajo</span>`:esc(p.stock))
    : (p.recipe||[]).length ? (p.alcanza!=null ? `<span class="${p.alcanza<=p.min?'badge low':''}">≈ ${esc(p.alcanza)}</span><div class="pcat">según insumos</div>` : '<span class="badge mute">insumos sin contar</span>')
    : '<span class="badge mute">sin control</span>';
  if(invFilter==='insumo'){
    $('invHint').textContent = ro ? 'Lo que queda de cada insumo y para cuántos productos alcanza.' : 'Cuando compres, presiona Compra: suma al inventario y actualiza el precio. Contar sirve para corregir lo que hay.';
    $('invHead').innerHTML=`<tr><th>Insumo</th><th class="num">Paquete</th>${ro?'':'<th class="num">Costo por unidad</th>'}<th class="num">Queda</th>${actTh}</tr>`;
    $('invBody').innerHTML = list.length ? list.map(p=>{
      const has=p.qty!=null, low=has && +p.qty<=+p.min;
      const paq = has && +p.content>0 ? `${num(p.qty/p.content,1)} paq.` : '';
      const est = alcanzaIns(p);
      return `<tr>
        <td><div class="pname">${esc(p.name)}</div>${!ro&&!(+p.price)?'<div class="pcat"><span class="badge warn">Falta el precio</span></div>':''}</td>
        <td class="num">${p.content?qtyU(p.content,p.unit):'—'}${ro?'':`<div class="pcat">${fmt(p.price)}</div>`}</td>
        ${ro?'':`<td class="num">${p.content?'$'+num(unitCostIns(p),2)+' / '+unitOf(p.unit):'—'}</td>`}
        <td class="num">${has?`<span class="${low?'badge low':''}">${qtyU(p.qty,p.unit)}</span><div class="pcat">${[paq, est?`alcanza para ≈ ${esc(est.n)} ${est.que}`:''].filter(Boolean).join(' · ')}</div>`:'<span class="badge mute">Sin registrar</span>'}</td>
        ${actTd(p)}</tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">Sin insumos</td></tr>';
  } else {
    $('invHint').textContent = invFilter==='adicional' ? 'Los adicionales se ofrecen al vender productos que los aceptan (las obleas).'
      : (ro ? '' : 'El costo sale de la receta (insumos + merma) o del costo escrito a mano. ')
        + 'El stock de lo que tiene receta se calcula con los insumos que quedan (cuántas salen de cada uno si solo se hiciera ese).';
    const venta = invFilter==='venta';
    $('invHead').innerHTML=`<tr><th>${venta?'Producto':'Adicional'}</th><th class="num">Precio</th>${ro?'':'<th class="num">Costo</th><th class="num">Ganancia</th><th class="num">Margen</th>'}${venta?'<th class="num">Stock</th>':''}${actTh}</tr>`;
    const cols = (ro?3:6) + (actTh?1:0);
    const nCat = c => list.filter(x=>(x.cat||'Sin categoría')===c).length;
    const grp = (p,ix) => venta && (ix===0 || (list[ix-1].cat||'Sin categoría')!==(p.cat||'Sin categoría'))
      ? `<tr class="grp"><td colspan="${cols}"><i class="dot" style="background:${catColor(p.cat,A.products.filter(x=>x.type==='venta'))}"></i> ${esc(p.cat||'Sin categoría')}<span class="n">${nCat(p.cat||'Sin categoría')}</span></td></tr>` : '';
    $('invBody').innerHTML = list.length ? list.map((p,ix)=>{
      const c=+p.unit_cost||0, g=p.price-c;
      return `${grp(p,ix)}<tr>
        <td><div class="pname">${esc(p.name)}</div><div class="pcat">${p.type==='venta'?`<i class="dot" style="background:${catColor(p.cat,A.products.filter(x=>x.type==='venta'))}"></i> ${esc(p.cat||'Sin categoría')}`:''}${(p.recipe||[]).length?` · receta${+p.merma?` + ${num(p.merma)} % merma`:''}`:''}${p.incl?` · incluye ${plS(p.incl)}`:''}${p.adds_ok?' · acepta adicionales':''}${p.salsa?' · salsa':''}</div></td>
        <td class="num">${fmt(p.price)}</td>
        ${ro?'':`<td class="num">${c?fmt(c):'<span class="badge warn">Sin costo</span>'}</td>
        <td class="num ${g>=0?'pos-v':'neg-v'}">${fmt(g)}</td>
        <td class="num">${pct(g,p.price)}</td>`}
        ${venta?`<td class="num">${stockCell(p)}</td>`:''}
        ${actTd(p)}</tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">Nada por aquí</td></tr>`;
  }
  $('invBody').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editProduct(b.dataset.edit));
  $('invBody').querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    const p=findA(b.dataset.del); if(!p) return;
    if(await askConfirm('Eliminar',`¿Eliminar "${p.name}"? Las ventas pasadas se conservan.${p.type==='insumo'?' Se quitará de las recetas que lo usan.':''}`,'Eliminar')){
      if(await run(()=>rpc('admin_eliminar_producto',{p_clave:A.key,p_id:p.id}),'Eliminado')) loadAdminProducts();
    }
  });
  $('invBody').querySelectorAll('[data-buy]').forEach(b=>b.onclick=async()=>{
    const p=findA(b.dataset.buy); if(!p) return;
    const v=await askForm({title:'Registrar compra: '+p.name, text:`Cada paquete trae ${p.content?qtyU(p.content,p.unit):'—'}.`, ok:'Registrar compra',
      fields:[{id:'n',label:'¿Cuántos paquetes compraste?',value:1,min:0,step:'any'},{id:'price',label:'Precio por paquete',value:+p.price||'',min:0,step:'1',hint:'Si cambió el precio, escríbelo aquí. Se usa para calcular los costos.'}],
      validate:x=>!x.n||x.n<=0?'Escribe una cantidad mayor que cero.':''});
    if(!v) return;
    const r=await run(()=>rpc('admin_insumo_compra',{p_clave:A.key,p_id:p.id,p_paquetes:v.n,p_precio:v.price}));
    if(r!==false){ toast(`${p.name}: ahora quedan ${qtyU(r,p.unit)}`); loadAdminProducts(); }
  });
  $('invBody').querySelectorAll('[data-count]').forEach(b=>b.onclick=async()=>{
    const p=findA(b.dataset.count); if(!p) return;
    const v=await askForm({title:'Contar: '+p.name, text:`Escribe cuánto hay ahora mismo, en ${p.unit==='u'?'unidades':p.unit==='ml'?'mililitros':'gramos'}. Ej: medio balde de 5 kg = 2500.`, ok:'Guardar',
      fields:[{id:'q',label:'Cantidad actual ('+(p.unit||'u')+')',value:p.qty!=null?Math.round(p.qty*100)/100:'',min:0,step:'any'}],
      validate:x=>x.q==null?'Escribe una cantidad.':(x.q<0?'No puede ser negativo.':'')});
    if(!v) return;
    if(await run(()=>rpc('admin_insumo_contar',{p_clave:A.key,p_id:p.id,p_cantidad:v.q}),'Cantidad guardada')) loadAdminProducts();
  });
  $('invBody').querySelectorAll('[data-adj]').forEach(b=>b.onclick=async()=>{
    const p=findA(b.dataset.adj); if(!p) return;
    const v=await askForm({title:'Ajustar stock: '+p.name, text:`Hay ${p.stock}. Escribe cuánto sumar (ej. 20) o restar (ej. -3).`, ok:'Aplicar',
      fields:[{id:'d',label:'Sumar o restar',value:'',step:'1'}], validate:x=>!x.d?'Escribe un número distinto de cero.':''});
    if(!v) return;
    const ns=await run(()=>rpc('admin_ajustar_stock',{p_clave:A.key,p_id:p.id,p_delta:Math.round(v.d)}));
    if(ns!==false){ toast(`${p.name}: ${ns} en stock`); loadAdminProducts(); }
  });
}

// ---- formulario de producto ----
function syncType(){
  const t=$('pType').value;
  document.querySelectorAll('#prodForm [data-for]').forEach(el=>el.hidden=!el.dataset.for.split(' ').includes(t));
  if(t!=='insumo'){ $('pCostBox').hidden = recipeRowsData().length>0; }
  const auto = t==='venta' && recipeRowsData().length>0;
  $('pStock').disabled = auto;
  if(auto) $('pStock').value='';
  $('pStock').placeholder = auto ? 'Automático (según insumos)' : 'Sin control';
  $('pStockHint').textContent = auto ? 'Se calcula solo con lo que queda de los insumos de la receta.' : 'Vacío = no se controla. Para sumar o restar usa "± Stock".';
  $('pMinInsHint').textContent = 'en '+({g:'gramos',ml:'mililitros',u:'unidades'}[$('pUnit').value]);
  updatePreview();
}
function recipeRowHtml(r){
  const opts=insumos().sort((a,b)=>a.name.localeCompare(b.name)).map(i=>`<option value="${esc(i.id)}" ${i.id===r.id?'selected':''}>${esc(i.name)}</option>`).join('');
  const u=findA(r.id)?.unit||'g';
  return `<div class="rrow"><select class="input r-ins" aria-label="Insumo"><option value="">Elige un insumo…</option>${opts}</select>
    <div class="unit"><input class="input r-qty" type="number" min="0" step="any" inputmode="decimal" value="${r.qty??''}" aria-label="Cantidad"><span class="r-u">${esc(u)}</span></div>
    <button type="button" class="icon-btn del r-del" aria-label="Quitar insumo">${icon('x')}</button></div>`;
}
function setRecipe(rows){ $('recipeRows').innerHTML=rows.map(recipeRowHtml).join(''); bindRecipe(); }
function bindRecipe(){
  $('recipeRows').querySelectorAll('.rrow').forEach(row=>{
    row.querySelector('.r-ins').onchange=e=>{ row.querySelector('.r-u').textContent=findA(e.target.value)?.unit||'g'; syncType(); };
    row.querySelector('.r-qty').oninput=syncType;
    row.querySelector('.r-del').onclick=()=>{ row.remove(); syncType(); };
  });
}
function recipeRowsData(){
  return [...$('recipeRows').querySelectorAll('.rrow')].map(r=>({id:r.querySelector('.r-ins').value, qty:+r.querySelector('.r-qty').value||0})).filter(r=>r.id&&r.qty>0);
}
$('addRecipeRow').onclick=()=>{ $('recipeRows').insertAdjacentHTML('beforeend',recipeRowHtml({id:'',qty:''})); bindRecipe(); };
function updatePreview(){
  if($('pType').value==='insumo') return;
  const rows=recipeRowsData(), merma=+$('pMerma').value||0, price=+$('pPrice').value||0;
  let cost;
  if(rows.length){
    // la merma no se suma a lo que se cuenta por unidades (las galletas van exactas)
    const fac = i => i.unit==='u' ? 1 : 1+merma/100;
    cost=rows.reduce((s,r)=>{const i=findA(r.id);return s+(i?r.qty*unitCostIns(i)*fac(i):0);},0);
    const det=rows.map(r=>{const i=findA(r.id);return i?`${esc(i.name)}: ${num(r.qty,2)} ${esc(i.unit||'')} = $${num(r.qty*unitCostIns(i),0)}`:''}).filter(Boolean).join('<br>');
    $('costPreview').innerHTML=`<div class="small muted">${det}${merma?`<br>+ ${num(merma)} % de merma en lo que va en gramos (las unidades van exactas)`:''}</div>Costo de producción: ${fmt(cost)} · Ganancia ${fmt(price-cost)} · Margen ${pct(price-cost,price)}`;
  } else {
    cost=+$('pCost').value||0;
    $('costPreview').innerHTML=`Costo: ${fmt(cost)} · Ganancia ${fmt(price-cost)} · Margen ${pct(price-cost,price)}`;
  }
}
['pPrice','pMerma','pCost'].forEach(id=>$(id).oninput=updatePreview);
$('pType').onchange=syncType; $('pUnit').onchange=syncType;
// Categorías: las que ya existen (obleas primero) y la opción de crear una nueva
function fillCats(selected){
  const cats=[...new Set(A.products.filter(p=>p.type==='venta').map(p=>p.cat).filter(Boolean))]
    .sort((a,b)=>(/oblea/i.test(b)-/oblea/i.test(a))||a.localeCompare(b));
  $('pCatSel').innerHTML = cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('') + '<option value="__new">+ Nueva categoría…</option>';
  const existe = cats.includes(selected);
  $('pCatSel').value = existe ? selected : (selected || !cats.length ? '__new' : cats[0]);
  $('pCat').value = existe ? '' : (selected||'');
  $('pCat').hidden = $('pCatSel').value!=='__new';
}
const catValue = () => $('pCatSel').value==='__new' ? $('pCat').value.trim() : $('pCatSel').value;
$('pCatSel').onchange=()=>{ const n=$('pCatSel').value==='__new'; $('pCat').hidden=!n; if(n) $('pCat').focus(); };
function resetForm(type){
  $('prodForm').reset(); $('pId').value=''; $('pType').value=type||'venta'; $('pType').disabled=false; $('pStock').dataset.orig='';
  $('pMin').value=5; $('pMerma').value= type==='adicional'?15:0; $('pUnit').value='g';
  $('formTitle').textContent='Nuevo'; $('saveBtn').textContent='Agregar'; setRecipe([]); fillCats(''); syncType();
}
function editProduct(id){
  const p=findA(id); if(!p) return;
  resetForm(p.type);
  $('pId').value=p.id; $('pName').value=p.name; fillCats(p.type==='venta'?(p.cat||''):'');
  if(p.type==='insumo'){
    $('pUnit').value=p.unit||'g'; $('pContent').value=p.content??''; $('pBuy').value=+p.price||''; $('pMinIns').value=p.min??'';
  } else {
    $('pPrice').value=p.price; $('pMerma').value=+p.merma||0; $('pCost').value=+p.cost||''; $('pStock').value=tracked(p)?p.stock:''; $('pStock').dataset.orig=$('pStock').value; $('pMin').value=p.min??5; $('pAddsOk').checked=!!p.adds_ok;
    $('pIncl').value=p.incl||0; $('pSalsa').checked=!!p.salsa;
    setRecipe(p.recipe||[]);
  }
  $('pType').disabled=true;    // el tipo no se cambia: dañaría las recetas (crea uno nuevo si hace falta)
  $('formTitle').textContent='Editar: '+p.name; $('saveBtn').textContent='Guardar cambios'; syncType();
  $('prodDialog').showModal();
}
$('newProd').onclick=()=>{ resetForm(invFilter); $('prodDialog').showModal(); $('pName').focus(); };
$('cancelEdit').onclick=$('cancelEdit2').onclick=()=>$('prodDialog').close();
$('prodForm').onsubmit=async e=>{
  e.preventDefault();
  if(!A.key){ $('prodDialog').close(); return; }
  const type=$('pType').value, name=$('pName').value.trim();
  if(!name){ toast('Escribe un nombre.'); return; }
  let data;
  if(type==='insumo'){
    if(!(+$('pContent').value>0)){ toast('Escribe cuánto trae cada paquete.'); return; }
    data={id:$('pId').value||null,name,type,unit:$('pUnit').value,content:+$('pContent').value,price:+$('pBuy').value||0,min:Math.round(+$('pMinIns').value||0)};
  } else {
    const sv=$('pStock').value.trim();
    const cat = type==='venta' ? catValue() : 'Adicionales';
    if(type==='venta' && !cat){ toast('Escribe el nombre de la nueva categoría.'); $('pCat').focus(); return; }
    data={id:$('pId').value||null,name,type,cat,price:+$('pPrice').value||0,
      cost:+$('pCost').value||0,merma:+$('pMerma').value||0,recipe:recipeRowsData(),
      min:parseInt($('pMin').value,10)||0,adds_ok:type==='venta'&&$('pAddsOk').checked,
      incl:type==='venta'?Math.max(0,parseInt($('pIncl').value,10)||0):0, salsa:type==='adicional'&&$('pSalsa').checked};
    // el stock solo se manda si es nuevo o si se cambió a mano: así no se pisan las ventas hechas mientras tanto
    if(type==='venta' && data.recipe.length){ if($('pStock').dataset.orig!=='') data.stock=null; }   // con receta: stock automático, se quita el manual
    else if(type==='venta' && (!data.id || sv!==$('pStock').dataset.orig)) data.stock = sv!=='' ? Math.max(0,parseInt(sv,10)||0) : null;
  }
  $('saveBtn').disabled=true;
  const ok=await run(()=>rpc('admin_guardar_producto',{p_clave:A.key,p_prod:data}), data.id?'Guardado':'Agregado');
  $('saveBtn').disabled=false;
  if(ok!==false){ $('prodDialog').close(); loadAdminProducts(); }
};

// =====================================================================
//  Descartes (administrador): lo que se dañó o no cumplió la calidad
// =====================================================================
let descLoaded=false; A.descartes=[];
const firstOfMonth = () => bogotaDay().slice(0,8)+'01';
$('descDesde').value=firstOfMonth(); $('descHasta').value=bogotaDay();
$('descDesde').onchange=$('descHasta').onchange=()=>loadDescartes();
const qtyD = (n,u) => unitOf(u)==='u' ? num(n,2)+' u' : qtyU(n,u);
// costo de una unidad, igual que el servidor: receta (unidades exactas, el resto con merma) o costo a mano
const costoBase = p => p.type==='insumo' ? unitCostIns(p) : (p.recipe||[]).length
  ? p.recipe.reduce((s,r)=>{ const i=findA(r.id); return s+(i ? +r.qty*unitCostIns(i)*(i.unit==='u'?1:1+(+p.merma||0)/100) : 0); },0)
  : (+p.cost||0);
async function loadDescartes(){
  if(!A.key) return;
  const r=await run(()=>rpc('admin_descartes',{p_clave:A.key,p_desde:$('descDesde').value||null,p_hasta:$('descHasta').value||null}));
  if(r!==false){ A.descartes=r||[]; descLoaded=true; }
  renderDescartes();
}
function renderDescartes(){
  const q=$('invSearch').value.toLowerCase();
  const all=A.descartes.filter(d=>String(d.name).toLowerCase().includes(q)), ok=all.filter(d=>!d.void);
  const total=ok.reduce((a,d)=>a+ +d.cost,0);
  $('descTotal').textContent='−'+fmt(total); $('descTotalN').textContent=plural(ok.length,'descarte','descartes');
  const agg={};
  ok.forEach(d=>{ const a=agg[d.product]=agg[d.product]||{name:d.name,unit:d.unit,q:0,c:0,n:0}; a.q+=+d.qty; a.c+=+d.cost; a.n++; });
  const rows=Object.values(agg).sort((a,b)=>b.c-a.c);
  $('descSum').innerHTML = rows.length ? rows.map(x=>`<tr><td><div class="pname">${esc(x.name)}</div></td><td class="num">${qtyD(x.q,x.unit)}</td><td class="num">${esc(x.n)}</td><td class="num neg-v">−${fmt(x.c)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Sin descartes en estas fechas</td></tr>';
  $('descSumFoot').innerHTML = rows.length ? `<tr><td colspan="3">Pérdida total</td><td class="num neg-v">−${fmt(total)}</td></tr>` : '';
  $('descList').innerHTML = all.length ? all.map(d=>`<tr class="${d.void?'void':''}">
      <td><b class="strike">${esc(d.name)}</b><div class="pcat">${fDate(d.date)} ${fTime(d.date)}${d.void?' · anulado':''}</div></td>
      <td class="num strike">${qtyD(d.qty,d.unit)}</td>
      <td>${esc(d.reason)||'—'}</td>
      <td class="num strike">−${fmt(d.cost)}</td>
      <td class="num">${d.void?'':`<button class="btn ghost sm" data-dvoid="${esc(d.uid)}">Anular</button>`}</td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">Sin descartes en estas fechas</td></tr>';
  $('descList').querySelectorAll('[data-dvoid]').forEach(b=>b.onclick=async()=>{
    const d=A.descartes.find(x=>x.uid===b.dataset.dvoid); if(!d) return;
    if(!await askConfirm('Anular descarte',`¿Anular el descarte de ${d.name}? Lo descartado vuelve al inventario.`,'Anular')) return;
    if(await run(()=>rpc('admin_anular_descarte',{p_clave:A.key,p_uid:d.uid}),'Descarte anulado')){ await loadAdminProducts(); await loadDescartes(); }
  });
}
function openDescarte(){
  const g=(t,l)=>{ const ps=A.products.filter(p=>p.type===t).sort((a,b)=>a.name.localeCompare(b.name));
    return ps.length?`<optgroup label="${l}">${ps.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>`:''; };
  $('descProd').innerHTML = g('venta','Productos para vender')+g('adicional','Adicionales')+g('insumo','Insumos');
  $('descQty').value=''; $('descReason').selectedIndex=0; $('descOther').hidden=true; $('descOther').value=''; $('descErr').textContent=''; $('descOk').disabled=false;
  syncDesc(); $('descDialog').showModal(); $('descProd').focus();
}
function syncDesc(){
  const p=findA($('descProd').value); if(!p){ $('descPreview').textContent=''; return; }
  const ins=p.type==='insumo', u=unitOf(p.unit);
  $('descQtyLbl').textContent = ins ? `Cantidad (${u==='u'?'unidades':u==='ml'?'mililitros':'gramos'})` : 'Cantidad (unidades)';
  $('descQty').step = ins&&u!=='u' ? 'any' : '1';
  $('descQtyHint').textContent = ins ? (p.qty!=null?`Quedan ${qtyU(p.qty,p.unit)}.`:'Este insumo no se ha contado: se registra la pérdida, pero no baja la existencia.')
    : tracked(p) ? `Hay ${p.stock} en stock.` : (p.recipe||[]).length ? 'También se sacan del inventario los insumos de su receta.' : '';
  const q=+$('descQty').value||0, unit=costoBase(p);
  $('descPreview').innerHTML = q>0 ? `Pérdida: <b>−${fmt(q*unit)}</b> <span class="muted small">(${qtyD(q,ins?p.unit:'u')} × ${'$'+num(unit,unit<100?2:0)}${ins&&u!=='u'?' el '+u:' c/u'})</span>` : `Costo por ${ins&&u!=='u'?u:'unidad'}: ${'$'+num(unit,2)}`;
}
$('descNew').onclick=openDescarte;
$('descProd').onchange=syncDesc; $('descQty').oninput=syncDesc;
$('descReason').onchange=()=>{ const o=$('descReason').value==='otro'; $('descOther').hidden=!o; if(o) $('descOther').focus(); };
$('descClose').onclick=$('descCancel').onclick=()=>$('descDialog').close();
$('descForm').onsubmit=async e=>{
  e.preventDefault();
  const p=findA($('descProd').value), q=+$('descQty').value;
  if(!p){ $('descErr').textContent='Elige qué se descartó.'; return; }
  if(!(q>0)){ $('descErr').textContent='Escribe la cantidad.'; return; }
  if(p.type!=='insumo' && !Number.isInteger(q)){ $('descErr').textContent='Los productos se descartan por unidades completas.'; return; }
  const motivo = $('descReason').value==='otro' ? $('descOther').value.trim() : $('descReason').value;
  $('descOk').disabled=true; $('descErr').textContent='';
  try{
    const d=await rpc('admin_descartar',{p_clave:A.key,p_id:p.id,p_cantidad:q,p_motivo:motivo});
    $('descDialog').close(); toast(`Descarte registrado. Pérdida −${fmt(d.cost)}`);
    await loadAdminProducts(); await loadDescartes();
  }catch(err){
    $('descErr').textContent=errText(err); $('descOk').disabled=false;
    if(String(err.message).includes('CLAVE_INCORRECTA')){ $('descDialog').close(); lockAdmin(true); }
  }
};

// =====================================================================
//  Caja (cierre del día)
// =====================================================================
$('closeDate').value = bogotaDay();
$('closeDate').onchange = loadSales;
$('refreshBtn').onclick = async()=>{ await loadSales(); toast('Caja actualizada'); };
async function loadSales(quiet){
  if(A.role==='vend'){
    const [r,p] = await Promise.all([
      run(()=>rpc('vend_caja',{p_pin:A.pin}),null,quiet===true),
      run(()=>rpc('vend_inventario',{p_pin:A.pin}),null,quiet===true)]);
    if(r!==false && r){ A.sales=r.ventas||[]; A.cajas=r.cajas||[]; A.consumo=r.consumo||[]; $('closeDate').value=r.dia; }
    if(p!==false) A.products=p||[];
    if(A.role==='vend') renderClose();
    return;
  }
  if(!A.key) return;
  const dia=$('closeDate').value||null;
  const [v,c,p,d] = await Promise.all([
    run(()=>rpc('admin_ventas',{p_clave:A.key,p_dia:dia}),null,quiet===true),
    run(()=>rpc('admin_cajas',{p_clave:A.key,p_dia:dia}),null,quiet===true),
    run(()=>rpc('admin_productos',{p_clave:A.key}),null,quiet===true),
    run(()=>rpc('admin_descartes',{p_clave:A.key,p_desde:dia,p_hasta:dia}),null,true)]);
  A.descDia = d!==false ? (d||[]) : [];
  if(v!==false) A.sales=v||[];
  if(c!==false) A.cajas=c||[];
  if(p!==false) A.products=p||[];
  renderClose();
}
const plural = (n,s='venta',p='ventas') => n+' '+(n===1?s:p);
const saleCost = s => s.cost!=null ? +s.cost : s.items.reduce((a,i)=>a+(+i.cost||0)*i.qty,0);
function renderClose(){
  const all=A.sales, ok=all.filter(s=>!s.void);
  const f=m=>ok.filter(s=>s.pay===m), sum=l=>l.reduce((a,s)=>a+ +s.total,0);
  const cash=sum(f('efectivo')), tr=sum(f('transferencia')), tot=cash+tr;
  const perdida=(A.role==='vend'?[]:(A.descDia||[])).filter(d=>!d.void).reduce((a,d)=>a+ +d.cost,0);
  const cost=ok.reduce((a,s)=>a+saleCost(s),0), desc=ok.reduce((a,s)=>a+(+s.discount||0),0), gan=tot-cost-perdida;
  const d=new Date($('closeDate').value+'T12:00');
  $('closeTitle').textContent = isNaN(d) ? '' : d.toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).replace(/^./,c=>c.toUpperCase());
  $('sTotal').textContent=fmt(tot); $('sTotalN').textContent=plural(ok.length)+(all.length>ok.length?` · ${all.length-ok.length} anuladas`:'');
  $('sCash').textContent=fmt(cash); $('sCashN').textContent=plural(f('efectivo').length);
  $('sTransfer').textContent=fmt(tr); $('sTransferN').textContent=plural(f('transferencia').length);
  $('sProfit').textContent=fmt(gan); $('sProfitN').textContent=`Costo ${fmt(cost)}${desc?` · Descuentos ${fmt(desc)}`:''}${perdida?` · Descartes −${fmt(perdida)}`:''} · Margen ${pct(gan,tot)}`;

  // Caja (el vendedor no ve "debería haber", lo contado ni el resultado)
  const ro = A.role==='vend';
  $('cajasHead').innerHTML = ro
    ? '<tr><th>Abierta</th><th>Cerrada</th><th class="num">Base</th><th class="num">Ventas efectivo</th><th class="num">Transferencias</th><th>Estado</th></tr>'
    : '<tr><th>Abierta</th><th>Cerrada</th><th class="num">Base</th><th class="num">Ventas efectivo</th><th class="num">Debería haber</th><th class="num">Contado</th><th>Resultado</th></tr>';
  $('cajasBody').innerHTML = !A.cajas.length ? '<tr><td colspan="7" class="empty">No se abrió caja este día</td></tr>'
    : ro ? A.cajas.map(c=>`<tr><td>${fTime(c.desde)}</td><td>${c.hasta?fTime(c.hasta):'—'}</td><td class="num">${fmt(c.base)}</td><td class="num">${fmt(c.efectivo)}</td><td class="num">${fmt(c.transferencia)}</td><td>${c.abierta?'<span class="badge warn">Abierta</span>':'<span class="badge mute">Cerrada</span>'}</td></tr>`).join('')
    : A.cajas.map(c=>{
    const esperado=+c.base + +c.efectivo, diff=c.abierta?null:(+c.contado - esperado);
    const res = c.abierta ? '<span class="badge warn">Abierta</span>' : diff===0 ? '<span class="badge ok">Cuadra</span>' : diff<0 ? `<span class="badge low">Falta ${fmt(-diff)}</span>` : `<span class="badge transfer">Sobra ${fmt(diff)}</span>`;
    return `<tr><td>${fTime(c.desde)}</td><td>${c.hasta?fTime(c.hasta):'—'}</td><td class="num">${fmt(c.base)}</td><td class="num">${fmt(c.efectivo)}</td><td class="num"><b>${fmt(esperado)}</b></td><td class="num">${c.abierta?'—':fmt(c.contado)}</td><td>${res}${c.notas?`<div class="pcat">${esc(c.notas)}</div>`:''}</td></tr>`;
  }).join('');

  // Unidades vendidas
  const groups={}; let addsN=0;
  ok.forEach(s=>s.items.forEach(i=>{
    const c=/^oblea/i.test(i.cat||i.name)?'Obleas':/^boli/i.test(i.cat||i.name)?'Bolis':(i.cat||'Otros');
    groups[c]=(groups[c]||0)+int(i.qty); addsN+=(i.adds||[]).filter(a=>!a.incl).length*int(i.qty);
  }));
  const tiles=[['Obleas',groups.Obleas||0],['Bolis',groups.Bolis||0],...Object.entries(groups).filter(([k])=>k!=='Obleas'&&k!=='Bolis'),['Adicionales',addsN]];
  $('unitTiles').innerHTML=tiles.map(([k,v])=>`<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');

  // Ventas
  $('salesBody').innerHTML = all.length ? all.slice().reverse().map(s=>`<tr class="${s.void?'void':''}">
    <td class="num" style="text-align:left"><b>N.º ${pad3(s.order)}</b>${s.edited?'<div class="pcat">editada</div>':''}</td>
    <td class="num" style="text-align:left">${fTime(s.date)}</td>
    <td class="strike">${s.items.map(i=>`${esc(i.qty)}× ${esc(i.name)}${addsTxt(i)?` <span class="pcat">(+ ${esc(addsTxt(i))})</span>`:''}`).join('<br>')}${+s.discount>0?`<div class="pcat">Descuento mesero −${fmt(s.discount)}</div>`:''}</td>
    <td>${s.void?'<span class="badge mute">Anulada</span>':s.pay==='efectivo'?`<span class="badge cash">Efectivo</span>`:`<span class="badge transfer">Transferencia</span>`}</td>
    <td class="num strike"><b>${fmt(s.total)}</b></td>
    <td class="num"><div class="actions">
      <button class="icon-btn" data-rc="${esc(s.uid)}" aria-label="Ver e imprimir el recibo de la orden ${pad3(s.order)}" title="Recibo">${icon('print')}</button>
      ${s.void?'':`<button class="icon-btn" data-ed="${esc(s.uid)}" aria-label="Editar la orden ${pad3(s.order)}" title="Editar">${icon('edit')}</button>
      <button class="btn ghost sm" data-void="${esc(s.uid)}">Anular</button>`}</div></td></tr>`).join('')
    : `<tr><td colspan="6" class="empty">No hay ventas en esta fecha</td></tr>`;
  $('salesBody').querySelectorAll('[data-rc]').forEach(b=>b.onclick=()=>openReceipt(A.sales.find(x=>x.uid===b.dataset.rc)));
  $('salesBody').querySelectorAll('[data-ed]').forEach(b=>b.onclick=()=>{ const s=A.sales.find(x=>x.uid===b.dataset.ed); if(s) startEdit(s); });
  $('salesBody').querySelectorAll('[data-void]').forEach(b=>b.onclick=async()=>{
    const s=A.sales.find(x=>x.uid===b.dataset.void); if(!s) return;
    if(!await askConfirm('Anular venta',`¿Anular la orden N.º ${pad3(s.order)} de ${fmt(s.total)}? Los productos e insumos vuelven al inventario.`,'Anular')) return;
    if(await run(()=>rpc('admin_anular',{p_clave:A.key,p_uid:s.uid}),'Venta anulada')) loadSales();
  });

  // Ganancia por producto (cada adicional aparte)
  const agg={};
  const addRow=(k,q,v,c)=>{ agg[k]=agg[k]||{q:0,v:0,c:0}; agg[k].q+=q; agg[k].v+=v; agg[k].c+=c; };
  ok.forEach(s=>s.items.forEach(i=>{
    const adds=i.adds||[];
    const base = i.base ?? (+i.price - adds.reduce((a,x)=>a+ +x.price,0));
    // las salsas incluidas en el precio se suman al costo del producto, no van en fila aparte
    const inclCost = adds.filter(a=>a.incl).reduce((a,x)=>a+(+x.cost||0),0);
    const bcost = (i.base_cost ?? ((+i.cost||0) - adds.reduce((a,x)=>a+(+x.cost||0),0))) + (i.base_cost!=null ? inclCost : 0);
    const q=int(i.qty);
    addRow(i.name, q, base*q, bcost*q);
    adds.filter(a=>!a.incl).forEach(a=>addRow('+ '+a.name, q, (+a.price||0)*q, (+a.cost||0)*q));
  }));
  const rows=Object.entries(agg).sort((a,b)=>(b[1].v-b[1].c)-(a[1].v-a[1].c));
  $('profitBody').innerHTML = rows.length ? rows.map(([n,x])=>{ const g=x.v-x.c; return `<tr><td>${esc(n)}</td><td class="num">${esc(x.q)}</td><td class="num">${fmt(x.v)}</td><td class="num">${x.c?fmt(x.c):'<span class="badge warn">Sin costo</span>'}</td><td class="num ${g>=0?'pos-v':'neg-v'}">${fmt(g)}</td><td class="num">${pct(g,x.v)}</td></tr>`; }).join('') : '<tr><td colspan="6" class="empty">Sin ventas</td></tr>';
  const tv=rows.reduce((a,[,x])=>a+x.v,0), tc=rows.reduce((a,[,x])=>a+x.c,0);
  $('profitFoot').innerHTML = rows.length ? `${desc?`<tr><td colspan="4">Descuentos a meseros</td><td class="num neg-v">−${fmt(desc)}</td><td></td></tr>`:''}<tr><td colspan="2">Total</td><td class="num">${fmt(tv-desc)}</td><td class="num">${fmt(tc)}</td><td class="num">${fmt(tv-desc-tc)}</td><td class="num">${pct(tv-desc-tc,tv-desc)}</td></tr>` : '';

  // Insumos usados
  const used={};
  $('usedHead').innerHTML = `<tr><th>Insumo</th><th class="num">Cantidad usada</th>${ro?'':'<th class="num">Costo</th>'}<th class="num">Queda</th></tr>`;
  (ro ? (A.consumo||[]) : ok.flatMap(s=>s.consumo||[])).forEach(x=>{ used[x.id]=used[x.id]||{name:x.name,unit:x.unit,q:0,c:0}; used[x.id].q+=+x.qty; used[x.id].c+=+x.cost||0; });
  const urows=Object.entries(used).sort((a,b)=>b[1].c-a[1].c);
  $('usedBody').innerHTML = urows.length ? urows.map(([id,x])=>{ const p=findA(id); const left=p&&p.qty!=null?`<span class="${+p.qty<=+p.min?'badge low':''}">${qtyU(p.qty,p.unit)}</span>`:'<span class="badge mute">Sin registrar</span>';
    return `<tr><td>${esc(x.name)}</td><td class="num">${qtyU(x.q,x.unit)}</td>${ro?'':`<td class="num">${fmt(x.c)}</td>`}<td class="num">${left}</td></tr>`; }).join('')
    : '<tr><td colspan="4" class="empty">No se usaron insumos</td></tr>';
}
function download(content,name,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }
$('csvBtn').onclick=()=>{
  const rows=[['Orden','Fecha','Hora','Productos','Pago','Subtotal','Descuento','Total','Costo','Ganancia','Estado']];
  A.sales.forEach(s=>rows.push([pad3(s.order),s.day,fTime(s.date),s.items.map(i=>i.qty+'x '+i.name+(addsTxt(i)?' (+ '+addsTxt(i)+')':'')).join(' | '),s.pay,s.subtotal??s.total,s.discount||0,s.total,Math.round(saleCost(s)),Math.round(s.total-saleCost(s)),s.void?'Anulada':'OK']));
  download('﻿'+rows.map(r=>r.map(c=>{ let v=String(c??''); if(typeof c==='string' && /^[=+\-@\t\r]/.test(v)) v="'"+v; return `"${v.replace(/"/g,'""')}"`; }).join(';')).join('\n'),`cierre_${$('closeDate').value}.csv`,'text/csv');
};
setInterval(()=>{ if((A.key||A.role==='vend') && !document.hidden && $('page-cierre').classList.contains('active') && !document.querySelector('dialog[open]')) loadSales(true); },30000);

// =====================================================================
//  Ajustes (administrador)
// =====================================================================
function renderSettings(){
  $('pinState').textContent = S.pidePin
    ? 'Se pide un PIN para abrir y cerrar caja y para vender.'
    : 'No hay PIN: cualquier persona con el enlace puede abrir caja y vender.';
  $('clearPin').hidden=!S.pidePin; $('newPin').value='';
  $('meseroState').textContent = S.pideMesero
    ? 'Ya hay un código. Los meseros lo escriben al tocar "Descuento mesero" en la venta.'
    : 'Aún no hay código: el descuento de meseros está desactivado.';
  $('clearMesero').hidden=!S.pideMesero; $('newMesero').value='';
  $('descMax').value=S.descMax;
}
$('setDescMax').onclick=async()=>{
  const v=Math.round(+$('descMax').value); if(!(v>=1&&v<=100)){ toast('Escribe un porcentaje entre 1 y 100.'); return; }
  const r=await run(()=>rpc('admin_fijar_descuento_max',{p_clave:A.key,p_pct:v}),'Descuento máximo guardado');
  if(r!==false){ S.descMax=+r||v; renderSettings(); }
};
$('setPin').onclick=async()=>{
  const v=$('newPin').value.trim(); if(v.length<6){ toast('El PIN debe tener al menos 6 caracteres.'); return; }
  if(await run(()=>rpc('admin_fijar_pin',{p_clave:A.key,p_pin:v}),'PIN de vendedor guardado')){ S.pidePin=true; pinStore.set(v); renderSettings(); }
};
$('clearPin').onclick=async()=>{
  if(!await askConfirm('Quitar PIN','Cualquier persona con el enlace podrá abrir caja y vender.','Quitar PIN')) return;
  if(await run(()=>rpc('admin_fijar_pin',{p_clave:A.key,p_pin:''}),'PIN eliminado')){ S.pidePin=false; pinStore.set(''); renderSettings(); }
};
$('setMesero').onclick=async()=>{
  const v=$('newMesero').value.trim(); if(v.length<6){ toast('El código debe tener al menos 6 caracteres.'); return; }
  if(await run(()=>rpc('admin_fijar_codigo_mesero',{p_clave:A.key,p_codigo:v}),'Código de meseros guardado')){ S.pideMesero=true; renderSettings(); }
};
$('clearMesero').onclick=async()=>{
  if(!await askConfirm('Quitar código','Ya no se podrán hacer descuentos de meseros.','Quitar código')) return;
  if(await run(()=>rpc('admin_fijar_codigo_mesero',{p_clave:A.key,p_codigo:''}),'Código eliminado')){ S.pideMesero=false; renderSettings(); }
};
$('chgPw').onclick=async()=>{
  const nueva = await askSecret({title:'Nueva contraseña', label:'Nueva contraseña (mínimo 8 caracteres)', twice:true, min:8,
    check: async v => { try{ await rpc('admin_cambiar_clave',{p_clave:A.key,p_nueva:v}); return ''; }catch(e){ return errText(e); } }});
  if(nueva){ A.key=nueva; toast('Contraseña cambiada'); }
};
$('exportBtn').onclick=async()=>{
  const d = await run(()=>rpc('admin_respaldo',{p_clave:A.key}));
  if(d!==false) download(JSON.stringify(d,null,2),`respaldo_obleas_matilde_${bogotaDay()}.json`,'application/json');
};
$('importLbl').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('importFile').click();}};
$('importFile').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader(); r.onload=async()=>{
    e.target.value='';
    let d; try{ d=JSON.parse(r.result); if(!Array.isArray(d.products)||!Array.isArray(d.sales)) throw 0; }catch(err){ toast('Ese archivo no es un respaldo válido.'); return; }
    if(!await askConfirm('Subir respaldo',`Se actualizarán ${d.products.length} productos y se agregarán las ventas que falten (${d.sales.length} en el archivo).`,'Subir')) return;
    toast('Subiendo respaldo…');
    const res = await run(()=>rpc('admin_restaurar',{p_clave:A.key,p_datos:{products:d.products,sales:d.sales}}));
    if(res!==false) toast(`Respaldo subido: ${res.productos} productos y ${res.ventas} ventas nuevas`);
  }; r.readAsText(f);
};

// =====================================================================
//  Inicio
// =====================================================================
(function start(){
  renderCart();
  const cfg = window.OM_CONFIG || {};
  if(!cfg.url || !cfg.key || !window.supabase){
    setSync(false,'Sin configurar');
    banner(!window.supabase ? 'No se pudo cargar la conexión. Revisa el internet y recarga.' : 'Falta conectar la base de datos: abre el archivo config.js y pega la URL y la clave pública de Supabase.');
    $('prodGrid').innerHTML='<div class="empty" style="grid-column:1/-1">Sin conexión con la base de datos.</div>';
    return;
  }
  sb = window.supabase.createClient(cfg.url, cfg.key, { auth:{ persistSession:false, autoRefreshToken:false } });
  syncSheet();
  loadMenu();
  setInterval(()=>{ if(!document.hidden && $('page-vender').classList.contains('active') && !saving && !document.querySelector('dialog[open]')) loadMenu(); },30000);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && $('page-vender').classList.contains('active')) loadMenu(); });
})();
