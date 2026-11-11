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

// 웹 화면 기본 메뉴(뒤로 · 새로 고침 · 검사)를 끈다 — 오른쪽 단추는 셸 메뉴가 맡는다. 글 입력 칸만 남긴다.
document.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
