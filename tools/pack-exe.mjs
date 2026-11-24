// One-command Windows EXE packager for 《赤沙行动 · Operation Red Sand》
// Usage: npm run pack:exe
//   1. Builds fresh production Vite bundle (dist/)
//   2. Generates crisp tactical emblem app.ico (if missing)
//   3. Packs dist/ into Store-mode desktop/game_dist.zip (zero-extract instant in-memory serving!)
//   4. Publishes single-file .NET WebView2 executable -> release/OperationRedSand.exe
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DESKTOP = path.join(ROOT, 'desktop');
const ZIP_OUT = path.join(DESKTOP, 'game_dist.zip');
const ICO_OUT = path.join(DESKTOP, 'app.ico');
const RELEASE = path.join(ROOT, 'release');

function run(cmd, cwd = ROOT) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

/** Generate a clean 256x256 tactical gold-and-slate crosshair emblem ICO (PNG-in-ICO format). */
async function ensureIcon() {
  if (fs.existsSync(ICO_OUT)) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#141e2b"/>
        <stop offset="100%" stop-color="#090d14"/>
      </linearGradient>
    </defs>
    <rect width="256" height="256" rx="44" fill="url(#bg)"/>
    <rect x="10" y="10" width="236" height="236" rx="36" fill="none" stroke="#e8b04a" stroke-width="6" opacity="0.85"/>
    <circle cx="128" cy="128" r="68" fill="none" stroke="#38e4ff" stroke-width="8" opacity="0.9"/>
    <circle cx="128" cy="128" r="14" fill="#e8b04a"/>
    <line x1="128" y1="34" x2="128" y2="82" stroke="#e8b04a" stroke-width="10" stroke-linecap="round"/>
    <line x1="128" y1="174" x2="128" y2="222" stroke="#e8b04a" stroke-width="10" stroke-linecap="round"/>
    <line x1="34" y1="128" x2="82" y2="128" stroke="#e8b04a" stroke-width="10" stroke-linecap="round"/>
    <line x1="174" y1="128" x2="222" y2="128" stroke="#e8b04a" stroke-width="10" stroke-linecap="round"/>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  // Standard ICO header (6 bytes) + 1 ICONDIRENTRY (16 bytes) + embedded 256x256 PNG payload
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // type = ICO
  header.writeUInt16LE(1, 4);          // image count = 1
  header.writeUInt8(0, 6);             // width = 256 (0 means 256)
  header.writeUInt8(0, 7);             // height = 256
  header.writeUInt8(0, 8);             // color count
  header.writeUInt8(0, 9);             // reserved
  header.writeUInt16LE(1, 10);         // planes
  header.writeUInt16LE(32, 12);        // bit count
  header.writeUInt32LE(png.length, 14);// byte size
  header.writeUInt32LE(22, 18);        // offset
  fs.writeFileSync(ICO_OUT, Buffer.concat([header, png]));
  console.log('Generated tactical app icon:', ICO_OUT);
}

/** Pack dist/ into an uncompressed (Store) ZIP with forward-slash entry paths for instant in-RAM serving. */
function packDistZip() {
  if (fs.existsSync(ZIP_OUT)) fs.unlinkSync(ZIP_OUT);
  const psScript = [
    "Add-Type -AssemblyName System.IO.Compression",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$src = [System.IO.Path]::GetFullPath('${DIST.replace(/\\/g, '\\\\')}')`,
    `$dst = '${ZIP_OUT.replace(/\\/g, '\\\\')}'`,
    "$fs = [System.IO.File]::Create($dst)",
    "$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)",
    "$files = Get-ChildItem -Path $src -Recurse -File | Where-Object { $_.FullName -notmatch '\\\\audition\\\\' -and $_.Name -ne 'voice-review.html' }",
    "foreach ($f in $files) {",
    "  $rel = $f.FullName.Substring($src.Length + 1).Replace('\\', '/')",
    "  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::NoCompression) | Out-Null",
    "}",
    "$zip.Dispose(); $fs.Dispose()",
    "Write-Host ('Packed ' + $files.Count + ' game files -> ' + [math]::Round((Get-Item $dst).Length / 1MB, 1) + ' MB')"
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], { stdio: 'inherit' });
}

console.log('=== [1/4] Building production web bundle (npm run build) ===');
run('npm run build');

console.log('\n=== [2/4] Preparing tactical EXE icon ===');
await ensureIcon();

console.log('\n=== [3/4] Packing dist/ into Store-mode embedded archive ===');
packDistZip();

console.log('\n=== [4/4] Publishing single-file Windows EXE (.NET WebView2) ===');
fs.mkdirSync(RELEASE, { recursive: true });
run(`dotnet publish "${path.join(DESKTOP, 'OperationRedSand.csproj')}" -c Release -r win-x64 -o "${RELEASE}"`);

// Clean up any stray non-exe artifacts in release/ (WebView2Loader.dll is embedded inside single-file EXE!)
const exePath = path.join(RELEASE, 'OperationRedSand.exe');
if (!fs.existsSync(exePath)) {
  throw new Error('Expected EXE not found at ' + exePath);
}
for (const f of fs.readdirSync(RELEASE)) {
  if (f !== 'OperationRedSand.exe') {
    fs.rmSync(path.join(RELEASE, f), { recursive: true, force: true });
  }
}
// Remove temporary embedded zip so git/workspace stays lean
if (fs.existsSync(ZIP_OUT)) fs.unlinkSync(ZIP_OUT);

const mb = (fs.statSync(exePath).size / (1024 * 1024)).toFixed(1);
console.log(`\n=============================================================`);
console.log(`SUCCESS! Standalone Windows EXE ready:`);
console.log(`  ${exePath}  (${mb} MB)`);
console.log(`  Tip: Press F11 in-game to toggle borderless fullscreen.`);
console.log(`=============================================================\n`);
