// 배포 빌드 앞 — 명령줄 fd.exe 와 색인 서비스 fd-indexd.exe 를 설치 파일에 넣을 자리(target/cli-stage)로 옮겨 둔다 (tauri.release.json).
// target/release/*.exe 를 바로 자원으로 쓰면 Tauri 가 같은 자리(target/release)로 되복사하며 원본과 겹친다 — 그래서 따로 둔다.
// 2026.11.12 : fd-indexd.exe 를 더했다 — 앱의 설정 › 색인 › 「빠른 색인 서비스 설치」가 이것을 관리자 권한으로 띄운다.
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const out = join(root, "target", "cli-stage");
mkdirSync(out, { recursive: true });
for (const exe of ["fd.exe", "fd-indexd.exe"]) {
  copyFileSync(join(root, "target", "release", exe), join(out, exe));
  console.log(`${exe} → ${out}`);
}
