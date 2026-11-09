# Supabase Auth email templates

Paste these into Supabase → Authentication → Emails → Templates. They replace
Supabase's unbranded defaults. NEEDED.md lists the rest of the email set-up
(SMTP, URL configuration, password rules).

The confirmation and reset links point at devShark's own pages with
`{{ .TokenHash }}` instead of Supabase's `{{ .ConfirmationURL }}`. A mail
filter that opens every link (Microsoft 365's Safe Links does, and schools use
it) would use up a `{{ .ConfirmationURL }}` link before the learner sees it.
These pages verify the link only when the learner presses the button
(`client/src/components/auth/AuthPages.tsx`). The default
`{{ .ConfirmationURL }}` works in the browser that requested the email. It
exchanges a code using that browser's stored PKCE verifier and can bring the
learner back to the page they signed up on. Token-hash links work across
devices and continue to the home page. Request a new email if a link issued
before the PKCE rollout returns a bearer token.

Links work once and expire after Supabase's "Email OTP expiration" (one hour by
default; Authentication → Sign In / Providers → Email).

## Confirm signup

Subject: `Confirm your devShark email`

```html
<div style="font-family: Inter, Arial, sans-serif; color: #132019; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="font-weight: 800; font-size: 20px; color: #2d7a2d; margin: 0 0 24px;">devShark</p>
  <h1 style="font-size: 22px; margin: 0 0 12px;">Confirm your email</h1>
  <p style="line-height: 1.6; margin: 0 0 20px;">Press the button to confirm {{ .Email }} and finish creating your devShark account.</p>
  <p style="margin: 0 0 24px;">
    <a href="{{ .SiteURL }}/auth/confirmed?token_hash={{ .TokenHash }}&type=email"
       style="display: inline-block; background: #2d7a2d; color: #ffffff; font-weight: 700; text-decoration: none; padding: 12px 20px; border-radius: 10px;">Confirm my email</a>
  </p>
  <p style="line-height: 1.6; color: #4a5a66; font-size: 14px; margin: 0;">The link works once and expires in an hour. If you did not create a devShark account, ignore this email: nothing happens unless the button is pressed.</p>
</div>
```

## Reset password

Subject: `Reset your devShark password`

```html
<div style="font-family: Inter, Arial, sans-serif; color: #132019; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="font-weight: 800; font-size: 20px; color: #2d7a2d; margin: 0 0 24px;">devShark</p>
  <h1 style="font-size: 22px; margin: 0 0 12px;">Reset your password</h1>
  <p style="line-height: 1.6; margin: 0 0 20px;">Press the button to set a new password for the devShark account of {{ .Email }}.</p>
  <p style="margin: 0 0 24px;">
    <a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery"
       style="display: inline-block; background: #2d7a2d; color: #ffffff; font-weight: 700; text-decoration: none; padding: 12px 20px; border-radius: 10px;">Set a new password</a>
  </p>
  <p style="line-height: 1.6; color: #4a5a66; font-size: 14px; margin: 0;">The link works once and expires in an hour. If you did not ask for a new password, ignore this email: your password stays as it is.</p>
</div>
```

## Magic link

devShark never asks for a magic link. Brand the template anyway, so a sign-in
link sent through Supabase's API does not arrive looking like phishing.

Subject: `Your devShark sign-in link`

```html
<div style="font-family: Inter, Arial, sans-serif; color: #132019; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="font-weight: 800; font-size: 20px; color: #2d7a2d; margin: 0 0 24px;">devShark</p>
  <h1 style="font-size: 22px; margin: 0 0 12px;">Sign in to devShark</h1>
  <p style="margin: 0 0 24px;">
    <a href="{{ .ConfirmationURL }}"
       style="display: inline-block; background: #2d7a2d; color: #ffffff; font-weight: 700; text-decoration: none; padding: 12px 20px; border-radius: 10px;">Sign in</a>
  </p>
  <p style="line-height: 1.6; color: #4a5a66; font-size: 14px; margin: 0;">The link works once and expires in an hour. If you did not ask to sign in, ignore this email.</p>
</div>
```
