(function () {
  'use strict';
  const config = window.PIRES_CONFIG;
  if (config?.mode !== 'connected' || config.gestao?.backend !== 'supabase') return;
  const card = document.getElementById('assetsModule'), badge = document.getElementById('assetsModuleBadge'),
    link = document.getElementById('openManagement'), planned = document.getElementById('managementPlanned'),
    note = document.getElementById('assetsModuleNote'), home = document.getElementById('home');
  if (!card || !home) return;
  let adapter, teamAdapter, ticket = 0;
  function reset(text) {
    card.classList.add('module-planned'); link.classList.add('hidden'); planned.classList.remove('hidden');
    planned.textContent = text; badge.textContent = 'Acesso restrito'; note.textContent = 'O acesso à Gestão é validado para sua conta.';
  }
  async function refresh() {
    const revision = ++ticket;
    if (home.classList.contains('hidden')) { reset('Consultar acesso'); return false; }
    reset('Verificando acesso…');
    try {
      adapter ||= window.PiresGestaoConnected.create(config);
      let allowed = false;
      try { const status = await adapter.request('status'); allowed = status.capabilities?.operations === true; } catch { /* Team access is independently checked below. */ }
      if (!allowed && window.PiresTeamAPI) {
        teamAdapter ||= window.PiresTeamAPI.create(config);
        const organizations = await teamAdapter.organizations();
        for (const organization of organizations) {
          teamAdapter.setTenant(organization.id);
          try { await teamAdapter.call('status'); allowed = true; break; } catch { /* No grant for this organization. */ }
        }
      }
      if (revision !== ticket || home.classList.contains('hidden')) return false;
      if (!allowed) throw Error('Acesso indisponível');
      card.classList.remove('module-planned'); planned.classList.add('hidden'); link.classList.remove('hidden');
      link.href = '/gestao'; badge.textContent = 'Disponível para sua conta';
      note.textContent = 'Clientes, projetos e corpo técnico da organização.';
      return true;
    } catch {
      if (revision === ticket) reset('Indisponível para esta conta');
      return false;
    }
  }
  link.addEventListener('click', async event => { event.preventDefault(); if (await window.PiresAccount.guard() && await refresh()) window.location.assign('/gestao'); });
  new MutationObserver(refresh).observe(home, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pageshow', refresh); window.addEventListener('focus', refresh);
  refresh();
})();
