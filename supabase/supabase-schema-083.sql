-- Ten service-only tables have no browser grants. The remaining 29 policies
-- preserve their ownership checks, including block visibility and the two
-- parent-row checks. Casting after the subselect keeps auth.uid() an initplan.
-- Rollback: restore the named policies from migrations 027–075; table grants
-- are unchanged. The four path policies from 026 already use the target form.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';

DROP POLICY IF EXISTS coding_attempts_select_own ON public.coding_attempts;
DROP POLICY IF EXISTS coding_drafts_select_own ON public.coding_drafts;
DROP POLICY IF EXISTS coding_progress_select_own ON public.coding_progress;
DROP POLICY IF EXISTS daily_queue_completions_select_own ON public.daily_queue_completions;
DROP POLICY IF EXISTS github_commits_select_own ON public.github_commits;
DROP POLICY IF EXISTS github_connections_select_own ON public.github_connections;
DROP POLICY IF EXISTS user_badges_select_own ON public.user_badges;
DROP POLICY IF EXISTS user_cards_select_own ON public.user_cards;
DROP POLICY IF EXISTS streak_config_select_own ON public.user_streak_config;
DROP POLICY IF EXISTS streak_freezes_select_own ON public.user_streak_freezes;

ALTER POLICY billing_checkout_consents_select_own ON public.billing_checkout_consents
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY billing_customers_select_own ON public.billing_customers
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY coding_bookmarks_select_own ON public.coding_bookmarks
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY coding_collection_items_select_own ON public.coding_collection_items
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.coding_collections c
     WHERE c.collection_id = coding_collection_items.collection_id
       AND c.user_id = (SELECT auth.uid())::text
  ));

ALTER POLICY coding_collections_select_own ON public.coding_collections
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY coding_puzzle_results_select_own ON public.coding_puzzle_results
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY coding_skips_select_own ON public.coding_skips
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY concept_reviews_owner_select ON public.concept_reviews
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY cosmetic_entitlements_select_own ON public.cosmetic_entitlements
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY daily_select_self ON public.daily_attempts
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY entitlement_grants_select_own ON public.entitlement_grants
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY flashcards_select_own ON public.flashcards
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY friendships_select_party ON public.friendships
  TO authenticated
  USING (
  (SELECT auth.uid())::text IN (user_low, user_high)
  AND (
    blocked_by = (SELECT auth.uid())::text
    OR (
      blocked_by IS NULL
      AND (
        requested_by = (SELECT auth.uid())::text
        OR NOT devshark_private.friendship_blocked_by_viewer(user_low, user_high)
      )
    )
  )
);

ALTER POLICY merch_order_items_select_own ON public.merch_order_items
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.merch_orders o
     WHERE o.order_id = merch_order_items.order_id
       AND o.user_id = (SELECT auth.uid())::text
  ));

ALTER POLICY merch_orders_select_own ON public.merch_orders
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY path_reward_claims_select_own ON public.path_reward_claims
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY practice_sessions_select_own ON public.practice_sessions
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY referral_codes_select_own ON public.referral_codes
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY roadmap_progress_select_own ON public.roadmap_progress
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY token_balances_select_own ON public.token_balances
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY token_ledger_select_own ON public.token_ledger
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY token_xp_credits_select_own ON public.token_xp_credits
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY user_activity_days_select_own ON public.user_activity_days
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY category_stats_select_self ON public.user_category_stats
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY user_handles_select_own ON public.user_handles
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY stats_select_own ON public.user_stats
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY user_streak_select_own ON public.user_streak
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY user_xp_select_own ON public.user_xp
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

ALTER POLICY user_xp_days_select_own ON public.user_xp_days
  TO authenticated
  USING (user_id = (SELECT auth.uid())::text);

COMMIT;
