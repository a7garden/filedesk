import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import type { Theme } from "./api";
import { applyTheme } from "./util";

// 설정 파일을 읽기 전에 지난번 화면 색을 먼저 입힌다 — 켤 때 시스템 색으로 번쩍이지 않게. 설정을 읽으면 App 이 다시 입힌다.
try {
  const t = localStorage.getItem("theme");
  if (t === "light" || t === "dark") applyTheme(t as Theme);
} catch {}

// 웹 화면 기본 메뉴(뒤로 · 새로 고침 · 검사 · 이미지 저장)를 끈다 — 오른쪽 단추는 filedesk 메뉴(ContextMenu)가 맡는다. 글 입력 칸만 남긴다.
// 2026.11.11 : 잡는 단계(capture)로 바꿨다. 줄 · 칸의 처리기가 stopPropagation 을 불러 문서까지 올라오지 않았고,
//   그래서 아이콘(<img>) 위에서 「이미지 저장」 메뉴가 먼저 뜬 뒤 셸 메뉴가 떴다. 잡는 단계는 React 처리기보다 먼저 돈다.
document.addEventListener(
  "contextmenu",
  (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest("input, textarea")) e.preventDefault();
  },
  true,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
