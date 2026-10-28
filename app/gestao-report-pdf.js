(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresGestaoReportPDF = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const VERSION = "1.0.0-draft", SCHEMA = "pires-gestao-system-report-v1";
  const BLUE = [0, 67, 84], INK = [28, 42, 49], RED = [145, 37, 37];
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024, MAX_REPORT_IMAGE_BYTES = 64 * 1024 * 1024;
  const clean = value => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').trim();
  const present = (value, missing = "Não informado") => clean(value) || missing;
  function canonical(value, ancestors = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (!value || typeof value !== "object" || ancestors.has(value)) throw Error("Snapshot deve conter somente dados JSON sem ciclos.");
    const proto = Object.getPrototypeOf(value), array = Array.isArray(value);
    if (!array && proto !== Object.prototype && proto !== null) throw Error("Objeto não JSON no snapshot.");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) if (!("value" in descriptors[key])) throw Error("Snapshot não aceita getters ou setters.");
    ancestors.add(value);
    const result = array ? "[" + Array.from({ length: value.length }, (_, i) => descriptors[i]?.value === undefined ? "null" : canonical(descriptors[i].value, ancestors)).join(",") + "]"
      : "{" + Object.keys(descriptors).sort().filter(k => descriptors[k].value !== undefined).map(k => JSON.stringify(k) + ":" + canonical(descriptors[k].value, ancestors)).join(",") + "}";
    ancestors.delete(value); return result;
  }
  // Snapshot fingerprint only; this is neither a signature nor technical approval.
  function sha256(text) {
    const input = new TextEncoder().encode(text), data = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
    data.set(input); data[input.length] = 128;
    const view = new DataView(data.buffer), bits = input.length * 8;
    view.setUint32(data.length - 8, Math.floor(bits / 4294967296)); view.setUint32(data.length - 4, bits >>> 0);
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const w = new Uint32Array(64), r = (x, n) => x >>> n | x << 32 - n;
    for (let offset = 0; offset < data.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) { const x = w[i - 15], y = w[i - 2]; w[i] = (w[i - 16] + (r(x, 7) ^ r(x, 18) ^ x >>> 3) + w[i - 7] + (r(y, 17) ^ r(y, 19) ^ y >>> 10)) >>> 0; }
      let [a,b,c,d,e,f,g,z] = h;
      for (let i = 0; i < 64; i++) { const t1 = (z + (r(e,6)^r(e,11)^r(e,25)) + (e&f^~e&g) + k[i] + w[i]) >>> 0, t2 = ((r(a,2)^r(a,13)^r(a,22)) + (a&b^a&c^b&c)) >>> 0; z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0; }
      [a,b,c,d,e,f,g,z].forEach((v,i) => { h[i]=(h[i]+v)>>>0; });
    }
    return h.map(v => v.toString(16).padStart(8,"0")).join("");
  }
  function normalize(input) {
    const data = JSON.parse(canonical(input));
    return { ...data,
      assets: data.assets || (data.asset ? [data.asset] : []),
      inspections: data.inspections || (data.inspection ? [data.inspection] : []),
      lvts: data.lvts || (data.lvt ? [data.lvt] : []),
      lvtItems: data.lvtItems || data.items || [], photos: data.photos || [],
      findings: data.findings || [], rtis: data.rtis || [],
    };
  }
  const itemOf = record => record.lvtItemId || record.itemId || null;
  function validate(model) {
    if (!model || !model.system || !clean(model.system.id)) throw Error("Relatório exige sistema explícito.");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(model.generatedAt || "") || !Number.isFinite(Date.parse(model.generatedAt))) throw Error("Data de geração inválida.");
    for (const key of ["assets","inspections","lvts","lvtItems","photos","findings","rtis"]) {
      const rows = model[key];
      if (!Array.isArray(rows) || rows.length > 2000) throw Error("Coleção inválida ou excessiva: " + key);
      const ids = new Set();
      for (const row of rows) {
        if (!row || typeof row !== "object" || !clean(row.id) || ids.has(row.id)) throw Error("IDs canônicos ausentes ou repetidos em " + key);
        ids.add(row.id);
        if (row.systemId && row.systemId !== model.system.id) throw Error("Registro pertence a outro sistema.");
        if (model.campaign?.id && row.campaignId && row.campaignId !== model.campaign.id) throw Error("Registro pertence a outra campanha.");
        if (row.ownerId && model.company?.id && row.ownerId !== model.company.id) throw Error("Registro pertence a outro cliente.");
      }
    }
    if (model.campaign?.systemId && model.campaign.systemId !== model.system.id) throw Error("Campanha pertence a outro sistema.");
    const assets = new Map(model.assets.map(row => [row.id, row])), inspections = new Map(model.inspections.map(row => [row.id,row])),
      lvts = new Map(model.lvts.map(row => [row.id,row])), items = new Map(model.lvtItems.map(row => [row.id,row])), findings = new Map(model.findings.map(row => [row.id,row]));
    for (const row of model.assets) if (row.systemId !== model.system.id) throw Error("Ativo sem vínculo ao sistema explícito.");
    for (const row of model.inspections) if (!assets.has(row.assetId)) throw Error("Inspeção sem ativo canônico neste relatório.");
    for (const row of model.lvts) {
      if (!assets.has(row.assetId) || !inspections.has(row.inspectionId) || inspections.get(row.inspectionId).assetId !== row.assetId) throw Error("LVT/inspeção pertencem a ativos diferentes.");
    }
    for (const row of model.lvtItems) {
      const lvt = lvts.get(row.lvtId);
      if (!lvt || row.assetId !== lvt.assetId || row.inspectionId !== lvt.inspectionId) throw Error("Item não pertence à LVT/inspeção/TAG declaradas.");
    }
    for (const row of [...model.photos,...model.findings]) {
      const item = items.get(itemOf(row));
      if (!item || row.assetId && row.assetId !== item.assetId || row.lvtId && row.lvtId !== item.lvtId) throw Error("Foto/achado não pertence ao item canônico.");
    }
    for (const row of model.rtis) {
      const finding = row.findingId ? findings.get(row.findingId) : null, item = itemOf(row) ? items.get(itemOf(row)) : finding ? items.get(itemOf(finding)) : null;
      if (row.findingId && !finding || itemOf(row) && !item || item && row.assetId && row.assetId !== item.assetId || finding && item && itemOf(finding) !== item.id) throw Error("RTI/achado/item não correspondem à mesma origem.");
      if (row.assetId && !assets.has(row.assetId)) throw Error("RTI pertence a outra TAG.");
    }
    const text = canonical(model);
    if (text.length > 5 * 1024 * 1024) throw Error("Snapshot excessivamente grande.");
    return model;
  }
  function snapshot(input) {
    const model = validate(normalize(input)), encoded = canonical({ schema: SCHEMA, generatorVersion: VERSION, model });
    return { schema: SCHEMA, generatorVersion: VERSION, model, snapshotId: "sha256:" + sha256(encoded) };
  }
  function sourceText(source) {
    if (!source) return "Origem documental não informada";
    if (source.format === "field_record") return "Registro de campo | data: " + present(source.observedOn) + " | operador registrado: " + present(source.actorUserId);
    const locator = typeof source.locator === "string" ? source.locator : source.locator ? canonical(source.locator) : "localizador não informado";
    return [source.fileName || source.name || "Arquivo não informado", source.sourceId ? "Fonte " + source.sourceId : null, locator].filter(Boolean).join(" | ");
  }
  function revision(record) { return clean(record?.id) + " | versão " + (record?.version ?? "não informada"); }
  function currentness(record) {
    return record.currentness === "confirmed_current" && record.currentnessConfirmedAt && record.currentnessEvidence
      ? "Estado atual confirmado: " + present(record.status) + " | confirmação: " + clean(record.currentnessConfirmedAt) + " | " + clean(record.currentnessEvidence)
      : "Situação atual não confirmada. Status na fonte: " + present(record.sourceStatus, "não informado") + " | data da fonte: " + present(record.sourceDate, "não informada");
  }
  function filename(input) {
    const system = input?.model?.system || input?.system || {}, name = clean(system.name || system.id || "sistema").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g,"-").slice(0,80);
    return "Pires-Inspecao-" + (name || "sistema") + "-RASCUNHO.pdf";
  }
  function resolved(images, id) { return images instanceof Map ? images.get(id) : images?.[id]; }
  function createPdf(input, images = {}, options = {}, jsPDFctor) {
    if (typeof options === "function") { jsPDFctor = options; options = {}; }
    const record = snapshot(input), model = record.model;
    const Ctor = jsPDFctor || root.PiresPDF?.jsPDF || root.jspdf?.jsPDF || root.jsPDF;
    if (typeof Ctor !== "function") throw Error("Biblioteca PDF indisponível.");
    if (options.mode && options.mode !== "draft" || options.issue === true) throw Error("Emissão definitiva não está habilitada; gere um rascunho para revisão.");
    const doc = new Ctor({ unit: "mm", format: "a4", orientation: "portrait", compress: true, putOnlyUsedFonts: true });
    const W = 210, H = 297, M = 16, WIDTH = W - M * 2, TOP = 36, BOTTOM = 278;
    let y = TOP, context = "", imageBytes = 0, decodedPixels = 0;
    const pending = [], embeddedPhotoIds = [], photoPlacements = [];
    const note = value => { if (!pending.includes(value)) pending.push(value); };
    doc.setProperties({ title: "Rascunho de inspeção por sistema - " + present(model.system.name), author: "Pires Integridade",
      subject: "Rascunho sem emissão ou assinatura técnica | " + record.snapshotId, creator: "Pires / Gestão PDF " + VERSION,
      keywords: "rascunho, inspeção, LVT, " + SCHEMA + ", " + record.snapshotId });
    function font(size = 10, bold = false, color = INK) { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color); }
    function lines(value, width = WIDTH, size = 10) { font(size); return doc.splitTextToSize(clean(value) || "-", width); }
    function header() {
      doc.setFillColor(...BLUE); doc.rect(0,0,W,25,"F");
      font(15,true,[255,255,255]); doc.text("PIRES INTEGRIDADE",M,10);
      font(10,true,[255,255,255]); doc.text("INSPEÇÃO POR SISTEMA | RASCUNHO",M,18);
      doc.setDrawColor(220,174,58); doc.setLineWidth(1); doc.line(M,27,W-M,27);
      font(8,false,BLUE);
      const label = context || "Sistema: " + present(model.system.name);
      doc.text(lines(label,WIDTH,8).slice(0,2),M,31);
      y=TOP;
    }
    function page() { if (doc.getNumberOfPages() >= 1000) throw Error("Relatório excede o limite de páginas."); doc.addPage(); header(); }
    function room(height) { if (y+height > BOTTOM) page(); }
    function paragraph(value,{size=10,bold=false,color=INK,gap=2}={}) {
      const text = clean(value) || "-";
      if (text.length > 100000) throw Error("Texto individual excessivamente longo.");
      const lh=size*.3528*1.35;
      for (const line of lines(text,WIDTH,size)) { room(lh+1); font(size,bold,color); doc.text(line,M,y+lh*.8); y+=lh; }
      y+=gap;
    }
    function heading(value,level=1) { room(15); y+=3; font(level===1?14:11,true,BLUE); paragraph(value,{size:level===1?14:11,bold:true,color:BLUE,gap:3}); }
    function source(source) { paragraph(sourceText(source),{size:8,color:[76,86,91],gap:2}); }
    function renderPhoto(photo,item) {
      const image = resolved(images,photo.id), caption = present(photo.caption,"Legenda não informada"), identity="Foto " + photo.id + " | item " + present(item.itemKey,item.id) + " [" + item.id + "]";
      if (!image?.bytes) { note("Foto " + photo.id + ": bytes indisponíveis."); paragraph("Foto pendente/ausente na fonte ou indisponível: " + identity,{size:10,bold:true,color:RED}); paragraph(caption,{size:9}); source(photo.source); return; }
      if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength > MAX_IMAGE_BYTES || image.bytes.byteLength < 8 || !["image/png","image/jpeg"].includes(image.mime)) throw Error("Foto deve conter bytes JPEG/PNG válidos de até 8 MiB.");
      imageBytes+=image.bytes.byteLength; if(imageBytes>MAX_REPORT_IMAGE_BYTES) throw Error("Fotos excedem o limite de 64 MiB por rascunho.");
      let properties;
      try { properties=doc.getImageProperties(image.bytes); } catch { throw Error("Imagem inválida para a foto " + photo.id); }
      if (!properties.width || !properties.height || properties.width*properties.height>16777216 || properties.width>16000 || properties.height>16000 ||
        image.mime==="image/jpeg"&&properties.fileType!=="JPEG" || image.mime==="image/png"&&properties.fileType!=="PNG") throw Error("Tipo ou dimensões inválidas para a foto " + photo.id);
      decodedPixels+=properties.width*properties.height;
      if(decodedPixels>134217728)throw Error("Fotos excedem a capacidade visual por rascunho; selecione um escopo menor sem descartar imagens.");
      const scale=Math.min(WIDTH/properties.width,100/properties.height), iw=properties.width*scale,ih=properties.height*scale;
      room(ih+19); paragraph(identity,{size:9,bold:true,gap:2});
      const x=M+(WIDTH-iw)/2,py=y;
      doc.addImage(image.bytes,image.mime==="image/png"?"PNG":"JPEG",x,py,iw,ih,"photo-"+photo.id,"FAST");
      photoPlacements.push({photoId:photo.id,lvtItemId:item.id,page:doc.getNumberOfPages(),x,y:py,width:iw,height:ih});
      y+=ih+3; embeddedPhotoIds.push(photo.id);
      paragraph(caption,{size:9,gap:1}); source(photo.source);
    }
    header();
    paragraph("RASCUNHO PARA REVISÃO — SEM EMISSÃO OU ASSINATURA TÉCNICA",{size:11,bold:true,color:RED,gap:4});
    paragraph("Documento montado dos registros vinculados. Não confirma execução, estado atual ou aprovação técnica por simples geração.",{size:9});
    heading("Sistema e escopo");
    paragraph("Cliente: " + present(model.company?.name || model.company?.displayName));
    paragraph("Sistema: " + present(model.system.name) + " | " + revision(model.system));
    paragraph("Contrato/escopo: " + present(model.contract?.name) + " | " + present(model.contract?.id));
    paragraph("Campanha: " + present(model.campaign?.name) + " | " + present(model.campaign?.id) + " | status: " + present(model.campaign?.status));
    paragraph("Geração do rascunho: " + model.generatedAt,{size:9});
    paragraph("Quantitativos: " + model.assets.length + " TAG(s) / " + model.inspections.length + " inspeção(ões) / " + model.lvts.length + " LVT(s) / " + model.lvtItems.length + " item(ns) / " + model.photos.length + " foto(s) vinculada(s) / " + model.rtis.length + " RTI(s).",{bold:true});
    if(Number.isInteger(model.unresolvedOwnerRTICount)&&model.unresolvedOwnerRTICount>0) paragraph("RTIs do cliente com vínculo não resolvido: " + model.unresolvedOwnerRTICount + ". Não foram atribuídas automaticamente a este sistema ou aos seus itens.",{size:9});
    paragraph("Snapshot: " + record.snapshotId,{size:8});
    if (!model.assets.length) { note("Nenhum ativo no escopo."); paragraph("Nenhuma TAG disponível no escopo.",{color:RED}); }
    for (const asset of model.assets) {
      context="TAG " + present(asset.tag,asset.id) + " | sistema " + present(model.system.name);
      page(); heading("TAG " + present(asset.tag,asset.id));
      paragraph("Ativo: " + revision(asset),{size:9});
      paragraph("Operação registrada: " + present(asset.operation) + " | motivo: " + present(asset.operationReason || asset.operationEvidence),{size:9});
      const inspections=model.inspections.filter(i=>i.assetId===asset.id), lvts=model.lvts.filter(l=>l.assetId===asset.id);
      if(!inspections.length) { note("TAG " + asset.id + ": inspeção não disponível."); paragraph("Inspeção não disponível.",{color:RED}); }
      if(!lvts.length) { note("TAG " + asset.id + ": LVT não disponível."); paragraph("LVT não disponível.",{color:RED}); }
      for (const lvt of lvts) {
        const inspection=inspections.find(i=>i.id===lvt.inspectionId);
        heading("LVT " + present(lvt.reference,lvt.id),2);
        paragraph("LVT: " + revision(lvt) + " | inspeção: " + revision(inspection),{size:9});
        paragraph("Data original / inspeção: " + present(lvt.observedOn || lvt.sourceDate || inspection?.sourceDate) + " | execução registrada: " + present(inspection?.done,"não informada"),{size:9});
        if(lvt.inspector) paragraph("Responsável pela inspeção: " + clean(lvt.inspector) + " | procedimento: " + present(lvt.procedure),{size:9});
        source(lvt.source);
        const items=model.lvtItems.filter(i=>i.lvtId===lvt.id);
        if(!items.length) { note("LVT " + lvt.id + ": itens não disponíveis."); paragraph("Itens da LVT pendentes de vinculação.",{color:RED}); }
        for(const item of items) {
          context="TAG " + present(asset.tag,asset.id) + " | item " + present(item.itemKey,item.id) + " [" + item.id + "]" + (clean(item.component)?" | "+clean(item.component):"");
          room(65);
          heading("Item " + present(item.itemKey,item.id) + (clean(item.component)?" | "+clean(item.component):""),2);
          paragraph("ID do item: " + revision(item),{size:8});
          paragraph(present(item.description,"Descrição não informada"));
          if(item.observations) paragraph("Observações: " + clean(item.observations));
          if(item.result || item.sourceStatus) paragraph("Registro na fonte: " + present(item.result || item.sourceStatus),{size:9});
          source(item.source);
          const photos=model.photos.filter(p=>itemOf(p)===item.id), findings=model.findings.filter(f=>itemOf(f)===item.id), findingIds=new Set(findings.map(f=>f.id)),
            rtis=model.rtis.filter(r=>itemOf(r)===item.id || r.findingId&&findingIds.has(r.findingId));
          if(!photos.length) { note("Item " + item.id + ": foto ausente."); paragraph("Foto pendente/ausente na fonte para este item.",{size:10,bold:true,color:RED}); }
          for(const photo of photos) renderPhoto(photo,item);
          for(const finding of findings) {
            room(24);
            paragraph("Achado " + revision(finding) + ": " + present(finding.description),{bold:true});
            if(clean(finding.recommendation)) paragraph("Recomendação: " + clean(finding.recommendation));
            paragraph(currentness(finding),{size:9}); source(finding.source);
          }
          if(!findings.length) paragraph("Sem achado ou recomendação registrados neste item.",{size:9});
          for(const rti of rtis) {
            room(42);
            paragraph("RTI — ID interno: " + revision(rti),{bold:true,color:BLUE});
            paragraph("Número histórico emitido: " + present(rti.issuedNumber,"não informado; ID interno não é número histórico"),{size:9});
            paragraph(present(rti.title || rti.recommendation));
            paragraph(currentness(rti),{size:9});
            paragraph("Prazo registrado: " + present(rti.due || rti.sourceDue,"não definido") + " | causa: " + present(rti.cause,"não informada"),{size:9});
            paragraph("Responsável pelo atendimento: " + present(rti.responsible,"não definido"),{size:9});
            for (const action of rti.actions || []) paragraph("Ação: " + present(typeof action === "string" ? action : action.description),{size:9});
            source(rti.source);
          }
        }
      }
    }
    context="Pendências e rastreabilidade"; page(); heading("Pendências de revisão");
    paragraph("Emissão definitiva não habilitada nesta etapa. Revisão e assinatura técnica não foram realizadas pelo gerador.",{bold:true,color:RED});
    if(!pending.length) paragraph("Nenhuma ausência de foto/estrutura foi detectada neste snapshot. Isso não equivale a aprovação técnica.");
    pending.forEach(value=>paragraph("- " + value,{size:9}));
    heading("Identidade do snapshot",2); paragraph(record.snapshotId,{size:8});
    paragraph("Versão do gerador: " + VERSION + " | schema: " + SCHEMA,{size:8});
    paragraph("As relações foram lidas por IDs de item/LVT/inspeção/TAG. Etiquetas repetidas não foram usadas para juntar registros.",{size:9});
    const pageCount=doc.getNumberOfPages();
    for(let p=1;p<=pageCount;p++) { doc.setPage(p);doc.setDrawColor(192,201,204);doc.setLineWidth(.2);doc.line(M,282,W-M,282);font(8,false,RED);doc.text("RASCUNHO — sem emissão ou assinatura técnica",M,287);font(8);doc.text(p+" / "+pageCount,W-M,287,{align:"right"}); }
    const metadata={schema:SCHEMA,generatorVersion:VERSION,snapshotId:record.snapshotId,draft:true,canIssue:false,pageCount,pending,embeddedPhotoIds,photoPlacements,
      counts:{assets:model.assets.length,inspections:model.inspections.length,lvts:model.lvts.length,items:model.lvtItems.length,photoReferences:model.photos.length,embeddedPhotos:embeddedPhotoIds.length,rtis:model.rtis.length},
      recordIds:Object.fromEntries(["assets","inspections","lvts","lvtItems","photos","findings","rtis"].map(key=>[key,model[key].map(r=>r.id)]))};
    doc.getGestaoSnapshot=()=>JSON.parse(canonical(record));
    return {doc,metadata,filename:filename(model)};
  }
  async function normalizePhoto(bytes,mime) {
    if (!(bytes instanceof Uint8Array) || !["image/jpeg","image/png"].includes(mime) || bytes.byteLength>MAX_IMAGE_BYTES) throw Error("Foto JPEG/PNG inválida ou acima de 8 MiB.");
    if(typeof root.document?.createElement!=="function" || typeof root.Blob!=="function") throw Error("Normalização visual exige navegador.");
    const blob=new Blob([bytes],{type:mime}); let image;
    try {
      if(typeof root.createImageBitmap==="function") image=await root.createImageBitmap(blob,{imageOrientation:"from-image"});
      else {
        if(typeof root.FileReader!=="function")throw Error("Preparação visual da foto indisponível.");
        const dataUrl=await new Promise((resolve,reject)=>{const reader=new root.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error("Não foi possível ler a foto privada."));reader.readAsDataURL(blob);});
        image=new root.Image();image.src=dataUrl;await image.decode();
      }
      const width=image.width || image.naturalWidth,height=image.height || image.naturalHeight;
      if(!width||!height||width*height>16777216||width>16000||height>16000) throw Error("Dimensões da foto excedem o limite.");
      const canvas=root.document.createElement("canvas");canvas.width=width;canvas.height=height;
      const context=canvas.getContext("2d");if(!context)throw Error("Preparação visual da foto indisponível.");context.drawImage(image,0,0);
      const normalized=await new Promise(resolve=>canvas.toBlob(resolve,mime,mime==="image/jpeg"?.94:undefined));
      if(!normalized||normalized.size>MAX_IMAGE_BYTES)throw Error("Foto normalizada excede o limite de 8 MiB.");
      return {bytes:new Uint8Array(await normalized.arrayBuffer()),mime,width,height,normalized:true};
    } finally { if(image&&typeof image.close==="function")image.close(); }
  }
  return Object.freeze({VERSION,SCHEMA,snapshot,createPdf,normalizePhoto,filename});
});
