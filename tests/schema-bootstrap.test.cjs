'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
test('schema-only bootstrap: fresh isolated database restores all application tables and denies anonymous team access',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 // Auth and Storage are managed by Supabase; only their schema contract is simulated here.
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean,raw_app_meta_data jsonb,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create function auth.role() returns text language sql stable as $$select current_user::text$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text,metadata jsonb,owner_id text);create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;");
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/bootstrap/current-schema.sql'),'utf8').replace('create extension if not exists pgcrypto with schema extensions;','-- pgcrypto is supplied by Supabase; no cryptographic operation is exercised by this schema test.');
 await db.exec(sql);
 const count=(await db.query("select count(*)::int n from pg_tables where schemaname like 'pi\\_%' escape '\\' or (schemaname='public' and tablename like 'pi\\_%' escape '\\')")).rows[0].n;
 assert.equal(count,40);
 assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from pi_team_private.professionals')).rows[0].n,0);
 await db.exec('set role anon');
 await assert.rejects(db.query("select public.pi_team_api('10000000-0000-4000-8000-000000000001','list','{}')"),{code:'42501'});
});

