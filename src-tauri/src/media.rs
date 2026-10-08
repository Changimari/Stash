//! ファイル取り込みまわりのネイティブ処理。
//!
//! サムネ生成・ハッシュ計算・フォルダ走査は Rust 側で行う。JS でやるより桁違いに速く、
//! 大量取り込みでも UI をブロックしない。重い処理はすべて `spawn_blocking` に逃がし、
//! バッチは rayon で並列化する（非同期ランタイムのワーカーを塞がないため）。

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::{GenericImageView, ImageEncoder};
use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

/// `image` クレートでデコードできるラスタ形式。
const RASTER_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "tga", "dds", "qoi", "pnm",
    "pbm", "pgm", "ppm", "exr", "hdr", "ff",
];
/// デコードはできないが webview は表示できる形式（サムネは原本をそのまま使う）。
const VECTOR_EXTS: &[&str] = &["svg", "svgz"];

/// `image` クレートは読めないが、macOS の ImageIO（sips 経由）なら開ける形式。
/// iPhone 写真の HEIC がここに入るので、実用上わりと効く。
const NATIVE_ONLY_EXTS: &[&str] = &["heic", "heif", "avif", "jp2", "jpf", "psd", "cr2", "nef",
    "arw", "dng", "raf", "orf", "rw2", "pef", "sr2", "icns"];
/// ブラウザが `<img>` でそのまま描ける形式。合成コピー時に再エンコードを省ける。
const WEB_SAFE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif"];

/// グリッドのタイルは論理 ~110px。Retina 2x と管理画面のプレビューを見込んで 512px を既定にする。
const DEFAULT_THUMB_MAX: u32 = 512;

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("画像を読み込めませんでした: {0}")]
    Image(#[from] image::ImageError),
    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for MediaError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, MediaError>;

/// `spawn_blocking` した先で panic した場合も、コマンドとしては素直なエラーにして返す。
async fn blocking<T, F>(f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| MediaError::Other(format!("処理が中断されました: {e}")))?
}

fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn is_image_path(path: &Path) -> bool {
    let e = ext_of(path);
    RASTER_EXTS.contains(&e.as_str())
        || VECTOR_EXTS.contains(&e.as_str())
        || NATIVE_ONLY_EXTS.contains(&e.as_str())
}

/// `image` で開けない画像を、OS の力を借りて PNG に変換する。
///
/// macOS の `sips` は ImageIO を使うので HEIC / RAW / PSD などを一通り開ける。
/// 追加のクレートも許可も要らず、失敗しても呼び出し側が素直にプレースホルダへ落ちる。
#[cfg(target_os = "macos")]
fn convert_with_os(src: &Path, dest: &Path) -> Result<()> {
    let status = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "png"])
        .arg(src)
        .arg("--out")
        .arg(dest)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;

    if status.success() && dest.exists() {
        Ok(())
    } else {
        Err(MediaError::Other("この形式は変換できませんでした".into()))
    }
}

#[cfg(not(target_os = "macos"))]
fn convert_with_os(_src: &Path, _dest: &Path) -> Result<()> {
    Err(MediaError::Other("この形式には対応していません".into()))
}

/// `image` で開き、駄目なら OS 変換を挟んでもう一度開く。
fn open_image(path: &Path) -> Result<image::DynamicImage> {
    match image::open(path) {
        Ok(img) => Ok(img),
        Err(original) => {
            // 一時 PNG を経由する。変換できない形式なら元のエラーを返す。
            let tmp = std::env::temp_dir().join(format!(
                "stash-convert-{}.png",
                std::process::id()
            ));
            if convert_with_os(path, &tmp).is_ok() {
                let converted = image::open(&tmp);
                let _ = fs::remove_file(&tmp);
                return converted.map_err(MediaError::from);
            }
            Err(MediaError::from(original))
        }
    }
}

/// SVG から表示寸法を読む。`width`/`height` が無ければ `viewBox` から拾う。
/// ベクタなので厳密な画素数は無いが、比率が分かれば合成もプレビューも成立する。
fn svg_dimensions(path: &Path) -> Option<(u32, u32)> {
    // 先頭だけ読めば十分（巨大な SVG を丸ごと読まない）
    let mut file = fs::File::open(path).ok()?;
    let mut head = vec![0u8; 4096];
    let n = file.read(&mut head).ok()?;
    let text = String::from_utf8_lossy(&head[..n]);

    let attr = |name: &str| -> Option<f32> {
        let key = format!("{name}=");
        let start = text.find(&key)? + key.len();
        let rest = &text[start..];
        let quote = rest.chars().next()?;
        let end = rest[1..].find(quote)? + 1;
        let raw = &rest[1..end];
        // "100%" は画素数にならない。viewBox 側にまかせる。
        if raw.contains('%') {
            return None;
        }
        // "100px" や "100.5" を数値として拾う
        let digits: String = raw
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
            .collect();
        digits.parse::<f32>().ok()
    };

    if let (Some(w), Some(h)) = (attr("width"), attr("height")) {
        if w > 0.0 && h > 0.0 {
            return Some((w.round() as u32, h.round() as u32));
        }
    }

    let view_box = {
        let start = text.find("viewBox=")? + "viewBox=".len();
        let rest = &text[start..];
        let quote = rest.chars().next()?;
        let end = rest[1..].find(quote)? + 1;
        rest[1..end].to_string()
    };
    let nums: Vec<f32> = view_box
        .split([' ', ','])
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<f32>().ok())
        .collect();
    if nums.len() == 4 && nums[2] > 0.0 && nums[3] > 0.0 {
        return Some((nums[2].round() as u32, nums[3].round() as u32));
    }
    None
}

fn sha256_of(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// サムネイルの保管場所（`$APPDATA/thumbnails`）。
/// tauri.conf.json の assetProtocol scope はこの配下だけを許可しているので、
/// webview に見せる生成物は必ずここに置くこと。
fn thumb_root(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| MediaError::Other(e.to_string()))?
        .join("thumbnails");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// パス + 更新時刻 + サイズ + 目標サイズをキーにする。元ファイルを差し替えれば自動で焼き直る。
fn cache_key(path: &Path, max: u32) -> Result<String> {
    let meta = fs::metadata(path)?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(mtime.to_le_bytes());
    hasher.update(meta.len().to_le_bytes());
    hasher.update(max.to_le_bytes());
    let full = format!("{:x}", hasher.finalize());
    Ok(full[..32].to_string())
}

fn make_thumbnail(root: &Path, src: &Path, max: u32) -> Result<String> {
    if !src.exists() {
        return Err(MediaError::Other("ファイルが見つかりません".into()));
    }
    let key = cache_key(src, max)?;
    let ext = ext_of(src);

    // SVG は原本をコピーするだけ。webview がベクタのまま綺麗に描いてくれる。
    if VECTOR_EXTS.contains(&ext.as_str()) {
        let dest = root.join(format!("{key}.svg"));
        if !dest.exists() {
            fs::copy(src, &dest)?;
        }
        return Ok(dest.to_string_lossy().into_owned());
    }

    // 既存キャッシュがあれば即返す（PNG / JPEG どちらで焼いたかは分からないので両方見る）
    for candidate in [root.join(format!("{key}.png")), root.join(format!("{key}.jpg"))] {
        if candidate.exists() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }

    let img = open_image(src)?;
    let (w, h) = img.dimensions();
    // 拡大はしない。元が小さい素材はその解像度のまま焼く。
    let thumb = if w > max || h > max {
        img.resize(max, max, FilterType::Lanczos3)
    } else {
        img
    };

    // アルファを持つ画像は PNG（透過を保つ）、不透明な画像は JPEG（容量を抑える）。
    let dest = if thumb.color().has_alpha() {
        let p = root.join(format!("{key}.png"));
        thumb.to_rgba8().save(&p)?;
        p
    } else {
        let p = root.join(format!("{key}.jpg"));
        let mut out = std::io::BufWriter::new(fs::File::create(&p)?);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 86)
            .write_image(
                thumb.to_rgb8().as_raw(),
                thumb.width(),
                thumb.height(),
                image::ExtendedColorType::Rgb8,
            )?;
        p
    };

    Ok(dest.to_string_lossy().into_owned())
}

// ─────────────────────────── コマンド ───────────────────────────

#[derive(Serialize, Clone)]
pub struct ThumbResult {
    pub path: String,
    /// 生成に失敗した場合は None。フロントはプレースホルダを出す。
    pub thumbnail: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn generate_thumbnail(app: AppHandle, path: String, max: Option<u32>) -> Result<String> {
    let max = max.unwrap_or(DEFAULT_THUMB_MAX);
    let root = thumb_root(&app)?;
    blocking(move || make_thumbnail(&root, Path::new(&path), max)).await
}

/// 一括取り込み用。rayon で並列に焼く。1 件失敗しても全体は止めない。
#[tauri::command]
pub async fn generate_thumbnails(
    app: AppHandle,
    paths: Vec<String>,
    max: Option<u32>,
) -> Result<Vec<ThumbResult>> {
    let max = max.unwrap_or(DEFAULT_THUMB_MAX);
    let root = thumb_root(&app)?;
    blocking(move || {
        Ok(paths
            .par_iter()
            .map(|p| match make_thumbnail(&root, Path::new(p), max) {
                Ok(t) => ThumbResult { path: p.clone(), thumbnail: Some(t), error: None },
                Err(e) => {
                    ThumbResult { path: p.clone(), thumbnail: None, error: Some(e.to_string()) }
                }
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn hash_file(path: String) -> Result<String> {
    blocking(move || sha256_of(Path::new(&path))).await
}

#[derive(Serialize, Clone)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    /// `assets.type` にそのまま入る値（'image' | 'file'）
    pub kind: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub hash: Option<String>,
}

fn probe(path: &Path, with_hash: bool) -> Result<FileInfo> {
    let meta = fs::metadata(path)?;
    let is_img = is_image_path(path);
    let (width, height) = if !is_img {
        (None, None)
    } else if VECTOR_EXTS.contains(&ext_of(path).as_str()) {
        // ベクタは画素数を持たないので、表示寸法（width/height か viewBox）を使う
        svg_dimensions(path).map(|(w, h)| (Some(w), Some(h))).unwrap_or((None, None))
    } else {
        image::image_dimensions(path)
            .ok()
            .map(|(w, h)| (Some(w), Some(h)))
            // sips 経由でしか開けない形式はここでは諦める（サムネ生成側で拾う）
            .unwrap_or((None, None))
    };

    Ok(FileInfo {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
        ext: ext_of(path),
        size: meta.len(),
        kind: if is_img { "image".into() } else { "file".into() },
        width,
        height,
        hash: if with_hash { sha256_of(path).ok() } else { None },
    })
}

#[tauri::command]
pub async fn probe_files(paths: Vec<String>, with_hash: Option<bool>) -> Result<Vec<FileInfo>> {
    let with_hash = with_hash.unwrap_or(true);
    blocking(move || {
        Ok(paths
            .par_iter()
            .filter_map(|p| probe(Path::new(p), with_hash).ok())
            .collect())
    })
    .await
}

fn walk(dir: &Path, recursive: bool, images_only: bool, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // ドットファイル（.DS_Store / ._foo などのリソースフォーク含む）は無視する
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if path.is_dir() {
            if recursive {
                walk(&path, recursive, images_only, out);
            }
        } else if !images_only || is_image_path(&path) {
            out.push(path);
        }
    }
}

/// フォルダ一括取り込みの下ごしらえ。走査 → probe（ハッシュ含む）まで一気にやる。
#[tauri::command]
pub async fn scan_folder(
    path: String,
    recursive: Option<bool>,
    images_only: Option<bool>,
) -> Result<Vec<FileInfo>> {
    blocking(move || {
        let mut found = Vec::new();
        walk(
            Path::new(&path),
            recursive.unwrap_or(true),
            images_only.unwrap_or(false),
            &mut found,
        );
        Ok(found.par_iter().filter_map(|p| probe(p, true).ok()).collect())
    })
    .await
}

/// 合成コピー用に「webview がそのまま描ける原寸画像」を返す。
///
/// png/jpeg/gif/webp/avif はバイト列をそのまま返す（再エンコードしない = 劣化ゼロ）。
/// tiff/bmp など webview 側で開けない形式だけ、**原寸のまま** PNG に焼き直して返す。
/// これで OS ごとの画像デコード対応差をフロントから完全に隠せる（§11「合成コピーの画質」）。
#[tauri::command]
pub async fn load_full_image(path: String) -> Result<tauri::ipc::Response> {
    blocking(move || {
        let p = Path::new(&path);
        let ext = ext_of(p);

        if WEB_SAFE_EXTS.contains(&ext.as_str()) || VECTOR_EXTS.contains(&ext.as_str()) {
            return Ok(tauri::ipc::Response::new(fs::read(p)?));
        }

        let img = open_image(p)?;
        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png)?;
        Ok(tauri::ipc::Response::new(buf.into_inner()))
    })
    .await
}

/// サムネの無い素材（画像以外）をドラッグするときのプレビュー画像。
///
/// `tauri-plugin-drag` の `startDrag` は `icon` にファイルパスを必ず要求するため（§11）、
/// 埋め込んだ PNG を初回だけ $APPDATA に書き出してそのパスを返す。
#[tauri::command]
pub async fn generic_drag_icon(app: AppHandle) -> Result<String> {
    const ICON: &[u8] = include_bytes!("../icons/drag-file.png");
    let dest = thumb_root(&app)?.join("_drag-file.png");
    if !dest.exists() {
        fs::write(&dest, ICON)?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

// ─────────────────── ライブラリフォルダへの取り込み ───────────────────

/// 既定の保管場所。ユーザーが自分で開いてバックアップできるよう、隠しフォルダは避ける。
#[tauri::command]
pub fn default_library_folder(app: AppHandle) -> Result<String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| MediaError::Other(e.to_string()))?;
    Ok(base.join("Stash").to_string_lossy().into_owned())
}

#[derive(Serialize, Clone)]
pub struct AdoptResult {
    pub original: String,
    /// 取り込み後のパス。失敗したときは元のまま。
    pub path: String,
    pub error: Option<String>,
}

/// 衝突しないファイル名を作る。中身が同じならそのファイルを使い回す。
fn unique_destination(dir: &Path, src: &Path) -> Result<(PathBuf, bool)> {
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = src.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();

    let mut candidate = dir.join(format!("{stem}{ext}"));
    if !candidate.exists() {
        return Ok((candidate, false));
    }

    // 同名で中身も同じなら、それは同じ素材。二重に置かない。
    let src_hash = sha256_of(src)?;
    for n in 2..1000 {
        if candidate.exists() && sha256_of(&candidate).ok().as_deref() == Some(src_hash.as_str()) {
            return Ok((candidate, true));
        }
        candidate = dir.join(format!("{stem} -{n}{ext}"));
        if !candidate.exists() {
            return Ok((candidate, false));
        }
    }
    Err(MediaError::Other("名前を決められませんでした".into()))
}

fn adopt_one(dir: &Path, src: &Path, move_file: bool) -> Result<String> {
    if !src.exists() {
        return Err(MediaError::Other("ファイルが見つかりません".into()));
    }
    // すでにライブラリフォルダの中にあるものは動かさない
    if src.starts_with(dir) {
        return Ok(src.to_string_lossy().into_owned());
    }

    let (dest, existing) = unique_destination(dir, src)?;
    if existing {
        // 同じ中身が既にある。move 指定なら元を片付けて、その 1 本に集約する。
        if move_file {
            let _ = fs::remove_file(src);
        }
        return Ok(dest.to_string_lossy().into_owned());
    }

    if move_file {
        // 別ボリュームだと rename は失敗するので、コピーしてから元を消す
        if fs::rename(src, &dest).is_err() {
            fs::copy(src, &dest)?;
            fs::remove_file(src)?;
        }
    } else {
        fs::copy(src, &dest)?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

/// 素材の実ファイルをライブラリフォルダへ入れる。
///
/// これをやらないと、取り込み元（ダウンロードフォルダ等）を片付けた瞬間に
/// ライブラリが総崩れになる。`move_file` が false ならコピーして原本も残す。
#[tauri::command]
pub async fn adopt_files(
    paths: Vec<String>,
    folder: String,
    move_file: bool,
) -> Result<Vec<AdoptResult>> {
    blocking(move || {
        let dir = PathBuf::from(&folder);
        fs::create_dir_all(&dir)?;

        Ok(paths
            .iter()
            .map(|p| match adopt_one(&dir, Path::new(p), move_file) {
                Ok(path) => AdoptResult { original: p.clone(), path, error: None },
                Err(e) => AdoptResult {
                    original: p.clone(),
                    path: p.clone(),
                    error: Some(e.to_string()),
                },
            })
            .collect())
    })
    .await
}

/// ライブラリフォルダの**中にあるものだけ**を消す。
/// Stash が管理していないユーザーのファイルは絶対に消さないための境界。
#[tauri::command]
pub async fn delete_managed_files(paths: Vec<String>, folder: String) -> Result<usize> {
    blocking(move || {
        let dir = PathBuf::from(&folder);
        let mut removed = 0;
        for p in paths {
            let path = PathBuf::from(&p);
            if path.starts_with(&dir) && path.is_file() && fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
        Ok(removed)
    })
    .await
}

/// 元ファイルをゴミ箱へ送る。
///
/// Shelf の「取り出し＝移動」で使う。OS のドラッグは常に copy で渡す
/// （move を宣言すると多くのアプリがドロップを拒否するため）ので、移動の後片付けは自分でやる。
/// **消さずにゴミ箱に入れる**のが肝。ドロップ先が本当に保存したかは分からないので、
/// 取りこぼしても戻せる状態にしておく。
#[tauri::command]
pub async fn trash_files(paths: Vec<String>) -> Result<usize> {
    blocking(move || {
        let mut moved = 0;
        for path in &paths {
            if trash_one(Path::new(path)).is_ok() {
                moved += 1;
            }
        }
        Ok(moved)
    })
    .await
}

#[cfg(target_os = "macos")]
fn trash_one(path: &Path) -> Result<()> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    if !path.exists() {
        return Err(MediaError::Other("ファイルが見つかりません".into()));
    }
    unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, None)
            .map_err(|e| MediaError::Other(e.localizedDescription().to_string()))
    }
}

#[cfg(not(target_os = "macos"))]
fn trash_one(_path: &Path) -> Result<()> {
    // ponytail: macOS のみ。Windows は SHFileOperation(FOF_ALLOWUNDO) が要るが、
    // 移動が効かないぶんは「Shelf から消えるだけ」で実害が無いので後回し。
    Err(MediaError::Other("この OS ではゴミ箱へ送れません".into()))
}

/// 素材が実在するかの確認。ライブラリの「リンク切れ」表示に使う。
#[tauri::command]
pub async fn paths_exist(paths: Vec<String>) -> Result<Vec<bool>> {
    blocking(move || Ok(paths.par_iter().map(|p| Path::new(p).exists()).collect())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_svg(name: &str, body: &str) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(body.as_bytes()).unwrap();
        path
    }

    #[test]
    fn svg_width_height_attributes() {
        let p = write_svg(
            "stash-test-a.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"></svg>"#,
        );
        assert_eq!(svg_dimensions(&p), Some((640, 480)));
    }

    #[test]
    fn svg_dimensions_with_units() {
        let p = write_svg(
            "stash-test-b.svg",
            r#"<svg width="120.5px" height="60px" xmlns="http://www.w3.org/2000/svg"></svg>"#,
        );
        assert_eq!(svg_dimensions(&p), Some((121, 60)));
    }

    #[test]
    fn svg_falls_back_to_viewbox() {
        let p = write_svg(
            "stash-test-c.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 768"></svg>"#,
        );
        assert_eq!(svg_dimensions(&p), Some((1024, 768)));
    }

    #[test]
    fn svg_percentage_width_uses_viewbox() {
        // width="100%" は画素数にならないので viewBox を見にいく
        let p = write_svg(
            "stash-test-d.svg",
            r#"<svg width="100%" height="100%" viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg"></svg>"#,
        );
        assert_eq!(svg_dimensions(&p), Some((300, 150)));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("stash-adopt-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_file(path: &Path, body: &str) {
        fs::write(path, body).unwrap();
    }

    #[test]
    fn adopt_moves_file_into_library() {
        let src_dir = temp_dir("src-move");
        let lib = temp_dir("lib-move");
        let src = src_dir.join("photo.png");
        write_file(&src, "aaa");

        let dest = adopt_one(&lib, &src, true).unwrap();

        assert_eq!(dest, lib.join("photo.png").to_string_lossy());
        assert!(!src.exists(), "移動なので元は消えている");
        assert!(lib.join("photo.png").exists());
    }

    #[test]
    fn adopt_copies_and_keeps_original() {
        let src_dir = temp_dir("src-copy");
        let lib = temp_dir("lib-copy");
        let src = src_dir.join("photo.png");
        write_file(&src, "aaa");

        adopt_one(&lib, &src, false).unwrap();

        assert!(src.exists(), "コピーなので元は残る");
        assert!(lib.join("photo.png").exists());
    }

    #[test]
    fn adopt_renames_on_name_collision() {
        let src_dir = temp_dir("src-collide");
        let lib = temp_dir("lib-collide");
        write_file(&lib.join("photo.png"), "existing");
        let src = src_dir.join("photo.png");
        write_file(&src, "different");

        let dest = adopt_one(&lib, &src, true).unwrap();

        assert_eq!(dest, lib.join("photo -2.png").to_string_lossy());
        assert_eq!(fs::read_to_string(lib.join("photo.png")).unwrap(), "existing");
    }

    #[test]
    fn adopt_reuses_identical_file() {
        let src_dir = temp_dir("src-same");
        let lib = temp_dir("lib-same");
        write_file(&lib.join("photo.png"), "same-bytes");
        let src = src_dir.join("photo.png");
        write_file(&src, "same-bytes");

        let dest = adopt_one(&lib, &src, true).unwrap();

        // 中身が同じなら複製を作らず既存を指す
        assert_eq!(dest, lib.join("photo.png").to_string_lossy());
        assert!(!lib.join("photo -2.png").exists());
        assert!(!src.exists());
    }

    #[test]
    fn adopt_leaves_files_already_inside() {
        let lib = temp_dir("lib-inside");
        let src = lib.join("already.png");
        write_file(&src, "aaa");

        let dest = adopt_one(&lib, &src, true).unwrap();

        assert_eq!(dest, src.to_string_lossy());
        assert!(src.exists());
    }

    #[test]
    fn svg_extensions_count_as_images() {
        assert!(is_image_path(Path::new("/tmp/a.svg")));
        assert!(is_image_path(Path::new("/tmp/a.heic")));
        assert!(is_image_path(Path::new("/tmp/a.HEIC")));
        assert!(!is_image_path(Path::new("/tmp/a.pdf")));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod trash_tests {
    use super::*;

    #[test]
    fn trash_moves_file_out_of_the_way_without_deleting_it() {
        let dir = std::env::temp_dir().join("stash-trash-test");
        let _ = fs::create_dir_all(&dir);
        let file = dir.join("stash-trash-sample.txt");
        fs::write(&file, "bytes").unwrap();

        trash_one(&file).unwrap();

        // 元の場所からは消えるが、消滅ではなくゴミ箱へ移っている
        assert!(!file.exists(), "元の場所には残らない");
        let trashed = dirs_trash().join("stash-trash-sample.txt");
        assert!(trashed.exists(), "ゴミ箱に入っている: {trashed:?}");
        let _ = fs::remove_file(&trashed);
    }

    fn dirs_trash() -> PathBuf {
        PathBuf::from(std::env::var("HOME").unwrap()).join(".Trash")
    }

    #[test]
    fn trash_reports_missing_file() {
        assert!(trash_one(Path::new("/tmp/stash-does-not-exist-xyz")).is_err());
    }
}
