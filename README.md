# filedesk

Windows 탐색기를 대신해 쓰는 로컬 파일 탐색기. 탐색기가 하는 일(셸 메뉴 · 끌기 · 파일 작업 · 단축키)은 셸에 맡겨 그대로 하고,
화면은 Windows 모양을 따르지 않고 일의 단위(과업 → 자리 → 문서 → 판)로 새로 지었다. 문서 정리(판 묶기 · 사본 · 정본 비교 · 정리 계획)를 더한다.
화면 색은 왼쪽 아래 단추로 시스템 · 밝게 · 어둡게를 고른다 (기본은 시스템 — Windows 설정을 따른다).

## 실행

```
cd apps/desktop
bun install
bun tauri dev                  # 개발 (화면 고치면 바로 반영)
bun tauri build --no-bundle    # 실행 파일: target/release/filedesk.exe
```

앱 시험 (배포판을 띄워 WebView2 디버깅 포트로 조작 · 캡처): `node apps/desktop/e2e/smoke.mjs [캡처 폴더]` — 셸 메뉴 · 앱 밖 끌기는 사람이 본다.
큰 폴더 성능: `node apps/desktop/e2e/perf.mjs [파일 수=20000]` — 켜고 첫 줄까지 · End 키 · 스크롤 프레임 · JS 힙을 잰다.

이름 규칙: 문서 키에서 뗄 과업 이름 · 작성자 이름은 `%APPDATA%\kr.seesun.filedesk\name-rules.json` 에 둔다 — `{ "projectNames": ["…"], "people": ["…"] }` (없으면 비운 채로 묶는다).

명령줄 (JSON): `fd ls <폴더>` · `fd docs <폴더> [-r] [--summary]` (문서 단위로 묶기 · 판 · 규칙 어긋남) · `fd memo ls [폴더]` · `fd memo get|set <경로> [글]` (앱과 같은 메모) ·
`fd tidy plan --sweep 이름=경로… --keep 정본자리 -o plan.json` → `fd tidy apply plan.json --box 정리함 [--only 이름]` → `fd tidy undo 정리함/manifest.json` (정본이 따로 있는 사본만 · 내용 해시 대조 · 옮기기만 하고 지우지 않는다). `cargo run -p fd-cli -- …`

릴리즈 · 업데이트 (docket 과 같은 틀): `tauri.conf.json` 의 `version` 을 올리고 `CHANGELOG.md` 에 `## <판>` 구획을 쓴 뒤 `v<판>` 태그를 밀면
GitHub Actions(`.github/workflows/release.yml`)가 서명한 설치 파일(NSIS) · `latest.json` 을 릴리즈에 올린다. 설치된 앱은 켤 때 · 한 시간마다 그것을 보고
제목 줄에 「새 판」을 알린다 (설치는 사용자가 누른다). 서명 키는 `~/.tauri/filedesk.key` (저장소 비밀 `TAURI_SIGNING_PRIVATE_KEY`) — 잃으면 이미 깐 앱이 새 판을 못 받는다.
로컬에서 설치 파일까지: `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/filedesk.key)" bun tauri build`.

앱 아이콘: 원본은 `apps/desktop/src-tauri/icons/source.svg` (폴더 앞판에 판 눈금 — 흐린 점 둘 다음 큰 찬 점: 지난 판들 다음 최신판). 고친 뒤 `node apps/desktop/e2e/render-icon.mjs` → `bun tauri icon src-tauri/icons/source.png -o src-tauri/icons` (android · ios · Square* · 64x64 · icns 는 지운다).

## 구조

| 경로 | 무엇 |
| - | - |
| `crates/fd-core` | 셸에 기대지 않는 것 — 목록 · 문서 이름 읽기(`docname`) · 문서 묶기(`docs`) · 새 판 이름(`edition`) (다음: 색인 · 작업 기록) |
| `crates/fd-shell` | Windows 셸 연동 — 오른쪽 메뉴 · 끌기 · IFileOperation · 아이콘 · 위치 |
| `crates/fd-cli` | `fd` 명령줄. 화면과 같은 조회를 JSON 으로 |
| `apps/desktop` | Tauri 2 + React 화면 |

## 단축키 (탐색기와 같다)

| 키 | 동작 |
| - | - |
| Enter · 더블클릭 | 열기 (폴더 · 폴더 바로가기는 앱 안에서) |
| Backspace · Alt+← / Alt+→ · Alt+↑ | 뒤로 / 앞으로 · 위로 |
| F2 · Delete | 이름 바꾸기 · 휴지통 |
| Ctrl+C · X · V · Ctrl+A | 복사 · 잘라내기 · 붙여넣기 · 모두 고르기 |
| Ctrl+Shift+N · Ctrl+Shift+C | 새 폴더 · 경로 복사 |
| Ctrl+L · Alt+D · F4 · F5 | 주소창 · 새로 고침 |
| Alt+Enter · Shift+F10 | 속성 · 오른쪽 메뉴 |
| Ctrl+T · Ctrl+W · Ctrl+Tab · Ctrl+1~9 | 탭 |
| Ctrl+H | 숨김 항목 보기 |
| Ctrl+F · Ctrl+E | 이 폴더에서 거르기 (Esc 지우기) |
| Ctrl+D | 지금 폴더를 즐겨찾기에 고정 |
| Ctrl+Shift+D | 판 접기 ↔ 펼치기 (문서 하나 = 한 줄) |
| Ctrl+M | 메모 붙이기 · 고치기 (비우면 뗀다) |
| → · ← | (판이 쌓인 줄에서) 판 펼치기 · 접기 |
| 마우스 뒤로 · 앞으로 단추 · 가운데 단추 | 뒤로 · 앞으로 · (탭 · 위치에서) 새 탭 / 닫기 |

끌어다 놓기는 탐색기 규칙을 따른다 — 같은 드라이브는 이동 · 다른 드라이브는 복사 · Ctrl 복사 · Shift 이동.

## 함정

| 증상 | 까닭 · 대응 |
| - | - |
| 오른쪽 메뉴의 「보내기」 · 「연결 프로그램」이 비어 열림 | 메뉴 동안 창 메시지를 IContextMenu2/3 으로 넘겨야 한다 (`fd-shell/src/menu.rs` 서브클래스) |
| 메뉴 · 끌기가 바로 닫힘 | 창을 가진 주 스레드에서 불러야 한다 (`lib.rs` `on_main`) |
| `windows` 크레이트에 `CMIC_MASK_UNICODE` 가 없다 | 0x4000 으로 직접 둔다 |
| 아이콘이 가끔 404 (pptx · txt) | 요청마다 스레드를 띄워 SHGetFileInfo 를 동시에 부르면 일부가 실패한다 — 아이콘 전담 STA 스레드 하나로 차례로 (`icon.rs` `worker`) |
| dll · log 아이콘만 실패 | 비트맵 직접 읽기가 안 되는 아이콘 꼴 — 검은 · 흰 바탕에 그려 투명도를 되살린다 (`draw_to_png`) |
| 이름 바꾸던 글자가 사라짐 | 이름 칸이 열린 채 폴더를 다시 읽으면 선택을 다시 잡아 글자를 덮었다 — 열릴 때 한 번만 고른다 |
| 다른 줄을 눌러도 이름 칸 · 거르기 칸이 안 닫힘 | 줄 누르기가 preventDefault 라 초점이 남는다 — 이어지는 Delete · Enter 가 칸에 들어갔다. 줄을 누르면 입력 칸을 직접 닫는다 |
