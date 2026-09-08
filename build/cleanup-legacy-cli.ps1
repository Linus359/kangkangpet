[CmdletBinding()]
param(
  [string] $CurrentInstallRoot,
  [switch] $ElevatedChild,
  [switch] $AuditOnly
)

$ErrorActionPreference = 'Continue'
$script:LogPath = Join-Path $env:TEMP 'KangKangPet-legacy-cli-cleanup.log'
$script:LegacyRoots = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$script:KnownLegacyRoots = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$script:CurrentRoot = $null

function Write-CleanupLog {
  param([string] $Message)
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  try { Add-Content -LiteralPath $script:LogPath -Encoding UTF8 -Value $line } catch { }
}

function Resolve-FullPath {
  param([string] $Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
  try { return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))) } catch { return $null }
}

function Test-PathUnderRoot {
  param([string] $Path, [string] $Root)
  $fullPath = Resolve-FullPath $Path
  $fullRoot = Resolve-FullPath $Root
  if (-not $fullPath -or -not $fullRoot) { return $false }
  $prefix = $fullRoot.TrimEnd('\') + '\'
  return $fullPath.Equals($fullRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Add-LegacyRoot {
  param([string] $Path, [switch] $Known)
  $full = Resolve-FullPath $Path
  if (-not $full) { return }
  if ($script:CurrentRoot -and (Test-PathUnderRoot -Path $full -Root $script:CurrentRoot)) { return }
  [void] $script:LegacyRoots.Add($full.TrimEnd('\'))
  if ($Known) { [void] $script:KnownLegacyRoots.Add($full.TrimEnd('\')) }
}

function Get-UninstallEntries {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  return @(Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object {
    ([string] $_.DisplayName) -match '(?i)^Forcome(?:[ -]?AI)?[ -]?CLI(?:[ -].*)?$'
  })
}

function Get-RootFromUninstallEntry {
  param($Entry)
  $location = Resolve-FullPath ([string] $Entry.InstallLocation)
  if ($location) { return $location }
  $command = [string] $Entry.UninstallString
  if ($command -match '^\s*"([^"]+\.exe)"' -or $command -match '^\s*([^\s]+\.exe)') {
    try { return Split-Path -Parent (Resolve-FullPath $Matches[1]) } catch { }
  }
  return $null
}

function Initialize-LegacyRoots {
  if ($CurrentInstallRoot) { $script:CurrentRoot = Resolve-FullPath $CurrentInstallRoot }
  $known = @(
    (Join-Path $env:LOCALAPPDATA 'ForcomeAI\cli'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Forcome AI CLI'),
    (Join-Path $env:LOCALAPPDATA 'Programs\ForcomeAI CLI'),
    (Join-Path $env:ProgramFiles 'Forcome AI CLI'),
    (Join-Path $env:ProgramFiles 'ForcomeAI\cli')
  )
  if (${env:ProgramFiles(x86)}) {
    $known += (Join-Path ${env:ProgramFiles(x86)} 'Forcome AI CLI')
    $known += (Join-Path ${env:ProgramFiles(x86)} 'ForcomeAI\cli')
  }
  foreach ($root in $known) { Add-LegacyRoot -Path $root -Known }

  $legacyKey = Get-ItemProperty 'HKCU:\Software\ForcomeAI\CLI' -ErrorAction SilentlyContinue
  if ($legacyKey) {
    foreach ($name in @('InstallRoot', 'InstallLocation', 'Path', 'Root')) {
      Add-LegacyRoot -Path ([string] $legacyKey.$name)
    }
  }
  foreach ($entry in Get-UninstallEntries) { Add-LegacyRoot -Path (Get-RootFromUninstallEntry -Entry $entry) }
  Get-CimInstance Win32_Process -Filter "Name='ForcomeAiTray.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $exe = Resolve-FullPath ([string] $_.ExecutablePath)
    if ($exe) { Add-LegacyRoot -Path (Split-Path -Parent $exe) }
  }
}

function Test-SafeLegacyRoot {
  param([string] $Path)
  $full = Resolve-FullPath $Path
  if (-not $full -or ($script:CurrentRoot -and (Test-PathUnderRoot -Path $full -Root $script:CurrentRoot))) { return $false }
  $blocked = @([IO.Path]::GetPathRoot($full), $env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}) |
    Where-Object { $_ } | ForEach-Object { (Resolve-FullPath $_).TrimEnd('\') }
  if ($blocked -contains $full.TrimEnd('\')) { return $false }
  if ($script:KnownLegacyRoots.Contains($full.TrimEnd('\'))) { return $true }
  $markers = @(
    (Join-Path $full 'ForcomeAiTray.exe'),
    (Join-Path $full 'runtime\node.exe'),
    (Join-Path $full 'cli\node_modules\@forcome\ai-cli\package.json'),
    (Join-Path $full 'bin\fai.cmd')
  )
  return @($markers | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0
}

function Remove-LegacyTasks {
  $exactNames = @('ForcomeAI-Connector', 'ForcomeAI-Tray', 'Forcome AI CLI', 'ForcomeAI CLI')
  Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
    $task = $_
    $actionText = (($task.Actions | ForEach-Object { ([string] $_.Execute) + ' ' + ([string] $_.Arguments) }) -join ' ')
    $matchesRoot = @($script:LegacyRoots | Where-Object { $actionText.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0
    if ($exactNames -contains $task.TaskName -or $matchesRoot -or $actionText -match '(?i)@forcome[\\/]ai-cli') {
      Write-CleanupLog "移除旧版计划任务：$($task.TaskPath)$($task.TaskName)"
      try { Disable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue | Out-Null } catch { }
      try { Stop-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue } catch { }
      try { Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false -ErrorAction Stop } catch { Write-CleanupLog "计划任务移除失败：$($_.Exception.Message)" }
    }
  }
}

function Remove-LegacyRunEntries {
  $runKeys = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
  )
  $exactNames = @('ForcomeAIConnector', 'ForcomeAITray', 'ForcomeAI-Connector', 'ForcomeAI-Tray', 'com.forcome.kangkangpet')
  foreach ($key in $runKeys) {
    $values = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if (-not $values) { continue }
    foreach ($property in $values.PSObject.Properties) {
      if ($property.Name -match '^PS(Path|ParentPath|ChildName|Drive|Provider)$') { continue }
      $data = [string] $property.Value
      $matchesRoot = @($script:LegacyRoots | Where-Object { $data.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0
      if ($exactNames -contains $property.Name -or $matchesRoot -or $data -match '(?i)@forcome[\\/]ai-cli|ForcomeAiTray\.exe') {
        Write-CleanupLog "移除旧版 Run 自启项：$key -> $($property.Name)"
        try { Remove-ItemProperty -LiteralPath $key -Name $property.Name -Force -ErrorAction Stop } catch { Write-CleanupLog "Run 自启项移除失败：$($_.Exception.Message)" }
      }
    }
  }
}

function Remove-LegacyServices {
  Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object {
    $service = $_
    $pathName = [string] $service.PathName
    $rootMatch = @($script:LegacyRoots | Where-Object { $pathName.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0
    $service.Name -match '(?i)^ForcomeAI[- ]?(Connector|Tray|CLI)$' -or $rootMatch
  } | ForEach-Object {
    Write-CleanupLog "移除旧版服务：$($_.Name)"
    & sc.exe stop $_.Name 2>&1 | Out-Null
    & sc.exe delete $_.Name 2>&1 | Out-Null
  }
}

function Test-LegacyProcess {
  param($Process)
  if ([int] $Process.ProcessId -eq $PID) { return $false }
  $exe = [string] $Process.ExecutablePath
  $cmd = [string] $Process.CommandLine
  $name = [string] $Process.Name
  if ($script:CurrentRoot -and $exe -and (Test-PathUnderRoot -Path $exe -Root $script:CurrentRoot)) { return $true }
  foreach ($root in $script:LegacyRoots) {
    if (($exe -and (Test-PathUnderRoot -Path $exe -Root $root)) -or ($cmd -and $cmd.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0)) { return $true }
  }
  if ($name -ieq 'ForcomeAiTray.exe') { return $true }
  return $cmd -match '(?i)(@forcome[\\/]ai-cli|ForcomeAI[\\/]cli|fai\.(cmd|js)).*\bconnect\b'
}

function Stop-LegacyProcesses {
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    $targets = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { Test-LegacyProcess $_ })
    if ($targets.Count -eq 0) { return }
    foreach ($process in ($targets | Sort-Object ProcessId -Descending)) {
      Write-CleanupLog "停止旧版/冲突进程：$($process.Name) PID=$($process.ProcessId)"
      & taskkill.exe /PID ([string] $process.ProcessId) /T /F 2>&1 | Out-Null
    }
    Start-Sleep -Milliseconds 500
  }
}

function Get-NpmGlobalPackages {
  $paths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($prefix in @((Join-Path $env:APPDATA 'npm'), (Join-Path $env:LOCALAPPDATA 'npm'), (Join-Path $env:ProgramFiles 'nodejs'))) {
    if ($prefix) { [void] $paths.Add((Join-Path $prefix 'node_modules\@forcome\ai-cli')) }
  }
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($npm) {
    try {
      $globalRoot = (& $npm.Source root -g 2>$null | Select-Object -First 1)
      if ($globalRoot) { [void] $paths.Add((Join-Path $globalRoot.Trim() '@forcome\ai-cli')) }
    } catch { }
  }
  return @($paths)
}

function Remove-NpmGlobalCli {
  $packages = @(Get-NpmGlobalPackages | Where-Object { Test-Path -LiteralPath $_ })
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($packages.Count -gt 0 -and $npm) {
    Write-CleanupLog '卸载 npm 全局版 @forcome/ai-cli。'
    try { & $npm.Source uninstall -g '@forcome/ai-cli' --no-audit --no-fund 2>&1 | ForEach-Object { Write-CleanupLog ([string] $_) } } catch { }
  }
  foreach ($package in Get-NpmGlobalPackages) {
    if (Test-Path -LiteralPath $package) {
      try { Remove-Item -LiteralPath $package -Recurse -Force -ErrorAction Stop } catch { Write-CleanupLog "npm 全局包目录移除失败：$($_.Exception.Message)" }
    }
    $prefix = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $package))
    foreach ($shim in @('fai', 'fai.cmd', 'fai.ps1')) {
      $shimPath = Join-Path $prefix $shim
      if (-not (Test-Path -LiteralPath $shimPath)) { continue }
      $content = try { Get-Content -Raw -LiteralPath $shimPath -ErrorAction Stop } catch { '' }
      if ($content -match '(?i)@forcome[\\/]ai-cli') {
        try { Remove-Item -LiteralPath $shimPath -Force -ErrorAction Stop } catch { Write-CleanupLog "npm fai 启动器移除失败：$($_.Exception.Message)" }
      }
    }
  }
}

function Remove-LegacyEnvironment {
  foreach ($scope in @('User', 'Machine')) {
    $pathValue = [Environment]::GetEnvironmentVariable('Path', $scope)
    if ($pathValue) {
      $kept = @($pathValue -split ';' | Where-Object {
        $segment = Resolve-FullPath $_
        if (-not $segment) { return $true }
        if ($script:CurrentRoot -and (Test-PathUnderRoot -Path $segment -Root $script:CurrentRoot)) { return $true }
        foreach ($root in $script:LegacyRoots) {
          if (Test-PathUnderRoot -Path $segment -Root $root) { return $false }
        }
        return $segment -notmatch '(?i)[\\/]ForcomeAI[\\/]cli[\\/]bin$|[\\/]Forcome AI CLI[\\/]bin$'
      })
      $next = ($kept -join ';').Trim(';')
      if ($next -ne $pathValue) {
        Write-CleanupLog "从 $scope PATH 移除旧版 CLI 路径。"
        try { [Environment]::SetEnvironmentVariable('Path', $next, $scope) } catch { Write-CleanupLog "PATH 更新失败：$($_.Exception.Message)" }
      }
    }
    $cliHomeValue = [Environment]::GetEnvironmentVariable('FORCOME_AI_CLI_HOME', $scope)
    if ($cliHomeValue -and @($script:LegacyRoots | Where-Object { Test-PathUnderRoot -Path $cliHomeValue -Root $_ }).Count -gt 0) {
      try { [Environment]::SetEnvironmentVariable('FORCOME_AI_CLI_HOME', $null, $scope) } catch { Write-CleanupLog "FORCOME_AI_CLI_HOME 清理失败：$($_.Exception.Message)" }
    }
  }
}

function Remove-LegacyShortcuts {
  $roots = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('StartMenu'),
    [Environment]::GetFolderPath('CommonStartMenu'),
    [Environment]::GetFolderPath('Startup'),
    [Environment]::GetFolderPath('CommonStartup')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
  $shell = New-Object -ComObject WScript.Shell
  foreach ($root in $roots) {
    Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      $remove = $_.BaseName -match '(?i)^Forcome AI (CLI|连接器)$'
      try {
        $shortcut = $shell.CreateShortcut($_.FullName)
        $target = [string] $shortcut.TargetPath
        foreach ($legacyRoot in $script:LegacyRoots) {
          if ($target -and (Test-PathUnderRoot -Path $target -Root $legacyRoot)) { $remove = $true }
        }
      } catch { }
      if ($remove) {
        Write-CleanupLog "移除旧版快捷方式：$($_.FullName)"
        try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } catch { Write-CleanupLog "快捷方式移除失败：$($_.Exception.Message)" }
      }
    }
  }
}

function Remove-LegacyRegistry {
  foreach ($entry in Get-UninstallEntries) {
    Write-CleanupLog "移除旧版卸载注册项：$($entry.DisplayName)"
    try { Remove-Item -LiteralPath $entry.PSPath -Recurse -Force -ErrorAction Stop } catch { Write-CleanupLog "卸载注册项移除失败：$($_.Exception.Message)" }
  }
  foreach ($key in @('HKCU:\Software\ForcomeAI\CLI', 'HKLM:\Software\ForcomeAI\CLI', 'HKLM:\Software\WOW6432Node\ForcomeAI\CLI')) {
    if (Test-Path -LiteralPath $key) {
      try { Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction Stop } catch { Write-CleanupLog "旧版 CLI 注册表键移除失败：$($_.Exception.Message)" }
    }
  }
  foreach ($key in @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\fai.exe',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\fai.exe',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\fai.exe'
  )) {
    if (Test-Path -LiteralPath $key) {
      try { Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction Stop } catch { Write-CleanupLog "旧版 fai App Paths 注册项移除失败：$($_.Exception.Message)" }
    }
  }
}

function Remove-LegacyDirectories {
  foreach ($base in $script:LegacyRoots) {
    if (-not (Test-SafeLegacyRoot $base)) {
      if (Test-Path -LiteralPath $base) { Write-CleanupLog "安全校验未通过，拒绝删除目录：$base" }
      continue
    }
    foreach ($target in @($base, "$base.backup", "$base.staging")) {
      if (Test-Path -LiteralPath $target) {
        Write-CleanupLog "删除旧版 CLI 目录：$target"
        try { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop } catch { Write-CleanupLog "目录删除失败：$($_.Exception.Message)" }
      }
    }
  }
  $defaultParent = Join-Path $env:LOCALAPPDATA 'ForcomeAI'
  if ((Test-Path -LiteralPath $defaultParent) -and -not (Get-ChildItem -LiteralPath $defaultParent -Force -ErrorAction SilentlyContinue)) {
    try { Remove-Item -LiteralPath $defaultParent -Force -ErrorAction Stop } catch { }
  }
}

function Get-RemainingConflicts {
  $issues = New-Object 'System.Collections.Generic.List[string]'
  foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { Test-LegacyProcess $_ })) {
    $issues.Add("进程：$($process.Name) PID=$($process.ProcessId)")
  }
  foreach ($task in @(Get-ScheduledTask -ErrorAction SilentlyContinue)) {
    $actionText = (($task.Actions | ForEach-Object { ([string] $_.Execute) + ' ' + ([string] $_.Arguments) }) -join ' ')
    $rootMatch = @($script:LegacyRoots | Where-Object { $actionText.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0
    if ($task.TaskName -in @('ForcomeAI-Connector', 'ForcomeAI-Tray', 'Forcome AI CLI', 'ForcomeAI CLI') -or $rootMatch -or $actionText -match '(?i)@forcome[\\/]ai-cli') {
      $issues.Add("计划任务：$($task.TaskPath)$($task.TaskName)")
    }
  }
  foreach ($root in $script:LegacyRoots) {
    if ((Test-Path -LiteralPath $root) -and (Test-SafeLegacyRoot $root)) { $issues.Add("旧目录：$root") }
  }
  foreach ($package in Get-NpmGlobalPackages) {
    if (Test-Path -LiteralPath $package) { $issues.Add("npm 全局包：$package") }
  }
  foreach ($entry in Get-UninstallEntries) { $issues.Add("卸载注册项：$($entry.DisplayName)") }
  foreach ($key in @('HKCU:\Software\ForcomeAI\CLI', 'HKLM:\Software\ForcomeAI\CLI', 'HKLM:\Software\WOW6432Node\ForcomeAI\CLI')) {
    if (Test-Path -LiteralPath $key) { $issues.Add("注册表：$key") }
  }
  foreach ($service in @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue)) {
    $servicePath = [string] $service.PathName
    $rootMatch = @($script:LegacyRoots | Where-Object { $servicePath.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0
    if ($service.Name -match '(?i)^ForcomeAI[- ]?(Connector|Tray|CLI)$' -or $rootMatch) { $issues.Add("服务：$($service.Name)") }
  }
  foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run')) {
    $values = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if (-not $values) { continue }
    foreach ($property in $values.PSObject.Properties) {
      if ($property.Name -match '^PS(Path|ParentPath|ChildName|Drive|Provider)$') { continue }
      $data = [string] $property.Value
      $rootMatch = @($script:LegacyRoots | Where-Object { $data.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0
      if ($property.Name -in @('ForcomeAIConnector', 'ForcomeAITray', 'ForcomeAI-Connector', 'ForcomeAI-Tray', 'com.forcome.kangkangpet') -or $rootMatch -or $data -match '(?i)@forcome[\\/]ai-cli|ForcomeAiTray\.exe') {
        $issues.Add("自启项：$key -> $($property.Name)")
      }
    }
  }
  foreach ($scope in @('User', 'Machine')) {
    $pathValue = [Environment]::GetEnvironmentVariable('Path', $scope)
    foreach ($segment in @($pathValue -split ';')) {
      $fullSegment = Resolve-FullPath $segment
      if (-not $fullSegment) { continue }
      foreach ($root in $script:LegacyRoots) {
        if (Test-PathUnderRoot -Path $fullSegment -Root $root) { $issues.Add("$scope PATH：$fullSegment") }
      }
    }
    $cliHomeValue = [Environment]::GetEnvironmentVariable('FORCOME_AI_CLI_HOME', $scope)
    foreach ($root in $script:LegacyRoots) {
      if ($cliHomeValue -and (Test-PathUnderRoot -Path $cliHomeValue -Root $root)) { $issues.Add("$scope FORCOME_AI_CLI_HOME：$cliHomeValue") }
    }
  }
  foreach ($key in @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\fai.exe',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\fai.exe',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\fai.exe'
  )) {
    if (Test-Path -LiteralPath $key) { $issues.Add("App Paths：$key") }
  }
  foreach ($package in Get-NpmGlobalPackages) {
    $prefix = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $package))
    foreach ($shim in @('fai', 'fai.cmd', 'fai.ps1')) {
      $shimPath = Join-Path $prefix $shim
      if (-not (Test-Path -LiteralPath $shimPath)) { continue }
      $content = try { Get-Content -Raw -LiteralPath $shimPath -ErrorAction Stop } catch { '' }
      if ($content -match '(?i)@forcome[\\/]ai-cli') { $issues.Add("npm fai 启动器：$shimPath") }
    }
  }
  return @($issues | Select-Object -Unique)
}

function Invoke-Cleanup {
  Initialize-LegacyRoots
  Write-CleanupLog '开始清理旧版独立 FORCOME AI CLI；保留 .lobehub 登录凭据、FORCOME AI PWA 和 Forcome Cloud。'
  Remove-LegacyTasks
  Remove-LegacyRunEntries
  Remove-LegacyServices
  Stop-LegacyProcesses
  Remove-NpmGlobalCli
  Remove-LegacyEnvironment
  Remove-LegacyShortcuts
  Remove-LegacyRegistry
  Remove-LegacyDirectories
  try { Remove-Item -LiteralPath (Join-Path $env:USERPROFILE '.lobehub\daemon.status.json') -Force -ErrorAction SilentlyContinue } catch { }
  return @(Get-RemainingConflicts)
}

try {
  Initialize-LegacyRoots
  if ($AuditOnly) {
    $audit = @(Get-RemainingConflicts)
    [pscustomobject]@{ CurrentInstallRoot = $script:CurrentRoot; LegacyRoots = @($script:LegacyRoots); Conflicts = $audit } | ConvertTo-Json -Depth 5
    exit 0
  }

  $remaining = @(Invoke-Cleanup)
  if ($remaining.Count -gt 0 -and -not $ElevatedChild) {
    Write-CleanupLog '仍有需要管理员权限处理的旧版残留，申请 UAC 后继续自动清理。'
    $scriptPath = $MyInvocation.MyCommand.Definition.Replace("'", "''")
    $rootArg = ([string] $CurrentInstallRoot).Replace("'", "''")
    $command = "& '$scriptPath' -CurrentInstallRoot '$rootArg' -ElevatedChild"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    try {
      $child = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
        -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded" `
        -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop
      exit $child.ExitCode
    } catch {
      Write-CleanupLog "管理员清理未完成：$($_.Exception.Message)"
      exit 2
    }
  }

  if ($remaining.Count -gt 0) {
    Write-CleanupLog ('清理后仍检测到冲突：' + ($remaining -join '；'))
    exit 2
  }

  Write-CleanupLog '旧版独立 CLI 已清理完成；本次安装将成为唯一受支持的 CLI。'
  exit 0
} catch {
  Write-CleanupLog "旧版 CLI 清理异常：$($_.Exception.Message)"
  exit 3
}
