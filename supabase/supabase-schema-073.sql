-- Migration 073: serialize saved-question writes with Auth account erasure.
-- Apply after 072. Safe to re-run. Live-account writes still use the existing
-- table and grants. Existing rows, including historical orphan rows, stay as-is.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.concept_review_receipts') IS NULL OR to_regclass('public.flashcards') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'migration 073 needs Auth and migrations 008 and 072 first';
  END IF;
  -- Check the future definer's access without locking any account row.
  PERFORM 1 FROM auth.users WHERE FALSE FOR KEY SHARE;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_flashcard_account()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
BEGIN
  IF NEW.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    -- Hold the same owner-row lock a foreign key would take, without rewriting
    -- legacy text identifiers. Auth deletion waits for an earlier card write.
    PERFORM 1 FROM auth.users u WHERE u.id = NEW.user_id::UUID FOR KEY SHARE;
    IF FOUND THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'flashcard_account_missing' USING ERRCODE = '23503';
END;
$$;

REVOKE ALL ON FUNCTION public.guard_flashcard_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_flashcard_account() TO service_role;
DROP TRIGGER IF EXISTS guard_flashcard_account ON public.flashcards;
CREATE TRIGGER guard_flashcard_account BEFORE INSERT OR UPDATE ON public.flashcards
  FOR EACH ROW EXECUTE FUNCTION public.guard_flashcard_account();
COMMIT;
