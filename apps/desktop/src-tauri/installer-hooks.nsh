; filedesk 설치 파일 훅 (tauri.release.json 의 bundle.windows.nsis.installerHooks).
;
; 앱을 지울 때 빠른 색인 서비스(fd-indexd)가 깔려 있으면 지울지 묻고, 지운다면 관리자 권한으로 `fd-indexd.exe uninstall` 을 돌린다.
; 서비스는 앱이 「설정 › 색인」에서 따로 깐 것이라(관리자 권한 · Program Files) 사용자 설치인 앱 제거기가 혼자 지우지 못한다.
; 조용한 제거(업데이트가 지난 판을 지울 때)에는 묻지도 지우지도 않는다 — 업데이트 뒤에도 서비스는 그대로 돈다.
; 2026.11.12 : 처음 씀.

!macro NSIS_HOOK_PREUNINSTALL
  IfSilent filedesk_skip_service
  ClearErrors
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\filedesk-index" "ImagePath"
  IfErrors filedesk_skip_service
  StrCmp $0 "" filedesk_skip_service
  MessageBox MB_YESNO|MB_ICONQUESTION "filedesk 빠른 색인 서비스도 지울까요?$\r$\n(관리자 권한을 묻는 창이 뜬다. 아니요를 누르면 서비스는 남는다)" IDNO filedesk_skip_service
  IfFileExists "$INSTDIR\fd-indexd.exe" 0 filedesk_skip_service
  ExecShellWait "runas" "$INSTDIR\fd-indexd.exe" "uninstall" SW_HIDE
  filedesk_skip_service:
!macroend
