create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions,pg_catalog;
select no_plan();

-- Independent sessions use this suite's committed synthetic partition only.
delete from private.v2_step_up_preparations where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_step_up_grants where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_delegated_preparations where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_step_up_requests where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_mandates where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_mandate_reviews where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_actor_credentials where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_booker_profiles where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='c8000000-0000-4000-8000-000000000001';
delete from auth.users where id in ('c8100000-0000-4000-8000-000000000001',
  'c8100000-0000-4000-8000-000000000002','c8100000-0000-4000-8000-000000000003');
drop schema if exists project_s_step_up_approval_test cascade;
create schema project_s_step_up_approval_test;
create table project_s_step_up_approval_test.state(key text primary key,value jsonb);

create function project_s_step_up_approval_test.principal(p_other boolean default false) returns jsonb
language sql set search_path=pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-step-up-approval',
    'principalId',owner_id,'subjectId',owner_id,'instanceId','c8000000-0000-4000-8000-000000000001',
    'epoch',1,'verifiedAt',private.v2_mandate_instant(clock_timestamp()),'transport','ui')
  from (select case when p_other then 'c8100000-0000-4000-8000-000000000002'
    else 'c8100000-0000-4000-8000-000000000001' end) as owner(owner_id);
$$;
create function project_s_step_up_approval_test.actor(p_number integer default 1) returns jsonb
language sql set search_path=pg_catalog as $$
  select project_s_step_up_approval_test.principal()||jsonb_build_object('transport','http',
    'actorId','c8300000-0000-4000-8000-'||lpad(p_number::text,12,'0'),
    'credentialId','c8400000-0000-4000-8000-'||lpad(p_number::text,12,'0'),
    'credentialRevision',1,'credentialFingerprint',repeat(case p_number when 1 then 'a' else 'b' end,64));
$$;
create function project_s_step_up_approval_test.review_id(p_key text) returns uuid
language sql set search_path=pg_catalog as $$
  select (value#>>'{stepUp,reviewId}')::uuid from project_s_step_up_approval_test.state where key='request-'||p_key;
$$;
create function project_s_step_up_approval_test.approve(p_key text,p_context jsonb default null,
  p_revision bigint default 1,p_digest text default null) returns jsonb
language sql set search_path=pg_catalog as $$
  select public.project_s_approve_step_up_v2(coalesce(p_context,project_s_step_up_approval_test.principal()),
    project_s_step_up_approval_test.review_id(p_key),extensions.gen_random_uuid(),extensions.gen_random_uuid(),
    p_revision,coalesce(p_digest,(select summary_digest from private.v2_step_up_requests
      where review_id=project_s_step_up_approval_test.review_id(p_key))));
$$;
create function project_s_step_up_approval_test.attempt(p_key text) returns jsonb
language plpgsql set search_path=pg_catalog as $$
begin
  return project_s_step_up_approval_test.approve(p_key);
exception when others then
  return jsonb_build_object('code',sqlstate,'message',sqlerrm);
end;
$$;
create function pg_temp.approval_snapshot() returns jsonb
language sql set search_path=pg_catalog as $$
  select jsonb_build_object(
    'grants',(select jsonb_agg(to_jsonb(g) order by grant_id) from private.v2_step_up_grants g
      where instance_id='c8000000-0000-4000-8000-000000000001'),
    'preparations',(select jsonb_agg(to_jsonb(p) order by preparation_id) from private.v2_step_up_preparations p
      where instance_id='c8000000-0000-4000-8000-000000000001'),
    'reviews',(select jsonb_agg(to_jsonb(r) order by review_id) from private.v2_step_up_requests r
      where instance_id='c8000000-0000-4000-8000-000000000001'),
    'mandates',(select jsonb_agg(to_jsonb(m) order by mandate_id) from private.v2_mandates m
      where instance_id='c8000000-0000-4000-8000-000000000001'),
    'principals',(select jsonb_agg(to_jsonb(p) order by principal_id) from private.v2_authority_principals p
      where instance_id='c8000000-0000-4000-8000-000000000001'),
    'events',(select jsonb_agg(to_jsonb(e) order by principal_id,sequence) from private.v2_authority_events e
      where instance_id='c8000000-0000-4000-8000-000000000001'));
$$;
create function pg_temp.approval_waits(p_pid integer) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare deadline timestamptz:=clock_timestamp()+interval '500 milliseconds';
begin
  loop
    if exists(select 1 from pg_locks where pid=p_pid and not granted) then return true; end if;
    exit when clock_timestamp()>=deadline;
    perform pg_sleep(0.005);
  end loop;
  return false;
end;
$$;
create function pg_temp.approval_wait_past_deadline() returns void
language sql set search_path=pg_catalog as $$
  select pg_sleep(greatest(0,extract(epoch from ((select (value#>>'{}')::timestamptz
    from project_s_step_up_approval_test.state where key='deadline')+interval '30 milliseconds'-clock_timestamp())))::double precision);
$$;

select is((select count(*)::integer from private.v2_authority_instance),0,'approval migration configures no instance');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.v2_step_up_grants'::regclass,'private.v2_step_up_preparations'::regclass)),
  'grant and exact preparation tables enable RLS');
select ok(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE'),
  role_name||' has no direct access to '||table_name)
from (values('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values('private.v2_step_up_grants'),('private.v2_step_up_preparations')) tables(table_name);
select ok(has_function_privilege('service_role',signature,'EXECUTE'),'trusted service can execute '||signature)
from (values('public.project_s_approve_step_up_v2(jsonb,uuid,uuid,uuid,bigint,text)'),
  ('public.project_s_revoke_step_up_v2(jsonb,uuid,bigint)')) functions(signature);
set role anon;
select throws_ok($$select public.project_s_approve_step_up_v2('{}',extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),extensions.gen_random_uuid(),1,repeat('a',64))$$,'42501',null,'anonymous direct approval is denied');
select throws_ok($$select public.project_s_revoke_step_up_v2('{}',extensions.gen_random_uuid(),1)$$,
  '42501',null,'anonymous direct revoke is denied');
reset role;
set role authenticated;
select throws_ok($$select public.project_s_approve_step_up_v2('{}',extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),extensions.gen_random_uuid(),1,repeat('a',64))$$,'42501',null,'authenticated direct approval is denied');
select throws_ok($$select public.project_s_revoke_step_up_v2('{}',extensions.gen_random_uuid(),1)$$,
  '42501',null,'authenticated direct revoke is denied');
reset role;

insert into private.v2_authority_instance(instance_id,epoch,audience)
values('c8000000-0000-4000-8000-000000000001',1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',username||'@example.invalid',
  clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Approval Host','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values('c8100000-0000-4000-8000-000000000001'::uuid,'step-up-approval-owner'),
  ('c8100000-0000-4000-8000-000000000002'::uuid,'step-up-approval-other'),
  ('c8100000-0000-4000-8000-000000000003'::uuid,'step-up-approval-host')) users(id,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,minimum_notice_minutes,active)
values('c8700000-0000-4000-8000-000000000001','c8100000-0000-4000-8000-000000000003','Synthetic approval meeting',30,0,true);
insert into project_s_step_up_approval_test.state values ('day',to_jsonb((clock_timestamp() at time zone 'UTC')::date+3));
insert into public.specific_date_availabilities(user_id,date,status,start_time,end_time)
values('c8100000-0000-4000-8000-000000000003',
  (select (value#>>'{}')::date from project_s_step_up_approval_test.state where key='day'),'available','09:00','17:00');
select public.project_s_register_actor_v2(project_s_step_up_approval_test.principal(),
  (a->>'actorId')::uuid,(a->>'credentialId')::uuid,decode(a->>'credentialFingerprint','hex'),
  'Synthetic approval actor',clock_timestamp()+interval '2 days')
from (select project_s_step_up_approval_test.actor(i) as a from generate_series(1,3) i) actors;
select public.project_s_create_booker_profile_v2(project_s_step_up_approval_test.principal(),
  ('c8200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  jsonb_build_object('name','Synthetic Private Approval Booker','email','private-approval@example.invalid','guestTimeZone','UTC'))
from generate_series(1,3) i;
select public.project_s_create_booker_profile_v2(project_s_step_up_approval_test.principal(true),
  'c8200000-0000-4000-8000-000000000004','{"name":"Synthetic Other Booker","email":"other-approval@example.invalid","guestTimeZone":"UTC"}');

do $$
declare fixture record; policy jsonb; review jsonb; mandate jsonb; day_start timestamptz;
  permission_start timestamptz:=clock_timestamp()+interval '5 seconds';
begin
  select (value#>>'{}')::date::timestamp at time zone 'UTC' into day_start
    from project_s_step_up_approval_test.state where key='day';
  for fixture in select * from (values
    ('main',1,1),('pending-revoke',1,1),('approved-revoke',1,1),('original-revoke',1,1),
    ('delete',1,2),('credential',2,1),('audit',1,1),('rejected',1,1),('race',1,1),
    ('wait-expiry',1,1),('wait-revoke',1,1),('wait-delete',1,3),('host-drift',1,1),('conflict',1,1),('bound',1,1))
    cases(key,actor,profile) loop
    policy:=jsonb_build_object('actorId',project_s_step_up_approval_test.actor(fixture.actor)->>'actorId',
      'profileId','c8200000-0000-4000-8000-'||lpad(fixture.profile::text,12,'0'),'profileRevision',1,
      'username','step-up-approval-host','meetingTypeId','c8700000-0000-4000-8000-000000000001',
      'meetingWindowStart',private.v2_mandate_instant(day_start+interval '10 hours'),
      'meetingWindowEnd',private.v2_mandate_instant(day_start+interval '14 hours'),
      'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(permission_start),
      'expiresAt',private.v2_mandate_instant(permission_start+interval '1 hour'));
    review:=public.project_s_create_mandate_review_v2(project_s_step_up_approval_test.principal(),extensions.gen_random_uuid(),policy);
    mandate:=public.project_s_approve_mandate_v2(project_s_step_up_approval_test.principal(),
      (review->>'reviewId')::uuid,extensions.gen_random_uuid(),1,review->>'summaryDigest');
    insert into project_s_step_up_approval_test.state values ('mandate-'||fixture.key,mandate);
  end loop;
  perform pg_sleep(greatest(0,extract(epoch from (permission_start+interval '20 milliseconds'-clock_timestamp())))::double precision);
  for fixture in select * from (values
    ('main',1),('pending-revoke',1),('approved-revoke',1),('original-revoke',1),('delete',1),('credential',2),
    ('audit',1),('rejected',1),('race',1),('wait-expiry',1),('wait-revoke',1),('wait-delete',1),
    ('host-drift',1),('conflict',1),('bound',1)) cases(key,actor) loop
    select value into mandate from project_s_step_up_approval_test.state where key='mandate-'||fixture.key;
    insert into project_s_step_up_approval_test.state values ('request-'||fixture.key,
      public.project_s_prepare_delegated_booking_v2(project_s_step_up_approval_test.actor(fixture.actor),
        extensions.gen_random_uuid(),extensions.gen_random_uuid(),jsonb_build_object('mandateId',mandate->>'mandateId',
          'username','step-up-approval-host','meetingTypeId','c8700000-0000-4000-8000-000000000001',
          'startAt',private.v2_mandate_instant(day_start+interval '9 hours 45 minutes'))));
  end loop;
  select value into mandate from project_s_step_up_approval_test.state where key='mandate-main';
  insert into project_s_step_up_approval_test.state values ('old-preparation',
    public.project_s_prepare_delegated_booking_v2(project_s_step_up_approval_test.actor(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),
      jsonb_build_object('mandateId',mandate->>'mandateId','username','step-up-approval-host',
        'meetingTypeId','c8700000-0000-4000-8000-000000000001','startAt',private.v2_mandate_instant(day_start+interval '10 hours'))));
  insert into project_s_step_up_approval_test.state values ('sibling',
    public.project_s_prepare_delegated_booking_v2(project_s_step_up_approval_test.actor(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),
      jsonb_build_object('mandateId',mandate->>'mandateId','username','step-up-approval-host',
        'meetingTypeId','c8700000-0000-4000-8000-000000000001','startAt',private.v2_mandate_instant(day_start+interval '9 hours 30 minutes'))));
end;
$$;
select is((select count(*)::integer from project_s_step_up_approval_test.state
  where key like 'request-%' and value->>'kind'='step_up_required'),15,'all approval fixtures are actual actor-created pending reviews');
insert into project_s_step_up_approval_test.state values ('review-main',public.project_s_get_step_up_review_v2(
  project_s_step_up_approval_test.principal(),project_s_step_up_approval_test.review_id('main')));
select is((select value->>'summaryDigest' from project_s_step_up_approval_test.state where key='review-main'),
  (select summary_digest from private.v2_step_up_requests where review_id=project_s_step_up_approval_test.review_id('main')),
  'approval digest is the exact digest shown by the issuer read');

insert into project_s_step_up_approval_test.state values ('before-refusals',pg_temp.approval_snapshot());
select throws_ok($$select project_s_step_up_approval_test.approve('main',project_s_step_up_approval_test.actor())$$,
  'PT401','AUTHENTICATION_REQUIRED','actor context cannot approve its own escalation');
select throws_ok($$select project_s_step_up_approval_test.approve('main',project_s_step_up_approval_test.principal(true))$$,
  'PT403','FORBIDDEN','another principal cannot approve a known review');
select throws_ok($$select public.project_s_revoke_step_up_v2(project_s_step_up_approval_test.actor(),
  project_s_step_up_approval_test.review_id('main'),1)$$,'PT401','AUTHENTICATION_REQUIRED','actor context cannot revoke issuer authority');
select throws_ok($$select public.project_s_revoke_step_up_v2(project_s_step_up_approval_test.principal(true),
  project_s_step_up_approval_test.review_id('main'),1)$$,'PT403','FORBIDDEN','foreign principal cannot revoke a known review');
select throws_ok($$select public.project_s_revoke_step_up_v2(project_s_step_up_approval_test.principal(),
  'c8500000-0000-4000-8000-000000000099',1)$$,'PT403','FORBIDDEN','foreign and missing revoke references use the same refusal');
select throws_ok($$select public.project_s_revoke_step_up_v2(project_s_step_up_approval_test.principal(),
  project_s_step_up_approval_test.review_id('main'),2)$$,'PT409','VERSION_CONFLICT','pending revoke rejects a stale revision');
select throws_ok($$select public.project_s_approve_step_up_v2(project_s_step_up_approval_test.principal(),
  'c8500000-0000-4000-8000-000000000099',extensions.gen_random_uuid(),extensions.gen_random_uuid(),1,repeat('a',64))$$,
  'PT403','FORBIDDEN','missing and foreign review have the same refusal');
select throws_ok($$select project_s_step_up_approval_test.approve('main',p_revision=>2)$$,
  'PT409','VERSION_CONFLICT','pending review rejects a stale revision');
select throws_ok($$select project_s_step_up_approval_test.approve('main',p_digest=>repeat('f',64))$$,
  'PT409','VERSION_CONFLICT','a different valid digest cannot approve the recorded review');
update private.v2_step_up_requests set summary_digest=repeat('d',64)
where review_id=project_s_step_up_approval_test.review_id('main');
select throws_ok($$select project_s_step_up_approval_test.approve('main')$$,'PT409','VERSION_CONFLICT',
  'matching a privately changed digest cannot authorize a different stored binding');
update private.v2_step_up_requests set summary_digest=(select value->>'summaryDigest'
  from project_s_step_up_approval_test.state where key='review-main')
where review_id=project_s_step_up_approval_test.review_id('main');
update private.v2_step_up_requests set summary=summary||'{"email":"unreviewed-override@example.invalid"}'::jsonb
where review_id=project_s_step_up_approval_test.review_id('main');
select throws_ok($$select project_s_step_up_approval_test.approve('main')$$,'PT409','VERSION_CONFLICT',
  'privately changed summary cannot be blessed by the original issuer digest');
update private.v2_step_up_requests set summary=(select (value->'exactSummary')-'name'-'email'
  from project_s_step_up_approval_test.state where key='review-main')
where review_id=project_s_step_up_approval_test.review_id('main');
update private.v2_authority_instance set epoch=2 where instance_id='c8000000-0000-4000-8000-000000000001';
select throws_ok($$select project_s_step_up_approval_test.approve('main')$$,'PT401','AUTHENTICATION_REQUIRED','old epoch cannot approve');
update private.v2_authority_instance set epoch=1 where instance_id='c8000000-0000-4000-8000-000000000001';
update auth.users set is_anonymous=true where id='c8100000-0000-4000-8000-000000000001';
select throws_ok($$select project_s_step_up_approval_test.approve('main')$$,'PT401','AUTHENTICATION_REQUIRED','live anonymous-account state denies approval');
update auth.users set is_anonymous=false where id='c8100000-0000-4000-8000-000000000001';
select is(pg_temp.approval_snapshot(),(select value from project_s_step_up_approval_test.state where key='before-refusals'),
  'all refused approval attempts preserve authority, rows and audit sequence');

do $$
declare support record; original_expiry timestamptz;
begin
  for support in select * from (values
    ('v2_actor_credentials','credential_id','c8400000-0000-4000-8000-000000000001'::uuid),
    ('v2_booker_profiles','profile_id','c8200000-0000-4000-8000-000000000001'::uuid),
    ('v2_mandates','mandate_id',(select (value->>'mandateId')::uuid from project_s_step_up_approval_test.state where key='mandate-main')),
    ('v2_step_up_requests','review_id',project_s_step_up_approval_test.review_id('main'))) as supports(table_name,id_column,id_value)
  loop
    execute format('select expires_at from private.%I where %I=$1',support.table_name,support.id_column)
      into original_expiry using support.id_value;
    execute format('update private.%I set expires_at=clock_timestamp()-interval ''1 millisecond'' where %I=$1',support.table_name,support.id_column)
      using support.id_value;
    insert into project_s_step_up_approval_test.state values ('expired-'||support.table_name,project_s_step_up_approval_test.attempt('main'));
    execute format('update private.%I set expires_at=$2 where %I=$1',support.table_name,support.id_column) using support.id_value,original_expiry;
  end loop;
end;
$$;
select is(value,'{"code":"PT409","message":"VERSION_CONFLICT"}'::jsonb,key||' cannot be approved despite an active label')
from project_s_step_up_approval_test.state where key like 'expired-%' order by key;

insert into project_s_step_up_approval_test.state values ('approved-main',project_s_step_up_approval_test.approve('main'));
select is((select array_agg(key order by key) from jsonb_object_keys(value) fields(key)),
  array['expiresAt','preparationId','reviewId','state'],'approval returns the strict public metadata only')
from project_s_step_up_approval_test.state where key='approved-main';
select is((select value->>'state' from project_s_step_up_approval_test.state where key='approved-main'),'approved','exact approval succeeds');
select ok((select state='revoked' and revision=2 and superseded_by_step_up=project_s_step_up_approval_test.review_id('main')
  from private.v2_mandates where mandate_id=(select (value->>'mandateId')::uuid from project_s_step_up_approval_test.state where key='mandate-main')),
  'the original unused mandate is durably replaced rather than left with another budget');
select is((select count(*)::integer from private.v2_step_up_grants where review_id=project_s_step_up_approval_test.review_id('main') and state='active'),1,
  'the replacement has exactly one active private grant');
select is((select expires_at-issued_at from private.v2_step_up_grants where review_id=project_s_step_up_approval_test.review_id('main')),
  interval '5 minutes','ordinary replacement reaches the supported five-minute upper boundary exactly');
select ok((select p.state='pending' and p.provider='principal_step_up' and p.provider_version=1
  and p.expires_at=g.expires_at and p.expires_at>p.created_at and p.expires_at<=p.created_at+interval '5 minutes'
  and p.summary->>'startAt'=s.value#>>'{exactSummary,startAt}' and p.summary->>'endAt'=s.value#>>'{exactSummary,endAt}'
  from private.v2_step_up_preparations p join private.v2_step_up_grants g using(grant_id)
  cross join project_s_step_up_approval_test.state s
  where s.key='review-main' and p.preparation_id=(select (value->>'preparationId')::uuid from project_s_step_up_approval_test.state where key='approved-main')),
  'a fresh exact preparation binds the one-use provider and bounded grant deadline');
select ok((select state='invalidated' and summary is null from private.v2_delegated_preparations
  where preparation_id=(select (value#>>'{data,preparationId}')::uuid from project_s_step_up_approval_test.state where key='old-preparation')),
  'approval invalidates the original uncommitted preparation');
select ok((select state='invalidated' and summary is null from private.v2_step_up_requests
  where review_id=(select (value#>>'{stepUp,reviewId}')::uuid from project_s_step_up_approval_test.state where key='sibling')),
  'approval invalidates a sibling pending review of the same original budget');
insert into project_s_step_up_approval_test.state values ('before-retry',pg_temp.approval_snapshot());
select is(project_s_step_up_approval_test.approve('main'),(select value from project_s_step_up_approval_test.state where key='approved-main'),
  'an exact retry returns the original preparation and expiry despite new proposed identities');
select is(pg_temp.approval_snapshot(),(select value from project_s_step_up_approval_test.state where key='before-retry'),
  'exact approval retry changes no grant, preparation, mandate, event or sequence');
select throws_ok($$select project_s_step_up_approval_test.approve('main',p_digest=>repeat('f',64))$$,
  'PT409','VERSION_CONFLICT','old revision with a different digest is not an eligible retry');

insert into project_s_step_up_approval_test.state values ('pending-revoked',public.project_s_revoke_step_up_v2(
  project_s_step_up_approval_test.principal(),project_s_step_up_approval_test.review_id('pending-revoke'),1));
select is((select value->>'revision' from project_s_step_up_approval_test.state where key='pending-revoked'),'2','pending revoke advances review revision once');
select throws_ok($$update private.v2_step_up_requests set revoked_from_revision=null
  where review_id=project_s_step_up_approval_test.review_id('pending-revoke')$$,'23514',null,
  'revoked request constraints refuse a missing predecessor revision');
select is(public.project_s_revoke_step_up_v2(project_s_step_up_approval_test.principal(),project_s_step_up_approval_test.review_id('pending-revoke'),1),
  (select value from project_s_step_up_approval_test.state where key='pending-revoked'),'exact pending revoke retry retains original time and result');
select throws_ok($$select project_s_step_up_approval_test.approve('pending-revoke')$$,'PT409','VERSION_CONFLICT','revoked pending review cannot be approved');
insert into project_s_step_up_approval_test.state values ('approved-revoke',project_s_step_up_approval_test.approve('approved-revoke'));
update private.v2_step_up_grants set expires_at=clock_timestamp()-interval '1 millisecond'
where review_id=project_s_step_up_approval_test.review_id('approved-revoke');
select throws_ok($$select project_s_step_up_approval_test.approve('approved-revoke')$$,'PT409','VERSION_CONFLICT','expired replacement cannot be revived by exact approval retry');
select is((select state from private.v2_mandates where mandate_id=(select (value->>'mandateId')::uuid
  from project_s_step_up_approval_test.state where key='mandate-approved-revoke')),'revoked','replacement expiry does not restore the original budget');
select throws_ok($$select public.project_s_revoke_step_up_v2(project_s_step_up_approval_test.principal(),
  project_s_step_up_approval_test.review_id('approved-revoke'),1)$$,'PT409','VERSION_CONFLICT','approved review revoke requires its current state revision');
insert into project_s_step_up_approval_test.state values ('revoked-approved',public.project_s_revoke_step_up_v2(
  project_s_step_up_approval_test.principal(),project_s_step_up_approval_test.review_id('approved-revoke'),2));
select is((select value->>'revision' from project_s_step_up_approval_test.state where key='revoked-approved'),'3','approved revoke advances to revision three');
select ok((select g.state='revoked' and p.state='invalidated' and p.summary is null
  from private.v2_step_up_grants g join private.v2_step_up_preparations p using(grant_id)
  where g.review_id=project_s_step_up_approval_test.review_id('approved-revoke')),'explicit revoke closes the linked grant and preparation');
select throws_ok($$update private.v2_step_up_grants set revoked_at=null
  where review_id=project_s_step_up_approval_test.review_id('approved-revoke')$$,'23514',null,
  'revoked grant constraints refuse a missing revocation time');
select is(public.project_s_revoke_step_up_v2(project_s_step_up_approval_test.principal(),project_s_step_up_approval_test.review_id('approved-revoke'),2),
  (select value from project_s_step_up_approval_test.state where key='revoked-approved'),'exact approved revoke retry preserves result');
select throws_ok($$select project_s_step_up_approval_test.approve('approved-revoke')$$,'PT409','VERSION_CONFLICT','revoked approval never revives its original permission');
insert into project_s_step_up_approval_test.state values ('approved-original-revoke',project_s_step_up_approval_test.approve('original-revoke'));
select lives_ok($$select public.project_s_revoke_mandate_v2(project_s_step_up_approval_test.principal(),
  (select (value->>'mandateId')::uuid from project_s_step_up_approval_test.state where key='mandate-original-revoke'),1)$$,
  'revoking an already replaced original still reaches its live replacement');
select ok((select g.state='revoked' and p.state='invalidated' and p.summary is null
  from private.v2_step_up_grants g join private.v2_step_up_preparations p using(grant_id)
  where g.review_id=project_s_step_up_approval_test.review_id('original-revoke')),'original mandate revocation closes the unused replacement atomically');
select throws_ok($$select project_s_step_up_approval_test.approve('original-revoke')$$,'PT409','VERSION_CONFLICT','revoked original and replacement cannot be resurrected by retry');

insert into project_s_step_up_approval_test.state values ('approved-delete',project_s_step_up_approval_test.approve('delete'));
select public.project_s_delete_booker_profile_v2(project_s_step_up_approval_test.principal(),'c8200000-0000-4000-8000-000000000002',1);
select ok((select g.state in ('revoked','invalidated') and p.state='invalidated' and p.summary is null
  from private.v2_step_up_grants g join private.v2_step_up_preparations p using(grant_id)
  where g.review_id=project_s_step_up_approval_test.review_id('delete')),'profile deletion invalidates the replacement and removes its summary');
select ok((select summary is null from private.v2_step_up_requests where review_id=project_s_step_up_approval_test.review_id('delete')),
  'profile deletion removes the approved review summary copy');
select throws_ok($$select project_s_step_up_approval_test.approve('delete')$$,'PT409','VERSION_CONFLICT','deleted profile denies approval replay');
select public.project_s_revoke_actor_v2(project_s_step_up_approval_test.principal(),'c8300000-0000-4000-8000-000000000002',1);
select throws_ok($$select project_s_step_up_approval_test.approve('credential')$$,'PT409','VERSION_CONFLICT','revoked supporting credential prevents approval');

-- Bounded expiry must use the earliest still-live supporting permission.
update private.v2_mandates set expires_at=clock_timestamp()+interval '2 minutes'
where mandate_id=(select (value->>'mandateId')::uuid from project_s_step_up_approval_test.state where key='mandate-bound');
insert into project_s_step_up_approval_test.state values ('approved-bound',project_s_step_up_approval_test.approve('bound'));
select is((select (value->>'expiresAt')::timestamptz from project_s_step_up_approval_test.state where key='approved-bound'),
  (select expires_at from private.v2_mandates where mandate_id=(select (value->>'mandateId')::uuid
    from project_s_step_up_approval_test.state where key='mandate-bound')),'grant deadline cannot extend the original permission');

-- Forced authoritative audit failure must roll back every linked state change.
create function project_s_step_up_approval_test.reject_audit() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.instance_id='c8000000-0000-4000-8000-000000000001' and new.action='step_up_approved' then
    raise exception sqlstate 'P0001' using message='synthetic approval audit failure';
  end if;
  return new;
end;
$$;
create trigger approval_reject_audit before insert on private.v2_authority_events
  for each row execute function project_s_step_up_approval_test.reject_audit();
insert into project_s_step_up_approval_test.state values ('before-audit-failure',pg_temp.approval_snapshot());
select throws_ok($$select project_s_step_up_approval_test.approve('audit')$$,'P0001','synthetic approval audit failure','authoritative audit failure aborts approval');
select is(pg_temp.approval_snapshot(),(select value from project_s_step_up_approval_test.state where key='before-audit-failure'),
  'audit failure preserves the original active budget and creates no grant, preparation or event');
drop trigger approval_reject_audit on private.v2_authority_events;

select is(dblink_connect('approval_holder',format('host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','independent approval holder connects');
select is(dblink_connect('approval_reader',format('host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','independent approval reader connects');
create temporary table approval_reader_pid(pid integer);
insert into approval_reader_pid select pid from dblink('approval_reader','select pg_backend_pid()') reader(pid integer);

select is(dblink_exec('approval_holder','begin'),'BEGIN','parallel approval transaction begins');
insert into project_s_step_up_approval_test.state select 'parallel-first',value::jsonb from dblink('approval_holder',
  $$select project_s_step_up_approval_test.approve('race')::text$$) result(value text);
select is(dblink_send_query('approval_reader',$$select project_s_step_up_approval_test.attempt('race')::text$$),1,'second exact approval starts before first commit');
select ok(pg_temp.approval_waits((select pid from approval_reader_pid)),'second approval is observed waiting for the real principal fence');
select is(dblink_exec('approval_holder','commit'),'COMMIT','first approval commits its single replacement');
select is(value::jsonb,(select value from project_s_step_up_approval_test.state where key='parallel-first'),
  'serialized exact concurrent approval returns the first preparation and deadline')
from dblink_get_result('approval_reader') result(value text);
select * from dblink_get_result('approval_reader') result(value text);
select is((select count(*)::integer from private.v2_step_up_grants where review_id=project_s_step_up_approval_test.review_id('race')),1,
  'parallel exact approval creates exactly one replacement grant');

select is(dblink_exec('approval_holder','begin'),'BEGIN','permission-expiry holder begins');
select is(dblink_exec('approval_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals where principal_id='c8100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','holder owns the actual issuer fence');
insert into project_s_step_up_approval_test.state values ('deadline',to_jsonb(clock_timestamp()+interval '400 milliseconds'));
update private.v2_mandates set expires_at=(select (value#>>'{}')::timestamptz from project_s_step_up_approval_test.state where key='deadline')
where mandate_id=(select (value->>'mandateId')::uuid from project_s_step_up_approval_test.state where key='mandate-wait-expiry');
select is(dblink_send_query('approval_reader',$$select project_s_step_up_approval_test.attempt('wait-expiry')::text$$),1,'approval starts before original permission expires');
select ok(pg_temp.approval_waits((select pid from approval_reader_pid)),'approval is observed waiting during natural permission expiry');
select ok(clock_timestamp()<(select (value#>>'{}')::timestamptz from project_s_step_up_approval_test.state where key='deadline'),
  'permission was live when approval reached its fence wait');
select pg_temp.approval_wait_past_deadline();
select is(dblink_exec('approval_holder','commit'),'COMMIT','fence releases after permission expiry');
select is(value::jsonb,'{"code":"PT409","message":"VERSION_CONFLICT"}'::jsonb,'post-wait expired permission cannot be replaced')
from dblink_get_result('approval_reader') result(value text);
select * from dblink_get_result('approval_reader') result(value text);

select is(dblink_exec('approval_holder','begin'),'BEGIN','original revoke holder begins');
select is(dblink_exec('approval_holder',$revoke$do $$begin
  perform public.project_s_revoke_mandate_v2(project_s_step_up_approval_test.principal(),
    (select (value->>'mandateId')::uuid from project_s_step_up_approval_test.state where key='mandate-wait-revoke'),1);
end;$$$revoke$),'DO','uncommitted real revoke owns the issuer fence');
select is(dblink_send_query('approval_reader',$$select project_s_step_up_approval_test.attempt('wait-revoke')::text$$),1,'approval contends with original mandate revocation');
select ok(pg_temp.approval_waits((select pid from approval_reader_pid)),'approval is observed waiting for revoke serialization');
select is(dblink_exec('approval_holder','commit'),'COMMIT','original revoke commits before approval resumes');
select is(value::jsonb,'{"code":"PT409","message":"VERSION_CONFLICT"}'::jsonb,'a subsequently serialized approval cannot replace revoked permission')
from dblink_get_result('approval_reader') result(value text);
select * from dblink_get_result('approval_reader') result(value text);

select is(dblink_exec('approval_holder','begin'),'BEGIN','profile deletion holder begins');
select is(dblink_exec('approval_holder',$delete$do $$begin
  perform public.project_s_delete_booker_profile_v2(project_s_step_up_approval_test.principal(),'c8200000-0000-4000-8000-000000000003',1);
end;$$$delete$),'DO','uncommitted real profile deletion owns the issuer fence');
select is(dblink_send_query('approval_reader',$$select project_s_step_up_approval_test.attempt('wait-delete')::text$$),1,'approval contends with dependent profile deletion');
select ok(pg_temp.approval_waits((select pid from approval_reader_pid)),'approval is observed waiting for profile deletion');
select is(dblink_exec('approval_holder','commit'),'COMMIT','profile and dependent invalidation commit together');
select is(value::jsonb,'{"code":"PT409","message":"VERSION_CONFLICT"}'::jsonb,'serialized deletion prevents stale-profile approval')
from dblink_get_result('approval_reader') result(value text);
select * from dblink_get_result('approval_reader') result(value text);

-- An audit/index/FK boundary may wait after admission has already succeeded.
create function project_s_step_up_approval_test.audit_gate() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.instance_id='c8000000-0000-4000-8000-000000000001' and new.action='step_up_approved' then
    perform pg_advisory_xact_lock(hashtextextended('project-s:approval:audit-wait-test',0));
  end if;
  return new;
end;
$$;
create trigger approval_audit_gate before insert on private.v2_authority_events
  for each row execute function project_s_step_up_approval_test.audit_gate();
select is(dblink_exec('approval_holder','begin'),'BEGIN','late-audit holder begins');
select is(dblink_exec('approval_holder',$gate$do $$begin
  perform pg_advisory_xact_lock(hashtextextended('project-s:approval:audit-wait-test',0));
end;$$$gate$),'DO','holder owns the actual advisory gate reached by the audit insert');
update project_s_step_up_approval_test.state set value=to_jsonb(clock_timestamp()+interval '400 milliseconds') where key='deadline';
update private.v2_mandates set expires_at=(select (value#>>'{}')::timestamptz from project_s_step_up_approval_test.state where key='deadline')
where mandate_id=(select (value->>'mandateId')::uuid from project_s_step_up_approval_test.state where key='mandate-audit');
insert into project_s_step_up_approval_test.state values ('before-late-expiry',pg_temp.approval_snapshot());
select is(dblink_send_query('approval_reader',$$select project_s_step_up_approval_test.attempt('audit')::text$$),1,
  'new approval starts with live permission and reaches the late audit insert');
select ok(pg_temp.approval_waits((select pid from approval_reader_pid)),'approval is observed waiting at the late audit boundary');
select ok(exists(select 1 from pg_locks where pid=(select pid from approval_reader_pid) and locktype='advisory' and not granted),
  'the observed late wait is the held advisory audit gate');
select ok(clock_timestamp()<(select (value#>>'{}')::timestamptz from project_s_step_up_approval_test.state where key='deadline'),
  'original permission was live when approval reached its late audit wait');
select pg_temp.approval_wait_past_deadline();
select is(dblink_exec('approval_holder','commit'),'COMMIT','audit gate releases after original permission expiry');
select is(value::jsonb,'{"code":"PT409","message":"VERSION_CONFLICT"}'::jsonb,
  'late post-write expiry refuses instead of returning a replacement')
from dblink_get_result('approval_reader') result(value text);
select * from dblink_get_result('approval_reader') result(value text);
drop trigger approval_audit_gate on private.v2_authority_events;
select is(pg_temp.approval_snapshot(),(select value from project_s_step_up_approval_test.state where key='before-late-expiry'),
  'late expiry rolls back source revocation, request state, grant, preparation, event and sequence');

-- A legacy owner fence is acquired without waiting while new rows are held.
select is(dblink_exec('approval_holder','begin'),'BEGIN','legacy owner holder begins');
select is(dblink_exec('approval_holder',$lock$do $$begin
  perform pg_advisory_xact_lock(hashtextextended('c8100000-0000-4000-8000-000000000003',0));
end;$$$lock$),'DO','holder owns the existing host scheduling fence');
select is(project_s_step_up_approval_test.attempt('rejected'),'{"code":"PT503","message":"AUTHORITY_BUSY"}'::jsonb,
  'contended legacy owner returns busy instead of adding a blocking old/new lock edge');
select is(dblink_exec('approval_holder','commit'),'COMMIT','legacy owner holder releases');
select is(dblink_disconnect('approval_reader'),'OK','independent approval reader disconnects');
select is(dblink_disconnect('approval_holder'),'OK','independent approval holder disconnects');

-- An actual confirmed booking changes availability without changing the host definition.
insert into public.bookings(id,user_id,meeting_type_id,start_time,duration_minutes,booker_name,booker_email,
  guest_timezone,meeting_type_title,host_timezone,idempotency_key,request_fingerprint)
select 'c8900000-0000-4000-8000-000000000001','c8100000-0000-4000-8000-000000000003',
  'c8700000-0000-4000-8000-000000000001',((value#>>'{}')::date::timestamp at time zone 'UTC')+interval '9 hours 45 minutes',30,
  'Synthetic Existing Guest','existing-approval@example.invalid','UTC','Synthetic approval meeting','UTC',
  extensions.gen_random_uuid(),decode(repeat('d',64),'hex')
from project_s_step_up_approval_test.state where key='day';
select throws_ok($$select project_s_step_up_approval_test.approve('conflict')$$,'PT409','SLOT_UNAVAILABLE','approval rechecks actual current booking conflicts');
delete from public.bookings where id='c8900000-0000-4000-8000-000000000001';
update public.meeting_types set title='Changed live approval meeting' where id='c8700000-0000-4000-8000-000000000001';
select throws_ok($$select project_s_step_up_approval_test.approve('host-drift')$$,'PT409','VERSION_CONFLICT','changed current host/type facts refuse the recorded approval');

-- Converting a review must not create capacity outside the existing rolling
-- creation bound. A live five-minute grant came from a then-live five-minute
-- request, so its original request remains in the ten-minute creation window.
do $$
declare policy jsonb; issuer_review jsonb; mandate jsonb; i integer; day_start timestamptz;
  permission_start timestamptz:=clock_timestamp()+interval '5 seconds';
begin
  select (value#>>'{}')::date::timestamp at time zone 'UTC' into day_start
    from project_s_step_up_approval_test.state where key='day';
  policy:=jsonb_build_object('actorId',project_s_step_up_approval_test.actor(3)->>'actorId',
    'profileId','c8200000-0000-4000-8000-000000000001','profileRevision',1,
    'username','step-up-approval-host','meetingTypeId','c8700000-0000-4000-8000-000000000001',
    'meetingWindowStart',private.v2_mandate_instant(day_start+interval '10 hours'),
    'meetingWindowEnd',private.v2_mandate_instant(day_start+interval '14 hours'),
    'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(permission_start),
    'expiresAt',private.v2_mandate_instant(permission_start+interval '1 hour'));
  for i in 1..20 loop
    issuer_review:=public.project_s_create_mandate_review_v2(project_s_step_up_approval_test.principal(),extensions.gen_random_uuid(),policy);
    mandate:=public.project_s_approve_mandate_v2(project_s_step_up_approval_test.principal(),
      (issuer_review->>'reviewId')::uuid,extensions.gen_random_uuid(),1,issuer_review->>'summaryDigest');
    insert into project_s_step_up_approval_test.state values ('mandate-cap-'||i,mandate);
  end loop;
  perform pg_sleep(greatest(0,extract(epoch from (permission_start+interval '20 milliseconds'-clock_timestamp())))::double precision);
  for i in 1..20 loop
    select value into mandate from project_s_step_up_approval_test.state where key='mandate-cap-'||i;
    insert into project_s_step_up_approval_test.state values ('request-cap-'||i,
      public.project_s_prepare_delegated_booking_v2(project_s_step_up_approval_test.actor(3),
        extensions.gen_random_uuid(),extensions.gen_random_uuid(),jsonb_build_object('mandateId',mandate->>'mandateId',
          'username','step-up-approval-host','meetingTypeId','c8700000-0000-4000-8000-000000000001',
          'startAt',private.v2_mandate_instant(day_start+interval '9 hours 45 minutes'))));
  end loop;
end;
$$;
select is((select count(*)::integer from private.v2_step_up_requests where
  actor_id='c8300000-0000-4000-8000-000000000003' and created_at>clock_timestamp()-interval '10 minutes'),20,
  'separate actor reaches the genuine twenty-request rolling creation boundary');
insert into project_s_step_up_approval_test.state values ('approved-cap',project_s_step_up_approval_test.approve('cap-1'));
select is((select count(*)::integer from private.v2_step_up_requests where
  actor_id='c8300000-0000-4000-8000-000000000003' and created_at>clock_timestamp()-interval '10 minutes'),20,
  'approval preserves the source request in the rolling creation count');
select ok((select g.issued_at<r.expires_at and r.expires_at<=r.created_at+interval '5 minutes'
  and g.expires_at<=g.issued_at+interval '5 minutes' and g.expires_at<=r.created_at+interval '10 minutes'
  from private.v2_step_up_grants g join private.v2_step_up_requests r on r.review_id=g.review_id
  where g.review_id=project_s_step_up_approval_test.review_id('cap-1')),
  'every live replacement remains bounded by the source request creation window');
select throws_ok($$select public.project_s_prepare_delegated_booking_v2(project_s_step_up_approval_test.actor(3),
  extensions.gen_random_uuid(),extensions.gen_random_uuid(),jsonb_build_object('mandateId',
    (select value->>'mandateId' from project_s_step_up_approval_test.state where key='mandate-cap-2'),
    'username','step-up-approval-host','meetingTypeId','c8700000-0000-4000-8000-000000000001',
    'startAt',private.v2_mandate_instant(((select (value#>>'{}')::date from project_s_step_up_approval_test.state where key='day')::timestamp
      at time zone 'UTC')+interval '10 hours')))$$,'PT429','RATE_LIMITED',
  'converting one pending review still refuses a twenty-first normal preparation');
insert into project_s_step_up_approval_test.state values ('before-cap-retry',pg_temp.approval_snapshot());
select is(project_s_step_up_approval_test.approve('cap-1'),(select value from project_s_step_up_approval_test.state where key='approved-cap'),
  'exact approval retry succeeds at capacity with the same original expiry');
select is(pg_temp.approval_snapshot(),(select value from project_s_step_up_approval_test.state where key='before-cap-retry'),
  'capacity retry creates no extra grant, preparation, request or event');

delete from auth.users where id='c8100000-0000-4000-8000-000000000001';
select throws_ok($$select project_s_step_up_approval_test.approve('rejected')$$,'PT401','AUTHENTICATION_REQUIRED','deleted Auth owner cannot approve through a retained context');
select is((select count(*)::integer from public.bookings where user_id='c8100000-0000-4000-8000-000000000003'),0,
  'all approval, refusal, revoke and retry paths create no actual booking');
select ok(not exists(select 1 from private.v2_step_up_grants g where instance_id='c8000000-0000-4000-8000-000000000001'
  and (to_jsonb(g)::text like '%private-approval@example.invalid%' or to_jsonb(g)::text like '%Synthetic Private Approval Booker%')),
  'replacement grants retain no copied reviewed booker name/email');
select ok(not exists(select 1 from private.v2_step_up_preparations p where instance_id='c8000000-0000-4000-8000-000000000001'
  and (to_jsonb(p)::text like '%private-approval@example.invalid%' or to_jsonb(p)::text like '%Synthetic Private Approval Booker%')),
  'replacement preparations retain no copied reviewed booker name/email');

delete from private.v2_step_up_preparations where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_step_up_grants where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_delegated_preparations where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_step_up_requests where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_mandates where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_mandate_reviews where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_actor_credentials where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_booker_profiles where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where instance_id='c8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='c8000000-0000-4000-8000-000000000001';
delete from auth.users where id in ('c8100000-0000-4000-8000-000000000002','c8100000-0000-4000-8000-000000000003');
drop schema project_s_step_up_approval_test cascade;
select * from finish();
