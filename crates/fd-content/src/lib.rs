//! filedesk 본문 색인 — 「문서 본문까지」를 모든 드라이브에서 바로 찾으려고.
//!
//! tantivy 색인 하나에 문서마다 경로 · 고친 때 · 크기 · 두 글자 조각(`tokenizer`) · 본문(저장)을 둔다.
//! 찾을 때는 조각으로 후보를 받고, 저장된 본문으로 정말 들어 있는지 확인하며 맞은 곳 앞뒤(`text::snippet`)를 만든다 —
//! 그래서 결과가 그 자리 본문 찾기와 같다.
//!
//! 사용자 권한으로만 돈다 (관리자 서비스는 파일 내용을 열지 않는다). 자리는 `%LOCALAPPDATA%\kr.seesun.filedesk\content`.
//! 색인은 투영일 뿐이라 지워도 다시 만든다. 쓰는 쪽은 앱 하나, 명령줄은 읽기만 한다.
//! 2026.11.12 : 처음 씀.

pub mod queue;
pub mod tokenizer;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::query::{BooleanQuery, Occur, PhraseQuery, Query, TermQuery};
use tantivy::schema::{Field, IndexRecordOption, STORED, STRING, Schema, TEXT, Value};
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term, doc};

pub use queue::{ContentStatus, Worker};

/// 색인 판 — 칸을 바꾸면 올린다 (다른 판 색인은 지우고 다시 만든다).
const SCHEMA_VERSION: &str = "1";

/// 본문 색인 자리.
pub fn default_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("kr.seesun.filedesk").join("content"))
}

struct Fields {
    path: Field,
    key: Field,
    modified: Field,
    size: Field,
    grams: Field,
    body: Field,
}

fn schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    let f = Fields {
        path: b.add_text_field("path", STORED),
        key: b.add_text_field("key", STRING | STORED),
        modified: b.add_i64_field("modified", STORED),
        size: b.add_u64_field("size", STORED),
        grams: b.add_text_field("grams", TEXT),
        body: b.add_text_field("body", STORED),
    };
    (b.build(), f)
}

/// 찾은 문서.
#[derive(Debug, Clone)]
pub struct Hit {
    pub path: String,
    pub modified: i64,
    pub size: u64,
    pub snippet: String,
}

pub struct ContentIndex {
    index: Index,
    reader: IndexReader,
    writer: Option<Mutex<IndexWriter>>,
    f: Fields,
}

fn err(e: impl std::fmt::Display) -> String {
    format!("본문 색인: {e}")
}

impl ContentIndex {
    /// 연다 (없으면 만든다). `writable` 이 아니면 읽기만 한다 — 앱이 쓰는 동안 명령줄이 읽을 때.
    pub fn open(dir: &Path, writable: bool) -> Result<ContentIndex, String> {
        let stamp = dir.join("filedesk-schema.txt");
        if writable && std::fs::read_to_string(&stamp).ok().as_deref() != Some(SCHEMA_VERSION) {
            let _ = std::fs::remove_dir_all(dir);
        }
        std::fs::create_dir_all(dir).map_err(err)?;
        let (schema, f) = schema();
        let index = match Index::open_or_create(MmapDirectory::open(dir).map_err(err)?, schema.clone()) {
            Ok(i) => i,
            Err(_) if writable => {
                // 칸이 다른 색인 — 지우고 새로
                let _ = std::fs::remove_dir_all(dir);
                std::fs::create_dir_all(dir).map_err(err)?;
                Index::open_or_create(MmapDirectory::open(dir).map_err(err)?, schema).map_err(err)?
            }
            Err(e) => return Err(err(e)),
        };
        if writable {
            let _ = std::fs::write(&stamp, SCHEMA_VERSION);
        }
        let reader = index.reader_builder().reload_policy(ReloadPolicy::OnCommitWithDelay).try_into().map_err(err)?;
        let writer = if writable { Some(Mutex::new(index.writer_with_num_threads(1, 50_000_000).map_err(err)?)) } else { None };
        Ok(ContentIndex { index, reader, writer, f })
    }

    fn key(path: &str) -> String {
        fd_index::norm(path)
    }

    /// 문서 하나를 넣거나 바꾼다.
    pub fn upsert(&self, path: &str, modified: i64, size: u64, text: &str) -> Result<(), String> {
        let Some(w) = &self.writer else { return Err("읽기 전용으로 열었다".into()) };
        let w = w.lock().map_err(err)?;
        let key = Self::key(path);
        w.delete_term(Term::from_field_text(self.f.key, &key));
        w.add_document(doc!(
            self.f.path => path,
            self.f.key => key,
            self.f.modified => modified,
            self.f.size => size,
            self.f.grams => tokenizer::index_text(text),
            self.f.body => text,
        ))
        .map_err(err)?;
        Ok(())
    }

    pub fn remove(&self, path: &str) {
        if let Some(w) = &self.writer
            && let Ok(w) = w.lock()
        {
            w.delete_term(Term::from_field_text(self.f.key, &Self::key(path)));
        }
    }

    /// 바뀐 것을 디스크에 쓴다 — 찾기에 보이는 때.
    pub fn commit(&self) -> Result<(), String> {
        let Some(w) = &self.writer else { return Ok(()) };
        w.lock().map_err(err)?.commit().map_err(err)?;
        Ok(())
    }

    /// 담긴 문서의 (고친 때, 크기). 없으면 None.
    pub fn lookup(&self, path: &str) -> Option<(i64, u64)> {
        let searcher = self.reader.searcher();
        let q = TermQuery::new(Term::from_field_text(self.f.key, &Self::key(path)), IndexRecordOption::Basic);
        let top = searcher.search(&q, &TopDocs::with_limit(1)).ok()?;
        let (_, addr) = top.first()?;
        let d: TantivyDocument = searcher.doc(*addr).ok()?;
        let m = d.get_first(self.f.modified).and_then(|v| v.as_i64())?;
        let s = d.get_first(self.f.size).and_then(|v| v.as_u64())?;
        Some((m, s))
    }

    /// 담긴 문서 수.
    pub fn count(&self) -> u64 {
        self.reader.searcher().num_docs()
    }

    /// 찾는 말(소문자)이 본문에 다 든 문서. 색인으로 좁힐 수 없는 말뿐이면(모두 한 글자) None — 부르는 쪽이 그 자리에서 읽는다.
    pub fn search(&self, terms: &[String], limit: usize) -> Option<Vec<Hit>> {
        let mut parts: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        for t in terms {
            for run in tokenizer::query_runs(t) {
                let q: Box<dyn Query> = if run.len() == 1 {
                    Box::new(TermQuery::new(Term::from_field_text(self.f.grams, &run[0]), IndexRecordOption::Basic))
                } else {
                    Box::new(PhraseQuery::new(run.iter().map(|g| Term::from_field_text(self.f.grams, g)).collect()))
                };
                parts.push((Occur::Must, q));
            }
        }
        if parts.is_empty() {
            return None;
        }
        let q = BooleanQuery::new(parts);
        let searcher = self.reader.searcher();
        let top = searcher.search(&q, &TopDocs::with_limit(limit.saturating_mul(2).max(10))).ok()?;
        let mut out = Vec::new();
        for (_, addr) in top {
            let Ok(d) = searcher.doc::<TantivyDocument>(addr) else { continue };
            let body = d.get_first(self.f.body).and_then(|v| v.as_str()).unwrap_or("");
            let Some(snippet) = fd_core::text::snippet(body, terms) else { continue };
            let path = d.get_first(self.f.path).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let modified = d.get_first(self.f.modified).and_then(|v| v.as_i64()).unwrap_or(0);
            let size = d.get_first(self.f.size).and_then(|v| v.as_u64()).unwrap_or(0);
            out.push(Hit { path, modified, size, snippet });
            if out.len() >= limit {
                break;
            }
        }
        Some(out)
    }

    /// 다 지운다 (다시 만들기).
    pub fn clear(&self) -> Result<(), String> {
        let Some(w) = &self.writer else { return Ok(()) };
        let mut w = w.lock().map_err(err)?;
        w.delete_all_documents().map_err(err)?;
        w.commit().map_err(err)?;
        Ok(())
    }

    #[allow(dead_code)]
    fn index(&self) -> &Index {
        &self.index
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_substrings_like_live_search() {
        let dir = std::env::temp_dir().join(format!("fd-content-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let ix = ContentIndex::open(&dir, true).unwrap();
        ix.upsert(r"C:\가\보고.docx", 10, 100, "이 사업은 산림재난 예방을 다룬다").unwrap();
        ix.upsert(r"C:\가\계획.hwpx", 20, 200, "산림재난 대응 계획").unwrap();
        ix.upsert(r"C:\가\다른.txt", 30, 300, "관계없는 글 산림 재난").unwrap();
        ix.commit().unwrap();
        ix.reader.reload().unwrap();
        let names = |terms: &[&str]| {
            let t: Vec<String> = terms.iter().map(|s| s.to_string()).collect();
            let mut v: Vec<String> = ix.search(&t, 10).unwrap().into_iter().map(|h| h.path).collect();
            v.sort();
            v
        };
        assert_eq!(names(&["산림재난"]), [r"C:\가\계획.hwpx", r"C:\가\보고.docx"]);
        assert_eq!(names(&["림재난"]), [r"C:\가\계획.hwpx", r"C:\가\보고.docx"]);
        assert_eq!(names(&["산림재난", "대응"]), [r"C:\가\계획.hwpx"]);
        // 띄어 쓴 「산림 재난」은 「산림재난」과 다르다 (그 자리 찾기와 같다)
        assert_eq!(names(&["산림", "재난"]).len(), 3);
        // 한 글자는 색인으로 좁히지 못한다
        assert!(ix.search(&["가".to_string()], 10).is_none());
        assert_eq!(ix.lookup(r"c:\가\계획.HWPX"), Some((20, 200)));
        // 바꾸면 하나만 남는다
        ix.upsert(r"C:\가\계획.hwpx", 21, 201, "다른 내용").unwrap();
        ix.remove(r"C:\가\보고.docx");
        ix.commit().unwrap();
        ix.reader.reload().unwrap();
        assert!(names(&["산림재난"]).is_empty());
        assert_eq!(ix.count(), 2);
        drop(ix);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
