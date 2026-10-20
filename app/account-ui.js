'use strict';
window.PiresAccount = (() => {
  const el = id => document.getElementById(id);
  let cloud, hooks, accountId = null, authMode = 'login', generation = 0, busy = false, recovery = false, inviteSetup = false, lastAllowed = false, savedId = null, saved = false, pendingEmailLink = null;
  let selectedCompanyId;
  let invitationsEpoch = 0;
  let clientRole = false, clientDocumentId = null, requestedClientDocument = null, clientDocumentEpoch = 0;
  function clearClientDocument() {
    clientDocumentEpoch++;
    clientDocumentId = null;
    el('clientDocumentDetail')?.replaceChildren();
    el('clientDocumentDetail')?.classList.add('hidden');
  }
  function errorText(error) { return error instanceof PiresCloud.CloudError ? error.message : 'Serviço indisponível. Tente novamente; os dados preenchidos permanecem na tela.'; }
  function setMode(mode) {
    if (mode === 'signup' && !cloud?.config?.selfRegistrationEnabled) mode = 'login';
    authMode = mode;
    const signup = mode === 'signup', recover = mode === 'recover';
    el('signupDetails')?.classList.toggle('hidden',!signup);
    if(el('signupKind')) el('signupKind').disabled=!signup;
    if(el('signupCompany')) el('signupCompany').disabled=!signup;
    if(el('signupSeats')) el('signupSeats').disabled=!signup;
    if(el('authIntro'))el('authIntro').textContent=signup
      ? 'Solicite acesso às calculadoras. Confirme seu e-mail e aguarde a aprovação. Os 7 dias (168 horas) começam somente quando o administrador aprovar; reaprovar não reinicia o prazo.'
      : 'Entre para consultar suas avaliações ou acompanhar sua solicitação de acesso.';

    el('authTitle').textContent = signup ? 'Crie seu acesso' : recover ? 'Recuperar acesso' : 'Entre no aplicativo';
    ['nameField', 'confirmField', 'passwordHint'].forEach(id => el(id).classList.toggle('hidden', !signup));
    el('name').required = signup; el('confirm').required = signup;
    el('passwordField').classList.toggle('hidden', recover); el('password').required = !recover;
    el('password').minLength = signup ? 8 : 1;
    // Existing passwords remain usable even when longer than the new-password range.
    el('password').maxLength = 64;
    el('password').autocomplete = signup ? 'new-password' : 'current-password';
    el('password').value = ''; el('confirm').value = '';
    el('authSubmit').textContent = signup ? 'Solicitar cadastro' : recover ? 'Enviar link de recuperação' : 'Entrar';
    el('toggleAuth').textContent = mode === 'login' ? 'Criar acesso' : 'Voltar ao acesso';
    el('recover').classList.toggle('hidden', recover);
    el('authError').textContent = ''; el('authStatus').textContent = '';
  }
  function setBusy(value) {
    busy = value;
    ['authSubmit', 'toggleAuth', 'recover'].forEach(id => el(id).disabled = value);
  }
  function clearInvitations() {
    invitationsEpoch++;
    el('companyInvitations')?.classList.add('hidden');
    el('invitationChoices')?.replaceChildren();
    if (el('invitationStatus')) el('invitationStatus').textContent = '';
  }
  function reset() {
    el('accessRequestBox')?.classList.add('hidden');
    el('requestForm')?.classList.add('hidden');
    if(el('requestStatus')) el('requestStatus').textContent='';
    if(el('requestName')) el('requestName').value='';
    if(el('requestCompany')) el('requestCompany').value='';
    generation++; selectedCompanyId=undefined; el('activeCompanyBox')?.classList.add('hidden'); el('activeCompanyChoices')?.replaceChildren(); accountId = null; savedId = null; saved = false; lastAllowed = false;
    clientRole = false; clearClientDocument();
    el('clientPublicationManagement')?.classList.add('hidden');
    hooks.clear(); el('historyList').replaceChildren(); el('historyStatus').textContent = '';
    el('logout').classList.add('hidden'); el('historyButton').classList.add('hidden');
    el('adminLink')?.classList.add('hidden');
    clearInvitations();
  }
  async function invitations(ticket) {
    const request = ++invitationsEpoch;
    el('companyInvitations').classList.add('hidden');
    el('invitationChoices').replaceChildren();
    if (typeof cloud.pendingInvites !== 'function') return;
    try {
      const rows = await cloud.pendingInvites();
      if (ticket !== generation || request !== invitationsEpoch || !accountId) return;
      for (const row of rows) {
        const option = document.createElement('option');
        option.value = row.invitation_id; option.textContent = row.company_name;
        el('invitationChoices').append(option);
      }
      el('companyInvitations').classList.toggle('hidden', rows.length === 0);
    } catch { if (ticket === generation && request === invitationsEpoch) el('companyInvitations').classList.add('hidden'); }
  }
  async function enter(user, keepView = false) {
    if (accountId !== user.id) { reset(); accountId = user.id; }
    const ticket = generation, previouslyAllowed = lastAllowed;
    el('greeting').textContent = 'Área de trabalho';
    el('logout').classList.remove('hidden');
    if (recovery) { hooks.show('passwordReset'); return false; }
    if (!cloud.configured) { lastAllowed = true; hooks.show('home'); return true; }
    const grant = await cloud.access(selectedCompanyId);
    if (ticket !== generation || accountId !== user.id) return false;
    lastAllowed = grant.allowed === true;
    if (typeof cloud.companies === 'function' && el('activeCompanyChoices')) {
      try {const choices=await cloud.companies();if(ticket!==generation)return false;const select=el('activeCompanyChoices');select.replaceChildren();
        const auto=document.createElement('option');auto.value='';auto.textContent='Escolha automática entre empresas válidas';select.append(auto);
        for(const c of choices){const option=document.createElement('option');option.value=c.id;option.textContent=c.name;select.append(option);}select.value=selectedCompanyId??grant.company_id??'';el('activeCompanyBox').classList.toggle('hidden',choices.length===0);
      } catch {el('activeCompanyBox')?.classList.add('hidden');}
    }
    const nextClientRole = grant.company_role === 'client';
    if (nextClientRole !== clientRole) { hooks.clear(); clearClientDocument(); el('historyList').replaceChildren(); }
    clientRole = nextClientRole;
    if (grant.status === 'pending' || lastAllowed) void invitations(ticket);
    else clearInvitations();
    el('historyButton').classList.toggle('hidden', !lastAllowed || !grant.company_id);
    el('adminLink')?.classList.toggle('hidden', !grant.can_admin);
    el('historyButton').textContent = clientRole ? 'Documentos liberados' : 'Minhas avaliações';
    if (!lastAllowed) {
      if (previouslyAllowed) hooks.clear();
      el('historyList').replaceChildren();
      clearClientDocument(); el('clientPublicationManagement')?.classList.add('hidden');
      el('accessTitle').textContent = ({ pending: 'Aguardando aprovação', expired: 'Vigência da empresa encerrada', revoked: 'Acesso revogado' })[grant.status] || 'Acesso indisponível';
      el('accessMessage').textContent = grant.message || 'Não foi possível confirmar seu acesso. Tente novamente mais tarde.';
      hooks.show('accessDenied');
      await showAccessRequest(ticket, grant);
      return false;
    }
    if (clientRole) {
      const requested = requestedClientDocument || clientDocumentId;
      requestedClientDocument = null;
      const documentsEpoch = await showClientDocuments(ticket);
      if (requested && ticket === generation && documentsEpoch === clientDocumentEpoch) await openClientDocument(requested, ticket);
    } else if (!keepView || !previouslyAllowed) hooks.show('home');
    return true;
  }
  function intakeValues(prefix) {
    return {kind:el(prefix+'Kind').value,company:el(prefix+'Company').value.trim(),seats:Number(el(prefix+'Seats').value)};
  }
  async function showAccessRequest(ticket,grant) {
    const box=el('accessRequestBox');if(!box)return;
    box.classList.add('hidden');el('requestForm').classList.add('hidden');el('requestStatus').textContent='';
    if(!cloud.config.selfRegistrationEnabled || grant.status!=='pending' || grant.company_id)return;
    try{
      const answer=await cloud.myAccessRequest();
      if(ticket!==generation || !accountId)return;
      box.classList.remove('hidden');
      const r=answer.request;
      if(r){
        el('requestStatus').textContent=r.request_state==='pending'
          ? 'Sua solicitação está no painel do administrador, aguardando aprovação. Os 7 dias ainda não começaram.'
          : r.request_state==='rejected' ? 'Sua solicitação não foi aprovada. Entre em contato com a Pires para revisão.'
          : 'Solicitação aprovada. Se o acesso ainda não apareceu, selecione Verificar novamente.';
      } else if(answer.can_request)el('requestForm').classList.remove('hidden');
      else el('requestStatus').textContent='Este acesso precisa ser revisado pelo administrador.';
    }catch(error){if(ticket===generation){box.classList.remove('hidden');el('requestStatus').textContent=errorText(error);}}
  }
  async function refresh() {
    if (pendingEmailLink) return;
    const ticket = generation;
    try {
      const user = await cloud.user();
      if (ticket !== generation) return;
      if (!user || !user.email_confirmed_at) { reset(); hooks.show('auth'); return; }
      const existingAccount = accountId === user.id;
      const allowed = await enter(user, existingAccount && !recovery);
      if (allowed && !existingAccount && typeof cloud.recordActivity === 'function') void cloud.recordActivity('session_opened');
    } catch (error) { if (ticket === generation) { reset(); hooks.show('auth'); el('authError').textContent = errorText(error); } }
  }
  function cleanCallback() {
    const url = new URL(location.href);
    ['code', 'error', 'error_code', 'error_description', 'flow', 'cadastro'].forEach(key => url.searchParams.delete(key));
    url.hash = ''; history.replaceState(null, '', url.pathname + url.search);
  }
  async function init(callbacks) {
    hooks = callbacks;
    el('privacy').onclick = e => {
      e.preventDefault();
      hooks.message('Tratamento de dados', cloud?.configured
        ? `Nome, e-mail, tipo de uso, nome da empresa e quantidade de licenças solicitadas são usados para identificar seu cadastro e apresentá-lo ao administrador global para aprovação. O cadastro e a confirmação do e-mail não iniciam a degustação. As avaliações são enviadas ao banco de dados quando você seleciona Salvar avaliação e ficam vinculadas à sua conta. A sessão é mantida neste navegador; use Sair em dispositivos compartilhados. A senha é transmitida ao serviço de autenticação por conexão criptografada e não integra as avaliações. Arquivos exportados ficam sob seu controle. Canal de privacidade: ${cloud.config.privacyEmail}.`
        : 'Nesta demonstração não há cadastro, envio de dados ou armazenamento persistente de avaliações. Dados técnicos permanecem na memória da página até sair ou recarregar. Arquivos são baixados somente por sua ação.');
    };
    try { cloud = PiresCloud.create(window.PIRES_CONFIG, window.PiresSupabase?.createClient); }
    catch (error) { el('environmentNotice').textContent = 'Acesso temporariamente indisponível.'; el('authError').textContent = errorText(error); return; }
    el('logout').onclick = async () => {
      el('logout').disabled = true;
      try { if (cloud.configured) await cloud.signOut(); recovery = false; inviteSetup = false; reset(); setMode('login'); hooks.show('auth'); }
      catch (error) { hooks.message('Encerramento de sessão', errorText(error)); }
      finally { el('logout').disabled = false; }
    };
    if (!cloud.configured) {
      el('environmentNotice').textContent = 'Demonstração local • Sem cadastro ou armazenamento de avaliações. Resultados técnicos indicativos.';
      el('demoEnter').classList.remove('hidden');
      el('demoEnter').onclick = () => enter({ id: 'demo' });
      return;
    }
    el('environmentNotice').textContent = 'Ambiente conectado • Salve as avaliações para consultá-las em sua conta. Resultados técnicos indicativos.';
    el('authForm').classList.remove('hidden'); el('authActions').classList.remove('hidden');
    el('toggleAuth').classList.toggle('hidden', !cloud.config.selfRegistrationEnabled);
    el('toggleAuth').onclick = () => setMode(authMode === 'login' ? 'signup' : 'login');
    const syncIntake=(prefix)=>{
      const company=el(prefix+'Kind').value==='company';
      el(prefix+'CompanyField').classList.toggle('hidden',!company);
      el(prefix+'Company').required=company;
      el(prefix+'SeatsField').classList.toggle('hidden',!company);
      if(!company)el(prefix+'Seats').value='1';
    };
    ['signup','request'].forEach(prefix=>{if(el(prefix+'Kind')){el(prefix+'Kind').onchange=()=>syncIntake(prefix);syncIntake(prefix);}});
    if(el('requestForm')) el('requestForm').onsubmit=async e=>{
      e.preventDefault();if(busy)return;setBusy(true);el('requestSubmit').disabled=true;el('requestStatus').textContent='';
      try{await cloud.requestAccess(el('requestName').value.trim(),intakeValues('request'));await refresh();}
      catch(error){el('requestStatus').textContent=errorText(error);}
      finally{setBusy(false);el('requestSubmit').disabled=false;}
    };
    el('accessRetry').onclick = () => refresh();
    if(el('activeCompanyChoices'))el('activeCompanyChoices').onchange=async()=>{selectedCompanyId=el('activeCompanyChoices').value||null;generation++;lastAllowed=false;saved=false;savedId=null;hooks.clear();clearClientDocument();el('historyList').replaceChildren();hooks.show('accessDenied');el('accessMessage').textContent='Confirmando acesso à empresa selecionada.';await refresh();};
    el('acceptCompanyInvite').onclick = async () => {
      const ticket = generation, button = el('acceptCompanyInvite');
      button.disabled = true; el('invitationStatus').textContent = '';
      try {
        await cloud.acceptInvite(el('invitationChoices').value);
        if (ticket !== generation) return;
        el('invitationStatus').textContent = 'Convite aceito. O vínculo aguarda aprovação do administrador.';
        await refresh();
      } catch (error) { if (ticket === generation) el('invitationStatus').textContent = errorText(error); }
      finally { button.disabled = false; }
    };
    el('recover').onclick = () => setMode('recover');
    el('authForm').onsubmit = async e => {
      e.preventDefault(); if (busy) return; setBusy(true); el('authError').textContent = ''; el('authStatus').textContent = '';
      try {
        const email = el('email').value.trim();
        if (authMode === 'signup') {
          if (el('password').value !== el('confirm').value) throw new PiresCloud.CloudError('As senhas devem ser iguais.');
          await cloud.signUp(el('name').value.trim(), email, el('password').value, intakeValues('signup'));
          setMode('login'); el('authStatus').textContent = 'Se o cadastro for novo, sua solicitação ficará pendente no painel. Confira o e-mail para confirmar sua identidade. A degustação só começa após aprovação. Se já possui conta, entre ou recupere sua senha.';
        } else if (authMode === 'recover') {
          await cloud.recover(email);
          el('authStatus').textContent = 'Se houver uma conta apta à recuperação, você receberá um link por e-mail. Abra o link para definir uma nova senha.';
        } else {
          const ticket = generation;
          recovery = false; inviteSetup = false;
          const current = await cloud.signIn(email, el('password').value);
          if (ticket !== generation) return;
          const allowed = await enter(current);
          if (allowed && typeof cloud.recordActivity === 'function') void cloud.recordActivity('session_opened');
        }
        el('password').value = ''; el('confirm').value = '';
      } catch (error) { el('authError').textContent = errorText(error); }
      finally { setBusy(false); }
    };
    el('resetForm').onsubmit = async e => {
      e.preventDefault(); const button = el('resetForm').querySelector('button'); button.disabled = true; el('resetError').textContent = '';
      try {
        if (el('newPassword').value !== el('newConfirm').value) throw new PiresCloud.CloudError('As senhas devem ser iguais.');
        const wasInvite = inviteSetup;
        await cloud.updatePassword(el('newPassword').value); recovery = false; inviteSetup = false; reset(); setMode('login'); hooks.show('auth');
        el('authStatus').textContent = wasInvite ? 'Senha definida. Seu acesso continua sujeito à aprovação do administrador. Entre para consultar a situação.' : 'Senha atualizada. Entre novamente com suas credenciais.';
      } catch (error) { el('resetError').textContent = errorText(error); }
      finally { el('newPassword').value = ''; el('newConfirm').value = ''; button.disabled = false; }
    };
    el('historyButton').onclick = showHistory;
    el('saveAssessment').onclick = saveAssessment;
    // An email can reopen an existing tab with only a fragment change. Reinitialize
    // that callback exactly as on a fresh page, without consuming the token yet.
    window.addEventListener('hashchange', () => {
      if (new URLSearchParams(location.hash.slice(1)).has('token_hash')) location.reload();
    });
    const callbackUrl = new URL(location.href);
    requestedClientDocument = callbackUrl.searchParams.get('document');
    recovery = callbackUrl.searchParams.get('flow') === 'recovery';
    const callbackError = callbackUrl.searchParams.has('error');
    let emailLinkError = null;
    try { pendingEmailLink = PiresCloud.emailLink(location.href); }
    catch (error) { emailLinkError = errorText(error); }
    // Token stays only in memory; remove it from the address bar before interaction.
    if (pendingEmailLink || emailLinkError) cleanCallback();
    cloud.subscribe((event) => {
      if (event === 'PASSWORD_RECOVERY') recovery = true;
      // Supabase callbacks must not await another auth call while its lock is held.
      setTimeout(() => {
        if (event === 'SIGNED_OUT') { pendingEmailLink = null; recovery = false; inviteSetup = false; reset(); hooks.show('auth'); }
        else if (pendingEmailLink) return;
        else if (!busy) void refresh();
      }, 0);
    });
    window.addEventListener('focus', () => { if (!busy && !pendingEmailLink) void refresh(); });
    if (typeof setInterval === 'function') setInterval(() => { if (!busy && !pendingEmailLink) void refresh(); }, 60000);
    if (pendingEmailLink) {
      inviteSetup = pendingEmailLink.type === 'invite';
      recovery = pendingEmailLink.type === 'recovery' || inviteSetup;
      el('emailLinkTitle').textContent = inviteSetup ? 'Aceitar convite' : recovery ? 'Recuperar seu acesso' : 'Confirmar seu cadastro';
      el('emailLinkIntro').textContent = inviteSetup ? 'Confirme sua identidade e defina sua senha. Depois de entrar, escolha e aceite o convite da empresa. A vigência da empresa começa na primeira aprovação e é compartilhada pela equipe.' : recovery ? 'Continue para validar o link recebido e definir uma nova senha.' : 'Confirme seu e-mail. A liberação do aplicativo depende da aprovação do administrador.';
      el('emailLinkConfirm').textContent = inviteSetup ? 'Confirmar identidade e definir senha' : recovery ? 'Continuar recuperação' : 'Confirmar meu e-mail';
      hooks.show('emailVerification');
      el('emailLinkConfirm').onclick = async () => {
        if (busy || !pendingEmailLink) return;
        setBusy(true); el('emailLinkConfirm').disabled = true; el('emailLinkCancel').disabled = true;
        el('emailLinkError').textContent = '';
        const ticket = generation;
        try {
          const current = await cloud.verifyEmailLink(pendingEmailLink);
          if (ticket !== generation) return;
          pendingEmailLink = null; await enter(current);
        } catch (error) { el('emailLinkError').textContent = errorText(error); }
        finally { setBusy(false); el('emailLinkConfirm').disabled = false; el('emailLinkCancel').disabled = false; }
      };
      el('emailLinkCancel').onclick = async () => {
        pendingEmailLink = null; recovery = false; inviteSetup = false; setMode('login'); hooks.show('auth'); await refresh();
      };
      return;
    }
    if (emailLinkError) { setMode('login'); hooks.show('auth'); el('authError').textContent = emailLinkError; return; }
    if(callbackUrl.searchParams.get('cadastro')==='1' && !recovery && !callbackError)setMode('signup');
    await refresh(); cleanCallback();
    if (callbackError) el('authError').textContent = 'Link de acesso inválido ou expirado. Solicite um novo link.';
  }
  function resultReady() {
    savedId = crypto.randomUUID(); saved = false;
    el('saveAssessment').disabled = !cloud?.configured;
    el('saveStatus').textContent = cloud?.configured ? 'Avaliação ainda não salva.' : 'Demonstração: use as exportações para preservar esta avaliação. O armazenamento em conta depende da conexão do serviço.';
  }
  async function saveAssessment() {
    const evaluation = hooks.result(); if (!evaluation.snapshot || saved || !cloud?.configured) return;
    const ticket = generation, id = savedId; el('saveAssessment').disabled = true; el('saveStatus').textContent = 'Salvando avaliação…';
    try {
      await cloud.save(evaluation.snapshot, evaluation.report, id);
      if (ticket === generation && id === savedId) { saved = true; el('saveStatus').textContent = 'Avaliação salva em sua conta.'; }
    } catch (error) { if (ticket === generation && id === savedId) { el('saveStatus').textContent = errorText(error); el('saveAssessment').disabled = false; } }
  }
  function historyLayout(isClient) {
    if (el('historyTitle')) el('historyTitle').textContent = isClient ? 'Documentos liberados' : 'Minhas avaliações';
    if (el('historyIntro')) el('historyIntro').textContent = isClient
      ? 'Somente documentos destinados à sua empresa cliente, dentro do contratante, com liberação explícita de Gestão para esta revisão. Aprovação da conta e degustação não liberam documentos.'
      : 'Até 100 registros mais recentes. Carregar dados permite uma nova avaliação.';
    if (el('historyBack')) {
      el('historyBack').textContent = isClient ? 'Atualizar documentos liberados' : 'Voltar às calculadoras';
      el('historyBack').onclick = isClient ? showHistory : () => hooks.show('calculators');
    }
    el('clientPublicationManagement')?.classList.add('hidden');
  }
  function documentText(record) {
    const lines = [record.title, `Revisão ${record.revision} · Liberação ${record.id}`];
    if (record.report_date) lines.push(`Data: ${record.report_date}`);
    if (record.report_text) lines.push(record.report_text);
    if (record.documents) {
      lines.push(`Documentos liberados incluídos: ${record.documents.length}`);
      record.documents.forEach(child => lines.push(documentText(child)));
    }
    return lines.join('\n\n');
  }
  async function showClientDocuments(ticket = generation) {
    hooks.show('history'); historyLayout(true); clearClientDocument();
    const documentsEpoch = clientDocumentEpoch;
    el('historyList').replaceChildren(); el('historyStatus').textContent = 'Consultando documentos liberados.';
    try {
      const records = await cloud.listClientDocuments();
      if (ticket !== generation || !clientRole || documentsEpoch !== clientDocumentEpoch) return;
      el('historyStatus').textContent = records.length ? `${records.length} documento(s) liberado(s).` : 'Nenhum documento liberado para sua empresa.';
      records.forEach(record => {
        const card = document.createElement('article'); card.className = 'card';
        const title = document.createElement('h2'); title.textContent = record.title;
        const detail = document.createElement('p'); detail.textContent = `${record.source_kind === 'rdo' ? 'RDO' : 'Avaliação'} · Revisão ${record.revision}`;
        const button = document.createElement('button'); button.textContent = 'Consultar documento liberado';
        button.onclick = () => openClientDocument(record.id, ticket);
        card.append(title, detail, button); el('historyList').append(card);
      });
      return documentsEpoch;
    } catch (error) { if (ticket === generation && documentsEpoch === clientDocumentEpoch) el('historyStatus').textContent = errorText(error); }
  }
  async function openClientDocument(id, ticket = generation) {
    clearClientDocument();
    const documentEpoch = clientDocumentEpoch;
    try {
      // Every detail and download is reauthorized; retained DTOs cannot export.
      const record = await cloud.loadClientDocument(id);
      if (ticket !== generation || !clientRole || documentEpoch !== clientDocumentEpoch) return;
      clientDocumentId = record.id;
      const panel = el('clientDocumentDetail'); panel.classList.remove('hidden');
      const title = document.createElement('h2'); title.textContent = record.title;
      const body = document.createElement('pre'); body.textContent = documentText(record);
      if (body.style) body.style.whiteSpace = 'pre-wrap';
      const note = document.createElement('p'); note.textContent = 'Consulta somente leitura. Cada download valida novamente a liberação. Arquivos já baixados não podem ser recolhidos.';
      const actions = document.createElement('div'); actions.className = 'actions';
      [['Baixar texto liberado', false], ['Baixar JSON liberado', true]].forEach(([label, json]) => {
        const button = document.createElement('button'); button.textContent = label;
        button.onclick = async () => {
          if (ticket !== generation || !clientRole || clientDocumentId !== id) return;
          const downloadEpoch = ++clientDocumentEpoch;
          button.disabled = true;
          try {
            const fresh = await cloud.loadClientDocument(id);
            if (ticket !== generation || !clientRole || clientDocumentId !== id || downloadEpoch !== clientDocumentEpoch) return;
            hooks.download(json ? JSON.stringify(fresh, null, 2) : documentText(fresh),
              `documento-liberado-r${fresh.revision}.${json ? 'json' : 'txt'}`,
              json ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8');
          } catch (error) {
            if (ticket === generation && downloadEpoch === clientDocumentEpoch) { clearClientDocument(); el('historyList').replaceChildren(); el('historyStatus').textContent = errorText(error); }
          } finally { button.disabled = false; }
        };
        actions.append(button);
      });
      panel.append(title, body, note, actions);
    } catch (error) {
      if (ticket === generation && documentEpoch === clientDocumentEpoch) { clearClientDocument(); el('historyList').replaceChildren(); el('historyStatus').textContent = errorText(error); }
    }
  }
  async function managementControls(companyId, ticket) {
    const panel = el('clientPublicationManagement');
    if (!panel || typeof cloud.canManageClientPublications !== 'function' || !await cloud.canManageClientPublications(companyId) || ticket !== generation || clientRole) return;
    panel.classList.remove('hidden');
    el('publicationManagementStatus').textContent = 'Capacidade explícita de Gestão confirmada para esta empresa.';
    const manage = async action => {
      const buttons = [el('clientPublicationForm').querySelector('button'), el('withdrawClientPublication')];
      buttons.forEach(button => { button.disabled = true; });
      el('publicationManagementStatus').textContent = '';
      try {
        const kind = el('publicationKind').value, source = el('publicationSource').value.trim();
        const dependencies = el('publicationDependencies').value.trim().split(/[\s,]+/).filter(Boolean);
        const recipient = el('publicationRecipient').value.trim();
        const result = await cloud.manageClientRelease(companyId, kind, source, action, dependencies, recipient);
        if (ticket !== generation || clientRole) return;
        el('publicationManagementStatus').textContent = `${action === 'release' ? 'Revisão liberada' : 'Liberação retirada'} · ${result.id}. A auditoria foi preservada.`;
      } catch (error) { if (ticket === generation) el('publicationManagementStatus').textContent = errorText(error); }
      finally { buttons.forEach(button => { button.disabled = false; }); }
    };
    el('clientPublicationForm').onsubmit = event => { event.preventDefault(); return manage('release'); };
    el('withdrawClientPublication').onclick = () => manage('withdraw');
  }
  async function showHistory() {
    const ticket = generation;
    try {
      const grant = await cloud.requireAccess(undefined, true);
      if (ticket !== generation) return;
      const nextClient = grant.company_role === 'client';
      if (nextClient !== clientRole) { hooks.clear(); clearClientDocument(); }
      clientRole = nextClient;
    } catch (error) {
      if (ticket === generation) { clearClientDocument(); el('historyList').replaceChildren(); el('historyStatus').textContent = errorText(error); }
      return;
    }
    if (clientRole) { requestedClientDocument = null; return showClientDocuments(ticket); }
    hooks.show('history'); historyLayout(false); clearClientDocument(); el('historyList').replaceChildren(); el('historyStatus').textContent = 'Consultando avaliações…';
    try {
      const records = await cloud.list(); if (ticket !== generation) return;
      if (records.some(record => record?.source_kind)) { clientRole = true; hooks.clear(); return showClientDocuments(ticket); }
      el('historyStatus').textContent = records.length ? `${records.length} avaliação(ões) disponíveis.` : 'Nenhuma avaliação salva nesta conta.';
      records.forEach(record => {
        const card = document.createElement('article'); card.className = 'card';
        const title = document.createElement('h2'); title.textContent = record.title;
        const detail = document.createElement('p'); detail.textContent = `${({life: 'Vida remanescente', pmta: 'Equipamentos • NR-13 / PMTA', risk: 'Matriz PI'})[record.kind] || 'Avaliação'} • ${new Date(record.created_at).toLocaleString('pt-BR')} • versão ${record.app_version}`;
        const actions = document.createElement('div'); actions.className = 'actions';
        [['Carregar dados', false], ['Baixar memória salva', true]].forEach(([label, exportOnly]) => {
          const button = document.createElement('button'); button.textContent = label; button.className = 'secondary';
          button.onclick = async () => {
            button.disabled = true;
            try {
              const recordData = await cloud.load(record.id); if (ticket !== generation) return;
              if (recordData?.source_kind) { clientRole = true; hooks.clear(); return showClientDocuments(ticket); }
              if (exportOnly) hooks.download(recordData.report_text, 'memoria-salva.txt', 'text/plain;charset=utf-8');
              else hooks.load(recordData.payload, record.id);
            } catch (error) { if (ticket === generation) el('historyStatus').textContent = errorText(error); }
            finally { button.disabled = false; }
          };
          actions.append(button);
        });
        card.append(title, detail, actions); el('historyList').append(card);
      });
      const grant = await cloud.requireAccess(undefined, true);
      if (ticket === generation) await managementControls(grant.company_id, ticket);
    } catch (error) { if (ticket === generation) el('historyStatus').textContent = errorText(error); }
  }
  async function guard() {
    if (!cloud?.configured) return cloud?.config?.mode === 'demo';
    const ticket = generation;
    try {
      const current = await cloud.user();
      if (ticket !== generation) return false;
      if (!current?.email_confirmed_at) { reset(); hooks.show('auth'); return false; }
      const allowed = await enter(current, true);
      return allowed && !clientRole;
    } catch (error) { if (ticket === generation) { reset(); hooks.show('auth'); el('authError').textContent = errorText(error); } return false; }
  }
  return { init, resultReady, guard };
})();
