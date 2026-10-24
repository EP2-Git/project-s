begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

create function pg_temp.actor_context(
  p_principal uuid default 'c1100000-0000-4000-8000-000000000001'
) returns jsonb language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-c1-test',
    'principalId',p_principal,'subjectId',p_principal,
    'instanceId','c1000000-0000-4000-8000-000000000001','epoch',1,
    'verifiedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'transport','http');
$$;
create function pg_temp.register_actor(
  p_actor uuid default 'c2000000-0000-4000-8000-000000000001',
  p_credential uuid default 'c3000000-0000-4000-8000-000000000001',
  p_context jsonb default null,
  p_expiry timestamptz default null
) returns jsonb language sql set search_path = pg_catalog as $$
  select public.project_s_register_actor_v2(
    coalesce(p_context,pg_temp.actor_context()),p_actor,p_credential,
    decode(repeat('a',64),'hex'),'Synthetic agent',coalesce(p_expiry,clock_timestamp()+interval '1 day'));
$$;

select is((select count(*)::integer from private.v2_authority_instance),0,
  'migration does not configure or enable an instance');
select throws_ok($$select pg_temp.register_actor()$$,'PT401','AUTHENTICATION_REQUIRED',
  'unconfigured instance cannot issue a credential');

insert into private.v2_authority_instance(instance_id,epoch,audience) values
 ('c1000000-0000-4000-8000-000000000001',1,'http://127.0.0.1:54321');
select lives_ok($$update private.v2_authority_instance set audience='https://[::1]:8443'$$,
 'HTTPS IPv6 origin shape is supported; gateway still verifies canonical URL');
update private.v2_authority_instance set audience='http://127.0.0.1:54321';

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
 'private.v2_authority_instance'::regclass,'private.v2_authority_principals'::regclass,
 'private.v2_authority_events'::regclass,'private.v2_actor_credentials'::regclass)),
 'all new private tables enable RLS with no client policies');
select is((select count(*)::integer from pg_policy where polrelid in (
 'private.v2_authority_instance'::regclass,'private.v2_authority_principals'::regclass,
 'private.v2_authority_events'::regclass,'private.v2_actor_credentials'::regclass)),0,
 'no policy opens authority state');
select ok(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE'),
 role_name||' has no direct table access to '||table_name)
from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values ('private.v2_authority_instance'),('private.v2_authority_principals'),
 ('private.v2_authority_events'),('private.v2_actor_credentials')) tables(table_name);
select ok(not has_function_privilege(role_name,fn,'EXECUTE'),role_name||' cannot directly call '||fn)
from (values ('anon'),('authenticated')) roles(role_name)
cross join (values
 ('public.project_s_register_actor_v2(jsonb,uuid,uuid,bytea,text,timestamp with time zone)'),
 ('public.project_s_get_actor_credential_v2(uuid,uuid,bigint)'),
 ('public.project_s_revoke_actor_v2(jsonb,uuid,bigint)')) functions(fn);
select ok(has_function_privilege('service_role',fn,'EXECUTE'),'server can call '||fn)
from (values
 ('public.project_s_register_actor_v2(jsonb,uuid,uuid,bytea,text,timestamp with time zone)'),
 ('public.project_s_get_actor_credential_v2(uuid,uuid,bigint)'),
 ('public.project_s_revoke_actor_v2(jsonb,uuid,bigint)')) functions(fn);
set local role anon;
select throws_ok($$select public.project_s_get_actor_credential_v2(
 'c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',1)$$,
 '42501',null,'anonymous direct RPC is denied even with known references');
reset role;
set local role authenticated;
select throws_ok($$select public.project_s_revoke_actor_v2('{}',
 'c2000000-0000-4000-8000-000000000001',1)$$,'42501',null,'authenticated direct RPC denied');
reset role;

select is((select count(*)::integer from pg_constraint
 where connamespace = 'private'::regnamespace and contype='f'
 and conrelid in ('private.v2_actor_credentials'::regclass,
 'private.v2_authority_principals'::regclass,'private.v2_authority_events'::regclass)
 and confrelid not in ('private.v2_actor_credentials'::regclass,
 'private.v2_authority_principals'::regclass,'private.v2_authority_events'::regclass)),0,
 'new authority rows have no legacy FK or deletion cascade');

-- Use a dedicated account with no legacy booking references. Account deletion
-- must not remove or relax seeded bookings or their existing RESTRICT boundary.
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
 values('00000000-0000-0000-0000-000000000000','c1100000-0000-4000-8000-000000000001',
 'authenticated','authenticated','c1-first-owner@example.invalid',clock_timestamp(),
 '{"provider":"email","providers":["email"]}',
 '{"username":"c1-first-owner","full_name":"C1 synthetic first owner","timezone":"UTC"}',
 clock_timestamp(),clock_timestamp(),'','','','',false);

select throws_ok($$select pg_temp.register_actor(p_context=>pg_temp.actor_context()||'{"actorId":"c2000000-0000-4000-8000-000000000001"}')$$,
 'PT401','AUTHENTICATION_REQUIRED','actor-context override refused');
select throws_ok($$select pg_temp.register_actor(p_context=>pg_temp.actor_context()||'{"subjectId":"c1100000-0000-4000-8000-000000000002"}')$$,
 'PT401','AUTHENTICATION_REQUIRED','another subject refused');
select throws_ok($$select pg_temp.register_actor(p_context=>pg_temp.actor_context()||'{"transport":null}')$$,
 'PT401','AUTHENTICATION_REQUIRED','null transport refused');
select throws_ok($$select pg_temp.register_actor(p_context=>pg_temp.actor_context()||'{"epoch":2}')$$,
 'PT401','AUTHENTICATION_REQUIRED','stale epoch refused');
select throws_ok($$select pg_temp.register_actor(p_context=>pg_temp.actor_context()||'{"instanceId":"c1000000-0000-4000-8000-000000000002"}')$$,
 'PT401','AUTHENTICATION_REQUIRED','wrong instance refused');
select throws_ok($$select pg_temp.register_actor(p_context=>pg_temp.actor_context('c1100000-0000-4000-8000-000000000002'))$$,
 'PT401','AUTHENTICATION_REQUIRED','missing live Auth account refused');
select is((select count(*)::integer from private.v2_authority_principals),0,
 'failed issuance rolls back initial principal creation');
select throws_ok($$select pg_temp.register_actor(p_expiry=>clock_timestamp()+interval '7 days 1 minute')$$,
 'PT400','VALIDATION_ERROR','expiry beyond seven-day ceiling refused');
select throws_ok($$select pg_temp.register_actor(p_expiry=>clock_timestamp()-interval '1 second')$$,
 'PT400','VALIDATION_ERROR','expired issuance refused');
select throws_ok($$select pg_temp.register_actor(p_expiry=>'infinity')$$,
 'PT400','VALIDATION_ERROR','unbounded credential lifetime refused');

create temporary table c1_results(key text primary key,value jsonb) on commit drop;
insert into c1_results values ('issued',pg_temp.register_actor());
select is((select value->>'revision' from c1_results where key='issued'),'1','first issuance revision is one');
select ok((select (value->>'expiresAt')::timestamptz > (value->>'issuedAt')::timestamptz
 and (value->>'expiresAt')::timestamptz <= (value->>'issuedAt')::timestamptz+interval '7 days'
 from c1_results where key='issued'),'issuance lifetime is finite and at most seven days');
select is((select count(*)::integer from jsonb_object_keys((select value from c1_results where key='issued'))),8,
 'issuance exposes only internal metadata, no recoverable raw credential');
select is((select encode(verifier,'hex') from private.v2_actor_credentials
 where credential_id='c3000000-0000-4000-8000-000000000001'),repeat('a',64),'only verifier bytes stored');
select is(public.project_s_get_actor_credential_v2('c3000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000001',1)->>'principalId','c1100000-0000-4000-8000-000000000001',
 'active lookup returns its bound principal to trusted verifier');
select is(public.project_s_get_actor_credential_v2('c3000000-0000-4000-8000-000000000002',
 'c1000000-0000-4000-8000-000000000001',1),null::jsonb,'unknown credential lookup is uniform null');
select is(public.project_s_get_actor_credential_v2('c3000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000002',1),null::jsonb,'wrong-instance lookup is uniform null');
select is(public.project_s_get_actor_credential_v2('c3000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000001',2),null::jsonb,'wrong-epoch lookup is uniform null');
select is((select count(*)::integer from private.v2_authority_principals),1,'lookup never bootstraps a principal');

update private.v2_authority_principals set disabled=true;
select is(public.project_s_get_actor_credential_v2('c3000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000001',1),null::jsonb,'disabled principal denies actor lookup');
select throws_ok($$select pg_temp.register_actor('c2000000-0000-4000-8000-000000000002',
 'c3000000-0000-4000-8000-000000000002')$$,'PT401','AUTHENTICATION_REQUIRED','disabled principal cannot issue');
update private.v2_authority_principals set disabled=false;
update auth.users set is_anonymous=true where id='c1100000-0000-4000-8000-000000000001';
select is(public.project_s_get_actor_credential_v2('c3000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000001',1),null::jsonb,'anonymous account denies actor lookup');
select throws_ok($$select pg_temp.register_actor('c2000000-0000-4000-8000-000000000002',
 'c3000000-0000-4000-8000-000000000002')$$,'PT401','AUTHENTICATION_REQUIRED','anonymous account cannot issue');
update auth.users set is_anonymous=false where id='c1100000-0000-4000-8000-000000000001';

-- Simulate an independently deleted account without a destructive cascade into
-- the authority domain. The surrounding transaction removes all test fixtures.
select ok(not exists(select 1 from public.bookings
 where user_id='c1100000-0000-4000-8000-000000000001'),
 'deletion proof account has no legacy booking dependencies');
delete from auth.users where id='c1100000-0000-4000-8000-000000000001';
select is(public.project_s_get_actor_credential_v2('c3000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000001',1),null::jsonb,'deleted account denies retained credential');
select is((select count(*)::integer from private.v2_actor_credentials),1,'Auth deletion retains authority tombstone');
select ok(exists(select 1 from auth.users where id='10000000-0000-4000-8000-000000000001'),
 'dedicated account deletion preserves the seeded host');
-- Continue state tests using a separate fully synthetic account.
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
 values('00000000-0000-0000-0000-000000000000','c1100000-0000-4000-8000-000000000002',
 'authenticated','authenticated','c1-owner@example.invalid',clock_timestamp(),
 '{"provider":"email","providers":["email"]}',
 '{"username":"c1-owner","full_name":"C1 synthetic owner","timezone":"UTC"}',
 clock_timestamp(),clock_timestamp(),'','','','',false);
insert into c1_results values ('second',pg_temp.register_actor(
 'c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000002',
 pg_temp.actor_context('c1100000-0000-4000-8000-000000000002')));
select throws_ok($$select public.project_s_revoke_actor_v2(
 pg_temp.actor_context('c1100000-0000-4000-8000-000000000002'),
 'c2000000-0000-4000-8000-000000000001',1)$$,'PT403','FORBIDDEN','another principal cannot revoke credential');
select throws_ok($$select public.project_s_revoke_actor_v2(
 pg_temp.actor_context('c1100000-0000-4000-8000-000000000002'),
 'c2000000-0000-4000-8000-000000000002',2)$$,'PT409','VERSION_CONFLICT','stale first-revoke revision refuses');

create function pg_temp.fail_c1_audit() returns trigger language plpgsql as $$
begin raise exception sqlstate 'P0001' using message='synthetic audit failure'; end;
$$;
create trigger c1_audit_failure before insert on private.v2_authority_events
 for each row execute function pg_temp.fail_c1_audit();
select throws_ok($$select public.project_s_revoke_actor_v2(
 pg_temp.actor_context('c1100000-0000-4000-8000-000000000002'),
 'c2000000-0000-4000-8000-000000000002',1)$$,'P0001','synthetic audit failure','audit failure aborts revocation');
select is((select state from private.v2_actor_credentials where actor_id='c2000000-0000-4000-8000-000000000002'),
 'active','failed audit leaves credential active');
select is((select event_sequence::integer from private.v2_authority_principals
 where principal_id='c1100000-0000-4000-8000-000000000002'),1,'failed audit rolls principal sequence back');
select throws_ok($$select pg_temp.register_actor('c2000000-0000-4000-8000-000000000003',
 'c3000000-0000-4000-8000-000000000003',pg_temp.actor_context('c1100000-0000-4000-8000-000000000002'))$$,
 'P0001','synthetic audit failure','audit failure aborts issuance');
select is((select count(*)::integer from private.v2_actor_credentials),2,'failed registration leaves no credential');
drop trigger c1_audit_failure on private.v2_authority_events;

insert into c1_results values ('revoked',public.project_s_revoke_actor_v2(
 pg_temp.actor_context('c1100000-0000-4000-8000-000000000002'),'c2000000-0000-4000-8000-000000000002',1));
select is((select value->>'revision' from c1_results where key='revoked'),'2','revocation advances revision once');
select is(public.project_s_revoke_actor_v2(pg_temp.actor_context('c1100000-0000-4000-8000-000000000002'),
 'c2000000-0000-4000-8000-000000000002',1),(select value from c1_results where key='revoked'),
 'exact revoke retry returns original acknowledgement');
select is((select event_sequence::integer from private.v2_authority_principals
 where principal_id='c1100000-0000-4000-8000-000000000002'),2,'repeat revoke appends no second event');
select is(public.project_s_get_actor_credential_v2('c3000000-0000-4000-8000-000000000002',
 'c1000000-0000-4000-8000-000000000001',1),null::jsonb,'revoked credential denies reads');
select throws_ok($$select pg_temp.register_actor('c2000000-0000-4000-8000-000000000002',
 'c3000000-0000-4000-8000-000000000003',pg_temp.actor_context('c1100000-0000-4000-8000-000000000002'))$$,
 '23505',null,'replacement cannot rebind an old actor identity');

select is((select string_agg(attname,',' order by attnum) from pg_attribute
 where attrelid='private.v2_authority_events'::regclass and attnum>0 and not attisdropped),
 'instance_id,epoch,principal_id,sequence,action,occurred_at',
 'audit has only private partition, sequence, action and time; no secret, label, raw object ID or PII');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=pg_catalog',
 'lock_timeout=1s','statement_timeout=5s']) from pg_proc where oid in (
 'public.project_s_register_actor_v2(jsonb,uuid,uuid,bytea,text,timestamptz)'::regprocedure,
 'public.project_s_get_actor_credential_v2(uuid,uuid,bigint)'::regprocedure,
 'public.project_s_revoke_actor_v2(jsonb,uuid,bigint)'::regprocedure)),
 'RPCs have fixed search path and scoped limits without global settings');

select * from finish();
rollback;
