# filedesk

Windows 탐색기를 대신해 쓰는 로컬 파일 탐색기. 탐색기가 하는 일(셸 메뉴 · 끌기 · 파일 작업 · 단축키)은 셸에 맡겨 그대로 하고,
화면은 Windows 모양을 따르지 않고 일의 단위(폴더 → 문서 → 판)로 새로 지었다. 문서 정리(판 묶기 · 사본 · 정본 비교 · 정리 계획)를 더한다.
화면 색은 왼쪽 아래 단추로 시스템 · 밝게 · 어둡게를 고른다 (기본은 시스템 — Windows 설정을 따른다).
설정(왼쪽 아래 「설정」 · Ctrl+,): 보기(목록 · 격자 · 격자 크기 · 아이콘 모양 · 미리보기 · 보일 열) ·
목록(기본 정렬 · 폴더를 위에 · 판 접어 시작 · 고친 날 · 크기 꼴) · 열기(폴더를 두 번 · 한 번 눌러 · 시작 폴더) · 종류 · 화면 색 · 색인 · Claude 스킬.
찾기(Ctrl+F): 이름 · 메모에 조건을 섞는다 — `고친:3일` · `고친:>30일` · `크기:>10MB` · `확장자:pdf` · `종류:문서` · `색:빨강` · `메모:있음` · `-뺄말` (영어 `modified:3d` 도 된다).
범위는 이 폴더 · 하위 폴더까지(Shift+Enter) · 모든 드라이브(Alt+Enter, 색인)이고 Tab · Shift+Tab 으로 돌린다. 문서 본문까지는 Ctrl+Enter 로 켜고 끈다. 조건 · 범위는 「스마트 폴더로 저장」해 왼쪽에서 한 번 눌러 다시 본다
(「최근 파일」 = 다운로드 · 바탕화면 · `고친:3일 종류:파일`).
색인: 앱이 고정 드라이브의 이름 · 크기 · 때를 색인하고(문서는 본문까지, 뒤에서 천천히), 설정 › 색인에서 **빠른 색인 서비스**(`fd-indexd`, 관리자 권한 · NTFS MFT · USN 저널)를 깔면
몇 초 만에 색인하고 앱이 꺼져 있던 동안의 변경도 따라간다. NAS 는 색인하지 않고 누를 때 훑는다. 설계는 `DESIGN.md` [4].
앱 안 보기: md · txt · log 와 그림(png · jpg · gif · webp · bmp · svg · ico · avif)은 열면 그 칸에서 바로 본다.
마크다운은 옵시디언처럼 렌더된 채로 고치고(커서가 있는 줄만 기호가 드러난다 · 링크는 Ctrl+누르기), 글은 입력이 멈추면 읽은 인코딩(UTF-8 · CP949 …) · 줄바꿈 방식 그대로 저장한다.
연 사이 다른 곳에서 고쳤으면 덮지 않고 묻는다. 그림은 ←/→ 로 같은 폴더의 그림 · 누르기(Space)로 맞춤 ↔ 원래 크기. Esc 로 목록 · 「기본 앱으로 열기」는 머리에.
화면 글자의 용어는 `TERMS.md` 한 곳에서 정한다 — 새 글자를 넣을 때 먼저 본다.

설치 파일은 코드 서명이 없어 처음 설치할 때 SmartScreen 이 「Windows의 PC 보호」를 띄운다 — 「추가 정보」 → 「실행」.
설치한 뒤의 새 판은 앱이 받아 서명(minisign)을 확인하고 깐다.

## Claude 스킬

설치본에는 명령줄 `fd.exe` 가 앱 옆에 함께 깔린다. 설정 → 「Claude 스킬」 → 「설치」(또는 `fd skill install`)를 누르면
`~/.claude/skills/filedesk/SKILL.md` 가 생기고, Claude Code 가 같은 판 규칙으로 파일을 다룬다 — 판 정리 · 새 판 · 메모 · 색 표시 · 찾기 · 휴지통.
파일을 바꾸는 명령(`edition` · `retire`)은 `--apply` 없이 계획만 보이고, 지우기는 휴지통으로만 한다. 이미 깐 스킬은 앱을 켤 때 이 판 · 이 fd.exe 자리에 맞춰 저절로 다시 쓴다 (깔지 않았으면 새로 깔지 않는다).
Claude 말고 다른 에이전트(Codex 등)는 `fd skill show` 가 내는 본문(fd.exe 절대경로가 들어 있다)을 그 에이전트의 지침 파일에 붙이면 같은 규칙으로 쓴다 —
명령줄 이름 `fd` 는 흔한 파일 찾기 도구와 겹치니 지침에는 늘 절대경로로 적는다.
스킬 본문의 정본은 `skills/filedesk/SKILL.md`.

## 실행

```
cd apps/desktop
bun install
bun tauri dev                  # 개발 (화면 고치면 바로 반영)
bun tauri build --no-bundle    # 실행 파일: target/release/filedesk.exe
```

앱 시험 (배포판을 띄워 WebView2 디버깅 포트로 조작 · 캡처): `node apps/desktop/e2e/smoke.mjs [캡처 폴더]` · 앱 안 보기(md · txt · 그림) `node apps/desktop/e2e/viewer.mjs` — 셸 메뉴 · 앱 밖 끌기는 사람이 본다 (릴리즈 전 목록: `apps/desktop/e2e/manual-check.md`).
큰 폴더 성능: `node apps/desktop/e2e/perf.mjs [파일 수=20000]` — 켜고 첫 줄까지 · End 키 · 스크롤 프레임 · JS 힙을 잰다.

명령줄 (JSON · 실패하면 표준 오류에 `{"error"}`): `fd ls <폴더>` · `fd docs <폴더> [-r] [--summary]` (문서 단위로 묶기 · 판 · 규칙 어긋남) ·
`fd edition <파일> [--apply]` (새 판) · `fd retire <폴더> [--doc 키] [--apply]` (지난 판을 이전판으로) · `fd find <폴더> <말>` (이름 · 메모, 하위 폴더까지) ·
`fd query "<말 · 조건>" [--in 폴더]… [--no-recurse] [--content] [--live]` (조건으로 찾기 — `--in` 이 없으면 모든 고정 드라이브, 색인 서비스가 있으면 색인으로) · `fd index status|rebuild` ·
`fd conv <폴더>` (그 폴더가 쓰는 이름 꼴 · 꼴과 다른 이름과 제안) · `fd name <경로> [--to 폴더]` (그 폴더 꼴로 고친 이름 제안) ·
`fd trash <경로>…` · `fd skill install` ·
`fd memo ls [폴더]` · `fd memo get|set <경로> [글]` · `fd memo color <경로> <red…gray|none>` (앱과 같은 메모 · 색) ·
`fd tidy plan --sweep 이름=경로… --keep 정본자리 -o plan.json` → `fd tidy apply plan.json --box 정리함 [--only 이름]` → `fd tidy undo 정리함/manifest.json` (정본이 따로 있는 사본만 · 내용 해시 대조 · 옮기기만 하고 지우지 않는다). `cargo run -p fd-cli -- …`

릴리즈 · 업데이트 (docket 과 같은 틀): `tauri.conf.json` 의 `version` 을 올리고 `CHANGELOG.md` 에 `## <판>` 구획을 쓴 뒤 `v<판>` 태그를 밀면
GitHub Actions(`.github/workflows/release.yml`)가 서명한 설치 파일(NSIS) · `latest.json` 을 릴리즈에 올린다. 설치된 앱은 켤 때 · 한 시간마다 그것을 보고
제목 줄에 「새 판」을 알린다 (설치는 사용자가 누른다). 서명 키는 `~/.tauri/filedesk.key` (저장소 비밀 `TAURI_SIGNING_PRIVATE_KEY`) — 잃으면 이미 깐 앱이 새 판을 못 받는다.
키와 그 암호는 이 PC 밖(암호 관리기 등)에 한 부 더 둔다. 그래도 잃었으면 새 키를 만들어(`bun tauri signer generate`) `tauri.conf.json` 의 공개 키 · 저장소 비밀을 바꾸고,
이미 깐 PC 에는 새 설치 파일을 사람이 한 번 직접 깔게 알린다 — 그 뒤로는 다시 저절로 받는다.
로컬에서 설치 파일까지: `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/filedesk.key)" bun tauri build --config src-tauri/tauri.release.json` (fd.exe 를 함께 넣는다).

앱 아이콘: 원본은 `apps/desktop/src-tauri/icons/source.svg` (폴더 앞판에 판 눈금 — 흐린 점 둘 다음 큰 찬 점: 지난 판들 다음 최신판). 고친 뒤 `node apps/desktop/e2e/render-icon.mjs` → `bun tauri icon src-tauri/icons/source.png -o src-tauri/icons` (android · ios · Square* · 64x64 · icns 는 지운다).

## 구조

| 경로 | 무엇 |
| - | - |
| `crates/fd-core` | 셸에 기대지 않는 것 — 목록 · 문서 이름 읽기(`docname`) · 문서 묶기(`docs`) · 새 판 계획(`edition`) · 메모 · 색(`memo`) · 찾기(`search`) · 스킬(`skill`) |
| `crates/fd-shell` | Windows 셸 연동 — 오른쪽 메뉴 · 끌기 · IFileOperation · 아이콘 · 위치 |
| `crates/fd-cli` | `fd` 명령줄. 화면과 같은 조회 · 작업을 JSON 으로 (에이전트 창구) |
| `crates/fd-index` | 이름 색인 — 볼륨별 표 · 스냅숏 · 조건 찾기 · 훑기 · 감시 · 앱 안 엔진 · 서비스와 주고받는 파이프 규약 |
| `crates/fd-indexd` | 빠른 색인 서비스 (관리자) — NTFS MFT 읽기 · USN 저널 · 이름 파이프 · 설치 · 지우기. 앱은 이것을 끌어 쓰지 않고 UAC 로 띄우기만 한다 |
| `crates/fd-content` | 본문 색인 — tantivy · 두 글자 조각 · 뒤에서 채우는 일감 줄 (사용자 권한) |
| `skills/filedesk` | Claude Code 스킬 본문 — `fd skill install` 이 fd.exe 경로를 넣어 설치한다 |
| `apps/desktop` | Tauri 2 + React 화면 |

## 단축키 (탐색기와 같다)

| 키 | 동작 |
| - | - |
| Enter · 더블클릭 | 열기 (폴더 · 폴더 바로가기 · md · txt · 그림은 앱 안에서) |
| Backspace · Alt+← / Alt+→ · Alt+↑ | 뒤로 / 앞으로 · 위로 |
| F2 · Delete | 이름 바꾸기 · 휴지통 |
| Ctrl+C · X · V · Ctrl+A | 복사 · 잘라내기 · 붙여넣기 · 모두 고르기 |
| Ctrl+Shift+N · Ctrl+Shift+C | 새 폴더 · 경로 복사 |
| Ctrl+L · Alt+D · F4 · F5 | 주소창 · 새로 고침 |
| Alt+Enter | 속성 |
| 메뉴 키 · Shift+F10 | 오른쪽 메뉴 (filedesk) · 셸 메뉴 — 마우스는 오른쪽 단추 · Shift+오른쪽 단추, filedesk 메뉴 맨 아래 「더 보기」도 셸 메뉴 |
| Ctrl+T · Ctrl+W · Ctrl+Tab · Ctrl+1~9 | 탭 — 나눠 보면 칸마다 제 탭 줄. 탭을 끌어 순서 바꾸기 · 칸 가장자리(상하좌우)에 놓아 그쪽으로 나눠 보기(네 칸까지) · 다른 칸의 탭 줄이나 가운데에 놓아 그 칸으로 옮기기 |
| Ctrl+\ | 오른쪽으로 나누기 · 나눠 있으면 한 칸으로 모으기 (칸 사이 줄을 끌어 너비 · 높이, 두 번 누르면 반반) |
| Ctrl+H | 숨김 항목 보기 |
| Ctrl+F · Ctrl+E | 이 폴더에서 거르기 — 이름 · 메모 글 (Esc 지우기) · Shift+Enter 하위 폴더까지 찾기 |
| Tab · Shift+Tab | 찾는 중에 범위 돌리기 — 이 폴더 → 하위 폴더까지 → 모든 드라이브 (찾기 칸 · 찾은 목록 어디서나) |
| Ctrl+D | 고른 항목(없으면 지금 폴더)을 즐겨찾기에 |
| Alt+1~7 · Alt+0 | 색 표시 (빨강 · 주황 · 노랑 · 초록 · 파랑 · 보라 · 회색) · 지우기 |
| Ctrl+휠 | 목록 ↔ 격자 · 격자 크기 |
| Ctrl+, | 설정 |
| Ctrl+Shift+D | 판 접기 ↔ 펼치기 (문서 하나 = 한 줄) |
| Ctrl+M | 메모 붙이기 · 고치기 (비우면 뗀다 · Shift+Enter 줄바꿈) — 긴 메모는 올려 두면 카드로 |
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
| 시험 앱이 디버깅 포트를 안 연다 | 설치한 filedesk 를 켜 둔 채면 같은 WebView2 데이터 폴더를 써서 그 브라우저에 붙는다 — 시험은 `WEBVIEW2_USER_DATA_FOLDER` 를 따로 준다 |
| 설치 파일에 넣은 fd.exe 가 깨짐 | `target/release/fd.exe` 를 바로 자원으로 쓰면 Tauri 가 같은 자리로 되복사한다 — `scripts/stage-cli.mjs` 가 `target/cli-stage` 로 옮겨 둔다 |
| 화면이 통째로 죽음 (`O is not a function`) | `useEffect(() => f(x))` 처럼 값을 돌려주면 React 가 그것을 정리 함수로 부른다 — 효과 본문은 늘 중괄호로 |
| 이름 바꾸던 글자가 사라짐 | 이름 칸이 열린 채 폴더를 다시 읽으면 선택을 다시 잡아 글자를 덮었다 — 열릴 때 한 번만 고른다 |
| 다른 줄을 눌러도 이름 칸 · 거르기 칸이 안 닫힘 | 줄 누르기가 preventDefault 라 초점이 남는다 — 이어지는 Delete · Enter 가 칸에 들어갔다. 줄을 누르면 입력 칸을 직접 닫는다 |
