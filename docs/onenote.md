# Meeting notes into OneNote

The debrief already copies cleanly. This removes the carrying: pick a section,
pick a page, and the finished notes land **at the top of it** — title and date
first, above whatever was already there.

Top, not bottom, on purpose. OneNote's own behaviour is to append, which buries
today's meeting under a quarter of history on a page you have been adding to all
along. The newest thing should be the thing you see.

## Why there is no "Record" button inside OneNote

There cannot be. Microsoft never shipped task-pane add-ins for OneNote on the
desktop — they exist for OneNote on the web and nowhere else. So unlike the
Outlook add-in, which lives inside Outlook, this works from the outside through
the Microsoft Graph API. The upside is that it works with every OneNote client,
desktop included, and needs nothing installed.

Recording still starts the way it always did: **Ctrl+Shift+R**, or the Record
button in Meeting Prep. When the notes are written you choose where they go.

## One-time setup

Two halves: register an app with Microsoft (once, for the deployment), then each
person connects their own account (once, in the app).

### 1. Register the app

In the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID** →
**App registrations** → **New registration**:

| Field | Value |
| --- | --- |
| Name | `Omni` |
| Supported account types | *Accounts in any organizational directory and personal Microsoft accounts* — unless you want to lock it to your tenant, in which case pick single-tenant and set `MICROSOFT_TENANT` below |
| Redirect URI | **Web** → `https://omni-nine-navy.vercel.app/api/integrations/microsoft/callback` |

Then, still in the registration:

- **Certificates & secrets** → **New client secret** → copy the *Value* (not the
  ID; the Value is shown once and never again).
- **API permissions** → **Add a permission** → **Microsoft Graph** →
  **Delegated permissions** → tick `Notes.ReadWrite`, `User.Read`, and
  `offline_access`. `offline_access` is the one that earns a refresh token —
  without it the connection dies silently an hour after it is made.
- If the tenant requires it, press **Grant admin consent**. If that button is
  greyed out for you, this is the step to ask an admin for: *"grant admin consent
  for the Omni app registration, delegated Notes.ReadWrite."*

> Add a second redirect URI for `http://localhost:3000/api/integrations/microsoft/callback`
> if you want this to work while developing.

### 2. Set the environment variables

In Vercel → Project → Settings → Environment Variables, and in `.env.local` for
local work:

```
MICROSOFT_CLIENT_ID=<Application (client) ID from the overview page>
MICROSOFT_CLIENT_SECRET=<the secret Value you copied>
MICROSOFT_TENANT=common
```

`MICROSOFT_TENANT` is optional and defaults to `common`, which lets both work and
personal accounts sign in. Set it to your tenant id to allow only your
organisation.

Redeploy after adding them — environment variables are read at build time.

### 3. Run the migration

`supabase/migrations/0029_microsoft_onenote.sql`, in the Supabase SQL editor.

It creates one table holding each user's Graph tokens. RLS is enabled with **no
policies at all**, so the browser cannot read it under any circumstances and
every access goes through the server with the service role. A refresh token is a
standing key to somebody's notebooks; "the client only ever calls our API" is a
convention, not a control.

### 4. Connect

Meeting Prep → any meeting → **Debrief** → **To OneNote** → **Connect OneNote**.
Pick the account (the picker is always shown, so a machine signed into a personal
Microsoft account can't quietly connect that one instead of the work one).

## Using it

**To OneNote** next to **Copy all**. Choose a section, then either:

- **A new page**, titled with the meeting, or
- **an existing page**, which prepends — today's notes go above what's there.

Wherever it went is remembered and offered first next time, because the honest
answer to "which page?" is nearly always "the same one as last time".

## If it stops working

- **"Not connected" after it had been working** — the refresh token was revoked
  (password change, consent withdrawn) or aged out. The button turns back into
  **Connect OneNote**; press it.
- **A 403 from Microsoft** — admin consent was never granted, or was withdrawn.
  See step 1.
- **The section list is empty** — the connected account has no OneNote notebooks.
  Personal and work accounts have separate ones; check which account is shown at
  the bottom of the dialog.
