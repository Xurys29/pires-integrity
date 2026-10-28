-- Team exercise accounts use real Auth, but are not granted legacy assessments.
-- The legacy model has no per-project assignment relation, so deny these accounts
-- there until a scoped inspection workflow is implemented. Existing users retain
-- their existing policies; this is an additional restrictive policy only.
begin;
create function pi_team_private.legacy_assessment_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not exists (
  select 1 from pi_team_private.professionals p
  where p.user_id=auth.uid() and p.exercise
 );
$$;
revoke all on function pi_team_private.legacy_assessment_allowed() from public,anon,service_role;
grant execute on function pi_team_private.legacy_assessment_allowed() to authenticated;
create policy team_exercise_assessment_boundary on public.pi_assessments
 as restrictive for all to authenticated
 using (pi_team_private.legacy_assessment_allowed())
 with check (pi_team_private.legacy_assessment_allowed());
commit;
