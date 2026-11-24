# What the product measures

devShark sends product analytics to PostHog EU Cloud, and only after the visitor allows analytics in the cookie banner (`client/src/lib/consent.ts`). Before that the SDK is not downloaded and nothing is stored or sent; a withdrawal resets PostHog and removes its cookies and the stored campaign. Without `VITE_PUBLIC_POSTHOG_KEY` every call is a no-op. Requests go through the same-origin `/ingest` proxy.

`client/src/lib/posthogClient.ts` turns off autocapture, dead-click capture and session recording, honours Do Not Track, creates person profiles only for signed-in accounts, and leaves URL fragments out. Its `before_send` hook strips every URL and referrer property down to origin and path plus the campaign labels. Room invitations are masked as `/play/:code` in address and text properties. Feature-flag requests are disabled because their initial properties bypass the event scrubber.

## Events

| Event | Sent from | Properties |
| --- | --- | --- |
| `$pageview` | the router (`capturePageview`) | the scrubbed URL; the first pageview of a page load also carries the campaign labels |
| `quiz_started` | `Quiz.tsx` | `mode` (`standard`, `review`, `daily`); `question_count` on standard and review runs; `difficulty` and `category_count` on standard runs |
| `quiz_submitted` | `Quiz.tsx` | `mode`, `percentage`, `correct`, `total` |
| `classroom_or_match_joined` | `Play.tsx` | none |
| `premium_page_viewed` | `PremiumPage.tsx` | `product` |
| `share_initiated` | `client/src/lib/share.ts` | `kind`, `source`, `method` |
| `landing_sample_completed`, `learning_cta_clicked` | `Home.tsx`, `TopicLandingPage.tsx` (`captureActivation`) | `product`, `source` (`home`, `topic_guide`), `category`; `locale` on guide events |
| `learning_path_enrolled`, `learning_path_activity_started`, `learning_path_activity_verified`, `learning_path_returned` | `LearningPathScreens.tsx` (`capturePathEvent`) | `pathId`, `curriculumVersion`, `activityId`, `activityKind`, `state` |

`captureActivation`, `capturePathEvent` and `captureShare` rebuild their payloads from an allow-list, so a caller cannot pass an extra field through. [Activation measurement](quality/activation.md) gives the funnel definition built from these events.

`share_initiated` carries a `kind` (`referral`, `challenge_result`, `learn_topic_result`, `daily_question`, `learning_path_result`), a `source` (`learn_level`, `learn_topic`, `challenge`, `daily`, `learning_path`) and a `method` (`share`, `copy`, `download`), never the link, a code, a score or a name.

Analytics never receives an email, display name, access, session or answer token, room code, free text, question text or selected answer. PostHog identifies a signed-in account by its user id.

PostHog captures the events the application sends. Session replay, heatmaps, automatic errors and performance capture, surveys, product tours, conversations, experiments and external script loading are disabled in the client. Browser monitoring uses the separate Sentry privacy rules. Both URL and path properties replace a Play room code before transmission.

## Campaign labels

A link may carry `utm_source`, `utm_medium` and `utm_campaign` (`client/src/lib/analytics.ts`). A value is kept only when it is a short lower-case label (`^[a-z0-9][a-z0-9._-]{0,63}$`). The first pageview of a page load keeps the three in its URL and as properties. The browser's first campaign, kept 30 days, becomes the account's initial `utm_source`, `utm_medium` and `utm_campaign` when the visitor signs in (set-once properties on `identify`). Every other query parameter (`ref`, `voucher`, `session_id` and the rest) is removed from every URL PostHog receives.

## Public pages and share surfaces

- **Topic guides.** The build emits metadata-specific HTML for five guides under `/topics/<slug>`: JavaScript closures, TypeScript narrowing, React Hooks, SQL joins and Git rebase (`client/src/lib/topicCatalog.ts`). Each has original teaching copy, one misconception, small practice prompts and a quiz call to action. No private question or answer key appears in the static HTML.
- **Question of the day.** `/daily` shows one question a day from a track that rotates by date (`shared/daily-question.ts`). The server keeps the answer sealed until the learner checks one and grades it as a signed-out quiz: no receipt, XP, streak day, leaderboard entry or review record. Each day has its own page, `/daily/<date>`, prerendered for the last 120 days and the next 45, with its own share image naming the track and the date. The static HTML never holds the question or its answer.
- **Coding task previews.** Every coding task page has a link-preview image with its title, track, difficulty and the free count from `shared/tiers.ts`, drawn at build time.
- **Result cards.** A Challenge run, a finished Learn topic and a completed learning path offer Share and Download card (`ResultShareActions.tsx`). The card is drawn in the browser (`client/src/lib/shareCard.ts`) from the numbers on screen and the date; it has no field for a name, an email, a room code or a question.
- **Invite link.** After a learner's first passed Learn level and after each Challenge run, `ReferralMoment.tsx` offers the invite link with the platform share sheet and a copy button. The invite reward is described in [rewards](rewards-launch.md).
- **Room links.** Multiplayer room links are explicit invitations; room codes and participant names never reach analytics.

## Premium surfaces

The upgrade sheet opens only when a learner chooses something Premium or asks what Premium includes. `/premium` shows the price before VAT and says VAT is added at checkout, with no countdown or scarcity. Checkout stays off until `BILLING_ENABLED=true`. `/support` redirects to `/premium`.
