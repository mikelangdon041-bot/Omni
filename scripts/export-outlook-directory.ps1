# Exports the company address list (the Exchange Global Address List) from
# classic Outlook to a CSV that Omni's Outlook pane imports as is:
# "Set up a meeting" -> "Company directory" -> choose the file.
#
# Why a script: new Outlook and Outlook on the web will not let you select more
# than one person in the Address Book, and there is no export. Classic Outlook
# (OUTLOOK.EXE) exposes the same list through its object model, read from the
# offline address book, so this needs no extra permission and asks IT nothing.
#
# It also records which person you mean by a first name:
#   Emailed / Last Emailed - how often you sent them mail in the last year,
#     counted from the work account's Sent Items (recipients only; no message
#     content is read). People outside the company you wrote to twice or more
#     are added too, so a KOL can be invited by name.
#   Relation - report, team (further down your line), manager, peer (same
#     manager), or me.
#   Company - the legal entity, so your own company outranks the others.
#
# Classic Outlook must be installed with the work account in its profile. It
# runs whether or not Outlook is open. Rooms, distribution lists and service
# accounts are skipped.
#
#   powershell -ExecutionPolicy Bypass -File scripts\export-outlook-directory.ps1 [-Out C:\path\directory.csv] [-Days 365]

param(
  [string]$Out = (Join-Path $env:USERPROFILE 'Downloads\company-directory.csv'),
  [int]$Days = 365
)

try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
catch { $ol = New-Object -ComObject Outlook.Application }

# The work account: the Exchange one, whatever else is in the profile.
$acct = $ol.Session.Accounts | Where-Object { $_.AccountType -eq 0 } | Select-Object -First 1
if (-not $acct) { throw 'No work (Exchange) account in classic Outlook.' }
$me = $acct.CurrentUser.AddressEntry.GetExchangeUser()
$myEmail = "$($me.PrimarySmtpAddress)".ToLower()
Write-Host "You: $($me.Name) <$myEmail>, $($me.Department), $($me.CompanyName)"

# --- Where people sit relative to you --------------------------------------
$relation = @{}
function SmtpOf($exUser) { "$($exUser.PrimarySmtpAddress)".ToLower() }
function Walk($user, $depth) {
  if ($depth -gt 6) { return }
  $reports = $user.GetDirectReports()
  if (-not $reports) { return }
  foreach ($r in $reports) {
    $u = $r.GetExchangeUser()
    if (-not $u) { continue }
    $key = SmtpOf $u
    if (-not $key -or $relation.ContainsKey($key)) { continue }
    $relation[$key] = if ($depth -eq 1) { 'report' } else { 'team' }
    Walk $u ($depth + 1)
  }
}
Walk $me 1
$mgr = $me.GetExchangeUserManager()
if ($mgr) {
  $relation[(SmtpOf $mgr)] = 'manager'
  $peers = $mgr.GetDirectReports()
  if ($peers) {
    foreach ($p in $peers) {
      $u = $p.GetExchangeUser()
      if ($u -and -not $relation.ContainsKey((SmtpOf $u))) { $relation[(SmtpOf $u)] = 'peer' }
    }
  }
}
$relation[$myEmail] = 'me'
Write-Host "Your line: $(@($relation.Values | Where-Object { $_ -in 'report','team' }).Count) people under you, $(@($relation.Values | Where-Object { $_ -eq 'peer' }).Count) peers"

# --- Who you write to --------------------------------------------------------
$PR_SMTP = 'http://schemas.microsoft.com/mapi/proptag/0x39FE001E'
$sentCount = @{}
$lastSent = @{}
$outsideName = @{}
$sentFolder = $acct.DeliveryStore.GetDefaultFolder(5)
$since = (Get-Date).AddDays(-$Days).ToString('MM/dd/yyyy HH:mm')
$items = $sentFolder.Items.Restrict("[SentOn] > '$since'")
$n = 0
Write-Host "Reading recipients of $($items.Count) sent items..."
foreach ($it in $items) {
  $n++
  if ($n % 200 -eq 0) { Write-Host "  $n / $($items.Count)" }
  try { $recips = $it.Recipients; $when = $it.SentOn } catch { continue }
  if (-not $recips) { continue }
  foreach ($r in $recips) {
    $addr = ''
    try { $addr = "$($r.PropertyAccessor.GetProperty($PR_SMTP))" } catch {}
    if (-not $addr) { try { $addr = "$($r.Address)" } catch {} }
    $addr = $addr.ToLower()
    if ($addr -notmatch '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' -or $addr -eq $myEmail) { continue }
    $sentCount[$addr] = 1 + [int]$sentCount[$addr]
    if (-not $lastSent[$addr] -or $when -gt $lastSent[$addr]) { $lastSent[$addr] = $when }
    if (-not $outsideName[$addr]) { $outsideName[$addr] = "$($r.Name)" }
  }
}
Write-Host "You wrote to $($sentCount.Count) different addresses."

# --- The address list ------------------------------------------------------------
$gal = $ol.Session.GetGlobalAddressList()
$entries = $gal.AddressEntries
$total = $entries.Count
Write-Host "Reading $total entries from '$($gal.Name)'..."

$rows = New-Object System.Collections.Generic.List[object]
$inGal = @{}
$i = 0
function Row($name, $email, $title, $dept, $company) {
  [pscustomobject]@{
    Name           = $name
    Email          = $email
    'Job Title'    = $title
    Department     = $dept
    Company        = $company
    Relation       = "$($relation[$email])"
    Emailed        = [int]$sentCount[$email]
    'Last Emailed' = if ($lastSent[$email]) { $lastSent[$email].ToString('yyyy-MM-dd') } else { '' }
  }
}
foreach ($e in $entries) {
  $i++
  if ($i % 500 -eq 0) { Write-Host "  $i / $total" }
  # 0 = a mailbox user, 5 = a remote (synced) user. Everything else is a
  # group, a room, a public folder or an outside contact.
  if ($e.AddressEntryUserType -ne 0 -and $e.AddressEntryUserType -ne 5) { continue }
  $u = $e.GetExchangeUser()
  if (-not $u -or -not $u.PrimarySmtpAddress) { continue }
  # Service and admin accounts are mailboxes too, but nobody invites them.
  if ("$($u.Name)" -match '^\[|service account|^svc|^admin[\s_-]') { continue }
  $email = SmtpOf $u
  $first = "$($u.FirstName)".Trim(); $last = "$($u.LastName)".Trim()
  $name = if ($first -and $last) { "$first $last" } else { "$($u.Name)" }
  $rows.Add((Row $name $email "$($u.JobTitle)" "$($u.Department)" "$($u.CompanyName)"))
  $inGal[$email] = $true
}

# People outside the company you actually write to: worth inviting by name.
foreach ($addr in $sentCount.Keys) {
  if ($inGal[$addr] -or $sentCount[$addr] -lt 2) { continue }
  if ($addr -match '^(no-?reply|do-?not-?reply|notifications?|calendar)') { continue }
  $nm = "$($outsideName[$addr])"
  if ($nm -eq $addr -or $nm -match '@') { $nm = '' }
  $rows.Add((Row $nm $addr '' '' ''))
}

$rows | Sort-Object Name | Export-Csv -Path $Out -NoTypeInformation -Encoding UTF8
Write-Host "Saved $($rows.Count) people to $Out"
