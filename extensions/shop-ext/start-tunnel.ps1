# Starts a Cloudflare quick tunnel to the local bridge and writes the public
# https://….trycloudflare.com origin into config.js (BRIDGE_EBS_BASE).
# Launched by start-tunnel.bat. Leave the window open; closing it stops the tunnel.

$ErrorActionPreference = "Continue"

try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $OutputEncoding = [Console]::OutputEncoding
} catch {}

if (-not ("ShopTunnelJob" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ShopTunnelJob {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetInformationJobObject(IntPtr hJob, int cls, IntPtr info, uint len);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  [StructLayout(LayoutKind.Sequential)]
  struct BASIC {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IO {
    public ulong a,b,c,d,e,f;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct EXT {
    public BASIC Basic;
    public IO Io;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  public static IntPtr Create() {
    IntPtr h = CreateJobObject(IntPtr.Zero, null);
    if (h == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    var info = new EXT();
    info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    int length = Marshal.SizeOf(typeof(EXT));
    IntPtr ptr = Marshal.AllocHGlobal(length);
    try {
      Marshal.StructureToPtr(info, ptr, false);
      if (!SetInformationJobObject(h, 9, ptr, (uint)length))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      Marshal.FreeHGlobal(ptr);
    }
    return h;
  }
}
"@
}

function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $candidates = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:LocalAppData\Microsoft\WinGet\Links\cloudflared.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

function Test-BridgePort {
  $tcp = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 3920)
    return [bool]$tcp.Connected
  } catch {
    return $false
  } finally {
    if ($tcp) { $tcp.Dispose() }
  }
}

function Read-SharedText([string]$path) {
  $fs = $null
  $sr = $null
  try {
    $fs = [System.IO.File]::Open(
      $path,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::ReadWrite
    )
    $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
    return $sr.ReadToEnd()
  } finally {
    if ($sr) { $sr.Dispose() }
    elseif ($fs) { $fs.Dispose() }
  }
}

function Read-TunnelUrl([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $text = Read-SharedText $path
  } catch {
    return $null
  }
  $m = [regex]::Match($text, "https://[a-z0-9-]+\.trycloudflare\.com")
  if ($m.Success) { return $m.Value }
  return $null
}

function Update-BridgeBase([string]$path, [string]$url) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $text = [System.IO.File]::ReadAllText($path, $utf8)
  $pattern = 'window\.BRIDGE_EBS_BASE\s*=\s*window\.BRIDGE_EBS_BASE\s*\|\|\s*"[^"]*"'
  $replacement = 'window.BRIDGE_EBS_BASE = window.BRIDGE_EBS_BASE || "' + $url + '"'
  $match = [regex]::Match($text, $pattern)
  if (-not $match.Success) {
    $pattern = 'window\.BRIDGE_EBS_BASE\s*=\s*"[^"]*"'
    $replacement = 'window.BRIDGE_EBS_BASE = "' + $url + '"'
    $match = [regex]::Match($text, $pattern)
  }
  if (-not $match.Success) {
    throw "config.js has no window.BRIDGE_EBS_BASE assignment"
  }
  $next = $text.Remove($match.Index, $match.Length).Insert($match.Index, $replacement)
  if ($next -eq $text) { return $false }
  [System.IO.File]::WriteAllText($path, $next, $utf8)
  return $true
}

function Test-TunnelHttp([string]$url) {
  $target = $url.TrimEnd("/") + "/api/ext/shop"
  for ($i = 0; $i -lt 4; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $target -UseBasicParsing -TimeoutSec 6
      return [int]$resp.StatusCode
    } catch {
      $response = $_.Exception.Response
      if ($response) { return [int]$response.StatusCode }
    }
    Start-Sleep -Seconds 2
  }
  return $null
}

function Show-TunnelBox([string]$body) {
  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup($body, 0, "Shop tunnel", 64)
  } catch {
    Write-Host $_.Exception.Message
  }
}

if ($MyInvocation.InvocationName -eq ".") { return }

$cloudflared = Find-Cloudflared
if (-not $cloudflared) {
  Write-Host "cloudflared не найден. Установите: winget install --id Cloudflare.cloudflared" -ForegroundColor Red
  exit 1
}

$configPath = Join-Path $PSScriptRoot "config.js"
if (-not (Test-Path -LiteralPath $configPath)) {
  Write-Host "Рядом со скриптом нет config.js" -ForegroundColor Red
  exit 1
}

$logPath = Join-Path $env:TEMP ("shop-ext-tunnel-" + [guid]::NewGuid().ToString("n") + ".log")
$bridgeUp = Test-BridgePort

try { $Host.UI.RawUI.WindowTitle = "Shop tunnel  127.0.0.1:3920" } catch {}
Write-Host ""
Write-Host "Cloudflare quick tunnel  ->  http://127.0.0.1:3920" -ForegroundColor Cyan
Write-Host "cloudflared: $cloudflared"
if ($bridgeUp) {
  Write-Host "Bridge на 127.0.0.1:3920 слушает." -ForegroundColor Green
} else {
  Write-Host "127.0.0.1:3920 не слушает. Запустите bridge: npm run dev" -ForegroundColor Yellow
}
Write-Host "Окно должно оставаться открытым. Закройте его, чтобы остановить туннель." -ForegroundColor Yellow
Write-Host ""

$proc = $null
$exitCode = 1
try {
  $job = [ShopTunnelJob]::Create()
  $proc = Start-Process -FilePath $cloudflared -ArgumentList @(
    "tunnel",
    "--no-autoupdate",
    "--logfile", $logPath,
    "--loglevel", "info",
    "--url", "http://127.0.0.1:3920"
  ) -PassThru -NoNewWindow

  $assigned = $false
  try { $assigned = [ShopTunnelJob]::AssignProcessToJobObject($job, $proc.Handle) } catch { $assigned = $false }
  if (-not $assigned) {
    Write-Host "Не удалось привязать процесс туннеля к окну. После закрытия окна проверьте, что cloudflared не остался в диспетчере задач." -ForegroundColor Yellow
  }

  $url = $null
  $deadline = (Get-Date).AddSeconds(90)
  while (-not $url -and -not $proc.HasExited -and (Get-Date) -lt $deadline) {
    $url = Read-TunnelUrl $logPath
    if (-not $url) { Start-Sleep -Milliseconds 400 }
  }

  if (-not $url) {
    Write-Host "URL туннеля не появился. Лог: $logPath" -ForegroundColor Red
    if (Test-Path -LiteralPath $logPath) {
      Write-Host "---- log ----" -ForegroundColor DarkGray
      try { Write-Host (Read-SharedText $logPath) } catch {}
    }
  } else {
    $wrote = $false
    $configError = $null
    try {
      $wrote = Update-BridgeBase $configPath $url
    } catch {
      $configError = $_.Exception.Message
    }
    $copied = $false
    try {
      Set-Clipboard -Value $url
      $copied = $true
    } catch {}

    try { $Host.UI.RawUI.WindowTitle = "Shop tunnel  $url" } catch {}
    Write-Host ""
    Write-Host "TUNNEL  $url" -ForegroundColor Green
    if ($configError) {
      Write-Host "Не удалось записать config.js: $configError" -ForegroundColor Red
    } elseif ($wrote) {
      Write-Host "config.js обновлён (BRIDGE_EBS_BASE)." -ForegroundColor Green
    } else {
      Write-Host "config.js уже указывает на этот адрес." -ForegroundColor Green
    }
    if ($copied) { Write-Host "Адрес скопирован в буфер обмена." -ForegroundColor Green }
    Write-Host ""

    $bridgeUp = Test-BridgePort
    $httpCode = Test-TunnelHttp $url

    $bridgeLine = if ($bridgeUp) { "Bridge 127.0.0.1:3920: слушает." } else { "Bridge 127.0.0.1:3920: не слушает. Запустите npm run dev." }
    $tunnelLine = if ($httpCode -eq 200) {
      "Туннель доходит до bridge."
    } elseif ($httpCode -in 401, 403) {
      "Туннель доходит до bridge. Ответ $httpCode для запроса без JWT — для панели это нормально."
    } elseif ($null -ne $httpCode) {
      "Туннель есть, bridge ответил HTTP $httpCode. Проверьте, что npm run dev запущен."
    } else {
      "Туннель пока не ответил. Адрес уже в config.js — откройте $url/api/ext/shop через несколько секунд."
    }
    $clipLine = if ($copied) { "Адрес скопирован в буфер обмена." } else { "Скопируйте адрес из заголовка окна." }
    $configLine = if ($configError) { "config.js не обновлён: $configError" } else { "config.js обновлён." }

    $body = @"
Туннель запущен

$url

$configLine
$clipLine

Дальше:
- Twitch Developer Console, Allowlist: этот хост, без пути
- Hosted Test: заново залейте zip с config.js
- Local Test: обновите страницу расширения

$bridgeLine
$tunnelLine

Не закрывайте чёрное окно, пока нужен туннель.
"@
    Show-TunnelBox $body

    if (-not $proc.HasExited) { Wait-Process -Id $proc.Id }
    $exitCode = 0
  }
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}

exit $exitCode
