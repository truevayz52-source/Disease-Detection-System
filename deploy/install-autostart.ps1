# Creates the Startup-folder shortcut that boots the DDS stack at login.
$target = Join-Path $PSScriptRoot "start-all.ps1"
$link = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\DDS-Stack.lnk"
$w = New-Object -ComObject WScript.Shell
$s = $w.CreateShortcut($link)
$s.TargetPath = "powershell.exe"
$s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$target`""
$s.WindowStyle = 7
$s.Save()
Write-Output "Installed autostart shortcut: $link"
