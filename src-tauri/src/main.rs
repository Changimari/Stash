// Windows のリリースビルドでコンソール窓が出ないようにする
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    stash_lib::run()
}
