; Run legacy cleanup through electron-builder's close-app hook. This hook is
; inside the install section, so the installer window appears immediately and
; cleanup starts only after the user clicks Install. It still runs before the
; old version is removed or any application files are overwritten.
!macro customCheckAppRunning
  InitPluginsDir
  DetailPrint "正在退出程序..."
  nsExec::ExecToLog `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Sleep 300
  ; electron-updater launches NSIS silently. Do not run the PowerShell legacy
  ; CLI cleanup in that path: security software commonly blocks it and turns
  ; an otherwise valid update into a failed install. Manual installs retain
  ; the cleanup below.
  IfSilent skipLegacyCliCleanup
  File /oname=$PLUGINSDIR\cleanup-legacy-cli.ps1 "${PROJECT_DIR}\build\cleanup-legacy-cli.ps1"
  DetailPrint "正在清理旧版 FORCOME AI CLI..."
  nsExec::ExecToLog `$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-legacy-cli.ps1" -CurrentInstallRoot "$INSTDIR"`
  Pop $0
  StrCmp $0 0 legacyCliCleanupDone
  MessageBox MB_OK|MB_ICONSTOP "检测到旧版 FORCOME AI CLI 未能完全清理。为避免多个连接器互相抢占，本次安装已停止。请查看日志：$TEMP\KangKangPet-legacy-cli-cleanup.log"
  SetErrorLevel $0
  Quit
  legacyCliCleanupDone:
  skipLegacyCliCleanup:
!macroend

!macro customUnInstall
  DetailPrint "Preserving local reminder, calendar, note, and settings data in AppData."
!macroend
