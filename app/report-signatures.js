(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PiresReportSignatures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024;
  const GROUPS = [
    ['plh', 'Profissional Legalmente Habilitado', [['name', 'Nome do PLH'], ['specialty', 'Especialidade'], ['registration', 'CREA / registro profissional']]],
    ['company', 'Empresa Inspetora', [['name', 'Razão social'], ['cnpj', 'CNPJ']]],
    ['inspector', 'Inspetor', [['name', 'Nome do inspetor'], ['qualification', 'Qualificação / atividade'], ['registration', 'Registro / certificação']]]
  ];
  function object(value, label) {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} inválido.`);
    return value;
  }
  function field(value, label) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > 240) throw Error(`${label}: informe até 240 caracteres.`);
    return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  }
  function signature(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') throw Error('Imagem da assinatura inválida.');
    const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4) throw Error('A assinatura deve ser uma imagem PNG ou JPEG incorporada.');
    const bytes = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    if (bytes > MAX_BYTES) throw Error('A imagem da assinatura deve ter no máximo 2 MB.');
    let prefix;
    try { prefix = root.atob ? root.atob(match[2].slice(0, 32)) : Buffer.from(match[2].slice(0, 32), 'base64').toString('binary'); }
    catch (_) { throw Error('Imagem da assinatura inválida.'); }
    const png = prefix.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => prefix.charCodeAt(index) === byte);
    const jpeg = prefix.length >= 3 && [255, 216, 255].every((byte, index) => prefix.charCodeAt(index) === byte);
    if (match[1] === 'png' ? !png : !jpeg) throw Error('O conteúdo da assinatura não corresponde a uma imagem PNG ou JPEG.');
    return match[1] === 'jpg' ? value.replace('data:image/jpg;', 'data:image/jpeg;') : value;
  }
  function normalize(value) {
    const source = object(value, 'Identificação dos responsáveis'), result = {};
    for (const [key, title, fields] of GROUPS) {
      const raw = object(source[key], title), row = {};
      for (const [name, label] of fields) row[name] = field(raw[name], label);
      row.signatureDataUrl = signature(raw.signatureDataUrl); result[key] = row;
    }
    return result;
  }
  function fromLegacy(value) {
    const row = object(value, 'Responsáveis');
    return normalize({
      plh: { name: row.engineerName, specialty: row.engineerSpecialty, registration: row.engineerRegistration, signatureDataUrl: row.engineerSignatureDataUrl },
      company: { name: row.inspectionCompanyName, cnpj: row.inspectionCompanyCnpj, signatureDataUrl: row.companySignatureDataUrl },
      inspector: { name: row.inspectorName, qualification: row.inspectorQualification, registration: row.inspectorRegistration, signatureDataUrl: row.inspectorSignatureDataUrl }
    });
  }
  function create(host, options = {}) {
    if (!host || typeof host.append !== 'function') throw Error('Área de identificação dos responsáveis indisponível.');
    const document = host.ownerDocument || root.document, prefix = String(options.prefix || 'report').replace(/[^a-zA-Z0-9_-]/g, '-');
    let state = normalize(options.value), generation = 0;
    const controls = new Map(), pending = new Set();
    const changed = () => { if (typeof options.onChange === 'function') options.onChange(); };
    const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
    const wrapper = element('div', 'report-signatures');
    wrapper.append(element('p', 'report-signatures-note', 'Identifique o PLH, a empresa inspetora e o inspetor. Para cada um, é possível anexar uma imagem da assinatura (PNG ou JPEG, até 2 MB). A imagem não é uma assinatura digital autenticada.'));
    const grid = element('div', 'report-signatures-grid'); wrapper.append(grid);
    for (const [key, title, fields] of GROUPS) {
      const section = element('fieldset', 'report-signatures-person'); section.append(element('legend', '', title));
      const inputs = new Map();
      for (const [name, labelText] of fields) {
        const item = element('div', 'report-signatures-field'), label = element('label', '', labelText), input = element('input');
        input.type = 'text'; input.id = `${prefix}-${key}-${name}`; input.maxLength = 160; input.autocomplete = 'off'; label.htmlFor = input.id; input.value = state[key][name];
        input.addEventListener('input', () => { state[key][name] = input.value; changed(); });
        item.append(label, input); section.append(item); inputs.set(name, input);
      }
      const label = element('label', '', 'Adicionar imagem da assinatura'), upload = element('input');
      upload.type = 'file'; upload.id = `${prefix}-${key}-signature`; upload.accept = 'image/png,image/jpeg'; label.htmlFor = upload.id;
      const preview = element('img', 'report-signatures-preview'); preview.alt = `Imagem da assinatura - ${title}`;
      const remove = element('button', 'secondary report-signatures-remove', 'Remover assinatura'); remove.type = 'button';
      const status = element('p', 'report-signatures-status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('role', 'status');
      const control = { inputs, upload, preview, remove, status, ticket: 0 }; controls.set(key, control);
      function refresh() { const image = state[key].signatureDataUrl; preview.hidden = !image; remove.hidden = !image; if (image) preview.src = image; else preview.removeAttribute('src'); }
      remove.addEventListener('click', () => { control.ticket++; pending.delete(key); state[key].signatureDataUrl = ''; upload.value = ''; status.textContent = ''; refresh(); changed(); });
      upload.addEventListener('change', () => {
        const file = upload.files && upload.files[0]; if (!file) return;
        const ticket = ++control.ticket, epoch = generation;
        pending.add(key); remove.hidden = false; status.textContent = 'Carregando e verificando a imagem...'; changed();
        const current = () => epoch === generation && ticket === control.ticket;
        function finish(error, image) {
          if (!current()) return;
          pending.delete(key); upload.value = '';
          if (error) status.textContent = error.message;
          else { state[key].signatureDataUrl = image; status.textContent = 'Imagem da assinatura adicionada.'; }
          refresh(); changed();
        }
        if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > MAX_BYTES || file.size <= 0) { finish(Error('Selecione uma imagem PNG ou JPEG de até 2 MB.')); return; }
        const Reader = root.FileReader || document.defaultView && document.defaultView.FileReader;
        const Image = root.Image || document.defaultView && document.defaultView.Image;
        if (!Reader || !Image) { finish(Error('Não foi possível ler a imagem neste navegador.')); return; }
        const reader = new Reader();
        reader.onerror = () => finish(Error('Não foi possível ler o arquivo da assinatura.'));
        reader.onload = () => {
          if (!current()) return;
          let imageUrl;
          try { imageUrl = signature(reader.result); } catch (error) { finish(error); return; }
          const image = new Image();
          image.onerror = () => finish(Error('O arquivo não contém uma imagem válida da assinatura.'));
          image.onload = () => { if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 20000000) finish(Error('Use uma imagem da assinatura com até 20 milhões de pixels.')); else finish(null, imageUrl); };
          image.src = imageUrl;
        };
        try { reader.readAsDataURL(file); } catch (_) { finish(Error('Não foi possível ler o arquivo da assinatura.')); }
      });
      section.append(label, upload, preview, remove, status); grid.append(section); refresh();
    }
    host.replaceChildren(wrapper);
    function getValue() {
      if (pending.size) throw Error('Aguarde o carregamento da imagem da assinatura antes de exportar ou salvar.');
      return normalize(state);
    }
    function setValue(value) {
      const normalized = normalize(value); generation++; pending.clear(); state = normalized;
      for (const [key, control] of controls) {
        control.ticket++; control.upload.value = ''; control.status.textContent = '';
        for (const [name, input] of control.inputs) input.value = state[key][name];
        const image = state[key].signatureDataUrl; control.preview.hidden = !image; control.remove.hidden = !image;
        if (image) control.preview.src = image; else control.preview.removeAttribute('src');
      }
    }
    return Object.freeze({ getValue, setValue, clear: () => setValue(), isPending: () => pending.size > 0 });
  }
  function draw(doc, value, options = {}) {
    if (!doc || typeof doc.text !== 'function' || typeof doc.splitTextToSize !== 'function') throw Error('Documento PDF indisponível para os responsáveis.');
    const data = normalize(value), x = options.x === undefined ? 17 : options.x, y = options.y === undefined ? 50 : options.y, width = options.width === undefined ? 176 : options.width;
    if (![x, y, width].every(Number.isFinite) || width < 120) throw Error('Área de assinaturas inválida.');
    const gap = 8, columnWidth = (width - gap * 2) / 3, imageHeight = 24;
    const pageHeight = doc.internal && doc.internal.pageSize && doc.internal.pageSize.getHeight ? doc.internal.pageSize.getHeight() : 297;
    const maxHeight = options.maxHeight === undefined ? pageHeight - 24 - y : options.maxHeight;
    if (!Number.isFinite(maxHeight) || maxHeight < 50) throw Error('Altura da área de assinaturas inválida.');
    const blocks = GROUPS.map(([key, title, fields]) => [{ raw: title, bold: true }, { raw: data[key].name || 'Não informado', bold: true }, ...fields.filter(([name]) => name !== 'name').map(([name]) => ({ raw: (name === 'registration' ? key === 'plh' ? 'CREA / registro: ' : 'Registro: ' : name === 'cnpj' ? 'CNPJ: ' : '') + (data[key][name] || 'Não informado'), bold: false }))]);
    let scale = 1, planned;
    for (let attempt = 0; attempt < 7; attempt++) {
      planned = blocks.map(block => block.map(item => { doc.setFont('helvetica', item.bold ? 'bold' : 'normal'); doc.setFontSize((item.bold ? 9 : 8.5) * scale); return { ...item, lines: doc.splitTextToSize(item.raw, columnWidth - 2) }; }));
      const height = Math.max(...planned.map(block => imageHeight + 8 + block.reduce((sum, item) => sum + item.lines.length * 4.3 * scale + 1.5 * scale, 0)));
      if (height <= maxHeight) break;
      if (attempt === 6) throw Error('Os dados dos responsáveis excedem a área de assinaturas. Reduza o texto ou reserve uma página maior.');
      scale *= 0.92;
    }
    const lineHeight = 4.3 * scale;
    let bottom = y;
    GROUPS.forEach(([key, title, fields], index) => {
      const left = x + index * (columnWidth + gap), center = left + columnWidth / 2, row = data[key];
      if (row.signatureDataUrl) {
        let image;
        try { image = doc.getImageProperties(row.signatureDataUrl); } catch (_) { throw Error(`A imagem da assinatura de ${title} não pode ser incorporada. Escolha outro PNG ou JPEG.`); }
        if (!(image.width > 0 && image.height > 0)) throw Error('Dimensões da assinatura inválidas.');
        const ratio = Math.min((columnWidth - 4) / image.width, (imageHeight - 3) / image.height);
        doc.addImage(row.signatureDataUrl, image.fileType, center - image.width * ratio / 2, y + (imageHeight - image.height * ratio) / 2, image.width * ratio, image.height * ratio);
      }
      let cursor = y + imageHeight + 2;
      doc.setDrawColor(70, 84, 92); doc.line(left, cursor, left + columnWidth, cursor); cursor += 6;
      function write(item) {
        doc.setFont('helvetica', item.bold ? 'bold' : 'normal'); doc.setFontSize((item.bold ? 9 : 8.5) * scale); doc.setTextColor(42, 56, 64);
        const lines = item.lines;
        for (const line of lines) { doc.text(line, center, cursor, { align: 'center' }); cursor += lineHeight; }
        cursor += 1.5 * scale;
      }
      planned[index].forEach(write);
      bottom = Math.max(bottom, cursor);
    });
    return { bottom, height: bottom - y };
  }
  return Object.freeze({ MAX_BYTES, normalize, fromLegacy, create, draw });
});
