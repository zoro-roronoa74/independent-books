$Desktop = [System.Environment]::GetFolderPath('Desktop')
$StartMenu = [System.Environment]::GetFolderPath('Programs')

$DesktopShortcut = Join-Path $Desktop "Independent Books.lnk"
if (Test-Path $DesktopShortcut) { Remove-Item -Path $DesktopShortcut -Force }

$AppStartMenu = Join-Path $StartMenu "Independent Books"
if (Test-Path $AppStartMenu) { Remove-Item -Path $AppStartMenu -Recurse -Force }

Write-Host "Shortcuts removed. To complete removal, delete directory: $PSScriptRoot" -ForegroundColor Yellow
