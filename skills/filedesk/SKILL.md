---
name: filedesk
description: Windows 에서 파일 · 폴더를 정리할 때 쓴다 — 문서의 판(v1 · v2 · 날짜) 보기, 새 판 내기, 최신판 자리에 남은 지난 판을 이전판 폴더로 옮기기, 파일 · 폴더 메모 읽고 쓰기, 휴지통으로 지우기. 「파일 정리」 「폴더 정리」 「새 판」 「이전판」 「판 정리」 「메모 달아」 「filedesk」 요청 때 쓴다.
---

# filedesk — 파일 관리 (명령줄 `fd`, filedesk {{VERSION}})

filedesk 앱과 같은 판단을 명령줄로 한다. 사람이 앱에서 보는 판 · 문제 · 메모와 에이전트가 보는 것이 같다.

```
FD="{{FD}}"
```

명령은 모두 JSON 을 낸다. 실패하면 표준 오류에 `{"error": "…"}` 와 종료 코드 1 — 그 문장은 사용자에게 그대로 전해도 된다.
경로는 `D:/문서/…` 처럼 빗금으로 줘도 된다 (안에서 역빗금 · 절대 경로로 맞춘다).

## 지키는 것

1. **파일을 바꾸기 전에 계획을 보인다.** `edition` · `retire` 는 `--apply` 없이 먼저 돌려 `plan` · `documents` · `collisions` 를 사용자에게 보이고, 확인을 받은 뒤 `--apply` 로 다시 부른다.
2. **지우기는 `fd trash` 로만 한다.** `rm` · `del` · `Remove-Item` 을 쓰지 않는다. 휴지통에 못 들어가는 자리(NAS 등)면 셸이 사람에게 묻는다 — 그 창이 뜨면 사용자에게 알린다.
3. **옮기기 · 새 판은 셸이 한다.** 탐색기 Ctrl+Z 로 되돌릴 수 있다. `collisions` 가 비어 있지 않으면 `--apply` 가 멈춘다 — 겹치는 파일을 사용자와 정리한 뒤 다시 한다.
4. **판단의 까닭은 메모로 남긴다.** 왜 이 파일을 남겼는지 · 무엇을 기다리는지 같은 것은 `fd memo set` 으로 그 파일에 붙인다. 앱 목록에 바로 보이고, 파일 이름이 바뀌거나 옮겨져도 따라간다.
5. **이 스킬이 다루지 않는 것** — 파일 내용 읽기 · 고치기, 일반 복사 · 이름 바꾸기는 평소 도구로 한다.

## 명령

| 하는 일 | 명령 | 결과 |
| - | - | - |
| 폴더 목록 | `$FD ls <폴더> [--all]` | `[{name, path, isDir, size, modified(ms), ext, kind}]` |
| 문서 · 판 묶기 | `$FD docs <폴더> [-r] [--summary]` | `[{key, title, files[{path, name, inHistory, parsed{version, date}}], issues[]}]` — `files[0]` 이 최신판 |
| 판 문제만 | `$FD docs <폴더> -r --summary` | `{files, documents, withIssues[{title, latest, issues}]}` |
| 새 판 계획 / 실행 | `$FD edition <파일> [--today YYYYMMDD] [--apply]` | `{applied, plan{source, newName, newPath, retire[], history}, collisions[]}` |
| 지난 판 정리 계획 / 실행 | `$FD retire <폴더> [--doc <key>] [--apply]` | `{applied, history, documents[{key, title, move[]}], collisions[]}` |
| 조건으로 찾기 | `$FD query "<말 · 조건>" [--in <폴더>]… [--no-recurse] [--content] [--live] [--limit N]` | `{spec, sources[], truncated, items[{name, path, size, modified, created, memo?, snippet?}]}` — `--in` 이 없으면 모든 고정 드라이브 (색인) |
| 색인 상태 | `$FD index status` · `$FD index rebuild` | `{index{service, volumes[{root, method, files, updated, state}]}, contentDocuments}` |
| 휴지통 | `$FD trash <경로>…` | `{trashed[]}` |
| 메모 | `$FD memo ls [폴더]` · `$FD memo get <경로>` · `$FD memo set <경로> "<글>"` (`""` 이면 뗀다) | `{path, text, updated}` |
| 폴더 이름 관례 | `$FD conv <폴더>` | `{convention{files, folders}, newFolder, deviations[{path, name, suggestion}]}` — 바꾸지 않는다 |
| 이름 제안 | `$FD name <경로> [--to <폴더>] [--date YYYYMMDD]` | `{name, changes[], follows, byConvention}` — 바꾸지 않는다 |
| 스킬 갱신 | `$FD skill install` | 앱을 새 판으로 올린 뒤 한 번 |

## 찾기 조건 (앱 찾기 칸 · 스마트 폴더와 같다)

찾는 말 사이에 `열쇠:값` 을 섞는다. 값이 없는 낱말은 이름(과 메모)에 다 들어 있어야 맞고, `-낱말` 은 그 낱말이 든 것을 뺀다.

| 열쇠 (영어 별칭) | 값 | 뜻 |
| - | - | - |
| `고친` (`modified`) | `오늘` · `어제` · `3일` · `<7일` · `>30일` · `2주` · `6달` · `1년` · `2026-11-01` · `2026-11-01..2026-11-10` | 생긴 때 · 고친 때 중 늦은 것 (받은 파일도 잡는다) |
| `크기` (`size`) | `>10MB` · `<1KB` · `1MB..1GB` | 파일 크기 |
| `확장자` (`ext`) | `pdf` · `pdf,hwpx` | |
| `종류` (`kind`) | `문서` · `표` · `발표` · `PDF` · `그림` · `폴더` · `파일` | 앱 기본 종류 |
| `색` (`color`) | `빨강` (`red`) … `회색` · `있음` | 색 표시 |
| `메모` (`memo`) | `있음` · `없음` | |

예: `$FD query "보고 고친:7일 종류:문서 -초안" --in "D:\work"` · `$FD query "산림재난" --content` (본문 색인).
「모든 드라이브」는 앱(빠른 색인 서비스)이 만든 색인을 쓴다 — 서비스가 없으면 그 자리에서 훑어 느리다. `sources` 에 `live` 가 있으면 사용자에게 「색인 없이 훑었다」고 전한다.

## 판 · 이름 규칙 (앱과 같다)

- **정해진 이름 꼴은 없다.** 그 폴더가 이미 쓰는 꼴(`fd conv`)을 따른다 — `제목_v3_20261111` · `2026-11-11 제목` · `01_제목` 무엇이든.
  이름을 새로 짓거나 받은 파일을 들일 때는 `$FD name` 의 제안을 사용자에게 보이고 고르게 한다. 제안은 빠진 판 · 날짜 · 순번을 더하고 복사본 표시 · 상태 말을 뗄 뿐, 제목은 바꾸지 않는다.
- 판 꼴: `v3` · `V1.2` · `ver2` · `rev3` · `제3판`. 날짜 꼴: `20261111` · `2026-11-11` · `2026.11.11` · `261111`. `2차` 는 판이 아니라 회차로 본다.
- 정본 폴더에는 최신판 하나만. 지난 판은 그 폴더의 지난 판 폴더에 — 이미 있는 것(`이전판` · `지난판` · `구버전` · `old versions` …)을 쓰고, 없으면 `이전판/` 을 만든다.
- 새 판은 마지막 판 자리를 하나 올리고 날짜를 오늘로 한다 (이름의 꼴 그대로). 오늘 판이 이미 있으면 `plan.note` 가 알린다 — 사용자에게 전하고 고르게 한다.
- 문서 이름에서 판 · 날짜 · 작성자 꼬리 · 상태 말(최종 · final · draft …) · 복사본 표시(`(1)` · `- 복사본` · `Copy of` …)를 떼고 남은 것이 같으면 같은 문서로 묶는다.

## 흐름 예

**폴더 정리** — 「이 폴더 판 정리해 줘」

1. `$FD docs <폴더> --summary` 로 문제 있는 문서를 본다.
2. `$FD retire <폴더>` 로 옮길 목록을 사용자에게 보인다 (문서별 `move`).
3. 확인을 받으면 `$FD retire <폴더> --apply`. `moved` 수를 보고한다.

**새 판** — 「보고서 새 판 만들어」

1. `$FD edition <최신판 파일>` → `plan.newName` 과 `plan.retire` 를 보인다.
2. 확인 뒤 `--apply`. 새 파일 경로는 `plan.newPath`.
3. 바뀐 까닭을 들었으면 `$FD memo set <newPath> "<까닭>"`.

