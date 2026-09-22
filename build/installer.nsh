!include nsDialogs.nsh

; electron-builder otherwise reuses the package name for the assisted install
; directory when the product filename contains non-ASCII characters.
!ifdef APP_FILENAME
  !undef APP_FILENAME
!endif
!define APP_FILENAME "康康Pet"

!define KANGKANGPET_SUFFIX "\康康Pet"
!define LEGACY_KANGKANGPET_SUFFIX "\kangkangpet"

Var SkipEmbeddedCli
Var KangKangPetInstallDirWasRedirected
!ifndef BUILD_UNINSTALLER
Var LegacyCliAuditStatus
Var LegacyCliChoice
Var LegacyCliCleanupStatus
Var LegacyCliDialog
Var LegacyCliPrompt
Var LegacyCliRemoveButton
Var LegacyCliKeepButton
!endif

Function NormalizeKangKangPetInstallDir
  StrCpy $R0 $INSTDIR

  trimTrailingSlash:
  StrLen $R1 $R0
  IntCmp $R1 0 trimDone
  StrCpy $R2 $R0 1 -1
  StrCmp $R2 "\" trimOne trimDone
  trimOne:
  StrCpy $R0 $R0 -1
  Goto trimTrailingSlash

  trimDone:
  StrLen $R1 $R0
  StrLen $R2 "${KANGKANGPET_SUFFIX}"
  IntCmp $R1 $R2 checkSuffix appendSuffix checkSuffix

  checkSuffix:
  IntOp $R3 $R1 - $R2
  StrCpy $R4 $R0 "" $R3
  StrCmp $R4 "${KANGKANGPET_SUFFIX}" normalized

  StrLen $R2 "${LEGACY_KANGKANGPET_SUFFIX}"
  IntCmp $R1 $R2 checkLegacySuffix appendSuffix checkLegacySuffix

  checkLegacySuffix:
  IntOp $R3 $R1 - $R2
  StrCpy $R4 $R0 "" $R3
  StrCmp $R4 "${LEGACY_KANGKANGPET_SUFFIX}" replaceLegacy appendSuffix

  replaceLegacy:
  StrCpy $R0 $R0 $R3

  appendSuffix:
  StrCpy $INSTDIR "$R0${KANGKANGPET_SUFFIX}"
  Goto normalized

  normalized:
FunctionEnd

Function IsPathUnderRoot
  StrCpy $R2 "0"
  StrLen $R3 $R1
  StrLen $R4 $R0
  IntCmp $R4 $R3 pathLengthEqual pathTooShort pathLengthGreater

  pathLengthGreater:
  pathLengthEqual:
  StrCpy $R5 $R0 $R3
  StrCmp $R5 $R1 0 pathDone
  IntCmp $R4 $R3 pathMatch pathCheckSeparator pathCheckSeparator

  pathCheckSeparator:
  StrCpy $R5 $R0 1 $R3
  StrCmp $R5 "\\" pathMatch pathDone

  pathMatch:
  StrCpy $R2 "1"

  pathTooShort:
  pathDone:
FunctionEnd

Function PathContains
  StrCpy $R2 "0"
  StrLen $R3 $R1
  StrLen $R4 $R0
  StrCpy $R5 "0"

  pathContainsLoop:
  IntCmp $R5 $R4 pathContainsDone pathContainsDone pathContainsCheck

  pathContainsCheck:
  StrCpy $R6 $R0 $R3 $R5
  StrCmp $R6 $R1 pathContainsFound
  IntOp $R5 $R5 + 1
  Goto pathContainsLoop

  pathContainsFound:
  StrCpy $R2 "1"

  pathContainsDone:
FunctionEnd

Function EnsureWritableKangKangPetInstallDir
  StrCpy $KangKangPetInstallDirWasRedirected "0"
  Call NormalizeKangKangPetInstallDir

  StrCpy $R0 $INSTDIR
  StrCpy $R1 "\Program Files"
  Call PathContains
  StrCmp $R2 "1" redirectInstallDir
  StrCpy $R1 "\Windows"
  Call PathContains
  StrCmp $R2 "1" redirectInstallDir

  StrCpy $R1 "$PROGRAMFILES"
  Call IsPathUnderRoot
  StrCmp $R2 "1" redirectInstallDir

  StrCpy $R1 "$PROGRAMFILES64"
  Call IsPathUnderRoot
  StrCmp $R2 "1" redirectInstallDir

  StrCpy $R1 "$WINDIR"
  Call IsPathUnderRoot
  StrCmp $R2 "1" redirectInstallDir

  StrCpy $R1 "$SYSDIR"
  Call IsPathUnderRoot
  StrCmp $R2 "1" redirectInstallDir installDirReady

  redirectInstallDir:
  StrCpy $KangKangPetInstallDirWasRedirected "1"
  StrCpy $INSTDIR "$LOCALAPPDATA\\Programs"
  Call NormalizeKangKangPetInstallDir

  installDirReady:
FunctionEnd

Function .onVerifyInstDir
  Call EnsureWritableKangKangPetInstallDir
FunctionEnd

!macro customInit
  ${StdUtils.GetParameter} $R0 "D" ""
  ${If} $R0 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs"
  ${Else}
    StrCpy $INSTDIR $R0
  ${EndIf}
  Call EnsureWritableKangKangPetInstallDir
!macroend

!ifndef BUILD_UNINSTALLER
Function AuditLegacyCli
  StrCmp $LegacyCliAuditStatus "" 0 auditDone
  InitPluginsDir
  File /oname=$PLUGINSDIR\cleanup-legacy-cli.ps1 "${PROJECT_DIR}\build\cleanup-legacy-cli.ps1"
  DetailPrint "正在检查旧版 FORCOME AI CLI..."
  nsExec::ExecToLog `$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-legacy-cli.ps1" -CurrentInstallRoot "$INSTDIR" -AuditOnly`
  Pop $0
  StrCmp $0 10 legacyCliDetected
  StrCmp $0 0 legacyCliAbsent
  StrCpy $LegacyCliAuditStatus "error"
  Return

  legacyCliDetected:
  StrCpy $LegacyCliAuditStatus "detected"
  Return

  legacyCliAbsent:
  StrCpy $LegacyCliAuditStatus "absent"

  auditDone:
FunctionEnd

Function CleanupLegacyCli
  DetailPrint "正在清理旧版 FORCOME AI CLI..."
  nsExec::ExecToLog `$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-legacy-cli.ps1" -CurrentInstallRoot "$INSTDIR"`
  Pop $LegacyCliCleanupStatus
FunctionEnd

Function LegacyCliRemoveClicked
  StrCpy $LegacyCliChoice "uninstall"
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${BM_CLICK} 0 0
FunctionEnd

Function LegacyCliKeepClicked
  StrCpy $LegacyCliChoice "keep"
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${BM_CLICK} 0 0
FunctionEnd

Function RestoreLegacyCliNavigation
  GetDlgItem $0 $HWNDPARENT 1
  ShowWindow $0 ${SW_SHOW}
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_SHOW}
FunctionEnd

Function LegacyCliChoicePageShow
  Call EnsureWritableKangKangPetInstallDir
  StrCmp $KangKangPetInstallDirWasRedirected 1 0 installDirReady
  MessageBox MB_OK|MB_ICONEXCLAMATION "检测到选择了 Windows 受保护目录。为避免火绒拦截，安装目录已改为：$INSTDIR"

  installDirReady:
  Call AuditLegacyCli
  StrCmp $LegacyCliAuditStatus "detected" legacyCliChoicePageCreate
  StrCmp $LegacyCliAuditStatus "absent" legacyCliChoicePageSkip

  StrCpy $SkipEmbeddedCli 1
  StrCpy $LegacyCliChoice "audit-error"
  MessageBox MB_OK|MB_ICONEXCLAMATION "无法确认旧版 FORCOME AI CLI 状态。本次将跳过内置 CLI，只安装桌宠和其他功能，原有 CLI 不会被修改。"
  Abort

  legacyCliChoicePageSkip:
  StrCpy $LegacyCliChoice "none"
  Abort

  legacyCliChoicePageCreate:
  nsDialogs::Create 1018
  Pop $LegacyCliDialog
  ${NSD_CreateLabel} 0u 0u 330u 30u "检测到电脑中存在旧版FORCOME AI CLI。"
  Pop $LegacyCliPrompt
  ${NSD_CreateButton} 20u 70u 120u 28u "卸载旧版"
  Pop $LegacyCliRemoveButton
  ${NSD_OnClick} $LegacyCliRemoveButton LegacyCliRemoveClicked
  ${NSD_CreateButton} 160u 70u 120u 28u "保留旧版"
  Pop $LegacyCliKeepButton
  ${NSD_OnClick} $LegacyCliKeepButton LegacyCliKeepClicked

  GetDlgItem $0 $HWNDPARENT 1
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_HIDE}
  nsDialogs::Show
FunctionEnd

Function LegacyCliChoicePageLeave
  StrCmp $LegacyCliChoice "uninstall" legacyCliChoicePageUninstall
  StrCmp $LegacyCliChoice "keep" legacyCliChoicePageKeep
  Abort

  legacyCliChoicePageUninstall:
  Call CleanupLegacyCli
  StrCmp $LegacyCliCleanupStatus 0 legacyCliChoicePageDone
  MessageBox MB_OK|MB_ICONSTOP "检测到旧版 FORCOME AI CLI 未能完全清理。为避免多个连接器互相抢占，本次安装已停止。请查看日志：$TEMP\KangKangPet-legacy-cli-cleanup.log"
  Abort

  legacyCliChoicePageKeep:
  StrCpy $SkipEmbeddedCli 1
  DetailPrint "用户选择保留旧版 CLI，本次跳过内置 CLI 部署。"

  legacyCliChoicePageDone:
  Call RestoreLegacyCliNavigation
FunctionEnd
!endif

!macro customPageAfterChangeDir
  PageEx custom
    PageCallbacks LegacyCliChoicePageShow LegacyCliChoicePageLeave
    Caption " "
  PageExEnd
!macroend

; Stop only the current desktop pet, then decide whether the embedded CLI may
; be installed. The legacy CLI remains untouched when the user declines.
!macro customCheckAppRunning
  StrCpy $SkipEmbeddedCli 0
  InitPluginsDir
  DetailPrint "正在退出程序..."
  nsExec::ExecToLog `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Sleep 300
!ifndef BUILD_UNINSTALLER
  StrCmp $LegacyCliChoice "keep" legacyCliSkipAlreadyHandled
  StrCmp $LegacyCliChoice "audit-error" legacyCliSkipAlreadyHandled
  StrCmp $LegacyCliChoice "" legacyCliFallbackAudit legacyCliAuditDone

  legacyCliSkipAlreadyHandled:
  StrCpy $SkipEmbeddedCli 1
  Goto legacyCliAuditDone

  legacyCliFallbackAudit:
  Call AuditLegacyCli
  StrCmp $LegacyCliAuditStatus "detected" legacyCliDetected
  StrCmp $LegacyCliAuditStatus "absent" legacyCliAuditDone
  StrCpy $SkipEmbeddedCli 1
  MessageBox MB_OK|MB_ICONEXCLAMATION "无法确认旧版 FORCOME AI CLI 状态。本次将跳过内置 CLI，只安装桌宠和其他功能，原有 CLI 不会被修改。"
  Goto legacyCliAuditDone

  legacyCliDetected:
  IfSilent legacyCliSilentSkip
  StrCpy $SkipEmbeddedCli 1
  MessageBox MB_OK|MB_ICONEXCLAMATION "无法显示旧版 FORCOME AI CLI 选择页面。本次将跳过内置 CLI，只安装桌宠和其他功能，原有 CLI 不会被修改。"
  Goto legacyCliAuditDone

  legacyCliSilentSkip:
  StrCpy $SkipEmbeddedCli 1
  DetailPrint "静默安装检测到旧版 CLI，本次跳过内置 CLI 部署。"

  legacyCliAuditDone:
!endif
!macroend

!macro customInstall
  StrCmp $SkipEmbeddedCli 1 0 customInstallDone
  DetailPrint "已保留内置 FORCOME AI CLI 文件；运行时将避免与独立安装版连接器同时运行。"
  customInstallDone:
!macroend

!macro customUnInstall
  DetailPrint "Preserving local reminder, calendar, note, and settings data in AppData."
!macroend
