// 배포판에서 콘솔 창이 함께 뜨지 않게.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    filedesk_desktop::run();
}
