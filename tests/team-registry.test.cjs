'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup}=require('./fixtures/gestao-postgres-fixture.cjs');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261028124613_team_registry_stage_one.sql'),'utf8');
const exerciseBoundary=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261028174014_team_exercise_access_validation.sql'),'utf8');
async function fixture(t){
 const f=await setup();t.after(()=>f.close());await f.db.exec(migration);
 // Isolated equivalent of the existing membership revocation contract.
 await f.db.exec(`create function pi_access_private.membership_change(p_user_id uuid,p_company_id uuid,p_action text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$ begin if p_action<>'deactivate' then raise exception 'unsupported fixture';end if; update public.pi_company_memberships set access_state='revoked' where company_id=p_company_id and user_id=p_user_id;return '{}'::jsonb;end $$;`);
 f.team=(action,payload={},user=f.ids.adminA,tenant=f.ids.tenantA)=>f.asRole('authenticated',user,async()=> (await f.db.query('select public.pi_team_api($1,$2,$3::jsonb) value',[tenant,action,JSON.stringify(payload)])).rows[0].value);
 f.seed=async()=>{await f.team('exercise.prepare');return (await f.team('list')).professionals;};
 return f;
}

test('exercise: legacy company access cannot expose assessments to unassigned test users; existing access is preserved',async t=>{
 const f=await fixture(t);
 await f.db.exec(`create table public.pi_assessments(id int primary key);alter table public.pi_assessments enable row level security;grant select,insert on public.pi_assessments to authenticated;create policy existing_company_access on public.pi_assessments for all to authenticated using(true) with check(true);insert into public.pi_assessments values(1);`);
 await f.db.exec(exerciseBoundary);
 const p=(await f.seed()).find(p=>p.exercise_key==='IF-01');
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);
 await f.db.query('update pi_team_private.professionals set user_id=$1 where id=$2',[f.ids.inspector,p.id]);
 await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 assert.equal((await f.asRole('authenticated',f.ids.adminA,()=>f.db.query('select * from public.pi_assessments'))).rows.length,1);
 assert.deepEqual((await f.asRole('authenticated',f.ids.inspector,()=>f.db.query('select * from public.pi_assessments'))).rows,[]);
 await assert.rejects(f.asRole('authenticated',f.ids.inspector,()=>f.db.query('insert into public.pi_assessments values(2)')),{code:'42501'});
});
test('team: exactly 20 inspectors and 2 engineers, repeat safe, no fictional qualifications or identities',async t=>{
 const f=await fixture(t),people=await f.seed();await f.team('exercise.prepare');
 const list=await f.team('list');assert.equal(list.professionals.length,22);assert.equal(people.filter(p=>p.functional_role==='inspector').length,20);assert.equal(people.filter(p=>p.functional_role==='engineer_reviewer').length,2);
 assert.ok(people.every(p=>p.user_id===null&&p.integrity_level===null&&p.qualifications.length===0&&p.documents.length===0&&p.access.status==='not_created'));
 assert.ok(people.every(p=>p.test_identity.startsWith('TESTE-CPF-')));assert.ok(people.filter(p=>p.functional_role==='engineer_reviewer').every(p=>p.access.signature_permission==='exercise_plh_sign_issue'));
 assert.equal((await f.db.query('select count(*)::int n from auth.users')).rows[0].n,8);
 assert.equal((await f.db.query('select count(*)::int n from pi_team_private.history')).rows[0].n,22);
});
test('team: current membership, own profile, no colleagues, clients, strangers or other organization',async t=>{
 const f=await fixture(t),people=await f.seed(),own=people.find(p=>p.exercise_key==='IF-01'),other=people.find(p=>p.exercise_key==='IF-02');
 await f.db.query('update pi_team_private.professionals set user_id=$1 where tenant_id=$2 and id=$3',[f.ids.inspector,f.ids.tenantA,own.id]).catch(async()=>{ // audit requires actor even in test setup
  await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ids.adminA]);await f.db.query('update pi_team_private.professionals set user_id=$1 where tenant_id=$2 and id=$3',[f.ids.inspector,f.ids.tenantA,own.id]);await f.db.query("select set_config('request.jwt.claim.sub','',false)");
 });
 assert.equal((await f.team('list',{},f.ids.inspector)).professionals.length,1);
 await assert.rejects(f.team('person.get',{professional_id:other.id},f.ids.inspector),{code:'42501'});
 await assert.rejects(f.team('history',{professional_id:other.id},f.ids.inspector),{code:'42501'});
 await assert.rejects(f.team('salary.list',{},f.ids.inspector),{code:'42501'});
 await assert.rejects(f.team('list',{},f.ids.client),{code:'42501'});
 await assert.rejects(f.team('list',{},f.ids.stranger),{code:'42501'});
 await assert.rejects(f.team('list',{},f.ids.adminB),{code:'42501'});
 await assert.rejects(f.team('person.get',{professional_id:own.id},f.ids.adminB,f.ids.tenantB),{code:'42501'});
 await assert.rejects(f.asRole('authenticated',f.ids.inspector,()=>f.db.query('select * from pi_team_private.professionals')),{code:'42501'});
 await assert.rejects(f.asRole('anon',null,()=>f.db.query("select public.pi_team_api($1,'list')",[f.ids.tenantA])),{code:'42501'});
 await assert.rejects(f.team('person.save',{...own,name:'Bad',professional_id:own.id,user_id:f.ids.adminA},f.ids.inspector),{code:'42501'});
 await f.team('access.revoke',{professional_id:own.id,reason:'Revogação de teste isolado'});
 await assert.rejects(f.team('list',{},f.ids.inspector),{code:'42501'});
 assert.equal((await f.team('person.get',{professional_id:own.id})).access.status,'revoked');
 assert.ok((await f.team('history',{professional_id:own.id})).length>=3);
});
test('team: CRUD, optimistic lock, catalog meaning, separate classification, scoped requirements and salary history',async t=>{
 const f=await fixture(t),p=(await f.seed())[0];
 const clean={professional_id:p.id,version:p.version,name:p.name,job_title:'Engenheiro',relationship:'exercise',registration_state:'active',integrity_level:2,integrity_basis:'Classificação informada pelo gestor para teste',availability:'unavailable'};
 const saved=await f.team('person.save',clean);assert.equal(saved.integrity_level,2);assert.equal(saved.version,2);
 await assert.rejects(f.team('person.save',clean),{code:'40001'});
 await assert.rejects(f.team('person.save',{...clean,version:2,integrity_basis:''}),{code:'22023'});
 await assert.rejects(f.team('person.save',{...clean,version:2,technical_state:'verified',technical_basis:'fake'}),{code:'22023'});
 const cat=await f.team('catalog.save',{code:'SIGLA',meaning:'Significado fornecido pelo gestor, sem inferência'});
 await f.team('qualification.save',{professional_id:p.id,catalog_id:cat.id,qualification_level:'3',verification:'not_informed'});
 assert.equal((await f.team('person.get',{professional_id:p.id})).integrity_level,2);
 await assert.rejects(f.team('catalog.save',{id:cat.id,code:'SIGLA',meaning:'Outro significado'}),{code:'22023'});
 await assert.rejects(f.team('requirement.save',{title:'NR universal',basis:'Teste isolado'}),{code:'23514'});
 await f.team('requirement.save',{title:'Treinamento conforme atividade',activity:'Atividade isolada',basis:'Fonte de teste'});
 await assert.rejects(f.team('salary.list'),{code:'42501'});
 await f.db.query('insert into pi_team_private.salary_managers values($1,$2)',[f.ids.tenantA,f.ids.adminA]);
 assert.deepEqual(await f.team('salary.list'),[]);
 await f.team('salary.save',{integrity_level:1,amount_cents:320000,effective_from:'2026-10-28',reason:'Confirmado no exercício',confirm:true});
 await f.team('salary.save',{integrity_level:1,amount_cents:330000,effective_from:'2026-11-01',reason:'Vigência seguinte',confirm:true});
 assert.equal((await f.team('salary.list')).length,2);
 await assert.rejects(f.team('salary.save',{integrity_level:1,amount_cents:340000,effective_from:'2026-11-01',reason:'Duplicado',confirm:true}),{code:'23505'});
});
test('team: private file reservation, immutable storage, wrong owner and no false document approval',async t=>{
 const f=await fixture(t),people=await f.seed(),p=people[0],other=people[1];
 const file=await f.team('file.reserve',{professional_id:p.id,name:'evidence.txt',mime:'text/plain',byte_size:10,purpose:'document'});
 await assert.rejects(f.team('file.complete',{professional_id:p.id,id:file.id}),{code:'22023'});
 await f.db.query("insert into storage.objects(bucket_id,name,metadata) values('pi-team-private',$1,'{\"size\":10,\"mimetype\":\"text/plain\"}')",[file.object_key]);
 await f.team('file.complete',{professional_id:p.id,id:file.id});
 await f.team('file.complete',{professional_id:p.id,id:file.id});
 await assert.rejects(f.team('file.get',{professional_id:other.id,id:file.id}),{code:'42501'});
 await assert.rejects(f.team('document.save',{professional_id:other.id,title:'wrong owner',kind:'document',file_id:file.id}),{code:'42501'});
 await assert.rejects(f.team('document.save',{professional_id:p.id,title:'no note',kind:'document',file_id:file.id,verification:'checked'}),{code:'22023'});
 const doc=await f.team('document.save',{professional_id:p.id,title:'Arquivo isolado',kind:'document',file_id:file.id,verification:'pending'});
 const persisted=await f.team('person.get',{professional_id:p.id});assert.equal(persisted.documents[0].id,doc.id);assert.equal(persisted.technical_state,null);assert.equal(persisted.access.status,'not_created');
 const allowed=await f.asRole('authenticated',f.ids.adminA,()=>f.db.query('select pi_team_private.file_allowed($1,false) r,pi_team_private.file_allowed($1,true) w',[file.object_key]));assert.deepEqual(allowed.rows[0],{r:true,w:false});
 const denied=await f.asRole('authenticated',f.ids.adminB,()=>f.db.query('select pi_team_private.file_allowed($1,false) r',[file.object_key]));assert.equal(denied.rows[0].r,false);
});
