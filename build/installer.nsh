Var SkipEmbeddedCli

; Stop only the current desktop pet, then decide whether the embedded CLI may
; be installed. The legacy CLI remains untouched when the user declines.
!macro customCheckAppRunning
  StrCpy $SkipEmbeddedCli 0
  InitPluginsDir
  DetailPrint "正在退出程序..."
  nsExec::ExecToLog `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Sleep 300
  File /oname=$PLUGINSDIR\cleanup-legacy-cli.ps1 "${PROJECT_DIR}\build\cleanup-legacy-cli.ps1"
  DetailPrint "正在检查旧版 FORCOME AI CLI..."
  nsExec::ExecToLog `$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-legacy-cli.ps1" -CurrentInstallRoot "$INSTDIR" -AuditOnly`
  Pop $0
  StrCmp $0 10 legacyCliDetected
  StrCmp $0 0 legacyCliAuditDone
  StrCpy $SkipEmbeddedCli 1
  MessageBox MB_OK|MB_ICONEXCLAMATION "无法确认旧版 FORCOME AI CLI 状态。本次将跳过内置 CLI，只安装桌宠和其他功能，原有 CLI 不会被修改。"
  Goto legacyCliAuditDone

  legacyCliDetected:
  IfSilent legacyCliSilentSkip
  MessageBox MB_YESNO|MB_ICONQUESTION "检测到电脑中存在旧版 FORCOME AI CLI。\n\n选择“是”：卸载旧版并安装康康熊内置 CLI。\n选择“否”：保留旧版 CLI，只安装桌宠和其他功能。" IDYES legacyCliInstall IDNO legacyCliSkip

  legacyCliInstall:
  DetailPrint "正在清理旧版 FORCOME AI CLI..."
  nsExec::ExecToLog `$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-legacy-cli.ps1" -CurrentInstallRoot "$INSTDIR"`
  Pop $0
  StrCmp $0 0 legacyCliAuditDone
  MessageBox MB_OK|MB_ICONSTOP "检测到旧版 FORCOME AI CLI 未能完全清理。为避免多个连接器互相抢占，本次安装已停止。请查看日志：$TEMP\KangKangPet-legacy-cli-cleanup.log"
  SetErrorLevel $0
  Quit

  legacyCliSkip:
  StrCpy $SkipEmbeddedCli 1
  DetailPrint "用户选择保留旧版 CLI，本次跳过内置 CLI 部署。"
  Goto legacyCliAuditDone

  legacyCliSilentSkip:
  StrCpy $SkipEmbeddedCli 1
  DetailPrint "静默安装检测到旧版 CLI，本次跳过内置 CLI 部署。"

  legacyCliAuditDone:
!macroend

!macro customInstall
  StrCmp $SkipEmbeddedCli 1 0 customInstallDone
  DetailPrint "正在移除跳过部署的内置 FORCOME AI CLI..."
  RMDir /r "$INSTDIR\resources\forcome-cli"
  customInstallDone:
!macroend

!macro customUnInstall
  DetailPrint "Preserving local reminder, calendar, note, and settings data in AppData."
!macroend
