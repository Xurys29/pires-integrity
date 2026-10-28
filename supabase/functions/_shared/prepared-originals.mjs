// Immutable originals packaged server-side; no download credentials or caller URLs.
export function preparedReader(catalog) {
  return async function readPreparedSource(id) {
    const item = catalog.find(x => x.id === id);
    if (!item || item.size < 1 || item.size > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(item.sha)) throw Error('Unknown source');
    const bytes = Uint8Array.from(atob(item.base64), c => c.charCodeAt(0));
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    if(bytes.length !== item.size || sha !== item.sha) throw Error('Identity mismatch');
    return {name:item.name,bytes,format:/\.xlsx$/i.test(item.name)?'document_xlsx':'document_pdf'};
  };
}
