use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

const MAX_BOARD_BYTES: u64 = 100 * 1024 * 1024;

// Paths never cross the IPC boundary. A native picker is the only production
// source of file access; tests replace that decision, not the file operations.
trait FilePicker: Send + Sync {
    fn open(&self) -> Result<Option<PathBuf>, String>;
    fn save(&self, suggested_name: &str) -> Result<Option<PathBuf>, String>;
}

struct NativePicker<R: Runtime>(tauri::AppHandle<R>);

impl<R: Runtime> FilePicker for NativePicker<R> {
    fn open(&self) -> Result<Option<PathBuf>, String> {
        self.0
            .dialog()
            .file()
            .add_filter("MindBoard", &["mindboard", "json"])
            .blocking_pick_file()
            .map(|path| path.into_path().map_err(|error| error.to_string()))
            .transpose()
    }

    fn save(&self, suggested_name: &str) -> Result<Option<PathBuf>, String> {
        self.0
            .dialog()
            .file()
            .add_filter("MindBoard", &["mindboard"])
            .set_file_name(suggested_name)
            .blocking_save_file()
            .map(|path| path.into_path().map_err(|error| error.to_string()))
            .transpose()
    }
}

struct BoardFiles(Arc<dyn FilePicker>);

fn validate_contents(contents: &str) -> Result<(), String> {
    if contents.len() as u64 > MAX_BOARD_BYTES {
        return Err("This board exceeds the 100 MB file limit.".into());
    }
    let value: serde_json::Value = serde_json::from_str(contents)
        .map_err(|_| "The board file is not valid JSON.".to_string())?;
    if !value.is_object() {
        return Err("The board file must contain a JSON object.".into());
    }
    Ok(())
}

fn suggested_file_name(name: &str) -> String {
    let stem: String = name
        .trim_end_matches(".mindboard")
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(100)
        .collect();
    let stem = stem.trim().trim_matches('.');
    format!(
        "{}.mindboard",
        if stem.is_empty() { "Untitled" } else { stem }
    )
}

fn read_board(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| format!("Could not open board: {error}"))?;
    let mut contents = String::new();
    file.take(MAX_BOARD_BYTES + 1)
        .read_to_string(&mut contents)
        .map_err(|error| format!("Could not read board: {error}"))?;
    validate_contents(&contents)?;
    Ok(contents)
}

fn write_board(path: &Path, contents: &str) -> Result<(), String> {
    validate_contents(contents)?;
    let parent = path
        .parent()
        .ok_or("The selected file has no parent folder.")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Could not prepare board save: {error}"))?;
    temporary
        .write_all(contents.as_bytes())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("Could not write board: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("Could not save board: {}", error.error))?;
    Ok(())
}

#[tauri::command]
async fn open_board_file(files: State<'_, BoardFiles>) -> Result<Option<String>, String> {
    let picker = files.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        picker.open()?.map(|path| read_board(&path)).transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_board_file(
    files: State<'_, BoardFiles>,
    contents: String,
    suggested_name: String,
) -> Result<bool, String> {
    validate_contents(&contents)?;
    let picker = files.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = picker.save(&suggested_file_name(&suggested_name))? else {
            return Ok(false);
        };
        write_board(&path, &contents)?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(BoardFiles(Arc::new(NativePicker(app.handle().clone()))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_board_file, save_board_file])
        .run(tauri::generate_context!())
        .expect("Could not start MindBoard");
}

#[cfg(test)]
mod tests;
