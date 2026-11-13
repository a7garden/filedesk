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
  const old = svc && hub && hub.index.serviceVersion !== hub.appVersion;
  const content = hub?.content;

  return (
    <>
      <p className="muted set-note">
        「모든 드라이브」 찾기 · 스마트 폴더가 쓴다. 파일 이름 · 크기 · 고친 날을 담고, 문서(hwpx · docx · pptx · xlsx · pdf · txt · md)는 본문도 담는다.
        색인은 이 PC 안에만 있고 지워도 다시 만든다. NAS · 네트워크 드라이브는 담지 않는다. 누를 때 그 자리에서 훑는다.
      </p>
      <div className="set-line">
        <span className="set-label">빠른 색인</span>
        <div>
          <div className="set-acts">
            <span className="set-path">
              {hub == null ? "확인 중…" : svc ? `서비스가 맡는다${old ? " (앱과 버전이 다르다)" : ""}` : "앱이 드라이브를 훑어 색인한다"}
            </span>
            {hub && !svc && (
              <button
                className="act primary"
                disabled={!hub.bundled || !!busy}
                title={hub.bundled ? "관리자 권한을 묻는 창이 뜬다" : "설치 파일로 설치한 앱에서만 된다"}
                onClick={() => run("install", () => api.serviceSetup("install"), "빠른 색인 서비스를 설치했다")}
              >
                {busy === "install" ? "설치하는 중…" : "빠른 색인 서비스 설치"}
              </button>
            )}
            {svc && old && (
              <button className="act primary" disabled={!hub?.bundled || !!busy} onClick={() => run("update", () => api.serviceSetup("update"), "서비스를 앱과 같은 버전으로 바꿨다")}>
                서비스 업데이트
              </button>
            )}
            {svc && (
              <button className="act" disabled={!hub?.bundled || !!busy} onClick={() => run("uninstall", () => api.serviceSetup("uninstall"), "서비스를 지웠다. 앱이 다시 색인한다")}>
                서비스 지우기
              </button>
            )}
          </div>
          <p className="muted set-hint">
            관리자 권한 서비스가 NTFS 드라이브의 파일 목록(MFT)을 바로 읽어 몇 초 만에 색인하고, 앱이 꺼져 있던 동안 바뀐 것도 정확히 따라간다. 파일 내용은 열지 않는다.
            설치할 때 Windows 가 관리자 권한을 묻고, 서명하지 않은 서비스라 보안 프로그램이 막을 수 있다. 막히면 앱이 계속 색인한다.
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
                    <td>{v.method === "ntfs" ? (v.usn ? "MFT · USN" : "MFT") : "훑기 · 감시"}</td>
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
            <p className="muted set-hint">{hub ? "아직 색인이 없다. 만드는 중이거나 고정 드라이브가 없다" : ""}</p>
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
                  {content.paused ? "다시 담기" : "잠시 멈춤"}
                </button>
              </div>
              <p className="muted set-hint">
                뒤에서 천천히 담는다. pdf 는 한 개에 몇 초가 걸려 맨 뒤에 따로 한다. Windows · Program Files · AppData · 다른 계정 폴더는 담지 않는다.
              </p>
            </>
          ) : (
            <p className="muted set-hint">본문 색인을 열지 못했다. 「문서 본문까지」는 그 자리에서 읽는다</p>
          )}
        </div>
      </div>
      <div className="set-line">
        <span className="set-label">빼는 폴더</span>
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
            <button className="act" onClick={() => run("exclude", () => api.indexExclude(exclude.split("\n")), "빼는 폴더를 바꿨다. 찾기 결과에서 바로 빠진다")}>
              저장
            </button>
            <button className="link-btn" onClick={() => setExclude((x) => (x.trim() ? `${x.trim()}\n${current}` : current))} title={current}>
              지금 폴더 더하기
            </button>
          </div>
        </div>
      </div>
      <div className="set-acts">
        <button className="act" disabled={!!busy} onClick={() => run("rebuild", () => api.indexRebuild(), "처음부터 다시 만든다. 그동안은 지난 색인으로 찾는다")}>
          다시 만들기
        </button>
        {msg && <span className={msg.warn ? "warn-text" : "muted"}>{msg.text}</span>}
      </div>
    </>
  );
}
