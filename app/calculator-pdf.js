(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PiresCalculatorPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const VERSION = 3;
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
  const labels = {
    origin: { measured: 'Medição registrada', nominal: 'Nominal - hipótese histórica' },
    minimum: { required: 'Requerida - cálculo documentado', alert: 'Alerta - critério documentado', reference: 'Referência ainda não validada' },
    mechanism: { uniform: 'Perda uniforme de espessura', localized: 'Dano localizado / outro mecanismo', unknown: 'Ainda não definido' },
    policy: { max: 'Maior taxa disponível', short: 'Histórico anterior > atual', long: 'Histórico inicial > atual' },
    status: { estimated: 'Estimativa linear', hypothesis: 'Estimativa com hipóteses', at_or_below_minimum: 'No limite ou abaixo da referência', inconsistent_history: 'Histórico requer conferência', mechanism_review: 'Mecanismo requer avaliação', no_positive_rate: 'Sem taxa positiva para projetar' }
  };
  const choiceLabel = (group, input) => labels[group][input] || value(input);
  function signaturesApi() {
    const api = root.PiresReportSignatures || (typeof require === 'function' ? require('./report-signatures.js') : null);
    if (!api || typeof api.draw !== 'function' || typeof api.normalize !== 'function') throw Error('O módulo local de identificação e assinaturas não está disponível.');
    return api;
  }
  function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.inputs || !snapshot.results) throw Error('Calcule a avaliação antes de exportar o relatório.');
    const mode = snapshot.results.mode;
    if (!['pmta', 'life'].includes(mode) || snapshot.type !== mode) throw Error('Este modelo de relatório aceita apenas PMTA parcial e vida remanescente.');
    if (mode === 'pmta' && (snapshot.inputs.constructionCode !== undefined || snapshot.results.constructionCode !== undefined)) {
      if (snapshot.inputs.constructionCode === undefined || snapshot.results.constructionCode === undefined) throw Error('A base normativa do resultado diverge das entradas. Calcule novamente antes de exportar.');
      const calc = root.IntegrityCalc || (typeof require === 'function' ? require('./calculations.js') : null);
      if (!calc) throw Error('O motor de conferência normativa não está disponível.');
      const code = calc.assertPmtaCode(snapshot.inputs.constructionCode);
      calc.assertPmtaCode(snapshot.results.constructionCode);
      if (JSON.stringify(code) !== JSON.stringify(snapshot.results.constructionCode)) throw Error('A base normativa do resultado diverge das entradas. Calcule novamente antes de exportar.');
    }
    const required = mode === 'pmta'
      ? ['pressure', 'operation', 'circumferential', 'longitudinal', 'shellRequired', 'headNet', 'headRequired', 'effectiveShell', 'effectiveHead', 'shellCircPressure', 'shellLongPressure', 'shellPressure', 'headPressure', 'componentPressure', 'pressureMargin', 'cylinderVolume', 'oneHeadVolume', 'volume']
      : ['current', 'previous', 'minimum', 'loss', 'lossPercent', 'margin', 'shortRate', 'adoptedRate'];
    if (required.some(key => typeof snapshot.results[key] !== 'number' || !Number.isFinite(snapshot.results[key]))) throw Error('O resultado salvo está incompleto ou contém valores inválidos. Calcule novamente.');
    if (!Array.isArray(snapshot.results.warnings)) throw Error('Os condicionantes do cálculo estão ausentes. Calcule novamente.');
    if (mode === 'pmta' && (snapshot.inputs.head !== 'elliptical' || snapshot.results.status !== 'partial' || ['shellMeets', 'headMeets'].some(key => typeof snapshot.results[key] !== 'boolean'))) throw Error('O resultado salvo não corresponde ao pré-cálculo parcial de casco e tampos elipsoidais 2:1. Calcule novamente.');
    if (mode === 'life') {
      const result = snapshot.results;
      if (!labels.status[result.status] || !result.interval || !Number.isFinite(result.interval.days) || !Number.isFinite(result.interval.years)) throw Error('O histórico da projeção está incompleto. Calcule novamente.');
      for (const key of ['longRate', 'remainingYears', 'remainingMonths', 'shortLife', 'longLife']) {
        if (result[key] !== null && (typeof result[key] !== 'number' || !Number.isFinite(result[key]))) throw Error('A projeção salva contém valores inválidos. Calcule novamente.');
      }
    }
    return snapshot;
  }
  function createPdf(input, metadata = {}, ctor) {
    const snapshot = validateSnapshot(input);
    if (typeof ctor !== 'function') throw Error('A biblioteca PDF local não está disponível.');
    const signatures = signaturesApi().normalize(metadata.signatures || {});
    const d = snapshot.inputs, r = snapshot.results, life = r.mode === 'life';
    const company = typeof metadata.company === 'object' && metadata.company !== null ? metadata.company.name : metadata.company;
    const reportNumber = clean(metadata.reportNumber) || `${life ? 'VR' : 'PMTA'}-${clean(d.tag) || 'SEM-TAG'}`;
    const revision = value(metadata.revision === undefined || metadata.revision === '' ? '00' : metadata.revision);
    const title = life ? 'RELATÓRIO DE VIDA REMANESCENTE' : 'RELATÓRIO DE PMTA PARCIAL';
    const subtitle = life ? 'Medição de espessura - avaliação de uma posição' : 'Casco cilíndrico e dois tampos elipsoidais 2:1 iguais';
    const doc = new ctor({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
    doc.setProperties({ title: `${title} / ${reportNumber}`, author: clean(metadata.providerName), subject: `${title} / TAG ${value(d.tag)} / avaliação indicativa`, creator: 'Relatório técnico', keywords: 'memorial, avaliação indicativa, PMTA parcial, vida remanescente' });
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
    newPage(); equipmentPhoto();
    paragraph(subtitle, { size: 10, lineHeight: 5, color: COLORS.muted });
    if (metadata.fictitious === true) notice('DEMONSTRAÇÃO FICTÍCIA. Dados e imagens não associados à avaliação de equipamento real.');
    section('01 - Identificação e rastreabilidade');
    table(['Registro', 'Informação declarada'], [['Empresa / cliente', company], ['Número do relatório', reportNumber], ['Revisão', revision], ['TAG', d.tag], ['Serviço', d.service], ['Material declarado', d.material], ...(life ? [['Ponto / componente', d.point]] : []), ['Data / instante da avaliação', snapshot.createdAt], ['Versão do aplicativo', snapshot.version], ['Versão do motor de cálculo', snapshot.engineVersion || r.version]]);
    paragraph('Observações do relatório', { bold: true, color: COLORS.ink }); paragraph(metadata.notes);
    notice('A identificação da empresa/cliente é informada para este documento. Nenhum contrato, inspeção física, LVT, prontuário ou registro de gestão é criado pela exportação da calculadora.');

    if (!life) {
      section('02 - Condições e premissas de PMTA');
      const code = r.constructionCode;
      table(['Base do motor parcial', 'Rastreabilidade'], [['Código', 'ASME BPVC Section VIII, Division 1'], ['Edição', code ? code.edition : 'Registro legado: conferir edição na fonte salva; sem migração automática'], ['Fonte declarada', code ? code.source : d.pmtaSource], ['Equações', 'UG-27(c)(1)/(2) e UG-32(c); casco cilíndrico e tampo elipsoidal 2:1']]);
      table(['Parâmetro', 'Entrada declarada'], [['Pressão de projeto', `${inputNumber(d.designPressure)} bar manométrico`], ['Pressão de operação', `${inputNumber(d.operationPressure)} bar manométrico`], ['Temperatura de projeto', `${inputNumber(d.temperature)} °C`], ['Diâmetro interno D', `${inputNumber(d.diameter)} mm`], ['Comprimento cilíndrico L', `${inputNumber(d.length)} mm`], ['Espessura nominal do casco', `${inputNumber(d.shell)} mm`], ['Espessura nominal dos tampos', `${inputNumber(d.headThickness)} mm`], ['Sobreespessura de corrosão CA', `${inputNumber(d.corrosionAllowance)} mm`], ['Eficiência de junta E', d.efficiency], ['Tensão admissível S', `${inputNumber(d.stress)} MPa`], ['Geometria avaliada', 'Casco cilíndrico + dois tampos elipsoidais 2:1 iguais']]);
      paragraph('Fonte de S, E e premissas geométricas', { bold: true, color: COLORS.ink }); paragraph(d.pmtaSource);
      notice('As pressões de componente usam espessuras nominais menos CA. O cálculo não utiliza espessuras medidas em serviço, nem verifica automaticamente tolerâncias ou redução por conformação.');

      section('03 - Resultados parciais de pressão');
      table(['Resultado', 'Valor preservado da avaliação'], [['Menor pressão entre casco e tampo', unit(r.componentPressure, 'bar')], ['Casco - menor entre as duas equações', unit(r.shellPressure, 'bar')], ['Casco - direção circunferencial', unit(r.shellCircPressure, 'bar')], ['Casco - direção longitudinal', unit(r.shellLongPressure, 'bar')], ['Tampo elipsoidal 2:1', unit(r.headPressure, 'bar')], ['Pressão de projeto convertida', unit(r.pressure, 'MPa')], ['Pressão de operação convertida', unit(r.operation, 'MPa')], ['Menor pressão - pressão de projeto', unit(r.pressureMargin, 'bar')], ['Espessura requerida do casco, com CA', unit(r.shellRequired, 'mm')], ['Conferência aritmética do casco', r.shellMeets ? 'Atende à espessura calculada' : 'Não atende à espessura calculada'], ['Espessura requerida do tampo, com CA', unit(r.headRequired, 'mm')], ['Conferência aritmética do tampo', r.headMeets ? 'Atende à espessura calculada' : 'Não atende à espessura calculada'], ['Volume geométrico', unit(r.volume, 'm³')], ['PMTA completa do vaso', 'Pendente de avaliação dos demais componentes e carregamentos']]);
      notice('A menor pressão calculada é um resultado parcial. Não foi definida uma pressão operacional adotada, uma pressão de teste ou a PMTA completa do vaso.');
      if (!r.shellMeets || !r.headMeets || r.pressureMargin < 0) notice('RESULTADO ARITMÉTICO INSUFICIENTE PARA AS PREMISSAS INFORMADAS. Há componente abaixo da espessura requerida ou menor pressão parcial inferior à pressão de projeto. Este registro não constitui aprovação ou liberação de operação.');

      section('04 - Memorial das conversões e do casco');
      const P = number(r.pressure), D = inputNumber(d.diameter), S = inputNumber(d.stress), E = inputNumber(d.efficiency), CA = inputNumber(d.corrosionAllowance), t = number(r.effectiveShell);
      const diameterInput = declaredNumber(d.diameter), stressInput = declaredNumber(d.stress), efficiencyInput = declaredNumber(d.efficiency);
      paragraph('As equações abaixo documentam as operações já executadas. Os resultados são preservados da avaliação salva; raio, S x E e raio da coroa são apenas intermediários aritméticos reproduzidos das entradas declaradas.', { size: 8.5, color: COLORS.muted });
      formula('Conversão da pressão de projeto', 'P_projeto [MPa] = P_projeto [bar] / 10', `P_projeto = ${inputNumber(d.designPressure)} bar / 10`, unit(r.pressure, 'MPa'));
      formula('Conversão da pressão de operação', 'P_operacao [MPa] = P_operacao [bar] / 10', `P_operacao = ${inputNumber(d.operationPressure)} bar / 10`, unit(r.operation, 'MPa'));
      formula('Raio interno declarado', 'R [mm] = D [mm] / 2', `R = ${D} mm / 2`, unit(diameterInput === null ? null : diameterInput / 2, 'mm'));
      formula('Produto da tensão admissível e eficiência', 'SE [MPa] = S [MPa] x E [adimensional]', `SE = ${S} MPa x ${E}`, unit(stressInput === null || efficiencyInput === null ? null : stressInput * efficiencyInput, 'MPa'));
      const seTrace = stressInput === null || efficiencyInput === null ? null : stressInput * efficiencyInput;
      const radiusTrace = diameterInput === null ? null : diameterInput / 2;
      paragraph('Limites do motor parcial - rastreio das verificações já executadas', { bold: true, color: COLORS.ink, keepWithNext: true });
      table(['Limite aritmético do motor', 'Substituição / quociente reproduzido'], [
        ['P / (S x E) <= 0,385', `${P} MPa / (${S} MPa x ${E}) = ${number(seTrace ? r.pressure / seTrace : null)}`],
        ['t_ef_casco / R <= 0,5', `${number(r.effectiveShell)} mm / (${D} mm / 2) = ${number(radiusTrace ? r.effectiveShell / radiusTrace : null)}`],
        ['t_ef_tampo / R <= 0,5', `${number(r.effectiveHead)} mm / (${D} mm / 2) = ${number(radiusTrace ? r.effectiveHead / radiusTrace : null)}`],
        ...(r.constructionCode ? [['t_ef_tampo / L_coroa >= 0,002; L_coroa = 0,90D', `${number(r.effectiveHead)} mm / (0,90 x ${D} mm) = ${number(diameterInput ? r.effectiveHead / (0.9 * diameterInput) : null)}`]] : [])
      ]);
      paragraph('Este bloco documenta o domínio restrito verificado pelo motor na avaliação salva. Os quocientes impressos não reavaliam limites nem constituem conformidade global do equipamento.', { size: 8.3, color: COLORS.muted });
      formula('Espessura líquida - direção circunferencial', 't_circ = P x R / (S x E - 0,6 x P)', `t_circ = ${P} x (${D} / 2) / (${S} x ${E} - 0,6 x ${P})`, unit(r.circumferential, 'mm'));
      formula('Espessura líquida - direção longitudinal', 't_long = P x R / (2 x S x E + 0,4 x P)', `t_long = ${P} x (${D} / 2) / (2 x ${S} x ${E} + 0,4 x ${P})`, unit(r.longitudinal, 'mm'));
      formula('Espessura requerida e espessura efetiva', 't_req = maior(t_circ, t_long) + CA; t_ef = t_nominal - CA', `t_req = maior(${number(r.circumferential)}, ${number(r.longitudinal)}) + ${CA}; t_ef = ${inputNumber(d.shell)} - ${CA}`, `Requerida: ${unit(r.shellRequired, 'mm')}; efetiva: ${unit(r.effectiveShell, 'mm')}`);
      formula('Pressão parcial - direção circunferencial', 'P_circ [bar] = 10 x S x E x t_ef / (R + 0,6 x t_ef)', `P_circ = 10 x ${S} x ${E} x ${t} / (${D} / 2 + 0,6 x ${t})`, unit(r.shellCircPressure, 'bar'));
      formula('Pressão parcial - direção longitudinal', 'P_long [bar] = 10 x 2 x S x E x t_ef / (R - 0,4 x t_ef)', `P_long = 10 x 2 x ${S} x ${E} x ${t} / (${D} / 2 - 0,4 x ${t})`, unit(r.shellLongPressure, 'bar'));
      formula('Resultado do casco', 'P_casco = menor(P_circ, P_long)', `P_casco = menor(${number(r.shellCircPressure)}, ${number(r.shellLongPressure)})`, unit(r.shellPressure, 'bar'));
      formula('Comparação da espessura nominal do casco', 't_nominal_casco >= t_requerida_casco [mm]', `${inputNumber(d.shell)} mm >= ${number(r.shellRequired)} mm`, r.shellMeets ? 'Atende à espessura calculada - resultado parcial preservado' : 'Não atende à espessura calculada - resultado parcial preservado');

      section('05 - Memorial dos tampos e do volume');
      const th = number(r.effectiveHead);
      formula('Raio equivalente da coroa do tampo 2:1', 'L_coroa [mm] = 0,90 x D [mm]', `L_coroa = 0,90 x ${D} mm`, `${unit(diameterInput === null ? null : 0.9 * diameterInput, 'mm')}; intermediário geométrico, sem nova validação de domínio`);
      formula('Espessura líquida do tampo elipsoidal 2:1', 't = P x D / (2 x S x E - 0,2 x P)', `t = ${P} x ${D} / (2 x ${S} x ${E} - 0,2 x ${P})`, unit(r.headNet, 'mm'));
      formula('Espessuras requerida e efetiva do tampo', 't_req = t + CA; t_ef = t_nominal - CA', `t_req = ${number(r.headNet)} + ${CA}; t_ef = ${inputNumber(d.headThickness)} - ${CA}`, `Requerida: ${unit(r.headRequired, 'mm')}; efetiva: ${unit(r.effectiveHead, 'mm')}`);
      formula('Pressão parcial dos dois tampos iguais', 'P_tampo [bar] = 10 x 2 x S x E x t_ef / (D + 0,2 x t_ef)', `P_tampo = 10 x 2 x ${S} x ${E} x ${th} / (${D} + 0,2 x ${th})`, unit(r.headPressure, 'bar'));
      formula('Comparação da espessura nominal dos tampos', 't_nominal_tampo >= t_requerida_tampo [mm]', `${inputNumber(d.headThickness)} mm >= ${number(r.headRequired)} mm`, r.headMeets ? 'Atende à espessura calculada - resultado parcial preservado' : 'Não atende à espessura calculada - resultado parcial preservado');
      formula('Menor pressão dos componentes avaliados', 'P_parcial = menor(P_casco, P_tampo)', `P_parcial = menor(${number(r.shellPressure)}, ${number(r.headPressure)})`, unit(r.componentPressure, 'bar'));
      formula('Margem contra a pressão de projeto', 'Margem [bar] = P_parcial [bar] - 10 x P_projeto [MPa]', `Margem = ${number(r.componentPressure)} bar - 10 x ${P} MPa`, unit(r.pressureMargin, 'bar'));
      formula('Volume do trecho cilíndrico', 'V_cilindro [m³] = pi x (D [mm]/1000)² x (L [mm]/1000) / 4', `V_cilindro = pi x (${D}/1000)² x (${inputNumber(d.length)}/1000) / 4`, unit(r.cylinderVolume, 'm³'));
      formula('Volume de um tampo elipsoidal 2:1', 'V_tampo [m³] = pi x (D [mm]/1000)³ / 24', `V_tampo = pi x (${D}/1000)³ / 24`, unit(r.oneHeadVolume, 'm³'));
      formula('Volume geométrico total', 'V_total [m³] = V_cilindro [m³] + 2 x V_tampo [m³]', `V_total = ${number(r.cylinderVolume)} + 2 x ${number(r.oneHeadVolume)}`, unit(r.volume, 'm³'));
    } else {
      section('02 - Medições, histórico e premissas');
      notice('Este memorial estima perda uniforme de espessura pelo histórico informado. A projeção linear não avalia fadiga, mecânica da fratura ou a vida em ciclos exigida pela ASME VIII, Divisão 3. A referência mínima precisa ter sua própria base documentada.');
      table(['Parâmetro', 'Entrada declarada'], [['Ponto / componente', d.point], ['Espessura atual', unit(r.current, 'mm')], ['Data da medição atual', date(d.currentDate)], ['Espessura anterior', unit(r.previous, 'mm')], ['Data anterior / início da hipótese', date(d.previousDate)], ['Origem da espessura anterior', choiceLabel('origin', d.previousOrigin)], ['Espessura mínima', unit(r.minimum, 'mm')], ['Natureza da espessura mínima', choiceLabel('minimum', d.minimumKind)], ['Mecanismo considerado', choiceLabel('mechanism', d.mechanism)], ['Correspondência e serviço comparável', d.comparable === true ? 'Confirmados pelo avaliador' : 'Não confirmados'], ['Critério da taxa', choiceLabel('policy', r.policy)], ['Histórico inicial de longo prazo', r.longInterval ? 'Incluído nesta avaliação' : 'Não utilizado'], ...(r.longInterval ? [['Espessura inicial', `${inputNumber(d.initial)} mm`], ['Data inicial', date(d.initialDate)], ['Origem da espessura inicial', choiceLabel('origin', d.initialOrigin)]] : [])]);
      paragraph('Fonte da espessura mínima', { bold: true, color: COLORS.ink }); paragraph(d.minimumSource);
      paragraph('Rastreabilidade das medições', { bold: true, color: COLORS.ink }); paragraph(d.measurementSource);
      paragraph('Condições e hipóteses declaradas', { bold: true, color: COLORS.ink }); paragraph(d.assumptions);
      paragraph('Justificativa para seleção da taxa', { bold: true, color: COLORS.ink, keepWithNext: true }); paragraph(r.justification || (r.policy === 'max' ? 'Maior taxa disponível para esta estimativa preliminar.' : ''));

      section('03 - Resultados e interpretação da projeção');
      const lifeTitle = r.minimumKind === 'required' ? 'Vida remanescente estimada' : r.minimumKind === 'alert' ? 'Prazo até a espessura de alerta' : 'Prazo até a referência - hipótese';
      table(['Resultado', 'Valor preservado da avaliação'], [['Condição da projeção', choiceLabel('status', r.status)], [lifeTitle, unit(r.remainingYears, 'anos')], ['Prazo em meses equivalentes', unit(r.remainingMonths, 'meses')], ['Taxa anterior > atual', unit(r.shortRate, 'mm/ano')], ['Taxa inicial > atual', unit(r.longRate, 'mm/ano')], ['Taxa adotada', unit(r.adoptedRate, 'mm/ano')], ['Base da taxa adotada', r.adoptedBasis === 'long' ? 'Histórico inicial > atual' : 'Histórico anterior > atual'], ['Margem de espessura', unit(r.margin, 'mm')], ['Perda no histórico anterior', unit(r.loss, 'mm')], ['Perda relativa', unit(r.lossPercent, '%')], ['Prazo pela taxa curta', unit(r.shortLife, 'anos')], ['Prazo pela taxa longa', unit(r.longLife, 'anos')], ['Hipótese histórica / referência', r.hypothesis ? 'Sim - consultar os condicionantes' : 'Não indicada pelo motor']]);
      notice(r.model);
      if (r.remainingYears === null) notice('PROJEÇÃO INDETERMINADA. Os valores aritméticos de taxa e margem permanecem registrados; não representam um prazo válido para esta condição.');
      else if (r.remainingYears === 0) notice('Sem margem de projeção: espessura atual no limite ou abaixo da referência informada. Encaminhar para avaliação técnica.');

      section('04 - Memorial de corrosão e vida remanescente');
      formula('Intervalo do histórico anterior', 'Delta_t [anos] = dias corridos / 365', `Delta_t = ${number(r.interval.days, 0)} / 365; ${date(d.previousDate)} > ${date(d.currentDate)}`, unit(r.interval.years, 'anos'));
      formula('Perda e taxa de curto prazo', 'Perda = e_anterior - e_atual; TC_curta = perda / Delta_t', `Perda = ${number(r.previous)} - ${number(r.current)}; TC_curta = ${number(r.loss)} / ${number(r.interval.years)}`, `Perda: ${unit(r.loss, 'mm')}; taxa curta: ${unit(r.shortRate, 'mm/ano')}`);
      formula('Perda relativa no histórico anterior', 'Perda_relativa [%] = (e_anterior - e_atual) / e_anterior x 100', `Perda_relativa = (${number(r.previous)} - ${number(r.current)}) / ${number(r.previous)} x 100`, unit(r.lossPercent, '%'));
      if (r.longInterval) {
        formula('Intervalo e taxa de longo prazo', 'Delta_t_long = dias corridos / 365; TC_longa = (e_inicial - e_atual) / Delta_t_long', `Delta_t_long = ${number(r.longInterval.days, 0)} / 365; TC_longa = (${inputNumber(d.initial)} - ${number(r.current)}) / ${number(r.longInterval.years)}`, `Intervalo: ${unit(r.longInterval.years, 'anos')}; taxa longa: ${unit(r.longRate, 'mm/ano')}`);
      }
      formula('Critério da taxa adotada', r.policy === 'max' ? 'TC_adotada = maior taxa disponível' : r.policy === 'short' ? 'TC_adotada = TC_curta, com justificativa' : 'TC_adotada = TC_longa, com justificativa', choiceLabel('policy', r.policy), unit(r.adoptedRate, 'mm/ano'));
      formula('Margem de espessura', 'Margem = e_atual - e_minima', `Margem = ${number(r.current)} - ${number(r.minimum)}`, unit(r.margin, 'mm'));
      formula('Prazo pela taxa de curto prazo', 'Prazo_curto [anos] = maior(0, margem) / TC_curta, quando a projeção é aplicável', r.shortLife === null ? 'Não aplicada: prazo indeterminado no cálculo salvo; consultar os condicionantes.' : `Prazo_curto = maior(0, ${number(r.margin)}) / ${number(r.shortRate)}`, unit(r.shortLife, 'anos'));
      formula('Prazo pela taxa de longo prazo', 'Prazo_longo [anos] = maior(0, margem) / TC_longa, quando a projeção é aplicável', r.longLife === null ? 'Não aplicada: prazo indeterminado no cálculo salvo; consultar os condicionantes.' : `Prazo_longo = maior(0, ${number(r.margin)}) / ${number(r.longRate)}`, unit(r.longLife, 'anos'));
      formula('Prazo desde a medição atual', 'Prazo [anos] = margem / taxa positiva adotada; meses = anos x 12', r.remainingYears === null ? 'Não aplicada: projeção suspensa pelos condicionantes do motor.' : r.remainingYears === 0 ? 'Não há margem positiva; resultado limitado a zero pelo motor.' : `Prazo = ${number(r.margin)} / ${number(r.adoptedRate)}; meses = ${number(r.remainingYears)} x 12`, `Anos: ${unit(r.remainingYears, 'anos')}; meses: ${unit(r.remainingMonths, 'meses')}`);

      section('05 - Projeção de espessura');
      const eligible = ['estimated', 'hypothesis'].includes(r.status) && r.remainingYears > 0 && d.mechanism === 'uniform';
      if (!eligible) {
        notice(`Gráfico de projeção indisponível para esta condição: ${choiceLabel('status', r.status)}.`);
        paragraph('O documento mantém os resultados e a interpretação calculados. Não desenha uma tendência que o motor suspendeu.');
      } else {
        ensure(150);
        paragraph(`Prazo ${r.minimumKind === 'alert' ? 'até a espessura de alerta' : r.minimumKind === 'reference' ? 'até a referência informada, como hipótese' : 'até a espessura requerida'}: ${unit(r.remainingYears, 'anos')}, contado desde ${date(d.currentDate)}.`, { after: 10 });
        const top = y + 8, bottom = y + 110, left = M + 21, right = RIGHT - 9;
        const span = r.current - r.minimum, minY = r.minimum - span * 0.15, maxY = r.current + span * 0.15;
        const chartY = thickness => bottom - (thickness - minY) / (maxY - minY) * (bottom - top);
        const yc = chartY(r.current), ym = chartY(r.minimum);
        doc.setDrawColor(...COLORS.line); doc.line(left, top, left, bottom); doc.line(left, bottom, right, bottom);
        doc.setDrawColor(167, 66, 54); doc.setLineDashPattern([2, 2], 0); doc.line(left, ym, right, ym);
        doc.setDrawColor(...COLORS.ink); doc.setLineWidth(0.8); doc.setLineDashPattern([4, 2], 0); doc.line(left, yc, right, ym);
        doc.setLineDashPattern([], 0); doc.setLineWidth(0.2); doc.setFillColor(...COLORS.ink); doc.circle(left, yc, 1.5, 'F'); doc.setFillColor(167, 66, 54); doc.circle(right, ym, 1.5, 'F');
        font('normal', 9, COLORS.ink); doc.text(number(r.current, 3), left - 4, yc + 1.2, { align: 'right' }); doc.text(number(r.minimum, 3), left - 4, ym + 1.2, { align: 'right' });
        doc.text('mm', M + 5, top - 4);
        [0, 0.5, 1].forEach(fraction => doc.text(number(r.remainingYears * fraction, 3), left + fraction * (right - left), bottom + 7, { align: fraction === 1 ? 'right' : 'center' }));
        doc.text('Anos desde a medição atual', (left + right) / 2, bottom + 16, { align: 'center' });
        y = bottom + 29;
        paragraph('Linha azul: projeção linear. Linha vermelha: espessura mínima informada. Condições de serviço e taxa adotada mantidas constantes.', { color: COLORS.muted });
        notice('A projeção representa uma posição de medição. Não determina a condição global do ativo nem fixa intervalo de inspeção.');
      }
    }

    section('06 - Fontes, condicionantes e recomendações');
    paragraph('Referências do método e da avaliação', { bold: true, color: COLORS.ink });
    for (const source of snapshot.sources || []) {
      paragraph(typeof source === 'string' ? source : source.title);
      if (source && typeof source === 'object' && source.url) paragraph(source.url, { size: 8.3, color: COLORS.muted });
    }
    if (!(snapshot.sources || []).length) paragraph('Referência do método não registrada nesta avaliação.');
    paragraph('Condicionantes calculados', { bold: true, color: COLORS.ink });
    r.warnings.forEach((warning, i) => paragraph(`${i + 1}. ${warning}`));
    paragraph('Recomendações técnicas para análise do cliente', { bold: true, color: COLORS.ink }); paragraph(snapshot.recommendations);
    paragraph(snapshot.note, { size: 8.3, lineHeight: 4.1, color: COLORS.alert, after: 1 });

    const signerGroups = [['plh', 'Profissional Legalmente Habilitado'], ['company', 'Empresa Inspetora'], ['inspector', 'Inspetor']];
    const fieldNames = { name: 'Nome / razão social', specialty: 'Especialidade', registration: 'Registro profissional / certificação', cnpj: 'CNPJ', qualification: 'Qualificação / atividade' };
    const suppliedSigners = signerGroups.filter(([key]) => Object.values(signatures[key]).some(Boolean));
    if (suppliedSigners.length) {
      ensure(70); section('07 - Identificação e assinaturas declaradas');
    for (const [key, groupTitle] of suppliedSigners) {
      paragraph(groupTitle, { bold: true, color: COLORS.ink, keepWithNext: true });
      const signerRows = Object.entries(signatures[key]).filter(([name, raw]) => name !== 'signatureDataUrl' && raw).map(([name, raw]) => [fieldNames[name] || name, raw]);
      if (signerRows.length) table(['Identificação declarada', 'Informação'], signerRows);
      if (signatures[key].signatureDataUrl) { ensure(32); logo(signatures[key].signatureDataUrl, M, y, 65, 24); y += 30; }
    }
    notice('Os campos e imagens de assinatura são declarações fornecidas para o relatório. A exportação não autentica signatários, não aplica assinatura digital e não representa liberação operacional.');
    }
    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page++) {
      doc.setPage(page); doc.setDrawColor(...COLORS.line); doc.line(M, 276, RIGHT, 276);
      font('normal', 7.1, COLORS.muted); doc.text('AVALIAÇÃO INDICATIVA | Revisão técnica pendente', M, 282); doc.text(`${page} / ${pageCount}`, RIGHT, 282, { align: 'right' });
    }
    const outputMetadata = { version: VERSION, reportNumber, revision, mode: r.mode, pageCount, index, engineVersion: snapshot.engineVersion || r.version, technicalSigned: false, digitallySigned: false, selectableText: true, photoAttached, projected: life ? ['estimated', 'hypothesis'].includes(r.status) && r.remainingYears > 0 && d.mechanism === 'uniform' : false };
    doc.piresCalculatorReportMetadata = outputMetadata;
    return { doc, metadata: outputMetadata };
  }
  return { VERSION, validateSnapshot, createPdf };
});
