<#
  Omni bridge: lets Claude (claude.ai) use Outlook on this PC.

  claude.ai calls Omni's connector (/api/mcp). Omni puts each request in a
  queue; this script, running in the background while you are signed in to
  Windows, picks it up, does it in classic Outlook, and sends the answer back.
  Outlook is already signed in to your mailbox, so no Microsoft app approval
  is involved.

  What it can do: list calendar events, search mail, read a conversation,
  save drafts, send a draft (drafts only, never a message in one step), and
  create calendar events. It never opens windows. Its log records which tool
  ran and whether it worked, never message content.

  Install (once):
    powershell -ExecutionPolicy Bypass -File omni-bridge.ps1 -Install -Token <code>
  Optional: -Mailbox you@company.com picks the account (default: the first
  Exchange account in Outlook).
  Run in the foreground to watch it:  ... omni-bridge.ps1 -Verbose
  Remove:
    powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Omni\omni-bridge.ps1" -Uninstall
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Uninstall,
  [string]$Token,
  [string]$Mailbox,
  [string]$Site = 'https://omni-nine-navy.vercel.app',
  # Self-test: run one tool locally and print the JSON, without the queue.
  [string]$Test,
  [string]$TestArgs = '{}'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Dir = Join-Path $env:LOCALAPPDATA 'Omni'
$ConfigPath = Join-Path $Dir 'bridge.json'
$LogPath = Join-Path $Dir 'bridge.log'
$TaskName = 'Omni Outlook bridge'

function Write-Log([string]$Message) {
  Write-Verbose $Message
  try {
    Add-Content -Path $LogPath -Value ("{0}  {1}" -f (Get-Date -Format s), $Message) -Encoding UTF8
    if ((Get-Item $LogPath).Length -gt 200KB) {
      Get-Content $LogPath | Select-Object -Last 500 | Set-Content $LogPath -Encoding UTF8
    }
  } catch { }
}

# ------------------------------------------------------------------ install
if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*omni-bridge.ps1*' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item $ConfigPath -ErrorAction SilentlyContinue
  Write-Host 'Removed. Claude can no longer reach Outlook on this PC.'
  return
}

if ($Install) {
  if (-not $Token -or $Token.Length -lt 20) { throw 'Paste the whole install line: it carries the -Token code.' }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $self = Join-Path $Dir 'omni-bridge.ps1'
  if ($PSCommandPath -ne $self) { Copy-Item -LiteralPath $PSCommandPath -Destination $self -Force }
  $cfg = Invoke-RestMethod -Uri ($Site.TrimEnd('/') + '/api/mcp/bridge-config') -UseBasicParsing
  if (-not $cfg.supabase_url) { throw "Couldn't read the bridge settings from $Site." }
  @{ token = $Token; supabase_url = $cfg.supabase_url; anon_key = $cfg.anon_key; mailbox = $Mailbox } |
    ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding ASCII

  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  # conhost --headless: runs with no console window at all.
  $arguments = "--headless `"$ps`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$self`""
  $action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\conhost.exe') -Argument $arguments
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
  # Every 5 minutes: restarts it if it ever stopped (IgnoreNew skips it while running).
  $watch = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  # 7:40 every day, waking the PC from sleep, ahead of the 7:47 weekday run.
  $morning = New-ScheduledTaskTrigger -Daily -At '7:40'
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -WakeToRun -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $logon, $watch, $morning `
    -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Host 'Installed and running. It starts whenever you sign in to Windows, and wakes the PC at 7:40.'
  Write-Host "Log: $LogPath"
  return
}

# ------------------------------------------------------------------ Outlook
$script:ol = $null
$script:ns = $null
$script:acct = $null
$script:store = $null
$script:cfg = $null

function Get-Outlook {
  if ($script:ol) {
    try { $null = $script:ol.Version; return } catch { $script:ol = $null }
  }
  try {
    $script:ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
  } catch {
    # Not running: start it in the background (no window).
    $script:ol = New-Object -ComObject Outlook.Application
  }
  $script:ns = $script:ol.GetNamespace('MAPI')
  $script:acct = $null
  $want = if ($script:cfg) { $script:cfg.mailbox } else { $Mailbox }
  # By index, not foreach: an account that came through PowerShell's pipeline
  # wrapper is silently ignored when assigned to SendUsingAccount.
  for ($i = 1; $i -le $script:ns.Accounts.Count; $i++) {
    $a = $script:ns.Accounts.Item($i)
    if ($want) { if ($a.SmtpAddress -eq $want) { $script:acct = $a; break } }
    elseif ($a.AccountType -eq 0) { $script:acct = $a; break }   # 0 = Exchange
  }
  if (-not $script:acct) {
    if ($want) { throw "Outlook has no account $want" }
    $script:acct = $script:ns.Accounts.Item(1)
  }
  $script:store = $script:acct.DeliveryStore
}

# Outlook sends a new item from its default account (on this PC that can be a
# personal one) unless told otherwise. A plain "$item.SendUsingAccount = $acct"
# is silently dropped from PowerShell; InvokeMember is what actually sets it.
function Set-SendAccount($Item) {
  [void][System.__ComObject].InvokeMember('SendUsingAccount', [Reflection.BindingFlags]::SetProperty, $null, $Item, @($script:acct))
}

function Get-SendAccount($Item) {
  $a = [System.__ComObject].InvokeMember('SendUsingAccount', [Reflection.BindingFlags]::GetProperty, $null, $Item, $null)
  if ($a) { return $a.SmtpAddress }
  return $null
}

function Get-Folder([int]$Kind) { return $script:store.GetDefaultFolder($Kind) }

function Get-ItemById([string]$Id) {
  try { return $script:ns.GetItemFromID($Id, $script:store.StoreID) }
  catch {
    try { return $script:ns.GetItemFromID($Id) } catch { throw 'No item with that id. It may have been moved or deleted.' }
  }
}

function To-Utc($LocalTime) {
  return ([datetime]$LocalTime).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

function From-Utc([string]$Iso) {
  $styles = [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal
  return [datetime]::Parse($Iso, [Globalization.CultureInfo]::InvariantCulture, $styles).ToLocalTime()
}

# Outlook's Jet filters want dates in this PC's own short format.
function Jet-Date([datetime]$Local) { return $Local.ToString('g') }

function Smtp-Of($Item) {
  try {
    $a = $Item.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x5D01001F')
    if ($a) { return $a }
  } catch { }
  try {
    if ($Item.SenderEmailType -eq 'EX') {
      $u = $Item.Sender.GetExchangeUser()
      if ($u) { return $u.PrimarySmtpAddress }
    }
  } catch { }
  return $Item.SenderEmailAddress
}

function Recipient-Text($Item, [int]$Type) {
  $out = @()
  foreach ($r in $Item.Recipients) {
    if ($r.Type -ne $Type) { continue }
    $smtp = $null
    try { $smtp = $r.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x39FE001F') } catch { }
    if (-not $smtp) { $smtp = $r.Address }
    if ($r.Name -and $smtp -and $r.Name -ne $smtp) { $out += "$($r.Name) <$smtp>" } else { $out += ($smtp, $r.Name | Where-Object { $_ } | Select-Object -First 1) }
  }
  return ($out -join ', ')
}

function Set-Recipients($Item, $List, [int]$Type) {
  $remove = @()
  for ($i = $Item.Recipients.Count; $i -ge 1; $i--) {
    if ($Item.Recipients.Item($i).Type -eq $Type) { $remove += $i }
  }
  foreach ($i in $remove) { $Item.Recipients.Remove($i) }
  foreach ($p in $List) {
    $r = $Item.Recipients.Add([string]$p.address)
    $r.Type = $Type
  }
}

# Strip the quoted history Outlook keeps under each reply.
function Trim-Quoted([string]$Body) {
  if (-not $Body) { return '' }
  $patterns = @(
    '(?m)^\s*_{20,}\s*$',
    '(?m)^-{2,}\s*Original Message\s*-{2,}',
    '(?m)^\s*From:\s.+\r?\n\s*Sent:\s',
    '(?m)^On .{6,120} wrote:\s*$'
  )
  $cut = $Body.Length
  foreach ($p in $patterns) {
    $m = [regex]::Match($Body, $p)
    if ($m.Success -and $m.Index -gt 0 -and $m.Index -lt $cut) { $cut = $m.Index }
  }
  return $Body.Substring(0, $cut).Trim()
}

$BUSY = @{ 0 = 'free'; 1 = 'tentative'; 2 = 'busy'; 3 = 'out of office'; 4 = 'working elsewhere' }
$RESPONSE = @{ 0 = 'none'; 1 = 'organizer'; 2 = 'tentative'; 3 = 'accepted'; 4 = 'declined'; 5 = 'not responded' }

# ------------------------------------------------------------------ tools
function Tool-ListEvents($a) {
  $start = From-Utc $a.start_utc
  $end = From-Utc $a.end_utc
  $items = (Get-Folder 9).Items
  $items.Sort('[Start]')
  $items.IncludeRecurrences = $true
  $found = $items.Restrict("[Start] < '" + (Jet-Date $end) + "' AND [End] > '" + (Jet-Date $start) + "'")
  $events = @()
  $truncated = $false
  foreach ($e in $found) {
    if ($events.Count -ge 300) { $truncated = $true; break }
    $teams = $null
    try {
      $m = [regex]::Match([string]$e.Body, 'https://teams\.microsoft\.com/l/meetup-join/[^\s>"]+')
      if ($m.Success) { $teams = $m.Value }
    } catch { }
    $events += [ordered]@{
      id = $e.EntryID
      subject = $e.Subject
      start_utc = ([datetime]$e.StartUTC).ToString('yyyy-MM-ddTHH:mm:ssZ')
      end_utc = ([datetime]$e.EndUTC).ToString('yyyy-MM-ddTHH:mm:ssZ')
      all_day = [bool]$e.AllDayEvent
      location = $e.Location
      organizer = $e.Organizer
      is_organizer = ($e.ResponseStatus -eq 1)
      attendees = [math]::Max(0, $e.Recipients.Count - 1)
      response = $RESPONSE[[int]$e.ResponseStatus]
      busy = $BUSY[[int]$e.BusyStatus]
      cancelled = ($e.MeetingStatus -eq 5 -or $e.MeetingStatus -eq 7)
      teams_url = $teams
    }
  }
  return @{ events = $events; truncated = $truncated }
}

$WELL_KNOWN = @{
  'inbox' = 6; 'sent' = 5; 'sent items' = 5; 'sentitems' = 5; 'drafts' = 16; 'draft' = 16
  'deleted' = 3; 'deleted items' = 3; 'deleteditems' = 3; 'trash' = 3
  'junk' = 23; 'junk email' = 23; 'junkemail' = 23; 'outbox' = 4
}

function Find-Folder([string]$Name) {
  $key = $Name.ToLower()
  if ($WELL_KNOWN.ContainsKey($key)) { return Get-Folder $WELL_KNOWN[$key] }
  $root = $script:store.GetRootFolder()
  foreach ($f in $root.Folders) { if ($f.Name -eq $Name) { return $f } }
  foreach ($f in (Get-Folder 6).Folders) { if ($f.Name -eq $Name) { return $f } }
  $names = ($root.Folders | ForEach-Object { $_.Name } | Select-Object -First 30) -join ', '
  throw "No folder called `"$Name`". Top-level folders: $names"
}

function Dasl-Escape([string]$s) { return $s.Replace("'", "''") }

# Outlook-style query -> DASL. Words must all match somewhere; from:/to:/subject:
# narrow a word to that field. "quoted phrases" stay together.
function Query-Filter([string]$Query) {
  $parts = @()
  $tokens = [regex]::Matches($Query, '(\w+:)?("[^"]+"|\S+)')
  foreach ($t in $tokens) {
    $field = $t.Groups[1].Value.TrimEnd(':').ToLower()
    $word = Dasl-Escape ($t.Groups[2].Value.Trim('"'))
    if (-not $word -or $word -in @('AND', 'and')) { continue }
    $like = "LIKE '%$word%'"
    switch ($field) {
      'from' { $parts += "(""urn:schemas:httpmail:fromname"" $like OR ""http://schemas.microsoft.com/mapi/proptag/0x5D01001F"" $like OR ""urn:schemas:httpmail:fromemail"" $like)" }
      'to' { $parts += "(""urn:schemas:httpmail:displayto"" $like OR ""urn:schemas:httpmail:displaycc"" $like)" }
      'subject' { $parts += "(""urn:schemas:httpmail:subject"" $like)" }
      default {
        $parts += "(""urn:schemas:httpmail:subject"" $like OR ""urn:schemas:httpmail:fromname"" $like OR ""http://schemas.microsoft.com/mapi/proptag/0x5D01001F"" $like OR ""urn:schemas:httpmail:displayto"" $like OR ""urn:schemas:httpmail:textdescription"" $like)"
      }
    }
  }
  return ($parts -join ' AND ')
}

function Tool-SearchMail($a) {
  $limit = [int]$a.limit
  if ($limit -lt 1) { $limit = 25 }
  $folders = @()
  if ($a.folder) { $folders += Find-Folder $a.folder }
  else {
    $folders += Get-Folder 6
    $folders += Get-Folder 5
    foreach ($f in $script:store.GetRootFolder().Folders) { if ($f.Name -eq 'Archive') { $folders += $f } }
  }
  $daslParts = @()
  if ($a.query) { $q = Query-Filter $a.query; if ($q) { $daslParts += $q } }
  if ($a.unread_only) { $daslParts += '"urn:schemas:httpmail:read" = 0' }

  $all = @()
  foreach ($f in $folders) {
    $items = $f.Items
    if ($a.since_utc) { $items = $items.Restrict("[ReceivedTime] >= '" + (Jet-Date (From-Utc $a.since_utc)) + "'") }
    if ($daslParts.Count) { $items = $items.Restrict('@SQL=' + ($daslParts -join ' AND ')) }
    $items.Sort('[ReceivedTime]', $true)
    $n = 0
    $m = $items.GetFirst()
    while ($m -and $n -lt $limit) {
      if ($m.Class -eq 43 -or $m.Class -eq 53 -or $m.Class -eq 54 -or $m.Class -eq 55 -or $m.Class -eq 56 -or $m.Class -eq 57) {
        $preview = ''
        try { $preview = ([string]$m.Body) -replace '\s+', ' ' } catch { }
        if ($preview.Length -gt 240) { $preview = $preview.Substring(0, 240) }
        $atts = 0
        try { $atts = $m.Attachments.Count } catch { }
        $all += [ordered]@{
          id = $m.EntryID
          subject = $m.Subject
          from_name = $m.SenderName
          from_email = (Smtp-Of $m)
          received_utc = (To-Utc $m.ReceivedTime)
          unread = [bool]$m.UnRead
          draft = ($m.Class -eq 43 -and -not $m.Sent)
          attachments = $atts
          importance = @('low', 'normal', 'high')[[int]$m.Importance]
          preview = $preview.Trim()
          folder = $f.Name
        }
        $n++
      }
      $m = $items.GetNext()
    }
  }
  $sorted = @($all | Sort-Object { $_.received_utc } -Descending | Select-Object -First $limit)
  return @{ messages = $sorted; folders = @($folders | ForEach-Object { $_.Name }) }
}

function Thread-Message($m) {
  $names = @()
  try { foreach ($att in $m.Attachments) { if ($att.Type -ne 6) { $names += $att.FileName } } } catch { }
  $sent = $null
  try { if ($m.SentOn -and ([datetime]$m.SentOn).Year -gt 1601 -and ([datetime]$m.SentOn).Year -lt 4000) { $sent = To-Utc $m.SentOn } } catch { }
  if (-not $sent) { try { $sent = To-Utc $m.ReceivedTime } catch { } }
  if (-not $sent) { try { $sent = To-Utc $m.CreationTime } catch { } }
  return [ordered]@{
    id = $m.EntryID
    from_name = $m.SenderName
    from_email = (Smtp-Of $m)
    to = (Recipient-Text $m 1)
    cc = (Recipient-Text $m 2)
    sent_utc = $sent
    attachments = $names
    draft = ($m.Class -eq 43 -and -not $m.Sent)
    body = (Trim-Quoted ([string]$m.Body))
  }
}

function Tool-GetThread($a) {
  $item = Get-ItemById $a.id
  $msgs = @()
  $conv = $null
  try { $conv = $item.GetConversation() } catch { }
  if ($conv) {
    $table = $conv.GetTable()
    $seen = @{}
    while (-not $table.EndOfTable) {
      $row = $table.GetNextRow()
      $eid = $row.Item('EntryID')
      if (-not $eid -or $seen.ContainsKey($eid)) { continue }
      $seen[$eid] = $true
      try {
        $m = Get-ItemById $eid
        if ($m.Class -eq 43 -or ($m.Class -ge 53 -and $m.Class -le 57)) { $msgs += Thread-Message $m }
      } catch { }
      if ($msgs.Count -ge 50) { break }
    }
  }
  if (-not $msgs.Count) { $msgs += Thread-Message $item }
  $sorted = @($msgs | Sort-Object { $_.sent_utc })
  return @{ subject = $item.ConversationTopic; messages = $sorted }
}

function Insert-Html([string]$Existing, [string]$Html) {
  if (-not $Html) { return $Existing }
  $m = [regex]::Match($Existing, '<body[^>]*>', 'IgnoreCase')
  if ($m.Success) { return $Existing.Insert($m.Index + $m.Length, $Html + '<br>') }
  return $Html + '<br>' + $Existing
}

function Tool-CreateDraft($a) {
  if ($a.reply_to_id) {
    $orig = Get-ItemById $a.reply_to_id
    if ($a.reply_all) { $d = $orig.ReplyAll() } else { $d = $orig.Reply() }
    if ($a.html) { $d.HTMLBody = Insert-Html $d.HTMLBody $a.html }
    if ($a.to_set) { Set-Recipients $d $a.to 1 }
    if ($a.cc_set) { Set-Recipients $d $a.cc 2 }
    if ($a.subject) { $d.Subject = $a.subject }
  } else {
    $d = (Get-Folder 16).Items.Add(0)
    Set-SendAccount $d
    Set-Recipients $d $a.to 1
    if ($a.cc_set) { Set-Recipients $d $a.cc 2 }
    $d.Subject = $a.subject
    $d.HTMLBody = '<html><body>' + $a.html + '</body></html>'
  }
  if (-not $a.reply_to_id -or -not (Get-SendAccount $d)) { Set-SendAccount $d }
  $null = $d.Recipients.ResolveAll()
  $d.Save()
  $from = Get-SendAccount $d
  if ($from -and $from -ne $script:acct.SmtpAddress) {
    $d.Delete()
    throw "Outlook would have sent this from $from instead of $($script:acct.SmtpAddress), so the draft was not kept."
  }
  $out = @{ id = $d.EntryID; to = (Recipient-Text $d 1); cc = (Recipient-Text $d 2); subject = $d.Subject; from = $from }
  # The account choice itself is not stored on a saved draft (drafts made by
  # hand in this mailbox carry none either); Exchange stamps it at send time
  # from the mailbox the draft lives in, and send_mail sets it again just
  # before sending. Close releases the item so Outlook isn't left holding it.
  $d.Close(0)
  return $out
}

function Tool-SendMail($a) {
  $d = Get-ItemById $a.draft_id
  if ($d.Class -ne 43 -or $d.Sent) { throw 'That item is not an unsent draft. send_mail only sends drafts made with create_draft.' }
  $draftsId = (Get-Folder 16).EntryID
  if ($d.Parent.EntryID -ne $draftsId) { throw 'That message is not in Drafts. send_mail only sends drafts made with create_draft.' }
  if ($d.Recipients.Count -lt 1) { throw 'The draft has no recipients.' }
  $from = Get-SendAccount $d
  if ($from -and $from -ne $script:acct.SmtpAddress) { throw "That draft is set to send from $from, not $($script:acct.SmtpAddress). Not sent." }
  if (-not $from) { Set-SendAccount $d; $d.Save() }
  if ((Get-SendAccount $d) -ne $script:acct.SmtpAddress) { throw "Couldn't set the draft to send from $($script:acct.SmtpAddress). Not sent." }
  if (-not $d.Recipients.ResolveAll()) { throw 'Outlook could not resolve every recipient on the draft.' }
  $out = @{ to = (Recipient-Text $d 1); cc = (Recipient-Text $d 2); subject = $d.Subject }
  $d.Send()
  return $out
}

function Tool-CreateEvent($a) {
  $e = (Get-Folder 9).Items.Add(1)
  $e.Subject = $a.subject
  $e.Start = From-Utc $a.start_utc
  $e.End = From-Utc $a.end_utc
  if ($a.location) { $e.Location = $a.location }
  if ($a.body) { $e.Body = $a.body }
  $e.ReminderSet = $true
  $e.ReminderMinutesBeforeStart = 15
  if ($a.attendees -and @($a.attendees).Count) {
    $e.MeetingStatus = 1
    Set-SendAccount $e
    foreach ($p in $a.attendees) { $r = $e.Recipients.Add([string]$p.address); $r.Type = 1 }
    $null = $e.Recipients.ResolveAll()
    $e.Save()
    $id = $e.EntryID
    $e.Send()
  } else {
    $e.Save()
    $id = $e.EntryID
    $e.Close(0)
  }
  return @{ id = $id }
}

function Invoke-Tool([string]$Name, $ToolArgs) {
  Get-Outlook
  switch ($Name) {
    'list_events' { return Tool-ListEvents $ToolArgs }
    'search_mail' { return Tool-SearchMail $ToolArgs }
    'get_thread' { return Tool-GetThread $ToolArgs }
    'create_draft' { return Tool-CreateDraft $ToolArgs }
    'send_mail' { return Tool-SendMail $ToolArgs }
    'create_event' { return Tool-CreateEvent $ToolArgs }
    default { throw "Unknown tool $Name" }
  }
}

if ($Test) {
  # -TestArgs @C:\path\args.json reads the arguments from a file.
  $json = if ($TestArgs.StartsWith('@')) { Get-Content -Raw -Encoding UTF8 $TestArgs.Substring(1) } else { $TestArgs }
  $r = Invoke-Tool $Test ($json | ConvertFrom-Json)
  $r | ConvertTo-Json -Depth 6
  return
}

# ------------------------------------------------------------------ loop
if (-not (Test-Path $ConfigPath)) { throw "Not installed. Run with -Install -Token <code> first." }
$script:cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

# One copy at a time, however many triggers fire.
$mutex = New-Object Threading.Mutex($false, 'Local\OmniOutlookBridge')
if (-not $mutex.WaitOne(0)) { return }

$headers = @{ apikey = $script:cfg.anon_key; Authorization = "Bearer $($script:cfg.anon_key)" }
$rpc = $script:cfg.supabase_url.TrimEnd('/') + '/rest/v1/rpc/'

function Invoke-Rpc([string]$Fn, $Body) {
  $json = $Body | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod -Method Post -Uri ($rpc + $Fn) -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 30 -UseBasicParsing
}

Write-Log 'started'
$note = 'ok'
$failures = 0
while ($true) {
  try {
    $job = Invoke-Rpc 'mcp_bridge_poll' @{ p_token = $script:cfg.token; p_note = $note }
    $failures = 0
  } catch {
    $failures++
    if ($_.Exception.Message -match '28000|unknown bridge token|401') { Write-Log 'token refused; reinstall the bridge'; Start-Sleep -Seconds 300; continue }
    if ($failures -eq 1 -or $failures % 40 -eq 0) { Write-Log "poll failed: $($_.Exception.Message)" }
    Start-Sleep -Seconds ([math]::Min(30, 2 * $failures))
    continue
  }
  if (-not $job -or -not $job.id) {
    # Idle: keep the Outlook health note fresh for the server's error messages.
    try { Get-Outlook; $note = 'ok' } catch { $note = "Outlook isn't available: $($_.Exception.Message)".Substring(0, [math]::Min(190, "Outlook isn't available: $($_.Exception.Message)".Length)) }
    Start-Sleep -Milliseconds 1500
    continue
  }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $ok = $true
  try {
    $result = Invoke-Tool $job.tool $job.args
  } catch {
    $ok = $false
    $msg = $_.Exception.Message
    if ($msg -match '0x80010001|0x8001010A') { $msg = 'Outlook is busy (a dialog may be open). Try again in a moment.' }
    $result = @{ error = $msg }
    # A dead COM link is fixed by reconnecting on the next job.
    $script:ol = $null
  }
  try {
    $null = Invoke-Rpc 'mcp_bridge_finish' @{ p_token = $script:cfg.token; p_job = $job.id; p_ok = $ok; p_result = $result }
  } catch {
    Write-Log "finish failed for $($job.tool): $($_.Exception.Message)"
  }
  Write-Log ("{0} {1} in {2} ms" -f $job.tool, $(if ($ok) { 'ok' } else { 'error' }), $sw.ElapsedMilliseconds)
}
