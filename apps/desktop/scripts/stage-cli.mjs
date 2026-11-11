// 배포 빌드 앞 — 명령줄 fd.exe 를 설치 파일에 넣을 자리(target/cli-stage)로 옮겨 둔다 (tauri.release.json).
// target/release/fd.exe 를 바로 자원으로 쓰면 Tauri 가 같은 자리(target/release)로 되복사하며 원본과 겹친다 — 그래서 따로 둔다.
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const out = join(root, "target", "cli-stage");
mkdirSync(out, { recursive: true });
copyFileSync(join(root, "target", "release", "fd.exe"), join(out, "fd.exe"));
console.log(`fd.exe → ${out}`);
