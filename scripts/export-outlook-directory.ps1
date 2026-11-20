# Exports the company address list (the Exchange Global Address List) from
# classic Outlook to a CSV that Omni's Outlook pane imports as is:
# "Set up a meeting" -> "Company directory" -> choose the file.
#
# Why a script: new Outlook and Outlook on the web will not let you select more
# than one person in the Address Book, and there is no export. Classic Outlook
# (OUTLOOK.EXE) exposes the same list through its object model, read from the
# offline address book, so this needs no extra permission and asks IT nothing.
#
# Classic Outlook must be installed with the work account in its profile. It
# runs whether or not Outlook is open. People only: rooms, distribution lists
# and contacts outside the company are skipped.
#
#   powershell -ExecutionPolicy Bypass -File scripts\export-outlook-directory.ps1 [-Out C:\path\directory.csv]

param([string]$Out = (Join-Path $env:USERPROFILE 'Downloads\company-directory.csv'))

try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
catch { $ol = New-Object -ComObject Outlook.Application }

$gal = $ol.Session.GetGlobalAddressList()
if (-not $gal) { throw 'No company address list: is a work (Exchange) account set up in classic Outlook?' }
$entries = $gal.AddressEntries
$total = $entries.Count
Write-Host "Reading $total entries from '$($gal.Name)'..."

$rows = New-Object System.Collections.Generic.List[object]
$i = 0
foreach ($e in $entries) {
  $i++
  if ($i % 250 -eq 0) { Write-Host "  $i / $total" }
  # 0 = a mailbox user, 5 = a remote (synced) user. Everything else is a
  # group, a room, a public folder or an outside contact.
  if ($e.AddressEntryUserType -ne 0 -and $e.AddressEntryUserType -ne 5) { continue }
  $u = $e.GetExchangeUser()
  if (-not $u -or -not $u.PrimarySmtpAddress) { continue }
  # Service and admin accounts are mailboxes too, but nobody invites them.
  if ("$($u.Name)" -match '^\[|service account|^svc|^admin[\s_-]') { continue }
  $first = "$($u.FirstName)".Trim(); $last = "$($u.LastName)".Trim()
  $rows.Add([pscustomobject]@{
    Name       = if ($first -and $last) { "$first $last" } else { "$($u.Name)" }
    Email      = "$($u.PrimarySmtpAddress)".ToLower()
    'Job Title' = "$($u.JobTitle)"
    Department = "$($u.Department)"
  })
}

$rows | Sort-Object Name | Export-Csv -Path $Out -NoTypeInformation -Encoding UTF8
Write-Host "Saved $($rows.Count) people to $Out"
