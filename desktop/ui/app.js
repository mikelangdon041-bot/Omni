// The window is a view of one thing: the status the Rust side emits. It never
// keeps its own copy of what is happening, so a recording started by the
// hotkey while this window was hidden shows up correctly the moment it opens.

// Plain HTML with no bundler, so Tauri is reached through the global rather
// than an npm import. That global exists because `withGlobalTauri` is on in
// tauri.conf.json; without it this line is the first thing that breaks, and
// the window renders as a blank rectangle.
const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;

const $ = (id) => document.getElementById(id);
const show = (id, on) => {
  $(id).hidden = !on;
};

/// The three views are very different heights — two fields to sign in, a
/// button to record, a page of settings — so one fixed window size leaves
/// most of it empty most of the time. Size to whatever is actually on screen.
///
/// setSize takes the *outer* size, so the title bar and borders have to be
/// added on top of the content; measuring them beats guessing, because it is
/// the difference between a snug window and one with a scrollbar in it.
async function fitWindow() {
  // Everything on screen, not just the active section: the unfinished-recording
  // banner sits outside them all, and measuring only sections cropped it off.
  const shown = [...document.body.children].filter(
    (el) => !el.hidden && el.tagName !== "SCRIPT" && el.getBoundingClientRect().height > 0,
  );
  if (!shown.length) return;
  const tops = shown.map((el) => el.getBoundingClientRect().top);
  const bottoms = shown.map((el) => el.getBoundingClientRect().bottom);
  const content = Math.max(...bottoms) - Math.min(...tops);
  const { getCurrentWindow, LogicalSize } = window.__TAURI__.window;
  const win = getCurrentWindow();
  try {
    const [outer, inner, scale] = await Promise.all([
      win.outerSize(),
      win.innerSize(),
      win.scaleFactor(),
    ]);
    const chrome = (outer.height - inner.height) / scale;
    // Body padding, top and bottom, plus the frame.
    const height = Math.ceil(content) + 44 + chrome;
    await win.setSize(new LogicalSize(440, Math.min(820, Math.max(240, height))));
  } catch {
    // Sizing is a nicety; a window that will not resize is still usable.
  }
}

// Content height is only known after layout, and again after fonts land.
const refit = () => requestAnimationFrame(() => requestAnimationFrame(fitWindow));

let status = null;
// The compose picker sits outside the phase-driven views below — it can come
// up regardless of whether recording is signed in, idle, or mid-upload, so it
// is tracked as its own flag rather than folded into `status.phase`.
let showingCompose = false;
let devices = { inputs: [], outputs: [] };
// Declared up here with the rest of the module state because render() reads it,
// and render() must never be the thing that touches it first.
let folders = [];
let foldersAsked = false;
// "+ New person" / "+ New topic" chosen from the select — which kind, so the
// form knows what it's creating and can send the right label.
let creatingFolderKind = null;
/** Settings is a separate view rather than a state of the main one. */
let showingSettings = false;

const mmss = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function render() {
  if (!status) return;

  // The picker takes over the whole window while it's up, independent of
  // sign-in or recording state: it never touches the desktop session at all,
  // it just opens a browser tab, so nothing about auth or recording gates it.
  show("compose", showingCompose);
  if (showingCompose) {
    show("setup", false);
    show("main", false);
    show("settings", false);
    show("recovered", false);
    refit();
    return;
  }

  const signedIn = status.signed_in && status.omni_url;

  // A recording that outlived the run that made it, offered back rather than
  // left in a folder nobody would think to look in. Shown above both views on
  // purpose: a crash can also cost the session, and a stranded recording that
  // only appears once you happen to sign in is stranded twice.
  const orphan = (status.orphans || [])[0];
  const busy = status.phase === "recording" || status.phase === "working";
  show("recovered", Boolean(orphan) && !busy);
  if (orphan) {
    const length = orphan.minutes >= 1 ? `about ${orphan.minutes} min` : "under a minute";
    const more =
      status.orphans.length > 1 ? ` ${status.orphans.length - 1} more after this.` : "";
    $("recovered-note").textContent = signedIn
      ? `From ${orphan.when}, ${length}. It never became a meeting.${more}`
      : `From ${orphan.when}, ${length}. Sign in and it can still be sent.${more}`;
    $("recover-send").disabled = !signedIn;
  }

  show("setup", !signedIn);
  show("settings", signedIn && showingSettings);
  show("main", signedIn && !showingSettings);
  if (!signedIn) {
    // Being thrown back here mid-flow (an expired session, a recording that
    // could not be uploaded) has to say why, and where the recording went.
    $("setup-error").textContent = status.message || "";
    $("setup-error").hidden = !status.message;
    // Never overwrite a field being typed into: this runs on every status
    // event, not just the first.
    if (document.activeElement !== $("username")) {
      $("username").value = status.username || "";
    }
    refit();
    return;
  }

  const recording = status.phase === "recording";
  const working = status.phase === "working";

  $("headline").textContent = recording
    ? "Recording"
    : working
      ? "Writing it up"
      : status.phase === "done"
        ? "Saved to Omni"
        : status.phase === "error"
          ? "Something went wrong"
          : "Ready";

  show("timer", recording);
  show("meter", recording);
  $("elapsed").textContent = mmss(status.seconds || 0);
  // A meter that only moves in the top of its range reads as broken during
  // speech, which sits low. Square-rooting it makes normal talking visible.
  $("meter-fill").style.width = `${Math.round(Math.sqrt((status.level || 0) / 100) * 100)}%`;

  // Open the whole time a title could still make it into the meeting: from
  // the first second of recording through the last second of the upload,
  // since capture() only reads it once the notes are about to be written.
  show("title-field", recording || working);
  if (document.activeElement !== $("meeting-title")) {
    $("meeting-title").value = status.title || "";
  }

  // Asked for the first time a recording could actually use them, not at
  // startup: this app is meant to sit in the tray costing nothing, and most
  // launches never record at all.
  if (recording || working) void loadFolders();

  // Same window of time as the title. Shown whenever a recording is live or
  // being written up — unlike the OneNote picker this replaced, it's always
  // useful: leaving it on Uncategorized is a fine answer, but it's always a
  // question worth asking.
  show("destination-field", (recording || working) && !creatingFolderKind);
  show("new-folder-form", (recording || working) && Boolean(creatingFolderKind));
  if (document.activeElement !== $("folder-select")) {
    $("folder-select").value = status.folder_id || "";
  }

  show("progress", working);
  $("progress-fill").style.width = `${status.percent || 0}%`;
  $("progress-label").textContent = status.message || "Working";
  $("progress-pct").textContent = `${status.percent || 0}%`;

  const note = $("note");
  note.className = "note";
  if (status.phase === "error") {
    note.textContent = status.message;
    note.classList.add("bad");
  } else if (status.phase === "done") {
    note.textContent = status.message ? `“${status.message}”` : "";
    note.classList.add("good");
  } else if (recording) {
    note.textContent = capturingLine();
  } else if (working) {
    note.textContent = "You can close this window. It keeps going in the tray.";
  } else {
    note.textContent = capturingLine();
  }

  const button = $("record");
  button.textContent = recording ? "Stop and write it up" : "Start recording";
  button.classList.toggle("stop", recording);
  button.disabled = working;

  // Only offered while it's still recording — once Stop hands it off to
  // upload/transcribe, the audio is on its way out and cancelling would just
  // orphan a half-finished job instead of cleanly discarding one.
  show("cancel-recording", recording);

  show("open-meeting", Boolean(status.last_meeting));
  $("hotkey-hint").textContent = status.hotkey;
  $("who").textContent = status.username;
  refit();
}

/** Say plainly what will and will not be captured — this is the setting that
    silently costs you half a meeting when it is wrong. */
function capturingLine() {
  const parts = [];
  if (status.capture_system) parts.push("what you hear");
  if (status.capture_mic) parts.push("your microphone");
  if (parts.length === 0) return "Nothing is selected to record. Open Settings.";
  return `Capturing ${parts.join(" and ")}.`;
}

function fillDeviceSelects() {
  const build = (select, list, chosen, defaultLabel) => {
    select.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    const fallback = list.find((d) => d.is_default);
    auto.textContent = fallback
      ? `${defaultLabel} (${fallback.name})`
      : defaultLabel;
    select.append(auto);
    for (const device of list) {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = device.name;
      select.append(option);
    }
    select.value = list.some((d) => d.id === chosen) ? chosen : "";
  };
  build($("mic-device"), devices.inputs, status.mic_device_id, "Windows default");
  build($("system-device"), devices.outputs, status.system_device_id, "Windows default");
}

async function openSettings() {
  try {
    devices = await invoke("list_audio_devices");
  } catch (e) {
    $("settings-error").textContent = String(e);
    $("settings-error").hidden = false;
  }
  $("capture-mic").checked = status.capture_mic;
  $("capture-system").checked = status.capture_system;
  $("keep-audio").checked = status.keep_audio;
  $("open-when-done").checked = status.open_when_done;
  $("start-at-login").checked = status.start_at_login;
  $("hotkey").value = status.hotkey;
  $("url").value = status.omni_url;
  fillDeviceSelects();
  showingSettings = true;
  render();
}

// --- wiring ----------------------------------------------------------------

$("signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = $("signin-button");
  const error = $("setup-error");
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    await invoke("sign_in", {
      username: $("username").value,
      password: $("password").value,
    });
    $("password").value = "";
  } catch (e) {
    error.textContent = String(e);
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

$("record").addEventListener("click", () => invoke("toggle_recording"));

$("cancel-recording").addEventListener("click", () => {
  // No confirm() on Stop — losing that would cost a whole meeting — but this
  // button's entire purpose is throwing the recording away, so it gets one:
  // opening the window mid-meeting to check on it is exactly the moment a
  // stray click here would otherwise cost the meeting for real.
  if (window.confirm("Discard this recording? It cannot be recovered.")) {
    void invoke("cancel_recording");
  }
});

$("meeting-title").addEventListener("input", () => {
  void invoke("set_title", { title: $("meeting-title").value });
});

// --- Where the meeting is filed ------------------------------------------

// Fetched once, lazily, the first time a recording could use them. Doing it at
// startup would put a network call on the path of an app that is meant to sit
// in the tray costing nothing, for a feature most launches never touch.
async function loadFolders() {
  if (foldersAsked) return;
  foldersAsked = true;
  try {
    folders = await invoke("list_folders");
    fillFolderSelect();
    render();
  } catch {
    // Offline, or Omni is having a day. The picker still shows Uncategorized
    // and "+ New…" — creating one will just fail with a clear error rather
    // than the whole feature disappearing.
  }
}

function fillFolderSelect() {
  const select = $("folder-select");
  const chosen = select.value;
  select.innerHTML = '<option value="">Uncategorized</option>';
  const people = folders.filter((f) => f.kind === "person");
  const topics = folders.filter((f) => f.kind === "topic");
  const group = (label, items) => {
    if (items.length === 0) return null;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const f of items) {
      const option = document.createElement("option");
      option.value = f.id;
      option.textContent = f.name;
      g.appendChild(option);
    }
    return g;
  };
  const peopleGroup = group("People", people);
  if (peopleGroup) select.appendChild(peopleGroup);
  const newPerson = document.createElement("option");
  newPerson.value = "__new_person__";
  newPerson.textContent = "+ New person…";
  select.appendChild(newPerson);
  const topicsGroup = group("Topics", topics);
  if (topicsGroup) select.appendChild(topicsGroup);
  const newTopic = document.createElement("option");
  newTopic.value = "__new_topic__";
  newTopic.textContent = "+ New topic…";
  select.appendChild(newTopic);
  select.value = folders.some((f) => f.id === chosen) ? chosen : "";
}

$("folder-select").addEventListener("change", () => {
  const select = $("folder-select");
  if (select.value === "__new_person__" || select.value === "__new_topic__") {
    creatingFolderKind = select.value === "__new_person__" ? "person" : "topic";
    $("new-folder-heading").textContent =
      creatingFolderKind === "person" ? "New person" : "New topic";
    $("new-folder-name").value = "";
    render();
    requestAnimationFrame(() => $("new-folder-name").focus());
    return;
  }
  void invoke("set_folder", {
    id: select.value,
    name: select.selectedOptions[0]?.textContent || "",
  });
});

$("new-folder-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("new-folder-name").value.trim();
  if (!name || !creatingFolderKind) return;
  try {
    const folder = await invoke("create_folder", { kind: creatingFolderKind, name });
    folders = [...folders, folder];
    fillFolderSelect();
    $("folder-select").value = folder.id;
    await invoke("set_folder", { id: folder.id, name: folder.name });
  } catch (e) {
    window.alert(String(e));
  } finally {
    creatingFolderKind = null;
    render();
  }
});

$("new-folder-cancel").addEventListener("click", () => {
  creatingFolderKind = null;
  render();
});

$("recover-send").addEventListener("click", () => {
  const orphan = (status.orphans || [])[0];
  if (orphan) void invoke("recover", { path: orphan.path }).catch(() => {});
});

$("recover-discard").addEventListener("click", () => {
  const orphan = (status.orphans || [])[0];
  // No confirm: the recording is the only copy, so this button says "Delete
  // it" and means it, but it is deliberately the quieter of the two.
  if (orphan && window.confirm("Delete this recording? It cannot be recovered.")) {
    void invoke("discard_orphan", { path: orphan.path });
  }
});
$("open-meeting").addEventListener("click", () => invoke("open_url", { url: status.last_meeting }));
$("settings-open").addEventListener("click", openSettings);
$("settings-close").addEventListener("click", () => {
  showingSettings = false;
  render();
});

$("settings-save").addEventListener("click", async () => {
  const error = $("settings-error");
  error.hidden = true;
  try {
    await invoke("save_settings", {
      patch: {
        omni_url: $("url").value,
        mic_device_id: $("mic-device").value,
        system_device_id: $("system-device").value,
        capture_mic: $("capture-mic").checked,
        capture_system: $("capture-system").checked,
        keep_audio: $("keep-audio").checked,
        open_when_done: $("open-when-done").checked,
        start_at_login: $("start-at-login").checked,
        hotkey: $("hotkey").value,
      },
    });
    showingSettings = false;
    render();
  } catch (e) {
    // Most often a shortcut another app already owns, which has to be said
    // rather than silently left unregistered.
    error.textContent = String(e);
    error.hidden = false;
  }
});

$("sign-out").addEventListener("click", async () => {
  await invoke("sign_out");
  showingSettings = false;
});

// Typing a shortcut is guesswork; capturing the keypress is not.
$("hotkey").addEventListener("keydown", (e) => {
  e.preventDefault();
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  const key = e.key;
  if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }
  if (parts.length) $("hotkey").value = parts.join("+");
});

// --- Writing Studio picker ---------------------------------------------

function closeCompose() {
  showingCompose = false;
  render();
  // Same reflex as closing after a recording finishes: it opened to do one
  // thing, and once it's done it should get out of the way again.
  void invoke("hide_window");
}

$("compose-close").addEventListener("click", closeCompose);

// Same handoff as the type tiles, with the website told there is a message on
// the clipboard waiting. It is the browser that reads the clipboard, not this
// app: Windows will hand it over here without asking, but the piece has to be
// created against the signed-in web session anyway, so the read happens where
// the piece does — behind one click, which is what Chrome requires.
$("compose-reply").addEventListener("click", () => {
  void invoke("open_url", { url: `${status.omni_url}/writing-studio?reply=1` });
  closeCompose();
});

for (const button of document.querySelectorAll(".type-btn")) {
  button.addEventListener("click", () => {
    const type = button.dataset.type;
    // The website already knows how to turn a type into a fresh piece — see
    // the `type` query param handling in writing-studio/page.tsx. Sending you
    // there rather than rebuilding the intake box here is the whole point:
    // one prompt, one set of chips, one place to keep in sync.
    void invoke("open_url", { url: `${status.omni_url}/writing-studio?type=${type}` });
    closeCompose();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && showingCompose) closeCompose();
});

listen("open-compose", () => {
  showingCompose = true;
  render();
});

listen("status", (event) => {
  status = event.payload;
  render();
});

invoke("get_status").then((s) => {
  status = s;
  render();
});
