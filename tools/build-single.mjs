/**
 * 单文件打包器（不修改任何源码，仅读取 dist-single 产物并重新组装）。
 *
 *   npx vite build --config tools/vite.single.config.mjs
 *   node tools/build-single.mjs "<输出路径>"
 *
 * 做的事：
 *   1. 把 app.js / CSS 内联进 HTML（CSS 已由 vite 注入进 app.js）；
 *   2. 把 dist-single/assets 下所有运行时资源转成 base64，放进 <script data-a> 数据块；
 *   3. 注入一段拦截器，让原来的 fetch / Image.src / XHR / <img> 请求全部命中内联数据；
 *   4. 把入口脚本移到 </body> 之前并以经典脚本执行，file:// 双击即可运行。
 */
import { createWriteStream } from 'node:fs';
import { readFile, readdir, stat, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve('.');
const distDir = path.join(root, 'dist-single');
const assetsDir = path.join(distDir, 'assets');

const outPath =
  process.argv[2] ||
  path.join(os.homedir(), 'Desktop', '赤沙行动.html');

/* ---------- 1. 收集资源 ---------- */
const SKIP_EXT = new Set(['.zip', '.md', '.html']);
const files = [];

async function walk(dir, rel = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) await walk(abs, r);
    else if (!SKIP_EXT.has(path.extname(e.name).toLowerCase())) {
      const s = await stat(abs);
      files.push({ abs, key: 'assets/' + r, size: s.size });
    }
  }
}
await walk(assetsDir);
files.sort((a, b) => a.key.localeCompare(b.key));

let total = 0;
for (const f of files) total += f.size;
console.log(`资源 ${files.length} 个，原始 ${(total / 1048576).toFixed(1)} MB`);

/* ---------- 2. 读取 HTML 与入口 JS ---------- */
let html = await readFile(path.join(distDir, 'index.html'), 'utf8');
const jsName = (html.match(/src="\.\/(app\.js)"/) || [])[1] || 'app.js';
// 内联进 <script> 前必须转义 </script（只可能出现在字符串/正则里，<\/script 等价）
const js = (await readFile(path.join(distDir, jsName), 'utf8')).replace(/<\/script/gi, '<\\/script');

// 去掉入口脚本标签（稍后放到 body 末尾）与 module 类型
html = html.replace(/<script[^>]*src="\.\/app\.js"[^>]*><\/script>\s*/, '');

const BOOT = String.raw`<script>
(function(){
var MIME={glb:'model/gltf-binary',gltf:'model/gltf+json',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',webp:'image/webp',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',hdr:'application/octet-stream',json:'application/json',js:'text/javascript',css:'text/css',bin:'application/octet-stream',txt:'text/plain',svg:'image/svg+xml',ktx2:'image/ktx2'};
var RAW=Object.create(null),MAP=Object.create(null);
var ns=document.querySelectorAll('script[data-a]');
for(var i=0;i<ns.length;i++){var el=ns[i];RAW[el.getAttribute('data-a')]=el.textContent;if(el.parentNode)el.parentNode.removeChild(el);}
function key(u){
  u=String(u);
  var h=u.indexOf('#');if(h>=0)u=u.slice(0,h);
  var q=u.indexOf('?');if(q>=0)u=u.slice(0,q);
  u=u.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\/]*/,'');
  var j=u.indexOf('assets/');
  if(j>0)u=u.slice(j);
  u=u.replace(/^\.?\//,'');
  try{u=decodeURIComponent(u);}catch(e){}
  return u;
}
function mime(k){var e=k.slice(k.lastIndexOf('.')+1).toLowerCase();return MIME[e]||'application/octet-stream';}
function dataURL(k){if(MAP[k]===undefined){var b=RAW[k];if(b===undefined)return null;MAP[k]='data:'+mime(k)+';base64,'+b;}return MAP[k];}
function bytes(k){var b=RAW[k];if(b===undefined)return null;var bin=atob(b),n=bin.length,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=bin.charCodeAt(i);return u;}
function hit(k){return RAW[k]!==undefined;}
window.__REDSAND__={raw:RAW,key:key,dataURL:dataURL};
var of=window.fetch;
window.fetch=function(input,init){
  try{
    var url=(typeof input==='string')?input:(input&&input.url);
    if(url){var k=key(url);if(hit(k)){var blob=new Blob([bytes(k)],{type:mime(k)});return Promise.resolve(new Response(blob,{status:200,statusText:'OK',headers:{'Content-Type':mime(k)}}));}}
  }catch(e){}
  return of.apply(window,arguments);
};
var d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
if(d&&d.set){Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){var u=v;try{var k=key(v);if(hit(k))u=dataURL(k);}catch(e){}d.set.call(this,u);}});}
var m=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
if(m&&m.set){Object.defineProperty(HTMLMediaElement.prototype,'src',{configurable:true,enumerable:m.enumerable,get:m.get,set:function(v){var u=v;try{var k=key(v);if(hit(k))u=dataURL(k);}catch(e){}m.set.call(this,u);}});}
var xo=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(method,url){try{var k=key(url);if(hit(k))arguments[1]=dataURL(k);}catch(e){}return xo.apply(this,arguments);};
function fixDom(){
  var els=document.querySelectorAll('img[src],link[href]');
  for(var i=0;i<els.length;i++){var el=els[i];var a=el.getAttribute(el.hasAttribute('src')?'src':'href');if(!a)continue;var k=key(a);if(hit(k)){el.setAttribute(el.hasAttribute('src')?'src':'href',dataURL(k));}}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fixDom);else fixDom();
})();
</script>`;

/* ---------- 3. 流式写出 ---------- */
const out = createWriteStream(outPath, { highWaterMark: 1 << 22 });

function write(str) {
  return new Promise((resolve) => {
    if (out.write(str)) resolve();
    else out.once('drain', resolve);
  });
}

const headEnd = html.indexOf('<div id="fatal"');
// 在 </body> 之前插入
const bodyClose = html.lastIndexOf('</body>');
const before = html.slice(0, bodyClose);
const after = html.slice(bodyClose);

await write(before);

console.log('写入资源数据块...');
let done = 0;
for (const f of files) {
  const buf = await readFile(f.abs);
  await write(`<script type="text/plain" data-a="${f.key}">${buf.toString('base64')}</script>`);
  done++;
  if (done % 50 === 0 || done === files.length) {
    process.stdout.write(`  ${done}/${files.length}\r`);
  }
}
console.log('');

await write(BOOT);
await write(`<script>\n${js}\n</script>\n`);
await write(after);

await new Promise((r) => out.end(r));

const s = await stat(outPath);
console.log(`完成: ${outPath}  ${(s.size / 1048576).toFixed(1)} MB`);
