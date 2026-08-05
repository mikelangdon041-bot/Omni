# Writing Studio in Outlook

The habit this removes: select the email, Ctrl+C, switch to the browser, find
Writing Studio, paste, then type "can you respond to this and here's what else
you need to know". Four of those five steps are carrying the same email across a
gap Outlook didn't need to have. The add-in reads the open message directly, so
the only thing left to type is the part only you know.

It works both ways:

- **Reading an email** — "Answer this" on the ribbon opens a pane showing what
  it's about to work from, with one box: _anything else I need to know?_ Press
  the button and the piece opens in your browser with the email, the sender and
  the subject already in, set to write a reply rather than proofread the email
  it was sent.
- **Writing a reply** — "Drop a piece in" lists what you've written recently and
  inserts the one you pick at the cursor, formatted, with your signature. This
  is the half that closes the loop; without it you'd still be copying something.

Nothing is duplicated. The pane creates an ordinary Writing Studio piece and
hands off to the workspace, so every prompt, chip, style and version stays in
one place.

## Installing it

The pane is served from the Omni deployment, so there is nothing to host — you
only need to tell Outlook where it is. Once, per person.

### Outlook on the web, or new Outlook for Windows

1. Open Outlook and go to **Settings → Mail → General → Manage add-ins**
   (or **Get Add-ins** on the ribbon).
2. Choose **My add-ins → Add a custom add-in → Add from URL**.
3. Paste:
   `https://omni-nine-navy.vercel.app/outlook/manifest.xml`
4. Accept the warning about a custom add-in. That warning is about the add-in
   not coming from Microsoft's store; it's yours.

### Classic Outlook for Windows

Same flow: **File → Manage Add-ins**, which opens the web page above. Custom
add-ins installed there show up in the desktop client too, usually within a few
minutes.

### If your tenant blocks custom add-ins

Some organisations turn off user-installed add-ins. Then an admin has to deploy
it from the Microsoft 365 admin center (**Settings → Integrated apps → Upload
custom apps**), pointing at the same manifest URL. Ask them for
"Integrated apps, upload custom app, manifest URL"; it takes them a minute.

## Signing in

The pane runs on your Omni account and shares the browser's sign-in. The first
time it opens it may ask you to sign in — do it once in the tab it offers and
Outlook remembers it after that.

## When you change the deployment URL

`manifest.xml` contains absolute URLs, because Outlook fetches it before it
knows anything about your app. If Omni moves, every
`https://omni-nine-navy.vercel.app` in that file has to move with it, and
everyone reinstalls. Nothing else in the add-in needs touching — the pane is
just `/outlook` in the Next app.

## Not using Outlook?

The same job is one hotkey away anywhere else: **Ctrl+Alt+W** from the Omni
desktop app, then "Reply to this". Copy the message first — that path can't
reach into the app you're looking at the way this one can.
