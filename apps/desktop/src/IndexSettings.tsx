// 설정 › 색인 — 빠른 색인 서비스 · 드라이브마다 방법과 상태 · 문서 본문 색인 진행 · 빼는 폴더 · 다시 만들기.
//
// 빠른 색인 서비스(fd-indexd)는 관리자 권한으로 NTFS MFT 를 읽어 몇 초 만에 색인하고, 꺼져 있던 동안의 변경도 USN 저널로 따라간다.
// 깔지 않으면 앱이 드라이브를 훑어 색인한다 (첫 색인이 몇 분 걸리고, 앱이 꺼져 있던 동안의 변경은 다음 훑기에 맞춘다).
// 2026.11.12 : 처음 씀.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HubStatus } from "./api";
import { ago } from "./query";
import { errText } from "./util";

export default function IndexSettings({ current }: { current: string }) {
  const [hub, setHub] = useState<HubStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [exclude, setExclude] = useState("");
  /** 빼는 폴더 칸은 처음 한 번만 채운다 — 3초마다 읽는 상태가 고치는 중인 글을 덮지 않게. */
  const excludeFilled = useRef(false);

  const load = useCallback(() => {
    api
      .indexStatus()
      .then((h) => {
        setHub(h);
        if (!excludeFilled.current) {
          excludeFilled.current = true;
          setExclude(h.exclude.join("\n"));
        }
      })
      .catch((e) => setMsg({ text: errText(e), warn: true }));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, [load]);

  const run = (label: string, f: () => Promise<HubStatus | void>, done?: string) => {
    setBusy(label);
    setMsg(null);
    f()
      .then((h) => {
        if (h) setHub(h);
        if (done) setMsg({ text: done });
      })
      .catch((e) => setMsg({ text: errText(e), warn: true }))
      .finally(() => setBusy(""));
  };

  const svc = hub?.index.service;
  const old = svc && hub && (hub.index.serviceVersion !== hub.appVersion || (hub.serviceBuild != null && hub.serviceBuild !== hub.appBuild));
  const content = hub?.content;

  return (
    <>
      <p className="muted set-note">
        「모든 드라이브」 찾기 · 스마트 폴더용. NAS · 네트워크 드라이브 제외.
      </p>
      <div className="set-line">
        <span className="set-label">빠른 색인</span>
        <div>
          <div className="set-acts">
            <span className="set-path">
              {hub == null ? "확인 중…" : svc ? `빠른 색인 서비스${old ? ` ${hub.serviceBuild ?? ""} · 앱 ${hub.appBuild}` : ""}` : "앱이 직접 색인"}
            </span>
            {hub && !svc && (
              <button
                className="act primary"
                disabled={!hub.bundled || !!busy}
                title={hub.bundled ? "관리자 권한 필요" : "설치 파일로 설치한 앱에서만 가능"}
                onClick={() => run("install", () => api.serviceSetup("install"), "빠른 색인 서비스 설치됨")}
              >
                {busy === "install" ? "설치하는 중…" : "빠른 색인 서비스 설치"}
              </button>
            )}
            {svc && old && (
              <button className="act primary" disabled={!hub?.bundled || !!busy} onClick={() => run("update", () => api.serviceSetup("update"), "서비스 업데이트됨")}>
                서비스 업데이트
              </button>
            )}
            {svc && (
              <button className="act" disabled={!hub?.bundled || !!busy} onClick={() => run("uninstall", () => api.serviceSetup("uninstall"), "서비스 제거됨")}>
                서비스 지우기
              </button>
            )}
          </div>
          <p className="muted set-hint">
            NTFS 파일 목록(MFT)을 직접 읽어 몇 초 안에 색인. 서명하지 않은 서비스라 보안 프로그램이 막을 수 있음.
          </p>
        </div>
      </div>
      <div className="set-line">
        <span className="set-label">드라이브</span>
        <div>
          {hub && hub.index.volumes.length > 0 ? (
            <table className="index-table">
              <thead>
                <tr>
                  <th>드라이브</th>
                  <th>방법</th>
                  <th>파일</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {hub.index.volumes.map((v) => (
                  <tr key={v.root}>
                    <td>{v.root}</td>
                    <td>{v.method === "ntfs" ? (v.usn ? "MFT · USN" : "MFT") : "직접 읽기 · 감시"}</td>
                    <td className="num">{v.files.toLocaleString("ko-KR")}</td>
                    <td>
                      {v.state === "ready" ? ago(v.updated) || "준비됨" : v.state === "error" ? "오류" : "만드는 중"}
                      {v.note && <span className="muted"> · {v.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted set-hint">{hub ? "색인 없음" : ""}</p>
          )}
        </div>
      </div>
      <div className="set-line">
        <span className="set-label">문서 본문</span>
        <div>
          {content ? (
            <>
              <p className="set-path">
                {content.indexed.toLocaleString("ko-KR")}개 담음
                {content.queued > 0 && ` · 남은 것 ${content.queued.toLocaleString("ko-KR")}${content.pdfLeft ? ` (pdf ${content.pdfLeft.toLocaleString("ko-KR")})` : ""}`}
                {content.failed > 0 && ` · 못 읽은 것 ${content.failed.toLocaleString("ko-KR")}`}
                {content.paused && " · 멈춤"}
              </p>
              {content.queued > 0 && (
                <div className="index-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round((content.indexed / Math.max(1, content.indexed + content.queued)) * 100)}%` }} />
                </div>
              )}
              <div className="set-acts">
                <button className="act" onClick={() => run("pause", () => api.contentPause(!content.paused).then(() => api.indexStatus()))}>
                  {content.paused ? "다시 시작" : "잠시 멈춤"}
                </button>
              </div>
              <p className="muted set-hint">
                제외: Windows · Program Files · AppData · 다른 계정 폴더
              </p>
            </>
          ) : (
            <p className={hub?.contentError ? "set-hint warn" : "muted set-hint"}>
              {hub == null ? "확인 중…" : hub.contentError ? `본문 색인을 열 수 없음: ${hub.contentError}` : "여는 중…"}
            </p>
          )}
        </div>
      </div>
      <div className="set-line">
        <span className="set-label">제외 폴더</span>
        <div>
          <textarea
            className="index-exclude"
            rows={3}
            value={exclude}
            spellCheck={false}
            placeholder={"한 줄에 하나: D:\\임시\nC:\\Users\\나\\OneDrive\\옛 자료"}
            onChange={(e) => setExclude(e.target.value)}
          />
          <div className="set-acts">
            <button className="act" onClick={() => run("exclude", () => api.indexExclude(exclude.split("\n")), "제외 폴더 저장됨")}>
              저장
            </button>
            <button className="act" onClick={() => setExclude((x) => (x.trim() ? `${x.trim()}\n${current}` : current))} title={current}>
              지금 폴더 추가
            </button>
          </div>
        </div>
      </div>
      <div className="set-acts">
        <button className="act" disabled={!!busy} onClick={() => run("rebuild", () => api.indexRebuild(), "색인 다시 만드는 중")}>
          다시 만들기
        </button>
        {msg && <span className={msg.warn ? "warn-text" : "muted"}>{msg.text}</span>}
      </div>
    </>
  );
}
