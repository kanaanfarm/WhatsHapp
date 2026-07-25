# ConnectChat Pro v6.7.3 — optional email and phone sign-in

Existing username and password login remains the default.

An approved user can open **You → Email or phone sign-in**, add an email
address and/or a phone number with country code, and then use any of these with
the existing password:

- username
- email address
- phone number

## Required one-time Supabase step

Open Supabase → SQL Editor and run:

`v6.7.3-email-phone-signin-migration.sql`

The migration only adds optional `email` and `phone` fields and unique indexes.
It does not delete or change existing accounts, usernames, passwords, groups or
messages.

This release uses password sign-in. Email verification, SMS verification and
one-time passcodes are not enabled yet; those can be introduced when
email/phone becomes the default registration method.
