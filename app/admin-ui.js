(function() {
  "use strict";
  const $ = (id) => document.getElementById(id), roles = { admin: "Administrador da empresa / Gestão", planner: "Planejador", inspector: "Inspetor", assistant: "Assistente", client: "Cliente · portal bloqueado" };
  const states = { blocked:"Portal bloqueado", active: "Ativo", pending: "Pendente", revoked: "Revogado", expired: "Expirado", offered: "Aguardando aceite", prepared: "Preparado", sent: "Enviado", accepted: "Aceito" };
  const events = { mapping_resolved:'Migração da empresa conferida', license_configured:"Licença configurada",license_started:"Vigência iniciada",license_extended:"Vigência prorrogada",license_suspended:"Empresa suspensa",license_resumed:"Empresa retomada",membership_activated:"Vínculo ativado",membership_deactivated:"Vínculo desativado",company_named:"Cadastro da empresa", company_created: "Empresa cadastrada", company_edited: "Empresa editada", trial_planned: "Prazo planejado", trial_extended: "Degustação prorrogada", access_approved: "Acesso aprovado", access_revoked: "Acesso revogado", invite_prepared: "Convite preparado", invite_offered: "Convite no aplicativo", invite_sent: "Convite enviado", invite_accepted: "Convite aceito", session_opened: "Entrada no aplicativo", assessment_created: "Avaliação salva", assessment_deleted: "Avaliação excluída" };
  let selectedTenant, cloud, data, grant, busy = false, epoch = 0, subscription, dialogSubmit, refreshTimer;
  function node(tag, text, className) {
    const n = document.createElement(tag);
    if (text !== void 0) n.textContent = String(text);
    if (className) n.className = className;
    return n;
  }
  function status(text, state = "active") {
    $("adminStatus").textContent = text;
    $("adminStatus").dataset.state = state;
  }
  function date(v) {
    return v && Number.isFinite(Date.parse(v)) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(v)) : "—";
  }
  function remaining(v) {
    if (!v) return "Não iniciada";
    const hours = (Date.parse(v) - Date.parse(data.server_now)) / 36e5;
    return hours <= 0 ? "Prazo encerrado" : hours < 24 ? Math.ceil(hours) + " h restantes" : Math.ceil(hours / 24) + " dias restantes";
  }
  function option(v, t) {
    const n = node("option", t);
    n.value = v;
    return n;
  }
  function button(t, fn, cls = "secondary") {
    const b = node("button", t, cls);
    b.type = "button";
    b.onclick = fn;
    return b;
  }
  function td(row, text, sub) {
    const c = node("td", text);
    if (sub) c.append(node("small", sub));
    row.append(c);
    return c;
  }
  function empty(el, text) {
    el.append(node("p", text, "empty"));
  }
  function controls(disabled) {
    document.querySelectorAll("#adminWorkspace button,#adminWorkspace input,#adminWorkspace select,#adminDialogSave").forEach((n) => {
      n.disabled = disabled;
    });
  }
  function clear() {
    data = null;
    grant = null;
    $("requests").hidden=true;$("adminRequestsLink").hidden=true;$("adminRequests").replaceChildren();
    $("adminWorkspace").hidden = true;
    ["adminUsers", "adminInvitations", "adminActivity", "adminMetrics", "adminChart", "adminCompanies", "adminExpiring"].forEach((id) => $(id).replaceChildren());
    $("adminInviteCompany").replaceChildren();
    $("adminDialog").close();
    controls(true);
  }
  function deny(text) {
    clear();
    $("adminLogin").hidden = false;
    $("adminRole").textContent = "Acesso indisponível";
    status(text, "denied");
  }
  async function authorize() {
    const g = window.PiresAccess.evaluate(await cloud.access(selectedTenant));
    if (!g.allowed || !g.can_admin || g.status !== "active") throw Error("access_denied");
    return g;
  }
  function modal(title, help, fields, save, submit) {
    $("adminDialogTitle").textContent = title;
    $("adminDialogHelp").textContent = help;
    $("adminDialogFields").replaceChildren(...fields);
    $("adminDialogError").textContent = "";
    $("adminDialogSave").textContent = save;
    dialogSubmit = submit;
    $("adminDialog").showModal();
  }
  function field(label, type, value, attrs = {}) {
    const l = node("label", label), i = node(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") i.type = type;
    i.value = value ?? "";
    Object.assign(i, attrs);
    l.append(i);
    return { label: l, input: i };
  }
  function daysField(value = 7) {
    const l = node("label", "Duração inicial (dias)"), s = node("select"), custom = field("Prazo personalizado · 1 a 90 dias", "number", value, { min: 1, max: 90, step: 1 });
    s.setAttribute("aria-label", "Duração inicial (dias)");
    [7, 15, 30].forEach((n) => s.append(option(n, n + " dias")));
    s.append(option("custom", "Personalizado"));
    s.value = [7, 15, 30].includes(value) ? String(value) : "custom";
    l.append(s);
    custom.label.hidden = s.value !== "custom";
    s.onchange = () => custom.label.hidden = s.value !== "custom";
    return { nodes: [l, custom.label], value: () => s.value === "custom" ? Number(custom.input.value) : Number(s.value) };
  }
  function validateDays(n) {
    if (!Number.isInteger(n) || n < 1 || n > 90) throw Error("Escolha um prazo inteiro entre 1 e 90 dias.");
    return n;
  }
  async function execute(action, values, message) {
    if (busy || !data) return false;
    busy = true;
    controls(true);
    const run = epoch;
    let authorized = false;
    try {
      const current = await authorize();
      if (run !== epoch) return false;
      if (!current.is_master && (!["membership_change","invite"].includes(action) || values.company_id !== current.company_id)) throw Error("access_denied");
      authorized = true;
      await cloud.admin(action, values);
      if (run !== epoch) return false;
      await reload(true);
      if (!data) return false;
      status(message);
      return true;
    } catch (error) {
      if (run === epoch) {
        if (!authorized) deny("Não foi possível confirmar a permissão atual. Entre novamente ou atualize o painel.");
        else {
          const actionError=error;
          await reload(true);
          if (data) $("adminError").textContent = error?.code === 'accepted_invitation_required'
            ? 'Aprovação não concluída. Confirme o aceite do convite desta empresa e a verificação da conta antes de tentar novamente.'
            : (typeof window.PiresCloud.CloudError === "function" && actionError instanceof window.PiresCloud.CloudError) ? actionError.message : "Ação não concluída. O painel foi atualizado; confira o estado antes de tentar novamente.";
        }
      }
      return false;
    } finally {
      if (run === epoch) {
        busy = false;
        controls(false);
      }
    }
  }
  function reasonField(){return field('Motivo (10–500 caracteres)','textarea','',{required:true,minLength:10,maxLength:500});}
  function editCompany(c){const f=field('Nome da empresa','text',c?.name||'',{required:true,minLength:2,maxLength:160}),r=reasonField();modal(c?'Editar empresa':'Cadastrar empresa','O cadastro começa sem capacidade e sem vigência definidas.',[f.label,r.label],'Salvar empresa',()=>execute('company_save',{name:f.input.value.trim(),company_id:c?.id??null,expected_name:c?.name??null,reason:r.input.value.trim()},'Empresa salva. Configure a licença antes da primeira aprovação.'));}
  function configureLicense(c){const l=c.license,seats=field('Vagas contratadas','number',l.seat_limit??'',{required:true,min:0,step:1}),r=reasonField(),fields=[seats.label];let days,kind;
   if(!l.activated_at){kind=node('select');kind.setAttribute('aria-label','Tipo de vigência');kind.append(option('trial','Degustação'),option('term','Plano com prazo definido'),option('indefinite','Acesso interno · sem vencimento'));kind.value=l.plan_kind||'trial';const label=node('label','Tipo de vigência');label.append(kind);days=field('Duração inicial em dias','number',l.initial_days??7,{required:true,min:1,max:365,step:1});kind.onchange=()=>{days.label.hidden=kind.value==='indefinite';days.input.required=kind.value!=='indefinite';};kind.onchange();fields.push(label,days.label);}
   fields.push(r.label);modal('Licença · '+c.name,l.activated_at?'A vigência já começou. Ajuste apenas a capacidade; para alterar a data, use Prorrogar.':'Defina capacidade e duração. A primeira aprovação bem-sucedida inicia a vigência da empresa.',fields,'Salvar licença',()=>execute('license_change',{company_id:c.id,action:'configure',expected_revision:l.revision,seat_limit:Number(seats.input.value),plan_kind:kind?.value||l.plan_kind,days:kind?.value==='indefinite'?null:days?Number(days.input.value):l.initial_days,new_expiry:null,reason:r.input.value.trim()},'Licença configurada.'));
  }
  function licenseAction(c,action){const l=c.license,r=reasonField(),fields=[];let expiry;if(action==='extend'){expiry=field('Novo vencimento · data e hora UTC','datetime-local',new Date(Date.parse(l.expires_at)+7*864e5).toISOString().slice(0,16),{required:true});fields.push(expiry.label);}fields.push(r.label);modal(({extend:'Prorrogar',suspend:'Suspender',resume:'Retomar'})[action]+' · '+c.name,action==='resume'?'As datas são preservadas. Retomar uma empresa vencida não renova o prazo.':action==='suspend'?'Suspende o acesso desta empresa. Vínculos, ocupação e outras empresas são preservados.':'Até 90 dias adicionais por alteração, com motivo e auditoria. A suspensão não é removida.',fields,'Confirmar alteração',()=>execute('license_change',{company_id:c.id,action,expected_revision:l.revision,seat_limit:null,plan_kind:null,days:null,new_expiry:expiry?new Date(expiry.input.value+'Z').toISOString():null,reason:r.input.value.trim()},'Alteração da licença registrada.'));
  }
  function memberAction(u,action){const r=reasonField(),c=data.companies.find(c=>c.id===u.company_id),l=c.license;
    const seat=u.seat_exempt===true?'Este vínculo é isento de vaga.':'Usa uma vaga desta empresa.';
    const term=l.activated_at?(l.plan_kind==='indefinite'?'O acesso da empresa permanece sem vencimento.':'Mantém o vencimento da empresa: '+date(l.expires_at)):'A primeira aprovação bem-sucedida inicia a vigência da empresa.';
    const help=action==='activate'?seat+' '+term:u.seat_exempt===true?'Revoga este vínculo isento, sem liberar vaga. Preserva o histórico, os outros vínculos e o acesso independente do administrador global.':'Libera a vaga nesta empresa, preserva o histórico e mantém os outros vínculos.';
    modal(action==='activate'?(u.membership_state==='revoked'?'Reativar vínculo':'Aprovar vínculo'):'Desativar vínculo',help,[r.label],action==='activate'?'Confirmar ativação':'Confirmar desativação',()=>execute('membership_change',{user_id:u.user_id,company_id:u.company_id,action,reason:r.input.value.trim()},'Vínculo atualizado.'));
  }
  function decideRequest(r,action) {
    const reason=reasonField(),fields=[],seats=field('Licenças aprovadas','number',r.requested_seats,{required:true,min:1,max:r.applicant_kind==='individual'?1:999,step:1});
    if(action==='approve')fields.push(seats.label);
    fields.push(reason.label);
    modal(action==='approve'?'Aprovar solicitação':'Recusar solicitação',
      action==='approve'?r.full_name+' · '+r.company_name+'. Cria um espaço independente. A primeira aprovação inicia 168 horas. Não haverá cobrança automática.':'Registre o motivo. A recusa não inicia prazo nem cria acesso.',
      fields,action==='approve'?'Aprovar e iniciar 7 dias':'Recusar solicitação',
      ()=>execute('request_decide',{request_id:r.id,action,seats:action==='approve'?Number(seats.input.value):null,reason:reason.input.value.trim()},action==='approve'?'Solicitação aprovada. Consulte o início e o vencimento na empresa.':'Solicitação recusada.'));
  }
  function renderRequests(result) {
    if(!Array.isArray(result?.requests))throw Error('invalid_requests_response');
    $('adminRequests').replaceChildren();
    const pending=result.requests.filter(r=>r.request_state==='pending').length;
    $('adminRequestsStatus').textContent=pending+' solicitação(ões) pendente(s).';
    for(const r of result.requests){
      const row=node('tr');td(row,r.full_name,r.email);
      td(row,r.applicant_kind==='individual'?'Individual':r.company_name,r.requested_seats+' licença(s) solicitada(s)');
      td(row,({pending:'Pendente',approved:'Aprovada',rejected:'Recusada'})[r.request_state]||'Indisponível',r.email_verified?'E-mail confirmado':'Aguardando confirmação do e-mail');
      td(row,r.activated_at?'Início: '+date(r.activated_at):'Degustação não iniciada',r.expires_at?'Vencimento: '+date(r.expires_at):'Sem vencimento definido');
      const cell=td(row,''),actions=node('div',undefined,'admin-row-actions');
      if(r.request_state==='pending'){
        if(r.email_verified)actions.append(button('Aprovar solicitação',()=>decideRequest(r,'approve')));
        else actions.append(node('small','Confirmação de e-mail necessária'));
        actions.append(button('Recusar',()=>decideRequest(r,'reject'),'admin-revoke'));
      }else actions.append(node('small',r.decision_reason||'Decisão registrada'));
      cell.append(actions);$('adminRequests').append(row);
    }
    if(!result.requests.length){const row=node('tr');td(row,'Nenhuma solicitação registrada.').colSpan=5;$('adminRequests').append(row);}
  }
  function renderPeople() {
    const el = $("adminUsers");
    el.replaceChildren();
    const q = $("adminSearch").value.trim().toLocaleLowerCase("pt-BR"), rows = data.users.filter((u) => (u.email + " " + (u.company_name || "Sem empresa")).toLocaleLowerCase("pt-BR").includes(q));
    const groups = /* @__PURE__ */ new Map();
    for (const u of rows) {
      const key = u.company_id || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(u);
    }
    for (const users of groups.values()) {
      const section = node("section", void 0, "person-group");
      section.append(node("h3", (users[0].company_name || "Sem empresa vinculada") + " · " + users.length));
      const wrap = node("div", void 0, "table-wrap");
      wrap.tabIndex = 0;
      const table = node("table"), head = node("thead"), tr = node("tr");
      ["Pessoa e responsabilidade", "Situação", "Vigência da empresa", "Acesso e sessões", "Ações"].forEach((t) => tr.append(node("th", t)));
      head.append(tr);
      table.append(head);
      const body = node("tbody");
      for (const u of users) {
        const row = node("tr");
        td(row, u.email, u.is_master ? "Administrador global" : roles[u.company_role] || "Sem vínculo");
        td(row, "").append(node("span", states[u.status] || "Indisponível", "status-badge " + u.status));
        const term = td(row, u.is_master ? (u.seat_exempt===true ? "Administrador global · vínculo isento de vaga" : "Administrador global · acesso independente") : u.access_kind === "indefinite" ? "Sem vencimento" : u.access_kind === "standard" ? "Sem degustação" : !u.activated_at ? u.trial_days ? u.trial_days + " dias planejados" : "Não definida" : remaining(u.expires_at));
        term.append(node("small", u.activated_at ? "Início: " + date(u.activated_at) + "\nVencimento: " + (u.access_kind === "indefinite" ? "Indeterminado" : date(u.expires_at)) : "Não iniciada · sem data de vencimento"));
        const access = td(row, "Última atividade: " + date(u.last_activity_at));
        access.append(node("small", "Entradas registradas: " + u.entries));
        access.append(node("small", "Último login Auth: " + (data.is_master ? date(u.last_sign_in_at) : "não disponível neste escopo")));
        access.append(node("small", u.sessions ? "Registros de sessão Auth: " + u.sessions.records + (u.sessions.observed_span_seconds !== null ? " · maior intervalo observado: " + Math.round(u.sessions.observed_span_seconds / 60) + " min" : "") : "Sessões Auth: não disponíveis"));
        const actions = td(row, ""), a = node("div", void 0, "admin-row-actions");
        const company=data.companies.find(c=>c.id===u.company_id),license=company?.license;
        if(company&&license?.migration_state!=='review_required'&&(data.is_master||u.company_role!=='admin')){
          if(u.membership_state!=='active'&&license?.seats_available>0&&['active','draft'].includes(license.status))a.append(button(u.membership_state==='revoked'?'Reativar':'Aprovar',()=>memberAction(u,'activate')));
          if(u.membership_state==='active'||u.membership_state==='pending')a.append(button('Desativar',()=>memberAction(u,'deactivate'),'admin-revoke'));
          if(u.membership_state!=='active'&&license?.seats_available===0)a.append(node('small','Sem vagas disponíveis'));
          if(license?.seat_limit===null)a.append(node('small','Capacidade não definida'));
          if(u.company_role==='client')a.append(node('small','Portal Cliente bloqueado'));
        }else a.append(node('small',u.company_id?'Administração global necessária':'Sem vínculo com empresa'));
        actions.append(a);
        body.append(row);
      }
      table.append(body);
      wrap.append(table);
      section.append(wrap);
      el.append(section);
    }
    if (!rows.length) empty(el, "Nenhuma pessoa encontrada.");
  }
  function render(d) {
    if (d?.version !== 3 || typeof d.is_master !== "boolean" || !Number.isFinite(Date.parse(d.server_now)) || !["users", "companies", "invitations", "activity"].every((k) => Array.isArray(d[k])) || !d.metrics) throw Error("invalid_dashboard");
    if (d.is_master !== grant.is_master || (!grant.is_master && (
      d.companies.some((c) => c.id !== grant.company_id) ||
      ["users", "invitations", "activity"].some((key) => d[key].some((row) => row.company_id !== grant.company_id))
    ))) throw Error("invalid_dashboard_scope");
    data = d;
    $("adminMetrics").replaceChildren();
    for (const [key, label] of [["companies", "Empresas"], ["users", "Pessoas"], ["pending_invitations", "Convites pendentes"], ["active_trials", "Empresas em degustação"], ["expiring_soon", "Vencem em até 72 h"]]) {
      if (!Number.isSafeInteger(d.metrics[key]) || d.metrics[key] < 0) throw Error("invalid_metrics");
      const n = node("div", void 0, "metric");
      n.append(node("span", label), node("strong", d.metrics[key]));
      $("adminMetrics").append(n);
    }
    $("adminRole").textContent = d.is_master ? "Administrador global" : "Gestão · sua empresa";
    $("adminCompanyNew").hidden = !d.is_master;
    $("adminInviteSection").hidden = false;
    $("adminInviteRole").querySelector('option[value="admin"]').hidden=!d.is_master;
    const counts = ["active", "pending", "expired", "revoked", "blocked"].map((s) => ({ s, n: d.users.filter((u) => u.company_id && u.status === s).length })), max = Math.max(1, ...counts.map((x) => x.n));
    $("adminChart").replaceChildren();
    for (const { s, n } of counts) {
      const row = node("div", void 0, "bar-row"), track = node("div", void 0, "bar-track"), fill = node("div", void 0, "bar-fill");
      fill.style.width = n / max * 100 + "%";
      track.append(fill);
      row.append(node("span", states[s]), track, node("b", n));
      $("adminChart").append(row);
    }
    $("adminExpiring").replaceChildren();
    const exp=d.companies.filter(c=>c.license.status==='active'&&Date.parse(c.license.expires_at)-Date.parse(d.server_now)<=72*36e5).sort((a,b)=>Date.parse(a.license.expires_at)-Date.parse(b.license.expires_at));
    for(const c of exp){const row=node('div',undefined,'deadline');row.append(node('div',c.name),node('b',remaining(c.license.expires_at)));$('adminExpiring').append(row);}
    if(!exp.length)empty($('adminExpiring'),'Nenhuma empresa ativa vence nas próximas 72 horas.');
    $("adminCompanies").replaceChildren();
    const selected = $("adminInviteCompany").value;
    $("adminInviteCompany").replaceChildren(option("", "Selecione a empresa"));
    for (const c of d.companies) {
      $("adminInviteCompany").append(option(c.id, c.name));
      const card = node("article", void 0, "company-card"), users = d.users.filter((u) => u.company_id === c.id);
      card.append(node("h3", c.name), node("p", users.length + " pessoas · " + users.filter((u) => u.status === "active").length + " acessos liberados"));
      const l=c.license;const names={review_required:'Mapeamento do legado pendente',unconfigured:'Licença não configurada',draft:'Aguardando primeira aprovação',active:'Vigente',expired:'Vencida',suspended:'Suspensa'};card.append(node('span',names[l.status]||l.status,'status-badge '+l.status));
      const summary=node('dl',undefined,'seat-summary');for(const [name,value]of [['Contratadas',l.seat_limit??'Não definido'],['Usadas',l.seats_used],['Disponíveis',l.seats_available??'Não definido'],['Convites pendentes',l.pending_invites],['Aceites para aprovar',l.pending_approvals]]){summary.append(node('dt',name),node('dd',value));}card.append(summary,node('p',l.plan_kind==='indefinite'?'Acesso interno · sem vencimento':l.activated_at?'Início: '+date(l.activated_at)+' · Vencimento: '+date(l.expires_at):l.initial_days?l.initial_days+' dias · ainda não iniciada':'Prazo ainda não definido'));
      if(d.is_master){card.append(button('Editar empresa',()=>editCompany(c)));if(l.migration_state!=='review_required'){card.append(button('Configurar licença',()=>configureLicense(c)));if(l.activated_at&&l.plan_kind!=='indefinite')card.append(button('Prorrogar',()=>licenseAction(c,'extend')));if(l.license_state==='suspended'&&l.activated_at)card.append(button('Retomar empresa',()=>licenseAction(c,'resume')));else if(l.license_state!=='suspended'&&l.activated_at)card.append(button('Suspender empresa',()=>licenseAction(c,'suspend')));}else card.append(node('p','Exige decisão de prazo, capacidade e tratamento dos vínculos antigos.','muted'));}
      $("adminCompanies").append(card);
    }
    $("adminInviteCompany").value = selected;
    if (!d.companies.length) empty($("adminCompanies"), "Nenhuma empresa cadastrada. Cadastre a primeira antes de convidar pessoas.");
    renderPeople();
    $("adminInvitations").replaceChildren();
    for (const i of d.invitations) {
      const r = node("tr");
      td(r, i.email, i.company_name);
      td(r, roles[i.role] || "—");
      td(r, states[i.status] || i.status);
      td(r, date(i.expires_at));
      td(r,i.plan_kind==='indefinite'?'Empresa com acesso sem vencimento':i.activated_at?'Empresa vigente até '+date(i.trial_expires_at):i.trial_days?i.trial_days+' dias planejados para a empresa':'Prazo da empresa não definido','Convite não reserva vaga. Consulte o vínculo na lista de pessoas.');
      $("adminInvitations").append(r);
    }
    if (!d.invitations.length) {
      const r = node("tr");
      td(r, "Nenhum convite registrado.").colSpan = 5;
      $("adminInvitations").append(r);
    }
    $("adminActivity").replaceChildren();
    for (const e of d.activity) {
      const r = node("tr");
      td(r, date(e.occurred_at));
      td(r, events[e.event] || e.event, e.source === "client_signal" ? "Sinal do aplicativo" : "Servidor");
      td(r, e.actor_name || "Sistema", e.target_name || "");
      td(r, e.company_name || "—");
      let change = "—";
      if (e.event === "trial_extended") change = date(e.before_value.expires_at) + " → " + date(e.after_value.expires_at);
      if (e.event === "trial_planned") change = e.before_value.days + " → " + e.after_value.days + " dias";
      if (e.event === "company_created" || e.event === "company_edited") change = (e.before_value.name || "Nova empresa") + " → " + e.after_value.name;
      if(e.event.startsWith('license_'))change='Vagas: '+(e.before_value.seat_limit??'—')+' → '+(e.after_value.seat_limit??'—')+' · Vencimento: '+date(e.before_value.expires_at)+' → '+date(e.after_value.expires_at);
      if(e.event.startsWith('membership_'))change=e.before_value.access_state+' → '+e.after_value.access_state;
      if(e.event==='company_named')change=(e.before_value.name||'Nova empresa')+' → '+e.after_value.name;
      td(r, change, e.reason);
      $("adminActivity").append(r);
    }
    if (!d.activity.length) {
      const r = node("tr");
      td(r, "Nenhuma atividade registrada.").colSpan = 5;
      $("adminActivity").append(r);
    }
    $("adminWorkspace").hidden = false;
    $("adminLogin").hidden = true;
  }
  async function reload(inAction = false) {
    if (busy && !inAction) return;
    if (!cloud?.configured) return;
    const run = ++epoch;
    busy = true;
    controls(true);
    $("adminError").textContent = "";
    try {
      const g = await authorize();
      if (run !== epoch) return;
      const d = await cloud.admin("dashboard", { company_id: g.is_master ? null : g.company_id });
      if (run !== epoch) return;
      grant = g;
      render(d);
      const requestsEnabled=g.is_master && window.PIRES_CONFIG.selfRegistrationEnabled===true;
      $("requests").hidden=!requestsEnabled;$("adminRequestsLink").hidden=!requestsEnabled;
      if(requestsEnabled){
        try{const requests=await cloud.admin('requests');if(run!==epoch)return;renderRequests(requests);}
        catch{if(run===epoch){$('adminRequests').replaceChildren();$('adminRequestsStatus').textContent='Não foi possível carregar as solicitações. Atualize o painel; nenhuma aprovação foi realizada.';}}
      }
      status("Atualizado em " + date(d.server_now) + " · horários de Brasília.");
    } catch (e) {
      if (run === epoch) deny(e.message === "access_denied" ? "Esta área exige Administrador global ou Gestão da própria empresa." : "Não foi possível confirmar a autorização e carregar o painel. Atualize ou entre novamente.");
    } finally {
      if (run === epoch) {
        busy = false;
        controls(false);
      }
    }
  }
  async function init() {
    clear();
    try {
      if (window.PIRES_CONFIG?.mode !== "connected") throw Error();
      cloud = window.PiresCloud.create(window.PIRES_CONFIG, window.PiresSupabase.createClient);
      $("adminSignOut").hidden = false;
      $("adminRefresh").onclick = () => reload();
      $("adminCompanyNew").onclick = () => editCompany();
      $("adminSearch").oninput = () => {
        if (data) renderPeople();
      };
      $('adminInviteForm').onsubmit=async(ev)=>{ev.preventDefault();try{if(await execute('invite',{email:$('adminInviteEmail').value.trim(),company_id:$('adminInviteCompany').value,role:$('adminInviteRole').value},'Convite registrado, sem reserva de vaga. O aceite ainda exige aprovação.'))$('adminInviteEmail').value='';}catch(e){$('adminError').textContent=e.message;}};
      $("adminDialogCancel").onclick = () => $("adminDialog").close();
      $("adminDialogForm").onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          if (await dialogSubmit()) $("adminDialog").close();
          else $("adminDialogError").textContent = $("adminError").textContent || "Não foi possível concluir. Atualize a lista e confira o estado.";
        } catch (e) {
          $("adminDialogError").textContent = e.message;
        }
      };
      $("adminSignOut").onclick = async () => {
        ++epoch;
        busy = false;
        deny("Sessão encerrada nesta página.");
        try {
          await cloud.signOut();
        } catch {
          $("adminError").textContent = "Confirme a saída pelo aplicativo.";
        }
      };
      subscription = cloud.subscribe((event) => {
        ++epoch;
        busy = false;
        clear();
        if (event === "SIGNED_OUT") {
          deny("Entre novamente.");
          return;
        }
        setTimeout(() => reload(), 0);
      });
      refreshTimer = setInterval(() => {
        if (!document.hidden && !$("adminDialog").open) reload();
      }, 6e4);
      window.addEventListener("beforeunload", () => {
        ++epoch;
        clearInterval(refreshTimer);
        subscription?.unsubscribe?.();
      });
      if(cloud.companies){const choices=await cloud.companies();if(choices.length>1){const label=node('label','Empresa de acesso '),sel=node('select');sel.setAttribute('aria-label','Empresa de acesso');sel.append(option('','Escolha automática entre vínculos válidos'));for(const c of choices)sel.append(option(c.id,c.name));sel.onchange=()=>{selectedTenant=sel.value||null;reload();};label.append(sel);document.querySelector('.admin-title').after(label);}}
      await reload();
    } catch {
      deny("Administração indisponível. Verifique a configuração e entre novamente.");
    }
  }
  window.PiresAdmin = Object.freeze({ ready: init() });
})();
