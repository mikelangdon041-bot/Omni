// No console window on Windows in release; a tray app that flashes a black
// box on launch looks broken.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    omni_recorder_lib::run()
}
