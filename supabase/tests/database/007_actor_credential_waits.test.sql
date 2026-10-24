create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions, pg_catalog;
select no_plan();

-- Every persisted fixture is scoped to these synthetic IDs. Separate sessions
-- must observe committed fixture state to prove actual row-lock waits.
delete from private.v2_actor_credentials where principal_id='c1400000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where principal_id='c1400000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where principal_id='c1400000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='c1400000-0000-4000-8000-000000000002';
delete from auth.users where id='c1400000-0000-4000-8000-000000000001';
drop schema if exists project_s_c1_wait cascade;
create schema project_s_c1_wait;
create table project_s_c1_wait.state(key text primary key,value jsonb);
create function project_s_c1_wait.context() returns jsonb
language sql set search_path=pg_catalog as $$
 select jsonb_build_object('contractVersion',2,'requestId','c1-wait-request-0001',
 'principalId','c1400000-0000-4000-8000-000000000001',
 'subjectId','c1400000-0000-4000-8000-000000000001',
 'instanceId','c1400000-0000-4000-8000-000000000002','epoch',1,
 'verifiedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'transport','http');
$$;
create function pg_temp.wait_for_c1_lock(p_pid integer) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare v_deadline timestamptz := clock_timestamp()+interval '500 milliseconds';
begin
 loop
  if exists(select 1 from pg_locks where pid=p_pid and not granted) then return true; end if;
  exit when clock_timestamp()>=v_deadline;
  perform pg_sleep(0.005);
 end loop;
 return false;
end;
$$;

insert into private.v2_authority_instance(instance_id,epoch,audience) values
 ('c1400000-0000-4000-8000-000000000002',1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
 values('00000000-0000-0000-0000-000000000000','c1400000-0000-4000-8000-000000000001',
 'authenticated','authenticated','c1-wait@example.invalid',clock_timestamp(),
 '{"provider":"email","providers":["email"]}',
 '{"username":"c1-wait","full_name":"C1 synthetic wait owner","timezone":"UTC"}',
 clock_timestamp(),clock_timestamp(),'','','','',false);
insert into project_s_c1_wait.state values ('issued',public.project_s_register_actor_v2(
 project_s_c1_wait.context(),'c1400000-0000-4000-8000-000000000003',
 'c1400000-0000-4000-8000-000000000004',decode(repeat('b',64),'hex'),
 'Synthetic wait agent',clock_timestamp()+interval '1 hour'));

select is(dblink_connect('c1_holder',format(
 'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
 'OK','C1 fence holder connects');
select is(dblink_connect('c1_reader',format(
 'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
 'OK','C1 credential reader connects');
create temporary table c1_reader_pid(pid integer);
insert into c1_reader_pid select pid from dblink('c1_reader','select pg_backend_pid()') as p(pid integer);
select is(dblink_exec('c1_holder','begin'),'BEGIN','principal fence transaction begins');
select is(dblink_exec('c1_holder',$lock$do $$begin
 perform 1 from private.v2_authority_principals
 where principal_id='c1400000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','holder owns the principal fence');

insert into project_s_c1_wait.state values('deadline',to_jsonb(clock_timestamp()+interval '400 milliseconds'));
update private.v2_actor_credentials set expires_at=(select (value #>> '{}')::timestamptz
 from project_s_c1_wait.state where key='deadline')
 where credential_id='c1400000-0000-4000-8000-000000000004';
select is(dblink_send_query('c1_reader',$query$
 select public.project_s_get_actor_credential_v2('c1400000-0000-4000-8000-000000000004',
 'c1400000-0000-4000-8000-000000000002',1)::text$query$),1,'lookup starts before credential expiry');
select ok(pg_temp.wait_for_c1_lock((select pid from c1_reader_pid)),
 'credential lookup is observed waiting on the principal fence');
select ok(clock_timestamp() < (select (value #>> '{}')::timestamptz from project_s_c1_wait.state where key='deadline'),
 'lookup reached the fence before expiry');
select pg_sleep(greatest(0,extract(epoch from (
 (select (value #>> '{}')::timestamptz from project_s_c1_wait.state where key='deadline')
 +interval '30 milliseconds'-clock_timestamp()))::double precision);
select is(dblink_exec('c1_holder','commit'),'COMMIT','fence releases after expiry');
select is(value,null::text,'fresh post-wait time denies the expired credential')
 from dblink_get_result('c1_reader') as result(value text);
select * from dblink_get_result('c1_reader') as result(value text);
select is((select count(*)::integer from private.v2_authority_events
 where principal_id='c1400000-0000-4000-8000-000000000001'),1,'denied lookup changes no authority/audit state');

-- A second live actor proves revocation serialization, independent of expiry.
insert into project_s_c1_wait.state values ('second',public.project_s_register_actor_v2(
 project_s_c1_wait.context(),'c1400000-0000-4000-8000-000000000005',
 'c1400000-0000-4000-8000-000000000006',decode(repeat('c',64),'hex'),
 'Synthetic revoke agent',clock_timestamp()+interval '1 hour'));
select is(dblink_exec('c1_holder','begin'),'BEGIN','revocation transaction begins');
select is(dblink_exec('c1_holder',$revoke$do $$begin
 perform public.project_s_revoke_actor_v2(project_s_c1_wait.context(),
 'c1400000-0000-4000-8000-000000000005',1);
end;$$$revoke$),'DO','revocation owns the fence but has not yet acknowledged commit');
select is(dblink_send_query('c1_reader',$query$
 select public.project_s_get_actor_credential_v2('c1400000-0000-4000-8000-000000000006',
 'c1400000-0000-4000-8000-000000000002',1)::text$query$),1,'lookup contends with uncommitted revocation');
select ok(pg_temp.wait_for_c1_lock((select pid from c1_reader_pid)),
 'lookup waits for revocation serialization');
select is(dblink_exec('c1_holder','commit'),'COMMIT','revocation commits before acknowledgement');
select is(value,null::text,'subsequently serialized lookup cannot authenticate revoked credential')
 from dblink_get_result('c1_reader') as result(value text);
select * from dblink_get_result('c1_reader') as result(value text);
select is((select event_sequence::integer from private.v2_authority_principals
 where principal_id='c1400000-0000-4000-8000-000000000001'),3,
 'two registrations and one revoke have exactly three ordered events');
select is((select revoked_sequence::integer from private.v2_actor_credentials
 where actor_id='c1400000-0000-4000-8000-000000000005'),3,'revoked binding records its serialized event');

select is(dblink_disconnect('c1_reader'),'OK','reader disconnects');
select is(dblink_disconnect('c1_holder'),'OK','holder disconnects');
delete from private.v2_actor_credentials where principal_id='c1400000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where principal_id='c1400000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where principal_id='c1400000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='c1400000-0000-4000-8000-000000000002';
delete from auth.users where id='c1400000-0000-4000-8000-000000000001';
drop schema project_s_c1_wait cascade;
select * from finish();
