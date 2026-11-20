<#
  Omni reminders and follow-ups: the PC side.

  The Outlook pane saves reminders and follow-ups (email_followups). This
  script, run every 15 minutes by a scheduled task while you are signed in,
  does the part a web pane cannot:

    reminder   handed to classic Outlook as a reply on the thread with
               "Do not deliver before" set. Exchange holds it until then, so
               it goes out on time even if this PC is off that day.
    follow-up  watches the thread. If nobody but you has written in it since
               the reminder (or since it was set up) by its date, it writes the
               follow-up as a reply to the latest message and sends it, or
               leaves it in Drafts flagged with a reminder, as chosen.

  Nothing happens while classic Outlook is closed; it picks up where it left
  off next time. It never opens windows.

  Install (once, with the code the pane shows):
    powershell -ExecutionPolicy Bypass -File omni-runner.ps1 -Install -Token <code>
  Check what it would do, sending and saving nothing:
    powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Omni\omni-runner.ps1" -DryRun
  Remove:
    powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Omni\omni-runner.ps1" -Uninstall
#>
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$DryRun,
  [string]$Token,
  [string]$Site = 'https://omni-nine-navy.vercel.app'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Dir = Join-Path $env:LOCALAPPDATA 'Omni'
$ConfigPath = Join-Path $Dir 'runner.json'
$LogPath = Join-Path $Dir 'runner.log'
$TaskName = 'Omni Outlook reminders'

function Write-Log([string]$Message) {
  if ($DryRun) { Write-Host $Message; return }
  try {
    Add-Content -Path $LogPath -Value ("{0}  {1}" -f (Get-Date -Format s), $Message) -Encoding UTF8
    $lines = Get-Content $LogPath
    if ($lines.Count -gt 600) { $lines | Select-Object -Last 400 | Set-Content $LogPath -Encoding UTF8 }
  } catch { }
}

# ---------------------------------------------------------------- install
if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item $ConfigPath -ErrorAction SilentlyContinue
  Write-Host 'Removed. The pane will say this PC has stopped checking in.'
  return
}

if ($Install) {
  if (-not $Token -or $Token.Length -lt 20) { throw 'Paste the whole line from the pane: it carries the -Token code.' }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $self = Join-Path $Dir 'omni-runner.ps1'
  if ($PSCommandPath -ne $self) { Copy-Item -LiteralPath $PSCommandPath -Destination $self -Force }
  @{ token = $Token; site = $Site.TrimEnd('/') } | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding ASCII

  # conhost --headless: no console window flashing up every 15 minutes.
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = "--headless `"$ps`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$self`""
  $action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\conhost.exe') -Argument $arguments
  $every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
  $logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $every, $logon `
    -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "Installed. It checks every 15 minutes while you're signed in and classic Outlook is open."
  Write-Host "Log: $LogPath"
  & $self
  return
}

# ---------------------------------------------------------------- run
if (-not (Test-Path $ConfigPath)) { Write-Host 'Not installed yet: run it once with -Install -Token <code>.'; return }
$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Site = $config.site
$Headers = @{ Authorization = "Bearer $($config.token)" }

function Get-Work([string]$Note) {
  Invoke-RestMethod -Uri ("{0}/api/outlook/runner?note={1}" -f $Site, [uri]::EscapeDataString($Note)) `
    -Headers $Headers -TimeoutSec 60
}

function Send-Report($Updates, [string]$Note) {
  if ($DryRun) {
    foreach ($u in $Updates) { Write-Host ("WOULD REPORT {0}" -f ($u | ConvertTo-Json -Compress)) }
    return
  }
  if (-not $Updates.Count -and -not $Note) { return }
  $body = @{ note = $Note; updates = @($Updates) } | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Uri "$Site/api/outlook/runner" -Method Post -Headers $Headers `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 60 | Out-Null
}

# Classic Outlook only, and only if it is already running: starting it from a
# hidden task would leave an Outlook nobody can see.
if (-not (Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)) {
  $null = Get-Work "Classic Outlook isn't open"
  return
}

try {
  $work = Get-Work 'ok'
} catch {
  Write-Log "Couldn't reach $Site : $($_.Exception.Message)"
  return
}
$items = @($work.items)
if (-not $items.Count) { return }

try {
  $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
} catch {
  $null = Get-Work "Couldn't talk to Outlook"
  Write-Log "GetActiveObject failed: $($_.Exception.Message)"
  return
}
$ns = $ol.Session
$account = $null
foreach ($a in $ns.Accounts) { if ($a.AccountType -eq 0) { $account = $a; break } }
if (-not $account) { $account = $ns.Accounts.Item(1) }
$store = $account.DeliveryStore
$me = "$($account.SmtpAddress)".ToLower()
$Inbox = $store.GetDefaultFolder(6)
$Sent = $store.GetDefaultFolder(5)

function Get-SenderSmtp($m) {
  try {
    $s = $m.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x5D01001F')
    if ($s) { return "$s".ToLower() }
  } catch { }
  try { if ($m.SenderEmailType -eq 'EX') { return "$($m.Sender.GetExchangeUser().PrimarySmtpAddress)".ToLower() } } catch { }
  return "$($m.SenderEmailAddress)".ToLower()
}

function Get-When($m) {
  try { if ($m.ReceivedTime -and $m.ReceivedTime.Year -gt 1990) { return $m.ReceivedTime } } catch { }
  try { return $m.SentOn } catch { return [datetime]::MinValue }
}

function Get-Topic([string]$Subject) {
  return ($Subject -replace '^\s*((re|fw|fwd)\s*:\s*)+', '').Trim()
}

function Find-Anchor($Item) {
  # The exact message, by its Internet id, where the pane had one.
  if ($Item.message_id) {
    $filter = '@SQL="http://schemas.microsoft.com/mapi/proptag/0x1035001F" = ''' + $Item.message_id.Replace("'", "''") + ''''
    foreach ($folder in $Inbox, $Sent) {
      $hits = $folder.Items.Restrict($filter)
      if ($hits.Count -gt 0) { return $hits.Item(1) }
    }
  }
  # Otherwise (a draft has no id until it is sent) the latest message with
  # the same topic.
  $topic = Get-Topic $Item.thread_subject
  if (-not $topic) { return $null }
  $filter = '@SQL="urn:schemas:httpmail:thread-topic" = ''' + $topic.Replace("'", "''") + ''''
  $best = $null
  foreach ($folder in $Inbox, $Sent) {
    foreach ($m in $folder.Items.Restrict($filter)) {
      if ($m.Class -ne 43) { continue }
      if (-not $best -or (Get-When $m) -gt (Get-When $best)) { $best = $m }
    }
  }
  return $best
}

function Get-ThreadMail($Anchor, [string]$Subject) {
  $out = New-Object System.Collections.ArrayList
  $conv = $null
  try { $conv = $Anchor.GetConversation() } catch { }
  if ($conv) {
    $stack = New-Object System.Collections.Stack
    foreach ($r in $conv.GetRootItems()) { $stack.Push($r) }
    while ($stack.Count) {
      $i = $stack.Pop()
      if ($i.Class -eq 43) { [void]$out.Add($i) }
      foreach ($c in $conv.GetChildren($i)) { $stack.Push($c) }
    }
  }
  if (-not $out.Count) {
    $topic = Get-Topic $Subject
    $filter = '@SQL="urn:schemas:httpmail:thread-topic" = ''' + $topic.Replace("'", "''") + ''''
    foreach ($folder in $Inbox, $Sent) {
      foreach ($m in $folder.Items.Restrict($filter)) { if ($m.Class -eq 43) { [void]$out.Add($m) } }
    }
    if (-not $out.Count) { [void]$out.Add($Anchor) }
  }
  return , $out
}

function New-Reply($Anchor, $Item, [string]$Text) {
  if ($Anchor) { $mail = $Anchor.ReplyAll() } else { $mail = $ol.CreateItem(0) }
  # Exactly who the pane said, not whoever Reply All would pick.
  while ($mail.Recipients.Count -gt 0) { $mail.Recipients.Remove(1) }
  foreach ($p in @($Item.to_people)) { [void]$mail.Recipients.Add($p.email) }
  [void]$mail.Recipients.ResolveAll()
  try { $mail.SendUsingAccount = $account } catch { }
  if ($Item.subject) { $mail.Subject = $Item.subject }
  $html = ([Net.WebUtility]::HtmlEncode($Text) -replace "`r?`n", '<br>')
  $div = "<div style=`"font-family:Calibri,Arial,sans-serif;font-size:11pt`">$html</div><br>"
  $existing = "$($mail.HTMLBody)"
  if ($existing -match '<body[^>]*>') {
    $mail.HTMLBody = [regex]::Replace($existing, '(<body[^>]*>)', { param($m) $m.Groups[1].Value + $div }, 1)
  } else {
    $mail.HTMLBody = $div + $existing
  }
  return $mail
}

function Get-Local([string]$Iso) {
  return [DateTimeOffset]::Parse($Iso, [Globalization.CultureInfo]::InvariantCulture).LocalDateTime
}

$updates = New-Object System.Collections.ArrayList
$now = Get-Date

foreach ($item in $items) {
  try {
    # ---- reminder: hand it to Outlook now, held until its time.
    if ($item.reminder_status -eq 'pending') {
      $at = Get-Local $item.reminder_at
      $anchor = Find-Anchor $item
      $mail = New-Reply $anchor $item $item.reminder_body
      $mail.DeferredDeliveryTime = $at
      $late = $at -lt $now
      if ($DryRun) {
        Write-Host ("REMINDER '{0}' to {1} at {2}{3}" -f $mail.Subject, (@($item.to_people | ForEach-Object { $_.email }) -join ', '), $at, $(if ($anchor) { ' (reply on the thread)' } else { ' (new email: thread not found)' }))
        $mail.Close(1)
      } else {
        $mail.Send()
      }
      [void]$updates.Add(@{
        id = $item.id; reminder_status = 'scheduled'
        result = $(if ($late) { 'The PC was off at the time, so the reminder went out as soon as it came back.' } else { "Handed to Outlook $(Get-Date -Format 'MMM d h:mm tt')" })
      })
      $item.reminder_status = 'scheduled'
      Write-Log "Reminder $($item.id) handed to Outlook for $at"
    }

    # ---- follow-up: only once any reminder is in Outlook's hands.
    if ($item.followup_status -eq 'waiting' -and $item.reminder_status -ne 'pending') {
      $since = if ($item.reminder_status -eq 'scheduled' -and $item.reminder_at) { Get-Local $item.reminder_at } else { Get-Local $item.created_at }
      $due = Get-Local $item.followup_at
      $anchor = Find-Anchor $item
      if (-not $anchor) {
        if ($now -ge $due) {
          [void]$updates.Add(@{ id = $item.id; followup_status = 'failed'; result = "Couldn't find the email in Outlook's Inbox or Sent Items, so the follow-up wasn't written." })
        }
        continue
      }
      $thread = Get-ThreadMail $anchor $item.thread_subject
      $reply = $null
      foreach ($m in $thread) {
        if ((Get-When $m) -gt $since -and (Get-SenderSmtp $m) -ne $me) { $reply = $m; break }
      }
      if ($reply) {
        [void]$updates.Add(@{ id = $item.id; followup_status = 'replied'; result = "$($reply.SenderName) replied $((Get-When $reply).ToString('MMM d'))." })
        Write-Log "Follow-up $($item.id): $($reply.SenderName) replied"
        continue
      }
      if ($now -lt $due) { continue }

      $latest = $anchor
      foreach ($m in $thread) { if ((Get-When $m) -gt (Get-When $latest)) { $latest = $m } }
      $mail = New-Reply $latest $item $item.followup_body
      if ($DryRun) {
        Write-Host ("FOLLOW-UP ({0}) '{1}' to {2}" -f $item.followup_mode, $mail.Subject, (@($item.to_people | ForEach-Object { $_.email }) -join ', '))
        $mail.Close(1)
        [void]$updates.Add(@{ id = $item.id; followup_status = $(if ($item.followup_mode -eq 'send') { 'sent' } else { 'drafted' }) })
      } elseif ($item.followup_mode -eq 'send') {
        $mail.Send()
        [void]$updates.Add(@{ id = $item.id; followup_status = 'sent'; result = "Nobody replied, so it went out $(Get-Date -Format 'MMM d h:mm tt')." })
        Write-Log "Follow-up $($item.id) sent"
      } else {
        # Flagged with a reminder, so Outlook's own reminder window says so.
        $mail.MarkAsTask(0)
        $mail.FlagRequest = 'Send this follow-up'
        $mail.ReminderSet = $true
        $mail.ReminderTime = $now.AddMinutes(1)
        $mail.Save()
        [void]$updates.Add(@{ id = $item.id; followup_status = 'drafted'; result = 'Nobody replied. The follow-up is in Drafts for you to send.' })
        Write-Log "Follow-up $($item.id) left in Drafts"
      }
    }
  } catch {
    # Left as it was, to try again next run; the pane shows why.
    Write-Log "Item $($item.id) failed: $($_.Exception.Message)"
    [void]$updates.Add(@{ id = $item.id; result = "Last try failed: $($_.Exception.Message)" })
  }
}

try { Send-Report $updates '' } catch { Write-Log "Couldn't report back: $($_.Exception.Message)" }
