# Email delivery

devShark sends two kinds of email, and both reach people through Resend.

| Email | Who sends it | Path |
|---|---|---|
| Confirm signup, reset password, magic link | Supabase Auth | Supabase → Resend SMTP (`smtp.resend.com`) |
| Premium cancellation and withdrawal (links and receipts) | devShark's API | `lib/email/resend.ts` → Resend HTTP API |

The sender is `devShark <noreply@devshark.app>`. Replies go to `support@devshark.app`, which is the Zoho
mailbox where people's mail lives (MX `mx.zoho.eu`). Zoho receives mail and Resend sends it; neither
replaces the other.

## Settings

| Where | Setting | Value |
|---|---|---|
| Resend | Domain | `devshark.app`, region Ireland (eu-west-1), DNS records in Vercel DNS |
| Resend | API key | `devshark-production`, Sending access, domain `devshark.app` only |
| Vercel (Production) | `RESEND_API_KEY` | that key; without it the API sends nothing |
| Vercel (Production) | `RESEND_FROM` | optional, default `devShark <noreply@devshark.app>` |
| Vercel (Production) | `RESEND_REPLY_TO` | optional, default `support@devshark.app` |
| Vercel (Production) | `SUPABASE_MANAGEMENT_API_TOKEN` | a Supabase personal access token; lets the admin editor write the account templates into Supabase |
| Supabase → Authentication → Emails → SMTP | host, port, user, password | `smtp.resend.com`, `465`, `resend`, the API key |
| Supabase → Authentication → Emails → SMTP | sender | `noreply@devshark.app`, name `devShark`, minimum interval 60 s |
| Supabase → Authentication → Rate Limits | emails sent | raise from 30 an hour to what the Resend plan allows |

Keys are pasted by the owner only. They never go into the repository, a log or the admin page.

## Editing the emails

Administration → Emails edits every template (owner, 12 November 2026, after the NAVIGYM
administration). Each one has a subject, a rich-text body (paragraphs, headings, lists, bold, italic,
underline) and variables in braces, such as `{link}`.

- A saved template is stored in `app_settings` under `email_template:<id>`. Without one, the code's
  original wording is sent (`shared/email-templates.ts`), and **Restore default wording** removes the row.
- A confirmation template must keep `{link}`; the API refuses to save it otherwise.
- Variable values are inserted as literal text and escaped in HTML, so a value can never add markup.
- Saving an account template also writes its subject and HTML into Supabase's hosted templates through the
  Management API. Without `SUPABASE_MANAGEMENT_API_TOKEN`, the text is saved in devShark only and the
  page says Supabase still sends its current template. Supabase's own `{{ }}` syntax typed into the text
  is made inert; only `{email}` and the button link become Supabase variables.
- **Send test email** sends the saved version once to the typed address, subject marked `[Test]`, with
  sample values and a button that leads to a harmless page.

[Supabase Auth email templates](auth-email-templates.md) keeps the hand-written HTML of the account
emails as a fallback when the token is not set.
