-- Play authorizes joining by membership; the Realtime server checks SELECT and
-- INSERT for the connection's topic. These rows are rolled back by test:sql.
INSERT INTO public.matches(id, code, mode, host_id, questions)
VALUES ('88888888-0000-4000-8000-000000000001','ROOMAA','classroom','88888888-0000-4000-8000-000000000002','[]');
INSERT INTO public.match_participants(match_id,user_id,display_name)
VALUES ('88888888-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000002','Host'),
       ('88888888-0000-4000-8000-000000000001','88888888-0000-4000-8000-000000000003','Player');
SELECT set_config('realtime.topic', 'match:ROOMAA', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','88888888-0000-4000-8000-000000000002',true);
INSERT INTO realtime.messages(topic,extension) VALUES ('match:ROOMAA','broadcast');
SELECT set_config('request.jwt.claim.sub','88888888-0000-4000-8000-000000000003',true);
DO $$ BEGIN
  ASSERT EXISTS (SELECT FROM realtime.messages WHERE topic = 'match:ROOMAA'), 'member receives room broadcasts';
  INSERT INTO realtime.messages(topic,extension) VALUES ('match:ROOMAA','broadcast');
  PERFORM set_config('realtime.topic', 'match:ROOMBB', true);
  ASSERT NOT EXISTS (SELECT FROM realtime.messages), 'another room is outside the subscription';
  PERFORM set_config('realtime.topic', 'match:ROOMAA', true);
  PERFORM set_config('request.jwt.claim.sub','88888888-0000-4000-8000-000000000004',true);
  ASSERT NOT EXISTS (SELECT FROM realtime.messages), 'new account has no room membership';
  BEGIN
    INSERT INTO realtime.messages(topic,extension) VALUES ('match:ROOMAA','broadcast');
    RAISE EXCEPTION 'membership is required to send a broadcast';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT FROM realtime.messages), 'signed-out roles do not receive room broadcasts';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon','devshark_private.match_broadcast_member(text)','EXECUTE'), 'signed-out role cannot execute the room helper';
END $$;
