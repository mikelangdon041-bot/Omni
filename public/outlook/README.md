# Writing Studio in Outlook

The habit this removes: select the email, Ctrl+C, switch to the browser, find
Writing Studio, paste, then type "can you respond to this and here's what else
you need to know". Four of those five steps are carrying the same email across a
gap Outlook didn't need to have. The add-in reads the open message directly, so
the only thing left to type is the part only you know.

**Open Writing Studio** (in the **Omni** group on the ribbon) opens the same pane
whether you are reading an email or writing one:

- **At the top**, a two-line summary of the email being answered, with
  signatures left out. On a thread you choose whether it works from the whole
  thread or just that one message, and which message you're answering.
- **One optional box**, _what do you want to say?_ Leave it empty and it writes
  the reply. Put the gist in, or have a draft started in Outlook, and it asks
  how much to change your words: write it from this, just fix it, polish it or
  rewrite it. The button says which it is about to do.
- **Options**, folded away: tone, audience, length, your styles, and anything
  else it should know. It fills in its own guesses from the email.
- **Make it sound like you**, folded away too — the three things below.
- **The result** is written in the pane, where you can edit it or ask for
  changes, then goes into Outlook: a reply window when you're reading, at the
  cursor when you're writing. Pieces you wrote earlier can be dropped in the
  same way.

## Making it sound like you

Three different complaints, so three different answers. All of them live under
**Make it sound like you**, which is on screen both before you write and right
underneath what came back — that second one matters, because "I'd never say
that" is a thought you have while reading it, not while filling a form in.

- **Your voice.** Gmail learns this by reading your sent mail. An add-in can't:
  Office hands over the message you're looking at and nothing else, and going
  wider means Microsoft Graph, an Azure app registration and your tenant admin
  agreeing to it. It doesn't need to. Half of any thread is usually your own
  replies, already open, already separated out — so the writing on the thread
  is listed and you tick what's actually yours. **Keep learning as I go** does
  it every time you open a thread, so a week of ordinary mail builds the voice
  without you doing anything. When a thread has nothing of yours in it, paste
  a few old emails instead. The samples are kept, not just the summary of them
  — a description of how somebody writes is a weaker guide than their actual
  sentences, so the model gets both — and everything it has learned is listed,
  with an ✕ on each.
- **Words you'd never use.** "Never _lovely_, say _great_." Stored as a swap
  and never as a bare ban: a list of forbidden words puts those words in front
  of the model and makes it _more_ likely to reach for them, where a
  replacement gives it somewhere else to go. It applies everywhere you write,
  including the browser.
- **How you sign off.** If Outlook has already dropped your signature into the
  message, one tap saves it. Two lines of "Cheers, Zak" are treated as the last
  sentence of the email and written by the model, in your own font, rather than
  pasted on underneath; a block of letterhead is still stapled on after the
  body, and never twice.

### Why it never learns from itself

The obvious way to build this is also the way it quietly destroys itself. The
replies in your Sent folder include the ones written here: you asked for one,
inserted it, sent it, and a week later it is in the thread under your name.
Learn from that and the model is reading its own output back — its habits get
scored as yours, and every round thins out the writing that was actually
yours until the voice is a generic version of where it started.

So nothing goes in without being checked. Three checks, and the order matters.

**What Omni wrote**, exactly. Every candidate is compared against the pieces
in your library, counting overlapping runs of eight words — which survives you
rewording a sentence or two before sending, and doesn't trip on two people
writing about the same subject. Free, certain, and blind to everything that
didn't come through here.

**How it reads.** A handful of phrases that turn up in machine-written business
email far more than in anyone's own, plus a measure of how even the sentences
and paragraphs are. Be honest about this one: it is weak. General "was this AI
written?" detectors are unreliable, worst of all at email length, and measured
against five freshly generated replies this caught none of them — partly
because Omni's own prompt already forbids the phrases a detector looks for.
It stays because it costs nothing and catches the older, more obvious stuff.

**Whether it reads like _you_.** The one that works. Not "is this AI?" in the
abstract, which is the question nobody can answer, but "did the person who
wrote these write this one too?" — with writing you have already confirmed as
yours sitting next to it. On the same five generated replies plus four human
emails, this kept out five of seven that weren't yours and wrongly rejected
none of your own. It needs at least two confirmed samples before it can say
anything, runs when you open the section, and always runs before anything is
kept automatically.

Nothing is ever deleted or hidden on the strength of these. A flagged piece is
still on the list, unticked, with the reason in words — "longer, more even
sentences than you write" — and a tick you can put back. Only you know whether
you wrote it; the checks only decide where the tick starts.

## What lands in Outlook

Inserting is not pasting, and the difference used to show. A paste has to
declare a font and put both a margin and a blank line between paragraphs,
because Word throws the margin away. Handed straight to a message, all of that
survives, so paragraphs came out double-spaced in Calibri 11 whatever font the
message was being written in.

Now the pane reads the font off the message you're in and hands it back, with
one blank line between paragraphs and no margins — the shape Outlook itself
writes when you press Enter twice. Replying to a message you're reading
declares no font at all, so the reply window uses the default you set for
writing mail.

Nothing is duplicated. The pane creates an ordinary Writing Studio piece, so
every prompt, chip, style and version stays in one place.

Changing a ribbon label means **reinstalling the manifest**: Outlook reads the
labels from the copy it installed, not from the site.

## Installing it

The pane is served from the Omni deployment, so there is nothing to host — you
only need to tell Outlook where it is. Once, per person.

Outlook goes to **Get Add-ins → My add-ins → Add a custom add-in**, and offers
either **Add from file** or **Add from URL**. Take whichever it gives you; they
carry the same manifest, and the file is not a lesser version of the URL —
Outlook reads either one once, to learn where the pane lives.

**Add from file.** Microsoft has been removing the URL option from several of
these dialogs, so this is increasingly the only one on offer. Save the manifest
somewhere your file picker will land on — Downloads is fine — and point Outlook
at it:

```text
https://omni-nine-navy.vercel.app/outlook/manifest.xml   → Save as…
```

or take it straight out of this repo, at `public/outlook/manifest.xml`.

**Add from URL.** Paste the same address:

```text
https://omni-nine-navy.vercel.app/outlook/manifest.xml
```

Either way, accept the warning about a custom add-in — that warning is about it
not coming from Microsoft's store. It's yours.

Classic Outlook for Windows uses the same dialog (**File → Manage Add-ins**,
which opens the web page above). Add-ins installed there show up in the desktop
client too, usually within a few minutes.

### If your tenant blocks custom add-ins

Some organisations turn off user-installed add-ins. You'll know because the
upload itself is refused, not because an option is missing. Then an admin
deploys it from the Microsoft 365 admin center (**Settings → Integrated apps →
Upload custom apps**), from the same file or URL. Ask them for "integrated apps,
upload custom app"; it takes them a minute.

### The manifest has to be reachable without signing in

Outlook fetches it from its own servers, with none of your cookies. The rest of
Omni redirects a request with no session to `/login`, and a manifest that
redirects is a manifest Outlook cannot read — so `/outlook` is exempt from that
gate, both the manifest and the pane. The pane is exempt for the same reason
from the other side: sending it to `/login` would put a full login page inside a
400px panel whose post-login redirect goes to the dashboard, with no way back.
It renders its own sign-in prompt instead.

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
