// Preserve every existing client/project deep link. Only the unscoped entry
// opens the new management home.
if(window.PIRES_CONFIG?.mode==='connected'&&!location.hash)location.replace('/gestao-inicio');
