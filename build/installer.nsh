; ── Deskly Custom NSIS Hooks ─────────────────────────────────────────────────

!define DESKLY_APPDATA_DIR "$APPDATA\Deskly Academic Edition"
!define DESKLY_UPDATE_BACKUP_DIR "$APPDATA\DesklyAcademic.UpdateBackup"

!macro preInit
  ; Do NOT set silent here — the full installer is one-click anyway.
!macroend

!macro customInit
  ${if} ${isUpdated}
    IfFileExists "${DESKLY_APPDATA_DIR}\*.json" 0 skip_update_backup
      RMDir /r "${DESKLY_UPDATE_BACKUP_DIR}"
      CreateDirectory "${DESKLY_UPDATE_BACKUP_DIR}"
      CopyFiles /SILENT "${DESKLY_APPDATA_DIR}\*.json" "${DESKLY_UPDATE_BACKUP_DIR}"
    skip_update_backup:
  ${endIf}
!macroend

!macro customInstall
  ${if} ${isUpdated}
    IfFileExists "${DESKLY_UPDATE_BACKUP_DIR}\*.*" 0 skip_update_restore
      CreateDirectory "${DESKLY_APPDATA_DIR}"
      CopyFiles /SILENT "${DESKLY_UPDATE_BACKUP_DIR}\*.*" "${DESKLY_APPDATA_DIR}"
      RMDir /r "${DESKLY_UPDATE_BACKUP_DIR}"
    skip_update_restore:
  ${endIf}

  WriteRegStr HKCU "Software\Deskly Academic Edition" "Version" "${VERSION}"
  WriteRegStr HKCU "Software\Deskly Academic Edition" "InstallPath" "$INSTDIR"
!macroend

!macro customUnInstall
  ; Kill any remaining Deskly Academic Edition process (safety net)
  nsExec::ExecToLog 'taskkill /F /IM "Deskly Academic Edition.exe" /T'

  ${ifNot} ${isUpdated}
    IfFileExists "$INSTDIR\resources\goodbye.ps1" 0 skip_goodbye
      nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -NonInteractive -File "$INSTDIR\resources\goodbye.ps1"'
    skip_goodbye:

    ; Wipe Electron userData on explicit uninstall only.
    ; The user's actual vault data is intentionally preserved.
    RMDir /r "$APPDATA\Deskly Academic Edition"

    ; Clean up registry
    DeleteRegKey HKCU "Software\Deskly Academic Edition"
  ${endIf}
!macroend
