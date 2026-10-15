$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [System.Environment]::GetFolderPath('Desktop')
$StartMenu = [System.Environment]::GetFolderPath('Programs')
$TargetDir = $PSScriptRoot
$TargetExe = Join-Path $TargetDir "IndependentBooks.exe"
if (-not (Test-Path $TargetExe)) { $TargetExe = Join-Path $TargetDir "Launch.bat" }

# Desktop Shortcut
$DesktopShortcutPath = Join-Path $Desktop "Independent Books.lnk"
$Shortcut = $WshShell.CreateShortcut($DesktopShortcutPath)
$Shortcut.TargetPath = $TargetExe
$Shortcut.WorkingDirectory = $TargetDir
$IcoPath = Join-Path $TargetDir "app.ico"
if (Test-Path $IcoPath) { $Shortcut.IconLocation = "$IcoPath,0" }
$Shortcut.Description = "Independent Books - 1:1 Tally Prime Accounting Application"
$Shortcut.Save()
Write-Host "Created Desktop Shortcut: $DesktopShortcutPath" -ForegroundColor Green

# Start Menu Shortcut
$AppStartMenuDir = Join-Path $StartMenu "Independent Books"
if (-not (Test-Path $AppStartMenuDir)) {
    New-Item -Path $AppStartMenuDir -ItemType Directory -Force | Out-Null
}
$StartMenuShortcutPath = Join-Path $AppStartMenuDir "Independent Books.lnk"
$SmShortcut = $WshShell.CreateShortcut($StartMenuShortcutPath)
$SmShortcut.TargetPath = $TargetExe
$SmShortcut.WorkingDirectory = $TargetDir
if (Test-Path $IcoPath) { $SmShortcut.IconLocation = "$IcoPath,0" }
$SmShortcut.Description = "Independent Books"
$SmShortcut.Save()
Write-Host "Created Start Menu Shortcut: $StartMenuShortcutPath" -ForegroundColor Green
