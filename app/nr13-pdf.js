(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PiresNR13Pdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const VERSION = 1;
  const COLORS = { ink: [0, 60, 88], yellow: [251, 185, 6], paper: [250, 245, 239], body: [42, 56, 64], muted: [91, 108, 117], line: [216, 226, 230], light: [240, 246, 248], alert: [137, 72, 24] };
  const empty = 'Não informado';
  const clean = input => String(input === null || input === undefined ? '' : input)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"').replace(/\u00D7/g, 'x').replace(/[\u2192\u2190]/g, '>')
    .replace(/\u2265/g, '>=').replace(/\u2264/g, '<=').trim();
  const value = input => clean(input) || empty;
  const number = (input, digits = 9) => typeof input === 'number' && Number.isFinite(input)
    ? input.toLocaleString('pt-BR', input !== 0 && Math.abs(input) < 10 ** -digits ? { maximumSignificantDigits: 6 } : { maximumFractionDigits: digits }) : 'Indeterminado';
  const unit = (input, suffix, digits) => `${number(input, digits)}${typeof input === 'number' && Number.isFinite(input) ? ` ${suffix}` : ''}`;
  const date = input => /^\d{4}-\d{2}-\d{2}/.test(clean(input)) ? `${clean(input).slice(8, 10)}/${clean(input).slice(5, 7)}/${clean(input).slice(0, 4)}` : value(input);
  const inputNumber = input => value(input).replace('.', ',');
  // These intermediates reproduce declared arithmetic only; exported results remain the saved snapshot.
  const declaredNumber = input => {
    const text = String(input === undefined || input === null ? '' : input).trim().replace(',', '.');
    return /^[-+]?\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  function signaturesApi() {
    const api = root.PiresReportSignatures || (typeof require === 'function' ? require('./report-signatures.js') : null);
    if (!api || typeof api.draw !== 'function' || typeof api.normalize !== 'function') throw Error('O módulo local de identificação e assinaturas não está disponível.');
    return api;
  }
  const numericResults = ['pressureKPa','volumeM3','diameterMM','pvKPaM3','pvMPaM3'];
  function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.inputs || typeof snapshot.inputs !== 'object' || Array.isArray(snapshot.inputs) || !snapshot.results || typeof snapshot.results !== 'object' || Array.isArray(snapshot.results)) throw Error('Calcule o enquadramento antes de exportar o relatório.');
    const r = snapshot.results;
    if (snapshot.type !== 'pmta' || r.mode !== 'nr13') throw Error('Este relatório aceita somente enquadramento NR-13 salvo no módulo de equipamentos.');
    if (r.status !== undefined && !['review_required','excluded','not_covered','classified','covered'].includes(r.status)) throw Error('A condição salva do enquadramento é inválida.');
    if (r.scope !== undefined && !['pending','excluded','not_covered','covered'].includes(r.scope)) throw Error('O escopo salvo do enquadramento é inválido.');
    if (r.category !== undefined && r.category !== null && !['I','II','III','IV','V'].includes(r.category)) throw Error('A categoria salva é inválida.');
    if (r.fluidClass !== undefined && r.fluidClass !== null && !['A','B','C','D'].includes(r.fluidClass)) throw Error('A classe do fluido salva é inválida.');
    if (r.group !== undefined && r.group !== null && (!Number.isInteger(r.group) || r.group < 1 || r.group > 5)) throw Error('O grupo salvo é inválido.');
    for (const key of numericResults) if (r[key] !== undefined && r[key] !== null && (typeof r[key] !== 'number' || !Number.isFinite(r[key]))) throw Error('O resultado salvo contém valor numérico inválido.');
    for (const [resultKey, inputKey, units] of [['pressureKPa','nrPressureUnit',['kPa','bar','MPa']],['volumeM3','nrVolumeUnit',['m3','L']],['diameterMM','nrDiameterUnit',['mm','m']]]) {
      if (r[resultKey] !== undefined && r[resultKey] !== null && !units.includes(snapshot.inputs[inputKey])) throw Error('A unidade da conversão salva é inválida ou não foi registrada. Calcule novamente o enquadramento.');
    }
    for (const key of ['warnings','premises','requirements']) if (r[key] !== undefined && (!Array.isArray(r[key]) || r[key].some(item => typeof item !== 'string'))) throw Error('Premissas ou pendências salvas inválidas.');
    if (r.criteria !== undefined && (!Array.isArray(r.criteria) || r.criteria.some(row => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !['string','boolean'].includes(typeof row[1])))) throw Error('Critérios salvos inválidos.');
    for (const list of [snapshot.sources,r.references]) if (list !== undefined && (!Array.isArray(list) || list.some(item => typeof item !== 'string' && (!item || typeof item !== 'object' || Array.isArray(item))))) throw Error('Fontes salvas inválidas.');
    if (r.intervals !== undefined && r.intervals !== null) {
      if (typeof r.intervals !== 'object' || Array.isArray(r.intervals)) throw Error('Limites gerais salvos inválidos.');
      for (const key of ['withoutSPIE','withSPIE']) {
        const row = r.intervals[key];
        if (row !== undefined && (!row || typeof row !== 'object' || Array.isArray(row))) throw Error('Limites gerais salvos inválidos.');
        for (const field of ['external','internal']) if (row && row[field] !== undefined && row[field] !== null && (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || row[field] < 0)) throw Error('Limite geral salvo inválido.');
      }
    }
    return snapshot;
  }
  const fieldLabels = {tag:'TAG',service:'Serviço',material:'Material declarado',pmtaTask:'Tarefa selecionada',nrProfile:'Família do equipamento',nrHead:'Geometria dos tampos',nrMaterialKind:'Natureza construtiva',nrSupport:'Apoio / instalação do tanque',nrTankDefinition:'Definição construtiva do tanque',nrSource:'Fonte dos dados e identificação',nrFluid:'Critério determinante do fluido',nrFluidTemperature:'Temperatura do fluido combustível [°C]',nrToxicLimit:'Limite de tolerância do fluido tóxico [ppm]',nrFluidClass:'Classe documentada / mistura',nrFluidSource:'Fundamentação do fluido / FDS / composição',nrRegime:'Regime de pressão',nrPressure:'Módulo da pressão máxima de operação',nrPressureUnit:'Unidade de pressão manométrica',nrVolume:'Volume interno / capacidade nominal',nrVolumeUnit:'Unidade do volume / capacidade',nrDiameter:'Diâmetro interno do vaso / externo do tanque',nrDiameterUnit:'Unidade do diâmetro',nrExclusion:'Revisão das exclusões 13.2.2'};
  const choices = {
    pmtaTask:{nr13:'Enquadramento NR-13'},nrRegime:{positive:'Pressão positiva',vacuum:'Exclusivamente vácuo',both:'Pressão positiva e vácuo'},nrMaterialKind:{metal:'Metálico',prfv:'PRFV',other:'Outro material',unknown:'Não confirmado'},
    nrSupport:{ground:'Fundo apoiado no solo / fundação contínua',legs:'Pernas, sapatas ou pedestais',saddles:'Selas',buried:'Enterrado',structural:'Estrutural de embarcação / plataforma',unknown:'Não confirmado'},nrTankDefinition:{yes:'Confirmado: estático, não enterrado, costado vertical',unknown:'Construção especial / não confirmada'},
    nrFluid:{flammable:'Inflamável',combustible:'Combustível - temperatura declarada',toxic:'Tóxico - limite de tolerância declarado',hydrogen:'Hidrogênio',acetylene:'Acetileno',steam:'Vapor de água',asphyxiant:'Gás asfixiante simples',air:'Ar comprimido',other:'Outros - fora de A, B e C',mixture:'Mistura - classe fundamentada',documented:'Classe previamente documentada'},nrVolumeUnit:{m3:'m³',L:'L'},nrExclusion:{none:'Nenhuma exclusão adicional aplicável, conforme revisão',unknown:'Revisão pendente'}
  };
  function inputValue(key, raw) {
    const catalog = root.IntegrityNR13 || (typeof require === 'function' ? require('./nr13.js') : null);
    const declared = typeof raw === 'boolean' ? raw ? 'Sim' : 'Não' : raw && typeof raw === 'object' ? JSON.stringify(raw) : value(raw);
    let label = choices[key] && choices[key][raw];
    if (catalog && key === 'nrProfile') label = (catalog.CATALOG.find(row => row.id === raw) || {}).name;
    if (catalog && key === 'nrHead') label = (catalog.HEADS.find(row => row[0] === raw) || [])[1];
    if (catalog && key === 'nrExclusion' && !label) { const row = catalog.EXCLUSIONS.find(row => row[0] === raw); if (row) label = '13.2.2(' + row[0] + ') - ' + row[1]; }
    return label ? label + ' [' + declared + ']' : declared;
  }
  function createPdf(input, metadata = {}, ctor) {
    const snapshot = validateSnapshot(input);
    if (typeof ctor !== 'function') throw Error('A biblioteca PDF local não está disponível.');
    const d = snapshot.inputs, r = snapshot.results;
    const signatures = signaturesApi().normalize(metadata.signatures || {});
    const company = typeof metadata.company === 'object' && metadata.company !== null ? metadata.company.name : metadata.company;
    const reportNumber = clean(metadata.reportNumber) || 'NR13-' + (clean(d.tag) || 'SEM-TAG');
    const revision = value(metadata.revision === undefined || metadata.revision === '' ? '00' : metadata.revision);
    const title = 'RELATÓRIO DE ENQUADRAMENTO NR-13';
    const doc = new ctor({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
    doc.setProperties({title:title + ' / ' + reportNumber,author:clean(metadata.providerName),subject:'Enquadramento indicativo / TAG ' + value(d.tag),creator:'Relatório técnico',keywords:'NR-13, enquadramento, categoria, escopo, avaliação indicativa'});
    const M = 17, W = 176, RIGHT = M + W, TOP = 43, BOTTOM = 269;
    let y = TOP, first = true;
    const index = [];
    function font(style = 'normal', size = 9, color = COLORS.body) { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); }
    function split(raw, width = W, size = 9, bold = false) { font(bold ? 'bold' : 'normal', size); return doc.splitTextToSize(value(raw), width); }
    function clipped(raw, width, size = 8) {
      font('normal', size); let text = clean(raw);
      while (text && doc.getTextWidth(text) > width) text = text.slice(0, -1);
      return text.length < clean(raw).length ? `${text.slice(0, -3)}...` : text;
    }
    function logo(raw, x, top, width, height) {
      if (!/^data:image\/(png|jpe?g);base64,/i.test(clean(raw))) return false;
      try {
        const image = doc.getImageProperties(raw), scale = Math.min(width / image.width, height / image.height);
        if (!(scale > 0 && Number.isFinite(scale))) return false;
        doc.addImage(raw, image.fileType, x + (width - image.width * scale) / 2, top + (height - image.height * scale) / 2, image.width * scale, image.height * scale);
        return true;
      } catch (_) { return false; }
    }
    let photoAttached = false;
    function equipmentPhoto() {
      const raw = metadata.equipmentPhotoDataUrl;
      ensure(raw ? 140 : 55);
      paragraph('Fotografia do equipamento', { bold: true, color: COLORS.ink, keepWithNext: true });
      if (!raw) {
        ensure(39); doc.setFillColor(...COLORS.light); doc.rect(M, y, W, 30, 'F');
        font('normal', 10, COLORS.muted); doc.text('Foto do equipamento não informada.', M + 7, y + 17); y += 39;
        return;
      }
      if (typeof raw !== 'string' || !/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/]+={0,2}$/i.test(raw) || raw.length > 12 * 1024 * 1024) throw Error('A foto do equipamento deve ser um PNG ou JPEG incorporado de até 9 MB.');
      let image;
      try { image = doc.getImageProperties(raw); } catch (_) { throw Error('Não foi possível incorporar a foto do equipamento. Selecione outro PNG ou JPEG.'); }
      if (!(image.width > 0 && image.height > 0) || image.width * image.height > 30000000) throw Error('A foto do equipamento deve ter dimensões válidas e até 30 milhões de pixels.');
      const boxHeight = 108, ratio = Math.min((W - 6) / image.width, (boxHeight - 6) / image.height);
      ensure(boxHeight + 14); doc.setFillColor(...COLORS.light); doc.rect(M, y, W, boxHeight, 'F');
      try { doc.addImage(raw, image.fileType, M + (W - image.width * ratio) / 2, y + (boxHeight - image.height * ratio) / 2, image.width * ratio, image.height * ratio); }
      catch (_) { throw Error('Não foi possível incorporar a foto do equipamento. Selecione outro PNG ou JPEG.'); }
      photoAttached = true; y += boxHeight + 6;
      paragraph(clean(metadata.equipmentPhotoCaption) || 'Fotografia fornecida para identificação do equipamento.', { size: 8.5, color: COLORS.muted });
      paragraph('A imagem identifica o registro declarado e não comprova, isoladamente, a condição de integridade ou a correspondência com os dados de cálculo.', { size: 8.3, color: COLORS.muted });
    }
    function header() {
      doc.setFillColor(...COLORS.ink); doc.rect(0, 0, 210, 3, 'F');
      const customLogo = logo(metadata.logoDataUrl, M, 8, 32, 17), titleX = customLogo ? M + 38 : M;
      font('bold', 10.5, COLORS.ink); doc.text(title, titleX, 16);
      font('normal', 7.6, COLORS.muted); doc.text('Memorial técnico - revisão pendente', titleX, 22);
      font('normal', 8, COLORS.muted); doc.text(clipped(`TAG ${value(d.tag)} | ${reportNumber}`, 143), M, 31);
      doc.text(`Rev. ${revision}`, RIGHT, 31, { align: 'right' });
      doc.setDrawColor(...COLORS.line); doc.line(M, 36, RIGHT, 36);
    }
    function newPage() { if (!first) doc.addPage(); first = false; header(); y = TOP; }
    function ensure(height) { if (y + height > BOTTOM) newPage(); }
    function paragraph(raw, options = {}) {
      const size = options.size || 9, lh = options.lineHeight || 4.4;
      const lines = split(raw, options.width || W, size, options.bold), after = options.after === undefined ? 2 : options.after;
      // Keep an opted-in heading beside the first default-height body line.
      if (options.keepWithNext) ensure(lines.length * lh + after + lh);
      for (const line of lines) {
        ensure(lh); font(options.bold ? 'bold' : 'normal', size, options.color || COLORS.body); doc.text(line, options.x || M, y); y += lh;
      }
      y += after;
    }
    function section(title) {
      ensure(44); if (y > TOP) y += 4; index.push({ title: clean(title), page: doc.getNumberOfPages() });
      paragraph(title, { size: 16, lineHeight: 6.8, bold: true, color: COLORS.ink, after: 3 });
      doc.setFillColor(...COLORS.yellow); doc.rect(M, y - 1, 17, 1.1, 'F'); y += 5;
    }
    function notice(raw) {
      const lines = split(raw, W - 10, 8.7);
      for (let offset = 0; offset < lines.length; offset += 38) {
        const part = lines.slice(offset, offset + 38), height = part.length * 4.5 + 9;
        ensure(height + 4); doc.setFillColor(...COLORS.paper); doc.rect(M, y - 3, W, height, 'F');
        doc.setFillColor(...COLORS.yellow); doc.rect(M, y - 3, 1.1, height, 'F');
        font('normal', 8.7, COLORS.alert); doc.text(part, M + 5, y + 2, { lineHeightFactor: 1.45 }); y += height + 4;
      }
    }
    function table(headers, rows, widths = [58, 118]) {
      const size = 8.7, lh = 4.3, pad = 2;
      function tableHeader() {
        const cells = headers.map((raw, i) => split(raw, widths[i] - pad * 2, size, true));
        const height = Math.max(...cells.map(lines => lines.length)) * lh + pad * 2;
        ensure(height + 12); doc.setFillColor(...COLORS.ink); doc.rect(M, y, W, height, 'F');
        let x = M;
        cells.forEach((cell, i) => { font('bold', size, [255, 255, 255]); doc.text(cell, x + pad, y + pad + 3.1, { lineHeightFactor: 1.42 }); x += widths[i]; });
        y += height;
      }
      tableHeader();
      rows.forEach((row, rowIndex) => {
        const cells = headers.map((_, i) => split(row[i], widths[i] - 2 * pad, size));
        let offset = 0, count = Math.max(...cells.map(lines => lines.length));
        while (offset < count) {
          const take = Math.min(count - offset, 34), height = take * lh + 2 * pad;
          if (y + height > BOTTOM) { newPage(); tableHeader(); }
          doc.setFillColor(...(rowIndex % 2 ? [255, 255, 255] : COLORS.light)); doc.rect(M, y, W, height, 'F');
          let x = M;
          cells.forEach((lines, i) => {
            font(i === 0 ? 'bold' : 'normal', size); const part = lines.slice(offset, offset + take);
            if (part.length) doc.text(part, x + pad, y + pad + 3.1, { lineHeightFactor: 1.42 });
            x += widths[i];
          });
          doc.setDrawColor(...COLORS.line); doc.line(M, y + height, RIGHT, y + height); y += height; offset += take;
        }
      }); y += 4;
    }
    function formula(name, equation, substitution, result) {
      const parts = [
        { text: name, size: 10.3, bold: true, lineHeight: 4.8, after: 1.4, color: COLORS.ink },
        { text: 'Equação: ' + value(equation), size: 8.8, lineHeight: 4.2, after: 0.9 },
        { text: 'Substituição: ' + value(substitution), size: 8.5, lineHeight: 4.15, after: 0.9, color: COLORS.muted },
        { text: 'Resultado preservado: ' + value(result), size: 9, bold: true, lineHeight: 4.4, after: 3, color: COLORS.ink }
      ];
      const height = parts.reduce((sum, part) => sum + split(part.text, W, part.size, part.bold).length * part.lineHeight + part.after, 0) + 4;
      ensure(Math.min(height + 1, BOTTOM - TOP));
      for (const part of parts) paragraph(part.text, part);
      doc.setDrawColor(...COLORS.line); doc.line(M, y, RIGHT, y); y += 4;
    }
    const result = (key, suffix) => r[key] === undefined || r[key] === null ? 'Não calculado / não atribuído no registro' : suffix ? unit(r[key], suffix) : value(r[key]);
    const incomplete = !r.status || !r.scope || !Array.isArray(r.warnings) || !Array.isArray(r.criteria) || (r.status === 'classified' && (!r.category || !r.group || !r.fluidClass));
    newPage(); equipmentPhoto();
    if (metadata.fictitious === true) notice('DEMONSTRAÇÃO FICTÍCIA. Dados e imagens não associados à avaliação de equipamento real.');
    section('01 - Identificação e rastreabilidade');
    table(['Registro','Informação declarada'],[['Empresa / cliente',company],['Número / revisão',reportNumber + ' / ' + revision],['TAG',d.tag],['Serviço',d.service],['Material',d.material],['Data / instante',snapshot.createdAt],['Versão do aplicativo',snapshot.version],['Versão do motor',snapshot.engineVersion || r.version]]);
    paragraph('Observações do relatório',{bold:true,color:COLORS.ink,keepWithNext:true}); paragraph(metadata.notes);
    notice('ENQUADRAMENTO INDICATIVO - revisão técnica pendente. A exportação conserva entradas, resultados, fontes e pendências do registro salvo. Não determina pressão admissível, liberação operacional ou próxima data de inspeção.');
    section('02 - Entradas completas da avaliação salva');
    paragraph('Entradas declaradas no snapshot, inclusive campos eventualmente não utilizados pelo caminho de enquadramento. A presença de um valor não significa validação documental.',{color:COLORS.muted});
    const inputRows = Object.entries(d).map(([key,raw]) => [fieldLabels[key] || 'Campo registrado: ' + key,inputValue(key,raw)]);
    table(['Parâmetro registrado','Valor declarado / identificação'],inputRows.length ? inputRows : [['Entradas','Nenhuma entrada registrada']]);
    section('03 - Resultados de abrangência e categoria');
    const statusLabels = {review_required:'Revisão necessária - categoria não definida automaticamente',excluded:'Exclusão indicada no registro',not_covered:'Não abrangido pelos critérios informados',classified:'Categoria atribuída no cálculo salvo - revisão técnica pendente',covered:'Abrangência indicada - revisão técnica pendente'};
    const scopeLabels = {pending:'Pendente de confirmação',excluded:'Excluído segundo o registro salvo',not_covered:'Não abrangido segundo o registro salvo',covered:'Abrangido segundo o registro salvo'};
    table(['Resultado','Valor preservado da avaliação'],[['Condição do registro',statusLabels[r.status] || 'Não registrada - revisão pendente'],['Escopo / abrangência',scopeLabels[r.scope] || 'Não registrado - revisão pendente'],['Família / tipo',r.profile],['Família do motor',r.family],['Classe do fluido',result('fluidClass')],['Grupo de potencial de risco',result('group')],['Categoria do vaso',result('category')],['Rota do código declarada',r.codeRoute],['Situação do cálculo estrutural',r.calculationStatus]]);
    if (incomplete) notice('REGISTRO INCOMPLETO. Faltam elementos do enquadramento salvo. Os campos ausentes permanecem não registrados; nenhuma categoria, cálculo ou aprovação foi completado pelo exportador.');
    notice('Classe do fluido, categoria NR-13 e classificações de risco corporativo são conceitos distintos. A ausência de categoria não equivale a aprovação ou isenção geral de deveres.');
    if (r.criteria && r.criteria.length) table(['Critério / item registrado','Fundamento / resultado salvo'],r.criteria.map(row => [row[0],typeof row[1] === 'boolean' ? row[1] ? 'Sim - critério registrado como atendido' : 'Não - critério registrado como não atendido' : row[1]])); else paragraph('Critérios de enquadramento não registrados nesta avaliação.');
    section('04 - Conversões e produto P x V registrados');
    paragraph('Somente valores presentes no resultado salvo são apresentados. As expressões documentam o método do motor; o exportador não reexecuta a decisão de enquadramento.',{color:COLORS.muted});
    if (numericResults.every(key => r[key] === null || r[key] === undefined)) notice('Não há conversões ou produto P x V calculados neste registro. O caminho do motor pode ter sido interrompido por exclusão ou pendência; nenhum valor foi inventado.');
    if (r.pressureKPa !== undefined && r.pressureKPa !== null) {
      const expression = d.nrPressureUnit === 'bar' ? 'P [kPa] = P [bar] x 100' : d.nrPressureUnit === 'MPa' ? 'P [kPa] = P [MPa] x 1000' : 'P [kPa] = P declarado [kPa]';
      formula('Pressão máxima de operação - módulo manométrico',expression,inputNumber(d.nrPressure) + ' ' + value(d.nrPressureUnit) + '; regime: ' + inputValue('nrRegime',d.nrRegime),result('pressureKPa','kPa'));
    }
    if (r.volumeM3 !== undefined && r.volumeM3 !== null) formula('Volume interno / capacidade nominal',d.nrVolumeUnit === 'L' ? 'V [m³] = V [L] / 1000' : 'V [m³] = volume declarado [m³]',inputNumber(d.nrVolume) + ' ' + inputValue('nrVolumeUnit',d.nrVolumeUnit),result('volumeM3','m³'));
    if (r.diameterMM !== undefined && r.diameterMM !== null) formula('Diâmetro declarado',d.nrDiameterUnit === 'm' ? 'D [mm] = D [m] x 1000' : 'D [mm] = diâmetro declarado [mm]',inputNumber(d.nrDiameter) + ' ' + value(d.nrDiameterUnit),result('diameterMM','mm'));
    if (r.pvKPaM3 !== undefined && r.pvKPaM3 !== null) formula('Produto P x V em kPa.m³','P x V [kPa.m³] = P [kPa] x V [m³]','P x V = ' + result('pressureKPa','kPa') + ' x ' + result('volumeM3','m³'),result('pvKPaM3','kPa.m³'));
    if (r.pvMPaM3 !== undefined && r.pvMPaM3 !== null) formula('Produto P x V em MPa.m³','P x V [MPa.m³] = P x V [kPa.m³] / 1000','P x V = ' + result('pvKPaM3','kPa.m³') + ' / 1000',result('pvMPaM3','MPa.m³'));
    notice('O PDF não arredonda resultados para decidir limiares nem atribui igualdade a faixas normativas. Critérios de fronteira, exclusões e categoria são os preservados pelo motor e requerem revisão técnica.');
    section('05 - Premissas, requisitos e limites gerais');
    paragraph('Premissas e dados a confirmar',{bold:true,color:COLORS.ink,keepWithNext:true});
    if (r.premises && r.premises.length) r.premises.forEach((item,i)=>paragraph((i+1) + '. ' + item)); else paragraph('Premissas não registradas nesta avaliação.');
    paragraph('Requisitos registrados',{bold:true,color:COLORS.ink,keepWithNext:true});
    if (r.requirements && r.requirements.length) r.requirements.forEach((item,i)=>paragraph((i+1) + '. ' + item)); else paragraph('Requisitos específicos não registrados neste caminho.');
    if (r.intervals) {
      paragraph('Limites gerais de referência - não constituem data de próxima inspeção',{bold:true,color:COLORS.ink,keepWithNext:true});
      const interval = (group,key) => r.intervals[group] && r.intervals[group][key] !== null && r.intervals[group][key] !== undefined ? unit(r.intervals[group][key],'anos') : 'Não indicado no registro - verificar condições aplicáveis';
      table(['Condição registrada','Limite geral salvo'],[['Sem SPIE - externa',interval('withoutSPIE','external')],['Sem SPIE - interna',interval('withoutSPIE','internal')],['Com SPIE - externa',interval('withSPIE','external')],['Com SPIE - interna',interval('withSPIE','internal')],['Base / ressalva',r.intervals.basis]]);
    } else paragraph('Limites gerais de inspeção não atribuídos nesta avaliação.');
    notice('Não foi fixado intervalo nem data de inspeção. SPIE, regimes especiais, condições de serviço e demais exigências dependem da documentação e da avaliação técnica do ativo.');
    section('06 - Fontes, pendências e recomendações');
    paragraph('Referências preservadas',{bold:true,color:COLORS.ink,keepWithNext:true});
    const sources = [...(snapshot.sources || []),...(r.references || [])], seen = new Set();
    for (const source of sources) { const key = JSON.stringify(source); if (seen.has(key)) continue; seen.add(key); paragraph(typeof source === 'string' ? source : source.title || 'Fonte sem título registrado'); if (source && typeof source === 'object' && source.url) paragraph(source.url,{size:8.3,color:COLORS.muted}); }
    if (!sources.length) paragraph('Fontes normativas não registradas nesta avaliação.');
    paragraph('Fonte documental do equipamento',{bold:true,color:COLORS.ink,keepWithNext:true}); paragraph(d.nrSource);
    paragraph('Fundamentação do fluido',{bold:true,color:COLORS.ink,keepWithNext:true}); paragraph(d.nrFluidSource);
    paragraph('Condicionantes e pendências preservados',{bold:true,color:COLORS.ink,keepWithNext:true});
    if (r.warnings && r.warnings.length) r.warnings.forEach((warning,i)=>paragraph((i+1) + '. ' + warning)); else notice('Condicionantes do motor não registrados. Completar a rastreabilidade e a revisão antes do uso decisório.');
    paragraph('Recomendações declaradas para análise do cliente',{bold:true,color:COLORS.ink,keepWithNext:true}); paragraph(snapshot.recommendations);
    notice(clean(snapshot.note) || 'Enquadramento indicativo; revisão técnica pendente, sem aprovação ou liberação operacional automática.');
    const signerGroups = [['plh','Profissional Legalmente Habilitado'],['company','Empresa Inspetora'],['inspector','Inspetor']];
    const fieldNames = {name:'Nome / razão social',specialty:'Especialidade',registration:'Registro profissional / certificação',cnpj:'CNPJ',qualification:'Qualificação / atividade'};
    const suppliedSigners = signerGroups.filter(([key])=>Object.values(signatures[key]).some(Boolean));
    if (suppliedSigners.length) {
      ensure(70); section('07 - Identificação e assinaturas declaradas');
    for (const [key,groupTitle] of suppliedSigners) {
      paragraph(groupTitle,{bold:true,color:COLORS.ink,keepWithNext:true});
      const fields = Object.entries(signatures[key]).filter(([name,raw])=>name !== 'signatureDataUrl' && raw).map(([name,raw])=>[fieldNames[name] || name,raw]);
      if (fields.length) table(['Identificação declarada','Informação'],fields);
      if (signatures[key].signatureDataUrl) { ensure(32); logo(signatures[key].signatureDataUrl,M,y,65,24); y += 30; }
    }
    notice('Os campos e imagens de assinatura são declarações fornecidas para o relatório. A exportação não autentica signatários, não aplica assinatura digital e não representa liberação operacional.');
    }
    const pageCount = doc.getNumberOfPages();
    for (let page=1;page<=pageCount;page++) { doc.setPage(page); doc.setDrawColor(...COLORS.line); doc.line(M,276,RIGHT,276); font('normal',7.1,COLORS.muted); doc.text('ENQUADRAMENTO INDICATIVO | Revisão técnica pendente',M,282); doc.text(page + ' / ' + pageCount,RIGHT,282,{align:'right'}); }
    const outputMetadata = {version:VERSION,reportNumber,revision,mode:'nr13',pageCount,index,engineVersion:snapshot.engineVersion || r.version,technicalSigned:false,digitallySigned:false,selectableText:true,photoAttached,incomplete};
    doc.piresNR13ReportMetadata = outputMetadata;
    return {doc,metadata:outputMetadata};
  }
  return {VERSION,validateSnapshot,createPdf};
});
