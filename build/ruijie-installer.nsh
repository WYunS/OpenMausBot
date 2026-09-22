# Opt into the repository's narrowly scoped electron-builder NSIS patch.
# Other installers keep their upstream behavior unless they define this path.
!define RUIJIE_LONG_PATH_7ZA "${BUILD_RESOURCES_DIR}\..\dist-native\windows-installer\7za.exe"

ShowUninstDetails show
ShowInstDetails show

!ifndef RUIJIE_INSTALL_LOG
  !define RUIJIE_INSTALL_LOG "$TEMP\RuijieBot-installer.log"
!endif

!macro ruijieInstallerError MESSAGE
  Push $R2
  FileOpen $R2 "${RUIJIE_INSTALL_LOG}" a
  FileSeek $R2 0 END
  FileWrite $R2 "${MESSAGE}$\r$\n"
  FileClose $R2
  Pop $R2
!macroend

!macro customCheckAppRunning
  SetDetailsPrint both
  # Never use upstream's process-name fallback: a development Bot or standalone
  # Harness can be doing unrelated work. Uninstall closes ours on its progress page.
  !ifndef BUILD_UNINSTALLER
    ${If} ${FileExists} "$INSTDIR\resources\enterprise-release.json"
      !insertmacro customUnInstall
    ${ElseIf} ${FileExists} "$INSTDIR\OpenMausBot.exe"
      IfSilent +2
        MessageBox MB_OK|MB_ICONSTOP "Existing installation cannot be identified safely. Uninstall it before retrying."
      SetErrorLevel 2
      Quit
    ${EndIf}
    # .onInit sets the installer's cwd to $INSTDIR. Release that directory
    # before the old uninstaller removes it during a reinstall/upgrade.
    SetOutPath $TEMP
  !endif
!macroend

!macro customUnInstall
  # The independent Harness installation is outside this root and is not ours.
  SetDetailsPrint both
  DetailPrint "正在关闭本次安装的 Bot 和内置组件…"
  InitPluginsDir
  File /oname=$PLUGINSDIR\ruijie-stop-installed.ps1 "${BUILD_RESOURCES_DIR}\ruijie-stop-installed.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\ruijie-stop-installed.ps1" -InstallRoot "$INSTDIR"'
  Pop $R0
  Pop $R1
  ${If} $R0 != "0"
    !insertmacro ruijieInstallerError "Stop components failed ($R0): $R1"
    DetailPrint "Cannot stop this installation: $R0 $R1"
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "Could not stop the installed application. No program files were removed."
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customRemoveFiles
  # NSIS's ordinary RMDir can report success while leaving >260-character paths.
  # The extended-length prefix fixes both normal uninstall and upgrade cleanup.
  SetOutPath $TEMP
  DetailPrint "正在删除程序文件；聊天记录和账号数据会保留…"
  # Antivirus and recently exited children can briefly retain file handles.
  StrCpy $R0 0
  ${Do}
    RMDir /r "\\?\$INSTDIR"
    ${IfNot} ${FileExists} "\\?\$INSTDIR"
      ${ExitDo}
    ${EndIf}
    IntOp $R0 $R0 + 1
    Sleep 500
  ${LoopUntil} $R0 >= 10
  ${If} ${FileExists} "\\?\$INSTDIR"
    !insertmacro ruijieInstallerError "Program files remain after retries: $INSTDIR"
    DetailPrint "Application files remain in $INSTDIR"
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "Some program files are still in use. Uninstall did not complete; close the application and retry."
    SetErrorLevel 2
    Quit
  ${EndIf}
  DetailPrint "程序文件已删除，正在清理卸载入口和快捷方式…"
!macroend
