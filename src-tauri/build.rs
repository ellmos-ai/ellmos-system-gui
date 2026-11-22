fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "attach",
                "check_desktop_update",
                "install_desktop_update",
            ])),
    )
    .expect("desktop build configuration must be valid");
}
