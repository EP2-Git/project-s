begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

create function pg_temp.retention_id(p_fixture text)
returns uuid language sql immutable strict set search_path = pg_catalog as $$
  select md5('project-s:retention-test:' || p_fixture)::uuid;
$$;

create function pg_temp.retention_context(p_owner text)
returns jsonb language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-retention-test',
    'instanceId',pg_temp.retention_id('instance'),'epoch',1,
    'principalId',pg_temp.retention_id(p_owner),'subjectId',pg_temp.retention_id(p_owner),
    'verifiedAt',private.v2_mandate_instant(clock_timestamp()),'transport','http');
$$;

create function pg_temp.retention_redact(p_owner text, p_limit integer, p_epoch bigint default 1)
returns integer language sql set search_path = pg_catalog as $$
  select private.v2_redact_expired_mandate_reviews(
    pg_temp.retention_id('instance'), p_epoch, pg_temp.retention_id(p_owner), p_limit);
$$;

select ok(not p.prosecdef, 'retention runs with the database caller privileges')
from pg_proc p where p.oid = 'private.v2_redact_expired_mandate_reviews(uuid,bigint,uuid,integer)'::regprocedure;
select ok(not exists (
  select 1 from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  where p.oid = 'private.v2_redact_expired_mandate_reviews(uuid,bigint,uuid,integer)'::regprocedure
    and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  'PUBLIC receives no cleanup execution privilege');
select ok(not has_function_privilege(role_name,
  'private.v2_redact_expired_mandate_reviews(uuid,bigint,uuid,integer)','EXECUTE'),
  role_name || ' cannot invoke retention')
from (values ('anon'),('authenticated'),('service_role')) roles(role_name);
select throws_ok($$select pg_temp.retention_redact('owner-a',1)$$,
  'PT401','AUTHENTICATION_REQUIRED','cleanup requires a configured synthetic instance');
select throws_ok(format('select pg_temp.retention_redact(%L,%L::integer)','owner-a',batch_limit),
  '22023','INVALID_RETENTION_ARGUMENT','invalid batch limit is rejected: ' || coalesce(batch_limit::text,'null'))
from (values (0),(101),(null::integer)) limits(batch_limit);

insert into private.v2_authority_instance(instance_id,epoch,audience)
values (pg_temp.retention_id('instance'),1,'http://127.0.0.1:54321');
select throws_ok($$select pg_temp.retention_redact('owner-a',1,2)$$,
  'PT401','AUTHENTICATION_REQUIRED','wrong epoch cannot run cleanup');
select is(pg_temp.retention_redact('unknown',1),0,'missing principal returns no work');
select is((select count(*)::integer from private.v2_authority_principals),0,
  'missing-principal cleanup does not create a fence');

insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.retention_id(fixture),'authenticated','authenticated',
  username || '@example.invalid',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Retention Account','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values ('owner-a','retention-synthetic-a'),('owner-b','retention-synthetic-b'),
  ('host','retention-synthetic-host')) accounts(fixture,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,active)
values (pg_temp.retention_id('meeting'),pg_temp.retention_id('host'),'Synthetic Retention Meeting',30,true);

create function pg_temp.retention_policy(p_owner text, p_profile text)
returns jsonb language sql set search_path = pg_catalog as $$
  select jsonb_build_object('actorId',pg_temp.retention_id(p_owner||'-actor'),
    'profileId',pg_temp.retention_id(p_profile),'profileRevision',1,
    'username','retention-synthetic-host','meetingTypeId',pg_temp.retention_id('meeting'),
    'meetingWindowStart',private.v2_mandate_instant(transaction_timestamp()+interval '1 day'),
    'meetingWindowEnd',private.v2_mandate_instant(transaction_timestamp()+interval '2 days'),
    'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(transaction_timestamp()+interval '10 minutes'),
    'expiresAt',private.v2_mandate_instant(transaction_timestamp()+interval '1 hour'));
$$;

do $$
declare
  v_owner text;
  v_fixture record;
  v_approved jsonb;
begin
  foreach v_owner in array array['owner-a','owner-b'] loop
    perform public.project_s_register_actor_v2(pg_temp.retention_context(v_owner),
      pg_temp.retention_id(v_owner||'-actor'),pg_temp.retention_id(v_owner||'-credential'),
      decode(repeat('a',64),'hex'),'Synthetic retention actor',clock_timestamp()+interval '2 days');
  end loop;
  for v_fixture in select * from (values ('owner-a','profile-a'),('owner-a','profile-closed'),
    ('owner-b','profile-b')) profiles(owner_name,profile_name) loop
    perform public.project_s_create_booker_profile_v2(pg_temp.retention_context(v_fixture.owner_name),
      pg_temp.retention_id(v_fixture.profile_name),
      '{"name":"Synthetic Retention Booker","email":"retention-booker@example.invalid","guestTimeZone":"America/Halifax"}');
  end loop;
  for v_fixture in select * from (values
    ('owner-a','profile-a','older'),('owner-a','profile-a','newer'),('owner-a','profile-a','live'),
    ('owner-a','profile-closed','closed'),('owner-b','profile-b','foreign')) reviews(owner_name,profile_name,review_name) loop
    perform public.project_s_create_mandate_review_v2(pg_temp.retention_context(v_fixture.owner_name),
      pg_temp.retention_id(v_fixture.review_name),pg_temp.retention_policy(v_fixture.owner_name,v_fixture.profile_name));
  end loop;
  v_approved := public.project_s_create_mandate_review_v2(pg_temp.retention_context('owner-a'),
    pg_temp.retention_id('approved'),pg_temp.retention_policy('owner-a','profile-a'));
  perform public.project_s_approve_mandate_v2(pg_temp.retention_context('owner-a'),pg_temp.retention_id('approved'),
    pg_temp.retention_id('mandate'),1,v_approved->>'summaryDigest');
  perform public.project_s_delete_booker_profile_v2(pg_temp.retention_context('owner-a'),
    pg_temp.retention_id('profile-closed'),1);
end;
$$;

-- Advance only the selected fixture deadlines. Both target reviews expire
-- after the transaction's frozen clock, so a cleanup using now() misses them.
update private.v2_mandate_reviews r set
  expires_at = transaction_timestamp() + (v.delay_ms * interval '1 millisecond'),
  reviewed_at = transaction_timestamp() + (v.delay_ms * interval '1 millisecond') - interval '5 minutes'
from (values ('older',20),('newer',40),('approved',20),('closed',20),('foreign',20)) v(fixture,delay_ms)
where r.review_id = pg_temp.retention_id(v.fixture);
select pg_sleep(greatest(0,extract(epoch from transaction_timestamp() + interval '40 milliseconds' - clock_timestamp())));

create temporary table retention_review_before on commit drop as
select * from private.v2_mandate_reviews;
create temporary table retention_event_before on commit drop as
select * from private.v2_authority_events;

select ok((select policy_summary ?& array['name','email','guestTimeZone']
  from retention_review_before where review_id=pg_temp.retention_id('older')),
  'expired pending review contains the cached contact details before cleanup');
select throws_ok($$select public.project_s_approve_mandate_v2(pg_temp.retention_context('owner-a'),
  pg_temp.retention_id('older'),pg_temp.retention_id('forbidden-mandate'),1,
  (select summary_digest from retention_review_before where review_id=pg_temp.retention_id('older')))$$,
  'PT409','VERSION_CONFLICT','deadline already denies approval before the worker runs');

select is(pg_temp.retention_redact('owner-a',1),1,'batch of one only redacts one eligible row');
select is((select array_agg(review_id order by review_id)
  from private.v2_mandate_reviews where state='invalidated' and review_id in
    (pg_temp.retention_id('older'),pg_temp.retention_id('newer'))),
  array[pg_temp.retention_id('older')],'oldest expiry is selected first');
select is((select count(*)::integer from private.v2_authority_events where action='expired_mandate_reviews_redacted'),
  1,'one nonempty batch emits one audit event');
select ok((select r.invalidated_at=e.occurred_at and r.invalidated_at>=r.expires_at
    and r.invalidated_at>transaction_timestamp()
  from private.v2_mandate_reviews r join private.v2_authority_events e
    on (r.instance_id,r.epoch,r.principal_id,r.invalidated_sequence)
     = (e.instance_id,e.epoch,e.principal_id,e.sequence)
  where r.review_id=pg_temp.retention_id('older') and e.action='expired_mandate_reviews_redacted'),
  'redaction uses a fresh clock and points to the owner-scoped event');

select is(pg_temp.retention_redact('owner-a',100),1,'next batch redacts the remaining expired review');
select is(pg_temp.retention_redact('owner-a',100),0,'empty batch is an idempotent no-op');
select is((select count(*)::integer from private.v2_authority_events where action='expired_mandate_reviews_redacted'),
  2,'empty batch adds no audit event');
select is((select count(*)::integer from private.v2_mandate_reviews r join retention_review_before b using(review_id)
  where r.review_id in (pg_temp.retention_id('older'),pg_temp.retention_id('newer'))
    and r.state='invalidated' and r.policy_summary is null
    and (to_jsonb(r)-array['state','policy_summary','invalidated_at','invalidated_sequence'])
      = (to_jsonb(b)-array['state','policy_summary','invalidated_at','invalidated_sequence'])),2,
  'both cached summaries are erased while original IDs, bindings, policy and digest remain');
select is((select count(*)::integer from private.v2_mandate_reviews r join retention_review_before b using(review_id)
  where r.review_id in (pg_temp.retention_id('live'),pg_temp.retention_id('approved'),
    pg_temp.retention_id('closed'),pg_temp.retention_id('foreign'))
    and to_jsonb(r)=to_jsonb(b)),4,'live, approved, closed and foreign review rows remain identical');
select is((select count(*)::integer from retention_event_before b join private.v2_authority_events e
  using(instance_id,epoch,principal_id,sequence) where to_jsonb(b)=to_jsonb(e)),
  (select count(*)::integer from retention_event_before),'prior audit records remain intact');
select ok((select bool_and((select array_agg(key order by key) from jsonb_object_keys(to_jsonb(e)) as keys(key))
    = array['action','epoch','instance_id','occurred_at','principal_id','sequence'])
  from private.v2_authority_events e where e.action='expired_mandate_reviews_redacted'),
  'cleanup audit entries contain only action, owner, sequence and time metadata');
select throws_ok($$select public.project_s_create_mandate_review_v2(pg_temp.retention_context('owner-a'),
  pg_temp.retention_id('older'),pg_temp.retention_policy('owner-a','profile-a'))$$,
  'PT409','VERSION_CONFLICT','retained review ID denies recreating the expired review');
select throws_ok($$select public.project_s_approve_mandate_v2(pg_temp.retention_context('owner-a'),
  pg_temp.retention_id('older'),pg_temp.retention_id('forbidden-mandate'),1,
  (select summary_digest from retention_review_before where review_id=pg_temp.retention_id('older')))$$,
  'PT409','VERSION_CONFLICT','redacted review still refuses approval with its original digest');
select is((select count(*)::integer from private.v2_mandates),1,'cleanup creates no mandate and preserves the approved one');

update private.v2_authority_principals set disabled=true
where principal_id=pg_temp.retention_id('owner-b');
delete from auth.users where id=pg_temp.retention_id('owner-b');
select is(pg_temp.retention_redact('owner-b',1),1,'database owner can scrub expired contact details after account deletion');
select is((select state from private.v2_mandate_reviews where review_id=pg_temp.retention_id('foreign')),
  'invalidated','orphaned review retains an invalidated tombstone');

select * from finish();
rollback;
