const API_BASE = window.SOS_CONFIG?.API_BASE || "https://api.queltu.com";
const TOKEN_KEY = "queltu_hse_professional_token";
const USER_KEY = "queltu_hse_professional_user";
let currentUser = null;
let cases = [];
let currentCaseId = null;
let workspace = null;
let searchTimer = null;

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const upper = (value) => String(value || "").toUpperCase();
const fmtDate = (value, dateOnly = false) => { if (!value) return "—"; const d = new Date(value); if (Number.isNaN(d.getTime())) return "—"; return new Intl.DateTimeFormat("es-CL", dateOnly ? {dateStyle:"medium"} : {dateStyle:"short",timeStyle:"short"}).format(d); };
const listText = (value) => Array.isArray(value) ? value.map(item => typeof item === "string" ? item : item?.description || item?.text || JSON.stringify(item)).filter(Boolean).join("\n") : "";
const lines = (value) => String(value || "").split(/\n+/).map(item => item.trim()).filter(Boolean);
const statusLabel = {OPEN:"Abierta",INVESTIGATING:"En investigación",ACTION_PLAN:"Plan de acción",CLOSED:"Cerrada",REQUESTED:"Pendiente de aprobación",APPROVED:"Aprobada",REJECTED:"Devuelta",ACTIVE:"Activo",ASSIGNED:"Asignado",EN_ROUTE:"En camino",ON_SITE:"En sitio",RESOLVED:"Resuelto",CANCELLED:"Cancelado",LOW:"Bajo",MODERATE:"Moderado",HIGH:"Alto",CRITICAL:"Crítico",INITIAL:"Inicial",RESIDUAL:"Residual",IN_PROGRESS:"En progreso",DONE:"Completada",CANCELLED_ACTION:"Cancelada"};
const label = (value) => statusLabel[upper(value)] || String(value || "—").replaceAll("_"," ");

function token(){ return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; }
function headers(){ return token() ? {Authorization:`Bearer ${token()}`} : {}; }
async function api(path, options={}){
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers:{"Content-Type":"application/json",...headers(),...(options.headers||{})} });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : {message:await response.text()};
  if (!response.ok) { const error = new Error(data.message || `Error HTTP ${response.status}`); error.status=response.status; throw error; }
  return data;
}
function toast(message,error=false){ const el=$("toast"); el.textContent=message; el.className=`toast${error?" error":""}`; clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.add("hidden"),4200); }
function setLoginMessage(message,error=true){ $("loginMessage").textContent=message||""; $("loginMessage").style.color=error?"#bd2426":"#0c8e4e"; }
function setBusy(button,busy,text){ if(!button)return; if(busy){button.dataset.label=button.textContent;button.textContent=text||"Procesando…";button.disabled=true;}else{button.textContent=button.dataset.label||button.textContent;button.disabled=false;} }

async function login(){
  const phone=$("loginPhone").value.trim(), code=$("loginCode").value.trim(), button=$("loginBtn");
  if(!phone) return setLoginMessage("Ingresa el teléfono del Profesional HSE.");
  setBusy(button,true,"Validando…"); setLoginMessage("");
  try{
    const result=await api("/resolver/auth/login",{method:"POST",body:JSON.stringify({phone,code:code||undefined,channel:"demo"})});
    if(result.requires_verification){ setLoginMessage(result.demo_code?`Código demo: ${result.demo_code}`:`Código enviado por ${result.otp_channel||"SMS"}.`,false); $("loginCode").focus(); return; }
    if(upper(result.user?.role)!=="RESOLVER") throw new Error("Esta cuenta no corresponde a un Profesional HSE.");
    sessionStorage.setItem(TOKEN_KEY,result.token); sessionStorage.setItem(USER_KEY,JSON.stringify(result.user));
    currentUser=result.user; showPortal(); await loadCases();
  }catch(error){ setLoginMessage(error.message); } finally{ setBusy(button,false); }
}
async function restoreSession(){
  if(!token()) return;
  try{ const result=await api("/auth/session"); if(upper(result.user?.role)!=="RESOLVER") throw new Error("Rol no autorizado"); currentUser=result.user; showPortal(); await loadCases(); }
  catch{ logout(false); }
}
function showPortal(){ $("loginView").classList.add("hidden"); $("portalView").classList.remove("hidden"); $("sessionName").textContent=currentUser?.full_name||"Profesional HSE"; $("sessionCenter").textContent=currentUser?.control_center_name||currentUser?.control_center_code||"Operación minera"; }
function logout(reload=true){ sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(USER_KEY);localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY); if(reload)location.reload(); }

async function loadCases(){
  const list=$("caseList"); list.innerHTML='<div class="stack-item">Cargando expedientes…</div>';
  try{
    const q=encodeURIComponent($("caseSearch").value.trim()), status=encodeURIComponent($("caseStatus").value);
    const result=await api(`/hse/professional/cases?limit=200&q=${q}&status=${status}`); cases=result.cases||[];
    $("caseCount").textContent=`${cases.length} expediente${cases.length===1?"":"s"}`;
    renderCases();
    if(currentCaseId && cases.some(item=>item.id===currentCaseId)) await openCase(currentCaseId,false);
  }catch(error){ list.innerHTML=`<div class="stack-item"><strong>No fue posible cargar casos</strong><p>${esc(error.message)}</p></div>`; if(error.status===401)logout(); }
}
function renderCases(){
  $("caseList").innerHTML=cases.length?cases.map(item=>{
    const active=item.id===currentCaseId?" active":"";
    const alert=Number(item.overdue_actions)>0?" alert":"";
    return `<button class="case-item${active}" data-case-id="${esc(item.id)}"><strong>${esc(item.title||item.alert_type||"Caso HSE")}</strong><div class="case-row"><span>#${esc(item.id.slice(0,8).toUpperCase())} · ${esc(item.event_sector_name||"Sin área")}</span></div><div class="case-row"><span>${esc(fmtDate(item.created_at))}</span><span class="mini-status${alert}">${esc(label(item.investigation_status))}</span></div></button>`;
  }).join(""):'<div class="stack-item"><strong>Sin casos</strong><p>No hay expedientes asignados con estos filtros.</p></div>';
  document.querySelectorAll("[data-case-id]").forEach(button=>button.addEventListener("click",()=>openCase(button.dataset.caseId)));
}
async function openCase(id,activate=true){
  currentCaseId=id; if(activate){renderCases();$("emptyWorkspace").classList.add("hidden");$("caseWorkspace").classList.remove("hidden");}
  try{ workspace=await api(`/hse/professional/tickets/${id}/workspace`); renderWorkspace(); }
  catch(error){toast(error.message,true); if(error.status===401)logout();}
}
function latestRisk(phase){ return (workspace?.risk_assessments||[]).find(item=>upper(item.phase)===phase); }
function renderWorkspace(){
  const t=workspace.ticket||{}, i=workspace.incident||{}, initial=latestRisk("INITIAL"), residual=latestRisk("RESIDUAL");
  $("caseKicker").textContent=`CASO #${String(t.id||"").slice(0,8).toUpperCase()} · ${t.alert_type||"HSE"}`; $("caseTitle").textContent=t.title||"Caso sin título";
  $("caseMeta").textContent=`${t.event_sector_name||i.area||"Área no informada"} · ${fmtDate(t.created_at)} · ${t.citizen_name||"Persona no informada"}`;
  $("investigationBadge").textContent=label(i.investigation_status||"OPEN"); $("ticketState").textContent=label(t.state);
  $("initialRisk").textContent=initial?`${initial.score}/25 · ${label(initial.risk_level)}`:"Pendiente"; $("residualRisk").textContent=residual?`${residual.score}/25 · ${label(residual.risk_level)}`:"Pendiente";
  $("openActions").textContent=String((workspace.corrective_actions||[]).filter(a=>["OPEN","IN_PROGRESS"].includes(upper(a.status))).length);
  $("ticketDetails").innerHTML=[
    ["Tipo",t.alert_type],["Área / faena",t.event_sector_name||i.area],["Persona",t.citizen_name],["Teléfono",t.citizen_phone],["Prioridad",t.priority],["Ubicación",t.latitude&&t.longitude?`${t.latitude}, ${t.longitude}`:null],["Descripción",t.description]
  ].map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value||"—")}</dd>`).join("");
  renderTimeline(); fillInvestigation(i); renderRisks(); renderControls(); renderActions(); renderClosure();
}
function renderTimeline(){
  const entries=[...(workspace.timeline||[]).map(x=>({...x,kind:"action"})),...(workspace.notes||[]).map(x=>({description:x.note,created_at:x.created_at,actor_name:x.author_name,action_type:"NOTA",kind:"note"})),...(workspace.voice_sessions||[]).map(x=>({description:`Llamada segura · ${x.duration_seconds||0} segundos`,created_at:x.created_at,actor_name:"WA-Center",action_type:"LLAMADA",recording_url:x.recording_url,kind:"voice"}))].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  $("timelineList").innerHTML=entries.length?entries.map(item=>`<div class="timeline-item"><strong>${esc(label(item.action_type))}</strong><p>${esc(item.description||"Actividad registrada")}</p>${item.recording_url?`<audio controls preload="none" src="${esc(item.recording_url)}"></audio>`:""}<time>${esc(fmtDate(item.created_at))} · ${esc(item.actor_name||item.actor_role||"Sistema")}</time></div>`).join(""):'<div class="stack-item">Aún no hay actividades registradas.</div>';
}
function fillInvestigation(i){
  $("investigationMethod").value=i.investigation_method||"FIVE_WHYS"; $("investigationStatus").value=i.investigation_status==="ACTION_PLAN"?"ACTION_PLAN":i.investigation_status==="OPEN"?"OPEN":"INVESTIGATING";
  $("problemStatement").value=i.problem_statement||""; $("incidentDescription").value=i.description||""; $("eventSequence").value=listText(i.event_sequence); $("immediateCauses").value=listText(i.immediate_causes); $("contributingFactors").value=listText(i.contributing_factors); $("rootCauses").value=listText(i.root_causes); $("immediateActions").value=i.immediate_actions||""; $("investigationNotes").value=i.investigation_notes||""; $("conclusion").value=i.conclusion||""; $("lessonsLearned").value=i.lessons_learned||""; $("recommendations").value=i.recommendations||"";
}
async function saveInvestigation(){
  const button=$("saveInvestigationBtn");setBusy(button,true,"Guardando…");
  try{ await api(`/hse/professional/tickets/${currentCaseId}/investigation`,{method:"PATCH",body:JSON.stringify({investigation_method:$("investigationMethod").value,investigation_status:$("investigationStatus").value,problem_statement:$("problemStatement").value,description:$("incidentDescription").value,event_sequence:lines($("eventSequence").value).map(description=>({description})),immediate_causes:lines($("immediateCauses").value),contributing_factors:lines($("contributingFactors").value),root_causes:lines($("rootCauses").value),immediate_actions:$("immediateActions").value,investigation_notes:$("investigationNotes").value,conclusion:$("conclusion").value,lessons_learned:$("lessonsLearned").value,recommendations:$("recommendations").value})});toast("Investigación guardada");await openCase(currentCaseId,false);
  }catch(error){toast(error.message,true);}finally{setBusy(button,false);}
}
function renderRisks(){
  const suggestion=workspace.frequency_suggestion||{};
  $("riskHistory").innerHTML=(workspace.risk_assessments||[]).length?(workspace.risk_assessments||[]).map(r=>`<div class="stack-item"><div class="row"><strong>${esc(label(r.phase))} · ${esc(r.score)}/25</strong><span class="tag${upper(r.risk_level)==="CRITICAL"?" danger":""}">${esc(label(r.risk_level))}</span></div><p>Gravedad ${esc(r.severity)} × frecuencia ${esc(r.frequency)} · ${esc(label(r.frequency_source))}</p><small>${esc(fmtDate(r.assessed_at))} · ${esc(r.assessed_by_name||"Profesional HSE")}</small></div>`).join(""):'<div class="stack-item">Sin evaluaciones registradas.</div>';
  if(suggestion.available) $("riskNotes").placeholder=`Sugerencia estadística disponible: frecuencia ${suggestion.value}. Fundamente la selección.`;
  updateRiskPreview();
}
function updateRiskPreview(){const score=Number($("riskSeverity").value)*Number($("riskFrequency").value);const level=score>=20?"Crítico":score>=12?"Alto":score>=6?"Moderado":"Bajo";$("riskPreview").textContent=`Puntaje: ${score}/25 · ${level}`;}
async function saveRisk(){const button=$("saveRiskBtn");setBusy(button,true,"Registrando…");try{await api(`/hse/professional/tickets/${currentCaseId}/risk`,{method:"POST",body:JSON.stringify({phase:$("riskPhase").value,severity:Number($("riskSeverity").value),frequency:Number($("riskFrequency").value),frequency_source:"PROFESSIONAL_ESTIMATE",notes:$("riskNotes").value})});$("riskNotes").value="";toast("Evaluación registrada");await openCase(currentCaseId,false);}catch(error){toast(error.message,true);}finally{setBusy(button,false);}}
function renderControls(){
  const verifications=workspace.control_verifications||[];
  $("controlsList").innerHTML=(workspace.critical_controls||[]).length?(workspace.critical_controls||[]).map(c=>{const v=verifications.find(x=>x.control_id===c.id);return `<div class="stack-item"><div class="row"><strong>${esc(c.code)} · ${esc(c.name)}</strong><span class="tag${upper(v?.result)==="FAILED"?" danger":""}">${esc(v?label(v.result):"Sin verificar")}</span></div><p>${esc(c.hazard||"Peligro no informado")} · ${esc(c.work_area||"Toda la operación")}</p><small>${esc(c.verification_question||"")}</small></div>`;}).join(""):'<div class="stack-item">No hay controles críticos configurados.</div>';
  $("pnrList").innerHTML=(workspace.pnr_documents||[]).length?(workspace.pnr_documents||[]).map(p=>`<div class="stack-item"><div class="row"><strong>${esc(p.code)} · ${esc(p.title)}</strong><span class="tag">${esc(label(p.document_type))}</span></div><p>Versión ${esc(p.version)} · ${esc(p.work_area||"Toda la operación")}</p><div class="stack-item-actions"><button class="small-button" data-pnr-id="${esc(p.id)}">Visualizar documento</button></div></div>`).join(""):'<div class="stack-item">No hay PNR aplicables al área del caso.</div>';
  document.querySelectorAll("[data-pnr-id]").forEach(button=>button.addEventListener("click",()=>openPnr(button.dataset.pnrId)));
}
async function openPnr(id){try{const response=await fetch(`${API_BASE}/mobile/safety/pnr/${id}/content`,{headers:headers()});if(!response.ok)throw new Error(await response.text());const blob=await response.blob(),url=URL.createObjectURL(blob);window.open(url,"_blank","noopener");setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){toast(error.message,true);}}
function renderActions(){
  $("actionsList").innerHTML=(workspace.corrective_actions||[]).length?(workspace.corrective_actions||[]).map(a=>`<div class="stack-item"><div class="row"><strong>${esc(a.title)}</strong><span class="tag${upper(a.priority)==="CRITICAL"?" danger":""}">${esc(label(a.status))}</span></div><p>${esc(label(a.action_type))} · ${esc(a.owner_name||a.owner_user_name||"Sin responsable")} · compromiso ${esc(fmtDate(a.due_date,true))}</p><small>${esc(a.description||"")}</small>${["OPEN","IN_PROGRESS"].includes(upper(a.status))?`<div class="stack-item-actions">${upper(a.status)==="OPEN"?`<button class="small-button" data-action="${esc(a.id)}" data-status="IN_PROGRESS">Iniciar</button>`:""}<button class="small-button" data-action="${esc(a.id)}" data-status="DONE">Completar</button></div>`:""}</div>`).join(""):'<div class="stack-item">No hay acciones creadas para este expediente.</div>';
  document.querySelectorAll("[data-action]").forEach(button=>button.addEventListener("click",()=>updateAction(button.dataset.action,button.dataset.status)));
}
async function createAction(){const button=$("createActionBtn");if(!$("actionTitle").value.trim())return toast("Ingresa un título para la acción",true);setBusy(button,true,"Creando…");try{await api(`/hse/professional/tickets/${currentCaseId}/actions`,{method:"POST",body:JSON.stringify({title:$("actionTitle").value,description:$("actionDescription").value,action_type:$("actionType").value,priority:$("actionPriority").value,owner_name:$("actionOwner").value,due_date:$("actionDueDate").value||null})});["actionTitle","actionDescription","actionOwner","actionDueDate"].forEach(id=>$(id).value="");toast("Acción creada");await openCase(currentCaseId,false);}catch(error){toast(error.message,true);}finally{setBusy(button,false);}}
async function updateAction(id,status){try{await api(`/hse/professional/tickets/${currentCaseId}/actions/${id}`,{method:"PATCH",body:JSON.stringify({status})});toast("Estado de la acción actualizado");await openCase(currentCaseId,false);}catch(error){toast(error.message,true);}}
function renderClosure(){
  const i=workspace.incident||{}, residual=latestRisk("RESIDUAL"), actions=workspace.corrective_actions||[], closure=workspace.closure_request;
  const checks=[["Definición del problema",i.problem_statement],["Causas raíz documentadas",Array.isArray(i.root_causes)&&i.root_causes.length],["Conclusión técnica",i.conclusion],["Riesgo residual evaluado",residual],["Acciones sin atraso",!actions.some(a=>["OPEN","IN_PROGRESS"].includes(upper(a.status))&&a.due_date&&new Date(a.due_date)<new Date())]];
  $("completionChecklist").innerHTML=checks.map(([text,ok])=>`<div class="check-item ${ok?"ok":"pending"}">${esc(text)}</div>`).join("");
  $("closureStatus").textContent=closure?`Solicitud ${label(closure.status)} · ${fmtDate(closure.requested_at)}${closure.decision_notes?` · ${closure.decision_notes}`:""}`:"Aún no se ha enviado una solicitud de cierre.";
  $("requestClosureBtn").disabled=upper(closure?.status)==="REQUESTED"||upper(i.investigation_status)==="CLOSED"; $("requestClosureBtn").textContent=upper(closure?.status)==="REQUESTED"?"Esperando decisión del Supervisor":upper(i.investigation_status)==="CLOSED"?"Investigación cerrada":"Enviar al Supervisor HSE";
}
async function requestClosure(){const summary=$("closureSummary").value.trim(),button=$("requestClosureBtn");if(!summary)return toast("Escribe el resumen ejecutivo de cierre",true);setBusy(button,true,"Enviando…");try{await api(`/hse/professional/tickets/${currentCaseId}/closure-request`,{method:"POST",body:JSON.stringify({request_summary:summary})});toast("Expediente enviado al Supervisor HSE");await openCase(currentCaseId,false);}catch(error){toast(error.message,true);}finally{setBusy(button,false);}}
function printReport(){if(!workspace)return;document.title=`Informe HSE ${String(workspace.ticket?.id||"").slice(0,8).toUpperCase()} · QUELTU`;window.print();}

document.querySelectorAll(".nav-tab").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll(".nav-tab").forEach(x=>x.classList.toggle("active",x===button));document.querySelectorAll(".workspace-panel").forEach(panel=>panel.classList.toggle("active",panel.id===button.dataset.panel));}));
$("loginBtn").addEventListener("click",login);$("loginCode").addEventListener("keydown",event=>{if(event.key==="Enter")login();});$("logoutBtn").addEventListener("click",()=>logout());$("refreshCasesBtn").addEventListener("click",loadCases);$("caseStatus").addEventListener("change",loadCases);$("caseSearch").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadCases,350);});$("saveInvestigationBtn").addEventListener("click",saveInvestigation);$("riskSeverity").addEventListener("change",updateRiskPreview);$("riskFrequency").addEventListener("change",updateRiskPreview);$("saveRiskBtn").addEventListener("click",saveRisk);$("createActionBtn").addEventListener("click",createAction);$("requestClosureBtn").addEventListener("click",requestClosure);$("printReportBtn").addEventListener("click",printReport);$("printReportBtnSecondary").addEventListener("click",printReport);
restoreSession();
