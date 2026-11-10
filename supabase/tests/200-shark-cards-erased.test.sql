-- Shark Cards (owner decision 12, 1 October 2026). A Shark Card is now a
-- saved question (public.flashcards), and the collectible card packs are
-- retired: nothing calls grant_daily_queue_cards any more, but the user_cards
-- table and its rows stay. Deleting an account still erases both, and only
-- that account's rows.

INSERT INTO auth.users (id) VALUES
  ('cccccccc-0000-4000-8000-000000000200'),
  ('cccccccc-0000-4000-8000-000000000201');

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_gone CONSTANT TEXT := 'cccccccc-0000-4000-8000-000000000200';
  v_kept CONSTANT TEXT := 'cccccccc-0000-4000-8000-000000000201';
BEGIN
  -- A pack from before the retirement, and a saved question, for each account.
  INSERT INTO public.user_cards (user_id, subject, card_id) VALUES
    (v_gone, 'webdev', 'webdev-topic-javascript'),
    (v_kept, 'webdev', 'webdev-topic-javascript');
  INSERT INTO public.flashcards (user_id, subject, question_id, question, category, correct_answer, explanation) VALUES
    (v_gone, 'webdev', 'rm-js-17', 'What does typeof null return?', 'javascript', '"object"', 'A historical quirk of the first engine.'),
    (v_kept, 'webdev', 'rm-js-17', 'What does typeof null return?', 'javascript', '"object"', 'A historical quirk of the first engine.');

  PERFORM public.delete_user_data(v_gone);

  ASSERT NOT EXISTS (SELECT 1 FROM public.user_cards WHERE user_id = v_gone), 'the retired card packs of a deleted account are erased';
  ASSERT NOT EXISTS (SELECT 1 FROM public.flashcards WHERE user_id = v_gone), 'the Shark Cards of a deleted account are erased';
  ASSERT (SELECT count(*) FROM public.user_cards WHERE user_id = v_kept) = 1, 'another account keeps its retired cards';
  ASSERT (SELECT count(*) FROM public.flashcards WHERE user_id = v_kept) = 1, 'another account keeps its Shark Cards';
END;
$$;

RESET ROLE;
