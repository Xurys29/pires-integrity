'use strict';
window.PiresCalculatorReportUI = (() => {
  const $ = id => document.getElementById(id);
  let calculation = null, logoDataUrl = '', logoTicket = 0, logoPending = false;
  let equipmentPhotoDataUrl = '', equipmentPhotoTicket = 0, equipmentPhotoPending = false, generating = false;
  const signatures = PiresReportSignatures.create($('calculatorReportSignatures'), { prefix: 'calculator-signatures', onChange: () => { $('calculatorPdfStatus').textContent = ''; } });
  const supported = item => item && (['pmta', 'life'].includes(item.results?.mode) || item.results?.mode === 'nr13' && item.type === 'pmta');
  const reportKind = mode => ({ pmta: 'PMTA', nr13: 'NR13', life: 'Vida-remanescente' })[mode];
  function syncDownload() { $('downloadPdf').disabled = !calculation || equipmentPhotoPending || generating; }
  function metadata() {
    if (logoPending) throw Error('Aguarde a leitura da logo para baixar o relatório.');
    if (equipmentPhotoPending) throw Error('Aguarde a preparação da foto do equipamento antes de exportar ou salvar.');
    return { pdfLayout: $('pmtaPdfLayout').value, company: $('pdfCompany').value.trim(), reportNumber: $('pdfNumber').value.trim(), revision: $('pdfRevision').value.trim(), notes: $('pdfNotes').value.trim(), logoDataUrl: logoDataUrl || '', equipmentPhotoDataUrl, equipmentPhotoCaption: $('pdfEquipmentPhotoCaption').value.trim().slice(0, 1000), signatures: signatures.getValue() };
  }
  function invalidate() { calculation = null; syncDownload(); $('calculatorPdfStatus').textContent = ''; }
  function setResult(item) {
    calculation = supported(item) ? item : null;
    $('calculatorReport').classList.toggle('hidden', !calculation);
    syncDownload();
    if (calculation) {
      const pmta = item.results.mode === 'pmta', nr13 = item.results.mode === 'nr13';
      $('calculatorPdfTitle').textContent = nr13 ? 'Relatório de enquadramento NR-13 em PDF' : pmta ? 'Relatório de PMTA parcial em PDF' : 'Relatório de vida remanescente em PDF';
      $('calculatorPdfScope').textContent = nr13
        ? 'Enquadramento indicativo, abrangência, classe do fluido, categoria quando aplicável, premissas e fontes informadas. O relatório não determina a PMTA nem libera o equipamento para operação.'
        : pmta
        ? 'Memorial de pressão dos componentes: condições de projeto, espessuras nominais, sobreespessura, tensão e eficiência de junta. Preserva as premissas desta calculadora; a PMTA completa do equipamento permanece pendente.'
        : 'Memorial de corrosão e projeção de espessura: histórico de medições, referência mínima, mecanismo de dano e taxa adotada. Preserva as premissas desta calculadora; o prazo estimado não define automaticamente a próxima inspeção.';
    }
    if (calculation && !$('pdfNumber').value.trim()) $('pdfNumber').value = `${item.results.mode === 'life' ? 'VR' : reportKind(item.results.mode)}-${item.inputs.tag || 'AVALIACAO'}-R00`.slice(0, 100);
    $('calculatorPdfStatus').textContent = '';
  }
  function clearLogo() { logoTicket++; logoPending = false; logoDataUrl = ''; $('pdfLogo').value = ''; $('pdfLogoPreview').hidden = true; $('pdfLogoPreview').removeAttribute('src'); $('pdfLogoRemove').hidden = true; $('pdfLogoStatus').textContent = ''; }
  function clearEquipmentPhoto() { equipmentPhotoTicket++; equipmentPhotoPending = false; equipmentPhotoDataUrl = ''; $('pdfEquipmentPhoto').value = ''; $('pdfEquipmentPhotoPreview').hidden = true; $('pdfEquipmentPhotoPreview').removeAttribute('src'); $('pdfEquipmentPhotoRemove').hidden = true; $('pdfEquipmentPhotoStatus').textContent = ''; $('pdfEquipmentPhotoCaption').value = ''; syncDownload(); }
  function clear() { $('pmtaPdfLayout').value = 'compact'; invalidate(); clearLogo(); clearEquipmentPhoto(); signatures.clear(); ['pdfCompany', 'pdfNumber', 'pdfNotes'].forEach(id => $(id).value = ''); $('pdfRevision').value = 'R00'; $('calculatorReport').classList.add('hidden'); }
  function restore(value) {
    clear(); if (!value || typeof value !== 'object') return;
    [['company', 'pdfCompany', 160], ['reportNumber', 'pdfNumber', 100], ['revision', 'pdfRevision', 30], ['notes', 'pdfNotes', 5000]].forEach(([key, id, max]) => { if (typeof value[key] === 'string') $(id).value = value[key].slice(0, max); });
    signatures.setValue(value.signatures); $('pmtaPdfLayout').value = value.pdfLayout === 'full' ? 'full' : 'compact';
    if (typeof value.equipmentPhotoCaption === 'string') $('pdfEquipmentPhotoCaption').value = value.equipmentPhotoCaption.slice(0, 1000);
    if (value.equipmentPhotoDataUrl) {
      if (typeof value.equipmentPhotoDataUrl === 'string' && value.equipmentPhotoDataUrl.length <= 7000000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value.equipmentPhotoDataUrl)) prepareEquipmentPhoto(value.equipmentPhotoDataUrl);
      else { $('pdfEquipmentPhotoStatus').textContent = 'Foto do arquivo inválida. Selecione PNG ou JPEG com até 5 MB.'; }
    }
    if (typeof value.logoDataUrl === 'string' && value.logoDataUrl.length <= 2800000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value.logoDataUrl)) {
      const ticket = ++logoTicket, img = new Image(); logoPending = true;
      img.onload = () => { if (ticket !== logoTicket) return; logoPending = false; logoDataUrl = value.logoDataUrl; $('pdfLogoPreview').src = logoDataUrl; $('pdfLogoPreview').hidden = false; $('pdfLogoRemove').hidden = false; };
      img.onerror = () => { if (ticket !== logoTicket) return; clearLogo(); $('pdfLogoStatus').textContent = 'Logo do arquivo inválida. Selecione uma imagem novamente.'; };
      img.src = value.logoDataUrl;
    }
  }
  $('pdfLogoRemove').onclick = clearLogo;
  $('pdfLogo').onchange = () => {
    const file = $('pdfLogo').files[0]; clearLogo(); if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) { $('pdfLogoStatus').textContent = 'Selecione PNG ou JPEG com até 2 MB.'; return; }
    const ticket = ++logoTicket, reader = new FileReader(); logoPending = true; $('pdfLogoStatus').textContent = 'Carregando logo…';
    const fail = () => { if (ticket !== logoTicket) return; clearLogo(); $('pdfLogoStatus').textContent = 'Não foi possível ler a imagem. Selecione PNG ou JPEG válido.'; };
    reader.onerror = fail;
    reader.onload = () => { if (ticket !== logoTicket) return; const img = new Image(); img.onerror = fail; img.onload = () => { if (ticket !== logoTicket) return; logoPending = false; logoDataUrl = String(reader.result); $('pdfLogoPreview').src = logoDataUrl; $('pdfLogoPreview').hidden = false; $('pdfLogoRemove').hidden = false; $('pdfLogoStatus').textContent = 'Logo adicionada ao relatório.'; }; img.src = String(reader.result); };
    reader.readAsDataURL(file);
  };
  function photoFailure(ticket) {
    if (ticket !== equipmentPhotoTicket) return;
    clearEquipmentPhoto();
    $('pdfEquipmentPhotoStatus').textContent = 'Não foi possível preparar a foto. Selecione uma imagem PNG ou JPEG válida com até 5 MB.';
  }
  function prepareEquipmentPhoto(dataUrl, ticket = ++equipmentPhotoTicket) {
    equipmentPhotoPending = true; syncDownload(); $('pdfEquipmentPhotoStatus').textContent = 'Preparando foto do equipamento…';
    const img = new Image();
    img.onerror = () => photoFailure(ticket);
    img.onload = () => {
      if (ticket !== equipmentPhotoTicket) return;
      try {
        if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) throw Error('Dimensões inválidas.');
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const context = canvas.getContext('2d'); if (!context) throw Error('Preparação de imagem indisponível.');
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, canvas.width, canvas.height);
        const prepared = canvas.toDataURL('image/jpeg', 0.85);
        if (!/^data:image\/jpeg;base64,/.test(prepared)) throw Error('Conversão da imagem indisponível.');
        equipmentPhotoDataUrl = prepared; equipmentPhotoPending = false;
        $('pdfEquipmentPhotoPreview').src = prepared; $('pdfEquipmentPhotoPreview').hidden = false; $('pdfEquipmentPhotoRemove').hidden = false;
        $('pdfEquipmentPhotoStatus').textContent = 'Foto preparada e adicionada ao relatório.'; syncDownload();
      } catch (_) { photoFailure(ticket); }
    };
    img.src = dataUrl;
  }
  $('pdfEquipmentPhotoRemove').onclick = clearEquipmentPhoto;
  $('pdfEquipmentPhoto').onchange = () => {
    const file = $('pdfEquipmentPhoto').files[0]; clearEquipmentPhoto(); $('calculatorPdfStatus').textContent = ''; if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) { $('pdfEquipmentPhotoStatus').textContent = 'Selecione PNG ou JPEG com até 5 MB.'; return; }
    const ticket = ++equipmentPhotoTicket, reader = new FileReader(); equipmentPhotoPending = true; syncDownload(); $('pdfEquipmentPhotoStatus').textContent = 'Lendo foto do equipamento…';
    reader.onerror = () => photoFailure(ticket);
    reader.onload = () => { if (ticket === equipmentPhotoTicket) prepareEquipmentPhoto(String(reader.result), ticket); };
    try { reader.readAsDataURL(file); } catch (_) { photoFailure(ticket); }
  };
  $('pdfEquipmentPhotoCaption').oninput = () => { $('calculatorPdfStatus').textContent = ''; };
  $('downloadPdf').onclick = async () => {
    if (!calculation) { $('calculatorPdfStatus').textContent = 'Calcule novamente antes de baixar o PDF.'; return; }
    if (generating) return;
    const requestedCalculation = calculation; generating = true; syncDownload(); $('calculatorPdfStatus').textContent = 'Gerando relatório PDF…';
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (calculation !== requestedCalculation) throw Error('A avaliação foi alterada. Calcule novamente antes de baixar o PDF.');
      const info = metadata(), generator = calculation.results.mode === 'nr13' ? window.PiresNR13Pdf : calculation.results.mode === 'pmta' && info.pdfLayout !== 'full' ? window.PiresCompactPDF : window.PiresCalculatorPdf;
      if (!generator || typeof generator.createPdf !== 'function' || typeof window.PiresPDF?.jsPDF !== 'function') throw Error('O módulo do relatório PDF não carregou. Recarregue a página e tente novamente.');
      const { doc } = generator.createPdf(calculation, info, PiresPDF.jsPDF);
      const filename = info.reportNumber || `${reportKind(calculation.results.mode)}-${calculation.inputs.tag || 'AVALIACAO'}-${info.revision || 'R00'}`;
      const segment = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100);
      const url = URL.createObjectURL(doc.output('blob')), link = document.createElement('a');
      link.href = url; link.download = `${segment}.pdf`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('calculatorPdfStatus').textContent = 'Download do PDF solicitado ao navegador.';
    } catch (error) { $('calculatorPdfStatus').textContent = error.message || 'Não foi possível gerar o PDF.'; }
    finally { generating = false; syncDownload(); }
  };
  return { setResult, invalidate, clear, restore, metadata };
})();
