//! The Web library shares its durable content between the UI and agent tools.
use crate::{project, project_fs::ProjectDir};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceInput {
    pub url: String,
    pub title: String,
    /// Text actually read from the source, never the search snippet or a generated summary.
    pub content: String,
    pub content_kind: String,
    pub summary: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSource {
    pub schema_version: u32,
    pub id: String,
    pub revision: String,
    pub saved_at: String,
    pub saved_by: String,
    pub content_path: String,
    #[serde(flatten)]
    pub source: SourceInput,
}

fn key(url: &str) -> String { format!("{:x}", Sha256::digest(url.as_bytes())) }

pub fn save(root: &Path, mut input: SourceInput, actor: &str) -> Result<WebSource, String> {
    let mut url = reqwest::Url::parse(input.url.trim()).map_err(|_| "Enter an http(s) URL.")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() {
        return Err("Enter a public http(s) URL without credentials.".into());
    }
    url.set_fragment(None);
    input.url = url.to_string();
    if input.url.len() > 4096 || input.title.trim().is_empty() || input.title.len() > 1000
        || input.content.trim().is_empty() || input.content.len() > 500_000
        || input.summary.len() > 20_000 || !matches!(input.content_kind.as_str(), "excerpt" | "full-text") {
        return Err("A web source needs a title, source text (up to 500 KB), and contentKind excerpt or full-text.".into());
    }
    let id = key(&input.url);
    let revision = uuid::Uuid::new_v4().to_string();
    let title: String = input.title.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_')).take(100).collect();
    let filename = if title.trim().is_empty() { "Web source" } else { title.trim() };
    let content_path = format!(".research/web/{id}/{revision}/{filename}.md");
    let source = WebSource {
        schema_version: 1, id, revision, content_path,
        saved_at: chrono::Utc::now().to_rfc3339(), saved_by: actor.into(), source: input,
    };
    // Immutable captures retain previous evidence and cannot overwrite a concurrent save.
    let path = format!(".research/web/{}/{}.json", source.id, source.revision);
    let files = ProjectDir::open(root)?;
    let kind = if source.source.content_kind == "full-text" { "Full text" } else { "Source excerpts" };
    let markdown = format!("# {filename}\n\n[Original source](<{}>) · {kind}\n\n{}\n", source.source.url, source.source.content);
    files.atomic_write(&source.content_path, markdown.as_bytes())?;
    files.atomic_write(&path, &serde_json::to_vec_pretty(&source).map_err(|e| e.to_string())?)?;
    Ok(source)
}

fn latest(root: &Path) -> Result<BTreeMap<String, WebSource>, String> {
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let root = canonical_root.as_path();
    let mut sources = BTreeMap::<String, WebSource>::new();
    if !root.join(".research/web").try_exists().map_err(|e| e.to_string())? { return Ok(sources); }
    let directory = project::safe_path(root, ".research/web")?;
    if !directory.exists() { return Ok(sources); }
    for entry in walkdir::WalkDir::new(&directory).max_depth(2).follow_links(false) {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() || entry.path().extension().is_none_or(|ext| ext != "json") { continue; }
        let relative = entry.path().strip_prefix(root).map_err(|e| e.to_string())?;
        let path = project::safe_path(root, &relative.to_string_lossy())?;
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 600_000 { return Err("Web source exceeds its size limit.".into()); }
        let source: WebSource = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| format!("Cannot read web source: {e}"))?;
        if source.schema_version != 1 || source.id != key(&source.source.url) { return Err("Unsupported or inconsistent web source.".into()); }
        if sources.get(&source.id).is_none_or(|old| (&old.saved_at, &old.revision) < (&source.saved_at, &source.revision)) {
            sources.insert(source.id.clone(), source);
        }
    }
    Ok(sources)
}

pub fn list(root: &Path) -> Result<serde_json::Value, String> {
    let mut sources: Vec<_> = latest(root)?.into_values().collect();
    sources.sort_by(|a,b| b.saved_at.cmp(&a.saved_at));
    let values: Vec<_> = sources.iter().map(|s| {
        let mut value = serde_json::to_value(s).expect("WebSource serializes");
        value.as_object_mut().unwrap().remove("content");
        value
    }).collect();
    Ok(serde_json::json!({"sources": values}))
}

pub fn read(root: &Path, id: &str) -> Result<WebSource, String> {
    latest(root)?.remove(id).ok_or_else(|| "Web source not found.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(content: &str) -> SourceInput {
        SourceInput { url: "https://example.org/method#section".into(), title: "Method".into(),
            content: content.into(), content_kind: "excerpt".into(), summary: "Agent interpretation".into() }
    }

    #[test]
    fn captures_survive_reopen_without_overwriting_evidence() {
        let project = crate::test_support::TempDir::new("web-library");
        let root = project.as_ref();
        assert_eq!(list(root).unwrap()["sources"].as_array().unwrap().len(), 0);
        let first = save(root, input("Original passage"), "agent").unwrap();
        let second = save(root, input("Updated passage"), "human").unwrap();
        assert_eq!(first.id, second.id);
        assert_ne!(first.content_path, second.content_path);
        assert_eq!(list(root).unwrap()["sources"].as_array().unwrap().len(), 1);
        assert!(list(root).unwrap()["sources"][0].get("content").is_none());
        assert_eq!(read(root, &first.id).unwrap().source.content, "Updated passage");
        let markdown = fs::read_to_string(root.join(first.content_path)).unwrap();
        assert!(markdown.contains("Original passage"));
        assert!(markdown.contains("https://example.org/method"));
        assert!(!markdown.contains("Agent interpretation"));
        assert!(save(root, input(" "), "agent").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn library_can_be_opened_through_a_project_symlink() {
        let project = crate::test_support::TempDir::new("web-library");
        let parent = crate::test_support::TempDir::new("web-library");
        let alias = parent.join("project");
        std::os::unix::fs::symlink(project.as_ref(), &alias).unwrap();
        let source = save(&alias, input("A passage"), "agent").unwrap();
        assert_eq!(read(&alias, &source.id).unwrap().source.content, "A passage");
    }
}
