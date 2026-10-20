(function (root, factory) {
  const policy = typeof module === 'object' && module.exports ? require('./access-policy.js') : root.PiresAccess;
  const api = factory(policy);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PiresCloud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Access) {
  'use strict';
  class CloudError extends Error {
    constructor(message, code = 'service_unavailable') { super(message); this.name = 'CloudError'; this.code = code; }
  }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function emailLink(href) {
    const url = new URL(href), fragment = new URLSearchParams(url.hash.slice(1));
    if (!fragment.has('token_hash')) return null;
    const token = fragment.get('token_hash'), type = fragment.get('type');
    if (fragment.getAll('token_hash').length !== 1 || fragment.getAll('type').length !== 1 ||
        !/^[a-zA-Z0-9_-]{32,256}$/.test(token || '') || !['email', 'recovery', 'invite'].includes(type)) {
      throw new CloudError('Link de acesso inválido. Solicite um novo e-mail.');
    }
    return { token, type };
  }
  function validateConfig(config) {
    if (config?.mode === 'demo') return { mode: 'demo' };
    if (config?.mode !== 'connected') throw new CloudError('Configuração de acesso indisponível.');
    let endpoint, app;
    try { endpoint = new URL(config.supabaseUrl); app = new URL(config.appUrl); } catch { throw new CloudError('Configuração de endereço inválida.'); }
    if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(endpoint.hostname) || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.port || endpoint.username || endpoint.password) throw new CloudError('Endpoint de autenticação inválido.');
    if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(config.publishableKey || '') || /REPLACE|YOUR_PROJECT/.test(config.supabaseUrl + config.publishableKey)) throw new CloudError('Utilize exclusivamente a chave pública de publicação do projeto.');
    if (app.protocol !== 'https:' || app.pathname !== '/' || app.search || app.hash || app.username || app.password || app.port) throw new CloudError('O endereço de produção deve usar HTTPS na raiz do domínio.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.privacyEmail || '')) throw new CloudError('Configure o canal de privacidade antes de habilitar contas.');
    return { mode: 'connected', supabaseUrl: endpoint.origin, publishableKey: config.publishableKey, appUrl: app.origin, privacyEmail: config.privacyEmail, ...(config.selfRegistrationEnabled === true ? {selfRegistrationEnabled:true} : {}) };
  }
  function payload(snapshot, reportText) {
    if (!snapshot || !['life', 'pmta', 'risk'].includes(snapshot.type) || !snapshot.inputs || !snapshot.results) throw new CloudError('Calcule a avaliação antes de salvar.');
    const title = String(snapshot.inputs.tag || '').trim();
    if (!title || title.length > 180) throw new CloudError('A TAG deve conter de 1 a 180 caracteres para salvamento.');
    // Explicit projection: no account, password, token or arbitrary outer properties.
    const clean = { version: snapshot.version, engineVersion: snapshot.engineVersion, createdAt: snapshot.createdAt,
      type: snapshot.type, inputs: snapshot.inputs, results: snapshot.results, sources: snapshot.sources,
      note: snapshot.note, recommendations: snapshot.recommendations };
    if (new TextEncoder().encode(JSON.stringify(clean)).length > 450000 || new TextEncoder().encode(reportText || '').length > 200000) throw new CloudError('Avaliação excede o limite de armazenamento desta versão.');
    return { title, kind: clean.type, payload: clean, report_text: String(reportText || ''), app_version: String(clean.version || '') };
  }
  function create(config, factory) {
    const settings = validateConfig(config);
    if (settings.mode === 'demo') return { configured: false, config: settings };
    if (typeof Access?.evaluate !== 'function') throw new CloudError('Controle de acesso indisponível. Tente novamente mais tarde.', 'access_unavailable');
    if (typeof factory !== 'function') throw new CloudError('Serviço de autenticação indisponível.');
    const client = factory(settings.supabaseUrl, settings.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'pires-auth-v1' }
    });
    let selectedCompany = null, selectedUser = null;
    function failure(error, fallback) {
      if (!error) return;
      const known = {
        email_not_confirmed: 'Confirme seu endereço de e-mail antes de entrar.',
        invalid_credentials: 'E-mail ou senha inválidos.', weak_password: 'A senha não atende aos requisitos de segurança.',
        over_request_rate_limit: 'Limite de tentativas atingido. Aguarde antes de tentar novamente.',
        over_email_send_rate_limit: 'Limite de envio atingido. Aguarde antes de solicitar outro e-mail.'
      };
      throw new CloudError(known[error.code] || fallback);
    }
    async function user() {
      const { data, error } = await client.auth.getUser();
      if (error?.name === 'AuthSessionMissingError' || error?.code === 'session_not_found') return null;
      failure(error, 'Não foi possível validar a sessão. Entre novamente.');
      return data?.user || null;
    }
    async function requireUser() {
      const current = await user();
      if (!current || !current.email_confirmed_at) throw new CloudError('Entre com uma conta de e-mail confirmado para acessar as avaliações.');
      return current;
    }
    async function access(companyId) {
      const current = await requireUser();
      if (selectedUser !== current.id) { selectedUser = current.id; selectedCompany = null; }
      const requested = companyId === undefined ? selectedCompany : companyId;
      if (requested !== null && !UUID.test(requested || '')) throw new CloudError('Empresa inválida.', 'invalid_company');
      if (typeof client.rpc !== 'function') return Access.evaluate(null);
      try {
        const { data, error } = await client.rpc('pi_access_status_v3', { p_company_id: requested });
        if (error || data?.version !== 3) return Access.evaluate(null);
        const result = Access.evaluate(data);
        if (result.user_id !== current.id) return Access.evaluate(null);
        if (requested !== null && result.company_id !== requested) return Access.evaluate(null);
        if (result.allowed) selectedCompany = result.company_id;
        return result;
      } catch { return Access.evaluate(null); }
    }
    async function requireAccess(companyId, requireCompany = false) {
      const result = await access(companyId);
      if (!result.allowed) throw new CloudError(result.message || 'Acesso indisponível.', result.status || 'access_unavailable');
      if (requireCompany && !UUID.test(result.company_id || '')) throw new CloudError('Vincule uma empresa aprovada antes de salvar ou consultar avaliações.', 'company_required');
      return result;
    }
    function clientDocument(row, companyId, child = false, recipientCompanyId = null) {
      // Client documents are a read-only projection. Never expose raw payloads,
      // authors, drafts or arbitrary server properties to calculator/editor hooks.
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          !UUID.test(row.id || '') || row.company_id !== companyId || !UUID.test(row.recipient_company_id || '') ||
          (recipientCompanyId !== null && row.recipient_company_id !== recipientCompanyId) ||
          !UUID.test(row.source_id || '') || !['assessment', 'rdo'].includes(row.source_kind) ||
          !Number.isSafeInteger(row.revision) || row.revision < 1 ||
          typeof row.title !== 'string' || !row.title.trim() || row.title.length > 180 ||
          (child && row.source_kind !== 'assessment')) throw new CloudError('Documento liberado indisponível.', 'invalid_document');
      const result = { id: row.id, company_id: row.company_id, recipient_company_id: row.recipient_company_id, source_kind: row.source_kind,
        source_id: row.source_id, revision: row.revision, title: row.title };
      if (row.kind !== undefined && row.kind !== null) {
        if (!['life', 'pmta', 'risk', 'rdo'].includes(row.kind)) throw new CloudError('Documento liberado indisponível.', 'invalid_document');
        result.kind = row.kind;
      }
      if (row.report_text !== undefined && row.report_text !== null) {
        if (typeof row.report_text !== 'string' || new TextEncoder().encode(row.report_text).length > 220000) throw new CloudError('Documento liberado indisponível.', 'invalid_document');
        result.report_text = row.report_text;
      }
      if (row.report_date !== undefined && row.report_date !== null) {
        if (typeof row.report_date !== 'string' || row.report_date.length > 40 || !Number.isFinite(Date.parse(row.report_date))) throw new CloudError('Documento liberado indisponível.', 'invalid_document');
        result.report_date = row.report_date;
      }
      if (row.source_kind === 'rdo') {
        if (child || !Array.isArray(row.documents) || row.documents.length > 1000) throw new CloudError('RDO liberado indisponível.', 'invalid_document');
        result.documents = row.documents.map(item => clientDocument(item, companyId, true, row.recipient_company_id));
        if (new Set(result.documents.map(item => item.id)).size !== result.documents.length ||
            !row.totals || row.totals.documents !== result.documents.length || !Number.isSafeInteger(row.totals.documents) ||
            Object.keys(row.totals).some(key => key !== 'documents')) throw new CloudError('RDO liberado indisponível.', 'invalid_document');
        result.totals = { documents: result.documents.length };
      } else if (row.documents !== undefined || row.totals !== undefined) {
        throw new CloudError('Documento liberado indisponível.', 'invalid_document');
      }
      return result;
    }
    async function clientGrant(companyId) {
      const grant = await requireAccess(companyId, true);
      if (grant.company_role !== 'client') throw new CloudError('Esta consulta é exclusiva do perfil Cliente.', 'access_denied');
      if (typeof client.rpc !== 'function') throw new CloudError('Consulta de documentos indisponível.', 'access_unavailable');
      return grant;
    }
    async function clientDocuments(grant) {
      try {
        const { data, error } = await client.rpc('pi_client_documents', { p_company_id: grant.company_id });
        if (error || !Array.isArray(data) || data.length > 1000) throw new Error('Rejected document list');
        const rows = data.map(row => clientDocument(row, grant.company_id));
        if (new Set(rows.map(row => row.recipient_company_id)).size > 1) throw new Error('Mixed recipient companies');
        if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate publication');
        return rows;
      } catch { throw new CloudError('Não foi possível consultar os documentos liberados. Tente novamente.', 'documents_unavailable'); }
    }
    async function clientDocumentById(id, grant) {
      if (!UUID.test(id || '')) throw new CloudError('Identificador de liberação inválido.', 'invalid_document');
      try {
        const { data, error } = await client.rpc('pi_client_document', { p_release_id: id });
        if (error) throw new Error('Document rejected');
        const row = clientDocument(data, grant.company_id);
        if (row.id !== id) throw new Error('Wrong publication');
        return row;
      } catch { throw new CloudError('Documento não liberado, retirado ou indisponível para esta conta.', 'document_unavailable'); }
    }
    async function canManageClientPublications(companyId) {
      try {
        const grant = await requireAccess(companyId, true);
        if (grant.company_role === 'client' || typeof client.rpc !== 'function') return false;
        const { data, error } = await client.rpc('pi_content_management_status', { p_company_id: grant.company_id });
        return !error && data === true;
      } catch { return false; }
    }
    async function manageClientRelease(companyId, sourceKind, sourceId, action, dependencies = [], recipientCompanyId) {
      if (!UUID.test(companyId || '') || !UUID.test(recipientCompanyId || '') || !UUID.test(sourceId || '') || !['assessment', 'rdo'].includes(sourceKind) ||
          !['release', 'withdraw'].includes(action) || !Array.isArray(dependencies) || dependencies.length > 1000 ||
          dependencies.some(id => !UUID.test(id || '')) || new Set(dependencies).size !== dependencies.length ||
          (sourceKind === 'assessment' && dependencies.length)) throw new CloudError('Solicitação de liberação inválida.', 'invalid_request');
      if (!await canManageClientPublications(companyId)) throw new CloudError('A liberação documental exige autorização explícita de Gestão.', 'access_denied');
      try {
        const { data, error } = await client.rpc('pi_manage_client_release', { p_company_id: companyId,
          p_source_kind: sourceKind, p_source_id: sourceId, p_action: action, p_dependencies: [...dependencies], p_recipient_company_id: recipientCompanyId });
        if (error || !data || !UUID.test(data.id || '') || data.action !== action) throw new Error('Release rejected');
        return { id: data.id, action: data.action };
      } catch { throw new CloudError('Não foi possível concluir a liberação ou retirada. Consulte a situação antes de tentar novamente.', 'release_unavailable'); }
    }
    async function acceptInvite(invitationId = null) {
      await requireUser();
      if (invitationId !== null && !UUID.test(invitationId || '')) throw new CloudError('Convite inválido.', 'invalid_invite');
      if (typeof client.rpc !== 'function') throw new CloudError('Aceite do convite indisponível.', 'access_unavailable');
      const { error } = await client.rpc('pi_accept_invite', { p_invitation_id: invitationId });
      failure(error, 'Convite indisponível, expirado ou já utilizado. Solicite orientação ao administrador.');
      return true;
    }
    async function pendingInvites() {
      await requireUser();
      try {
        if (typeof client.rpc !== 'function') throw new Error('RPC unavailable');
        const { data, error } = await client.rpc('pi_pending_invites');
        if (error || !Array.isArray(data)) throw new Error('Invitation lookup unavailable');
        return data.map(row => {
          if (!row || !UUID.test(row.invitation_id || '') || !UUID.test(row.company_id || '') || typeof row.company_name !== 'string' || row.company_name.length > 240) throw new Error('Invalid invitation response');
          return { invitation_id: row.invitation_id, company_id: row.company_id, company_name: row.company_name, role: String(row.role || ''), expires_at: row.expires_at, delivery: row.delivery };
        });
      } catch { throw new CloudError('Não foi possível consultar seus convites. Tente novamente.', 'invites_unavailable'); }
    }
    async function recordActivity(event) {
      if (event !== 'session_opened') return false;
      try {
        await requireUser();
        if (typeof client.rpc !== 'function') return false;
        const { data, error } = await client.rpc('pi_record_activity', { p_event: event, p_company_id: selectedCompany });
        return !error && data === true;
      } catch { return false; }
    }
    function companyFilter(query, companyId) {
      // Existing personal records remain private and unassigned; never silently migrate them.
      if (typeof query.or !== 'function') throw new CloudError('Consulta de empresa indisponível.', 'access_unavailable');
      return query.or(`company_id.eq.${companyId},company_id.is.null`);
    }
    function credentials(email, password) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw new CloudError('Informe um e-mail válido.');
      if (typeof password !== 'string' || password.length < 6 || password.length > 8) throw new CloudError('Utilize uma senha de 6 a 8 caracteres.');
    }
    function accessRequest(name, request) {
      const fullName=String(name||'').trim(),kind=request?.kind,seats=Number(request?.seats),company=kind==='individual'?fullName:String(request?.company||'').trim();
      if(fullName.length<2 || fullName.length>120 || !['individual','company'].includes(kind) ||
         !Number.isInteger(seats) || seats<1 || seats>999 || (kind==='individual'&&seats!==1) ||
         company.length<2 || company.length>160 || /[\u0000-\u001f\u007f]/.test(fullName+company)) throw new CloudError('Confira nome, tipo de uso, empresa e quantidade de licenças.');
      return {name:fullName,kind,company,seats};
    }
    return {
      configured: true, config: settings, user, access,
      async companies(){await requireUser();const {data,error}=await client.rpc('pi_my_company_access');if(error||!Array.isArray(data)||data.some(c=>!UUID.test(c.id)||typeof c.name!=='string'))throw new CloudError('Não foi possível consultar empresas.');return data;}, requireAccess, acceptInvite, pendingInvites, recordActivity,
      canManageClientPublications, manageClientRelease,
      async listClientDocuments(companyId) { return clientDocuments(await clientGrant(companyId)); },
      async loadClientDocument(id, companyId) { return clientDocumentById(id, await clientGrant(companyId)); },
      subscribe(callback) { return client.auth.onAuthStateChange(callback).data.subscription; },
      async signUp(name, email, password, request) {
        if (!settings.selfRegistrationEnabled) throw new CloudError('O acesso é fechado por convite e aprovação do administrador.', 'invitation_required');
        const intake = accessRequest(name,request);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw new CloudError('Informe um e-mail válido.');
        if (typeof password !== 'string' || password.length < 8 || password.length > 64) throw new CloudError('Utilize uma senha de 8 a 64 caracteres.');
        const {data,error}=await client.auth.signUp({email:email.trim(),password,options:{
          emailRedirectTo:settings.appUrl+'/',data:{full_name:intake.name,pi_access_request:{version:1,...intake}}
        }});
        failure(error,'Não foi possível solicitar o cadastro. Tente novamente mais tarde.');
        if(data?.session) await client.auth.signOut();
        return true;
      },
      async myAccessRequest() {
        await requireUser();
        const {data,error}=await client.rpc('pi_my_access_request');
        failure(error,'Não foi possível consultar sua solicitação.');
        if(!data || typeof data.can_request!=='boolean' || (data.request && (!UUID.test(data.request.id) || !['pending','approved','rejected'].includes(data.request.request_state)))) throw new CloudError('Resposta de solicitação inválida.');
        return data;
      },
      async requestAccess(name, request) {
        await requireUser();
        const intake=accessRequest(name,request);
        const {data,error}=await client.rpc('pi_request_access',{p_full_name:intake.name,p_kind:intake.kind,p_company_name:intake.company,p_seats:intake.seats});
        failure(error,'Solicitação não concluída. Atualize a situação do acesso antes de tentar novamente.');
        if(!data || !UUID.test(data.id))throw new CloudError('Não foi possível confirmar a solicitação.');
        return data;
      },
      async signIn(email, password) {
        const { error } = await client.auth.signInWithPassword({ email, password });
        failure(error, 'Não foi possível autenticar. Verifique suas credenciais e tente novamente.');
        return requireUser();
      },
      async recover(email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw new CloudError('Informe um e-mail válido.');
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${settings.appUrl}/?flow=recovery` });
        failure(error, 'Não foi possível solicitar a recuperação. Tente novamente mais tarde.');
      },
      async verifyEmailLink(link) {
        if (!link || !/^[a-zA-Z0-9_-]{32,256}$/.test(link.token || '') || !['email', 'recovery', 'invite'].includes(link.type)) throw new CloudError('Link de acesso inválido. Solicite um novo e-mail.');
        const { data, error } = await client.auth.verifyOtp({ token_hash: link.token, type: link.type });
        failure(error, 'Link inválido, expirado ou já utilizado. Solicite um novo e-mail.');
        // Auth verification consumes a one-use token. Company invitation acceptance
        // is a separate explicit action after password setup and sign-in, so a
        // choice between companies never forces a retry of a consumed token.
        const current = data?.user?.email_confirmed_at ? data.user : await requireUser();
        return current;
      },
      async updatePassword(password) {
        const current = await requireUser(); credentials(current.email, password);
        const { error } = await client.auth.updateUser({ password }); failure(error, 'Não foi possível atualizar a senha. Solicite um novo link.');
        const logout = await client.auth.signOut(); failure(logout.error, 'Senha atualizada. Encerre a sessão antes de entrar novamente.');
      },
      async signOut() { const { error } = await client.auth.signOut(); failure(error, 'Não foi possível encerrar a sessão. Tente novamente.'); selectedCompany = null; selectedUser = null; },
      async admin(action, values = {}) {
        const grant = await requireAccess();
        if (!grant.can_admin) throw new CloudError('Esta operação exige administração autorizada.', 'access_denied');
        const fields = { requests: [], request_decide: ["request_id","action","seats","reason"], list: [], dashboard: ['company_id'], approve_v2: ['user_id','company_id','days'], company_save: ['name','company_id','expected_name','reason'], license_change:['company_id','action','expected_revision','seat_limit','plan_kind','days','new_expiry','reason'], membership_change:['user_id','company_id','action','reason'], trial_plan: ['user_id','company_id','days'], trial_extend: ['user_id','company_id','expected_expiry','new_expiry','reason'], invite: ['email', 'company_id', 'role'], approve: ['user_id', 'company_id'], revoke: ['user_id', 'company_id'] }[action];
        if (!fields || !values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(key => !fields.includes(key))) throw new CloudError('Operação administrativa inválida.', 'invalid_request');
        if (!grant.is_master && (!['dashboard','invite','membership_change'].includes(action) || values.company_id !== grant.company_id)) throw new CloudError('Esta operação exige administração global ou Gestão da própria empresa.', 'access_denied');
        const rpcActions = {requests:'pi_admin_access_requests',request_decide:'pi_admin_decide_request',approve_v2:'pi_admin_approve_v2',dashboard:'pi_admin_dashboard_v3',company_save:'pi_admin_company_save_v3',license_change:'pi_admin_license_change',membership_change:'pi_admin_membership_change',trial_plan:'pi_admin_trial_plan',trial_extend:'pi_admin_trial_extend'};
        if (Object.hasOwn(rpcActions,action)) {
          const args=Object.fromEntries(fields.map(key=>['p_'+key, values[key]??null]));
          try {
            const {data,error}=await client.rpc(rpcActions[action],args);
            if(error && ['email_confirmation_required','company_already_exists_use_invitation','existing_access_requires_review','request_already_decided'].includes(error.message)) {
              const messages={email_confirmation_required:'A pessoa precisa confirmar o e-mail antes da aprovação.',company_already_exists_use_invitation:'Esta empresa já existe. Use o convite para vinculá-la à empresa correta, preservando o prazo atual.',existing_access_requires_review:'Esta pessoa já possui vínculo ou restrição. Revise o cadastro existente; uma nova degustação não foi criada.',request_already_decided:'A solicitação já foi analisada. Atualize o painel.'};
              throw new CloudError(messages[error.message],error.message);
            }
            if (error?.code === '22023' && error?.message === 'accepted_invitation_required') {
              throw new CloudError('Aprovação não concluída. Confirme o aceite do convite desta empresa e a verificação da conta antes de tentar novamente.', 'accepted_invitation_required');
            }
            if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_admin_response');
            return data;
          } catch (error) {
            if (error instanceof CloudError) throw error;
            throw new CloudError('Operação não concluída. Atualize a lista; o prazo ou a empresa pode ter mudado.', 'admin_unavailable');
          }
        }
        if (typeof client.functions?.invoke !== 'function') throw new CloudError('Administração indisponível.', 'access_unavailable');
        const body = { action }; fields.forEach(key => { if (values[key] !== undefined) body[key] = values[key]; });
        try {
          const { data, error } = await client.functions.invoke('access-admin', { body });
          if (error || !data || data.ok !== true || !data.data || typeof data.data !== 'object') throw new Error('Rejected administrative response');
          return data.data;
        } catch { throw new CloudError('Não foi possível concluir a operação administrativa. Atualize a lista antes de tentar novamente.', 'admin_unavailable'); }
      },
      async save(snapshot, reportText, id) {
        const grant = await requireAccess(undefined, true);
        if (grant.company_role === 'client') throw new CloudError('O perfil Cliente consulta apenas documentos liberados.', 'access_denied');
        const values = payload(snapshot, reportText);
        const { data, error } = await client.from('pi_assessments').insert({ ...values, id, user_id: grant.user_id, company_id: grant.company_id }).select('id,created_at').single();
        failure(error, 'Não foi possível salvar a avaliação. Os dados permanecem na tela; você pode exportá-los.'); return data;
      },
      async list() {
        const grant = await requireAccess(undefined, true);
        if (grant.company_role === 'client') return clientDocuments(grant);
        const query = client.from('pi_assessments').select('id,title,kind,created_at,app_version').eq('user_id', grant.user_id);
        const { data, error } = await companyFilter(query, grant.company_id).order('created_at', { ascending: false }).limit(100);
        failure(error, 'Não foi possível consultar seu histórico. Tente novamente.'); return data || [];
      },
      async load(id) {
        const grant = await requireAccess(undefined, true);
        if (grant.company_role === 'client') return clientDocumentById(id, grant);
        const query = client.from('pi_assessments').select('id,payload,report_text,created_at').eq('user_id', grant.user_id).eq('id', id);
        const { data, error } = await companyFilter(query, grant.company_id).single();
        failure(error, 'Avaliação não encontrada ou indisponível para esta conta.'); return data;
      }
    };
  }
  return { CloudError, emailLink, validateConfig, payload, create };
});
