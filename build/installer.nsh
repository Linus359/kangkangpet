!macro customCheckAppRunning
  DetailPrint "Closing running ${PRODUCT_NAME} processes..."
  nsExec::ExecToLog `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Sleep 1200
!macroend

!macro customInstall
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
!macroend

!macro customUnInstall
  DetailPrint "Preserving local reminder and settings data in AppData."
  RMDir "$INSTDIR"
!macroend

