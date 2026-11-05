'use strict';
// Explicit synthetic curation/binding used only by disposable SQL fixtures.
// This helper never discovers a "latest" catalogue or creates real access.
const {randomUUID}=require('node:crypto');

async function catalogueMetadata(f,{ownerId,catalogId,contractIds,assetIds}){
 const applicability={inspectionTypes:['visual'],assetTypes:['linha'],contractIds,assetIds};
 await f.db.query('update pi_gestao_private.inspection_catalogs set version_label=$1,procedure_reference=$2,applicability=$3::jsonb where tenant_id=$4 and owner_id=$5 and id=$6',[
  'VERSÃO EXCLUSIVAMENTE SINTÉTICA '+catalogId,
  'PROCEDIMENTO EXCLUSIVAMENTE SINTÉTICO; SEM VALIDADE TÉCNICA',
  JSON.stringify(applicability),f.ids.tenantA,ownerId,catalogId
 ]);
}

async function selectCatalogue(f,{ownerId,inspectionId,catalogId,actor=f.ids.adminA}){
 const rows=await f.db.query('select version from pi_gestao_private.records where tenant_id=$1 and owner_id=$2 and id=$3 and kind=\'inspection\'',[f.ids.tenantA,ownerId,inspectionId]);
 if(rows.rows.length!==1)throw Error('Explicit catalogue fixture inspection missing');
 const call=(action,payload)=>f.asRole('authenticated',actor,async()=> (await f.db.query('select public.pi_gestao_api($1,$2,$3::jsonb) value',[f.ids.tenantA,action,JSON.stringify(payload)])).rows[0].value);
 const detail=await call('execution.get',{ownerId,inspectionId});
 const selected=detail.catalogChoices?.find(c=>c.id===catalogId);
 if(!selected)throw Error('Explicit synthetic catalogue choice unavailable: '+catalogId);
 const payload={ownerId,inspectionId,catalogId,expectedVersion:rows.rows[0].version,expectedCatalogHash:selected.contentHash,requestId:randomUUID()};
 return call('execution.catalog.select',payload);
}

module.exports={catalogueMetadata,selectCatalogue};
