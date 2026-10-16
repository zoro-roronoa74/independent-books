param([ValidateRange(1024,65535)][int]$Port = 3543, [string]$DataPath = '', [switch]$NoBrowser, [switch]$Lan)
$ErrorActionPreference = 'Stop'
$applicationRoot = $PSScriptRoot
if (-not $DataPath) {
    if ($env:INDEPENDENT_BOOKS_DATA) {
        $DataPath = $env:INDEPENDENT_BOOKS_DATA
    } elseif ((Test-Path (Join-Path $applicationRoot 'installed.marker')) -or ($applicationRoot -like "*$env:LOCALAPPDATA\Programs\IndependentBooks*")) {
        $userDir = Join-Path $env:LOCALAPPDATA 'IndependentBooks\data'
        if (-not (Test-Path $userDir)) { New-Item -ItemType Directory -Path $userDir -Force | Out-Null }
        $DataPath = Join-Path $userDir 'books.sqlite3'
    } else {
        $localDataDir = Join-Path $applicationRoot 'data'
        if (-not (Test-Path $localDataDir)) { New-Item -ItemType Directory -Path $localDataDir -Force | Out-Null }
        $DataPath = Join-Path $localDataDir 'books.sqlite3'
    }
}
$running = $false
$availablePort = $null
$explicitPort = $PSBoundParameters.ContainsKey('Port')

function Test-PortOccupied([int]$p) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $p, $null, $null)
        $ready = $async.AsyncWaitHandle.WaitOne(50)
        return ($ready -and $client.Connected)
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

$candidatePorts = if ($explicitPort) { @($Port) } else { 3543..3553 }
foreach ($candidatePort in $candidatePorts) {
    $applicationUrl = "http://127.0.0.1:$candidatePort"
    $status = $null
    $occupied = Test-PortOccupied $candidatePort
    if ($occupied) {
        try {
            $status = Invoke-RestMethod -Uri "$applicationUrl/api/status" -TimeoutSec 1
        } catch { }
        if ($status -and $status.independent -and $status.application_root -eq $applicationRoot) {
            $Port = $candidatePort
            $running = $true
            break
        }
        if ($explicitPort) {
            throw "Port $candidatePort belongs to a different application copy. Choose a different -Port."
        }
    } elseif ($null -eq $availablePort) {
        $availablePort = $candidatePort
    }
}

if (-not $running) {
    if ($null -eq $availablePort) { throw 'No local application port is available. Choose a different -Port.' }
    $Port = $availablePort
}
$applicationUrl = "http://127.0.0.1:$Port"
if (-not $running) {
    $nativeServer = Join-Path $applicationRoot 'app_server.exe'
    if (Test-Path $nativeServer) {
        $argString = ('--port {0}' -f $Port)
        if ($DataPath) { $argString += (' --data "{0}"' -f $DataPath) }
        if ($Lan) { $argString += ' --lan' }
        Start-Process -FilePath $nativeServer -ArgumentList $argString -WorkingDirectory $applicationRoot -WindowStyle Hidden
    } else {
        $interpreters = @(
            (Join-Path $applicationRoot 'runtime\pythonw.exe'),
            "$env:LOCALAPPDATA\Programs\Python\Python39\pythonw.exe",
            "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\pythonw.exe",
            "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
        )
        $interpreter = $interpreters | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $interpreter) { throw 'Python 3.9 or later is required. See README.md.' }
        $serverFile = Join-Path $applicationRoot 'app_server.py'
        $argString = ('-E -s "{0}" --port {1}' -f $serverFile, $Port)
        if ($DataPath) { $argString += (' --data "{0}"' -f $DataPath) }
        if ($Lan) { $argString += ' --lan' }
        Start-Process -FilePath $interpreter -ArgumentList $argString -WorkingDirectory $applicationRoot -WindowStyle Hidden
    }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $readinessStatus = $null
        try { $readinessStatus = Invoke-RestMethod -Uri "$applicationUrl/api/status" -TimeoutSec 1 } catch { }
        if ($readinessStatus) {
            if (-not $readinessStatus.independent -or $readinessStatus.application_root -ne $applicationRoot) {
                throw 'This port belongs to a different application copy. Use a different -Port.'
            }
            $running = $true
            break
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $running) { throw 'The application could not start. Run python app_server.py to see diagnostics.' }
}
if ($NoBrowser) { exit 0 }
$browserPaths = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:GoogleChromePath",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
)
$browser = $browserPaths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if ($browser) {
    $profileDir = Join-Path $env:LOCALAPPDATA 'IndependentBooks\profile'
    if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir -Force | Out-Null }
    Start-Process -FilePath $browser -ArgumentList @("--user-data-dir=$profileDir", "--app=$applicationUrl", '--no-first-run', '--no-default-browser-check', '--start-maximized')
} else { Start-Process $applicationUrl }
