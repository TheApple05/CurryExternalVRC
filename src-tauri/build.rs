fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "load_state",
            "save_state",
            "search_avatars",
            "open_external",
        ]),
    ))
    .expect("Could not build Tauri resources");
}
