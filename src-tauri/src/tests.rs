use super::*;
use serde_json::{json, Value};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets};

struct FixedPicker(Option<PathBuf>);
impl FilePicker for FixedPicker {
    fn open(&self) -> Result<Option<PathBuf>, String> {
        Ok(self.0.clone())
    }
    fn save(&self, _: &str) -> Result<Option<PathBuf>, String> {
        Ok(self.0.clone())
    }
}

fn ipc(path: Option<PathBuf>, command: &str, arguments: Value) -> Result<Value, Value> {
    let app = mock_builder()
        .manage(BoardFiles(Arc::new(FixedPicker(path))))
        .invoke_handler(tauri::generate_handler![open_board_file, save_board_file])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    get_ipc_response(
        &window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(arguments),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<Value>().unwrap())
}

#[test]
fn ipc_saves_opens_and_atomically_replaces_a_board() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("Round trip.mindboard");
    let first = r#"{"name":"First board","items":[]}"#;
    let second = r#"{"name":"日本語 — café","items":[]}"#;
    for contents in [first, second] {
        assert_eq!(
            ipc(
                Some(path.clone()),
                "save_board_file",
                json!({"contents": contents, "suggestedName": "Board"})
            ),
            Ok(json!(true))
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
        assert_eq!(
            ipc(Some(path.clone()), "open_board_file", json!({})),
            Ok(json!(contents))
        );
    }
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn cancelled_dialogs_do_not_touch_the_filesystem() {
    assert_eq!(ipc(None, "open_board_file", json!({})), Ok(Value::Null));
    assert_eq!(
        ipc(
            None,
            "save_board_file",
            json!({"contents":"{}","suggestedName":"Board"})
        ),
        Ok(json!(false))
    );
}

#[test]
fn invalid_save_preserves_existing_board() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("Original.mindboard");
    std::fs::write(&path, "{}").unwrap();
    for contents in ["broken json", "[]", "null"] {
        assert!(ipc(
            Some(path.clone()),
            "save_board_file",
            json!({"contents":contents,"suggestedName":"Board"})
        )
        .is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
    }
}

#[test]
fn open_reports_missing_invalid_and_non_utf8_files() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("Invalid.mindboard");
    assert!(ipc(Some(path.clone()), "open_board_file", json!({})).is_err());
    for contents in [b"not json".as_slice(), &[0xff, 0xfe], b"[]".as_slice()] {
        std::fs::write(&path, contents).unwrap();
        assert!(ipc(Some(path.clone()), "open_board_file", json!({})).is_err());
    }
}

#[test]
fn save_reports_unwritable_destination() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("missing").join("Board.mindboard");
    assert!(ipc(
        Some(path),
        "save_board_file",
        json!({"contents":"{}","suggestedName":"Board"})
    )
    .is_err());
}

#[test]
fn suggested_names_cannot_supply_a_directory() {
    assert_eq!(
        suggested_file_name("../Secret\\Board.mindboard"),
        "SecretBoard.mindboard"
    );
    assert_eq!(suggested_file_name(" . "), "Untitled.mindboard");
    assert_eq!(
        suggested_file_name("Painting studies"),
        "Painting studies.mindboard"
    );
    assert_eq!(suggested_file_name("Night.mindboard"), "Night.mindboard");
}

#[test]
fn oversized_boards_are_rejected_before_json_parsing() {
    let huge = " ".repeat(MAX_BOARD_BYTES as usize + 1);
    assert_eq!(
        validate_contents(&huge),
        Err("This board exceeds the 100 MB file limit.".into())
    );
}
