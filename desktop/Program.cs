using System.Drawing;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace OperationRedSand;

static class Program
{
    [STAThread]
    static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new GameForm());
    }
}

sealed class GameForm : Form
{
    private readonly WebView2 _webView = new();
    private readonly HttpListener _http = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly int _port;
    private bool _fullscreen = false;
    private FormWindowState _prevState = FormWindowState.Normal;
    private Rectangle _prevBounds;

    private static readonly Dictionary<string, string> MimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".js"]   = "application/javascript; charset=utf-8",
        [".mjs"]  = "application/javascript; charset=utf-8",
        [".css"]  = "text/css; charset=utf-8",
        [".json"] = "application/json; charset=utf-8",
        [".glb"]  = "model/gltf-binary",
        [".gltf"] = "model/gltf+json",
        [".webp"] = "image/webp",
        [".png"]  = "image/png",
        [".jpg"]  = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".svg"]  = "image/svg+xml",
        [".mp3"]  = "audio/mpeg",
        [".wav"]  = "audio/wav",
        [".ogg"]  = "audio/ogg",
        [".hdr"]  = "application/octet-stream",
        [".wasm"] = "application/wasm",
        [".ico"]  = "image/x-icon",
    };

    public GameForm()
    {
        Text = "赤沙行动 · Operation Red Sand";
        BackColor = Color.FromArgb(10, 14, 20);
        Width = 1600;
        Height = 900;
        StartPosition = FormStartPosition.CenterScreen;
        KeyPreview = true;

        var exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        if (exeIcon != null) Icon = exeIcon;

        _webView.Dock = DockStyle.Fill;
        _webView.DefaultBackgroundColor = Color.FromArgb(10, 14, 20);
        Controls.Add(_webView);

        _port = StartAssetServer();

        Load += async (_, _) => await InitWebViewAsync();
        FormClosing += (_, _) =>
        {
            _cts.Cancel();
            try { _http.Stop(); _http.Close(); } catch { }
        };
    }

    private static int PickPort(int preferred)
    {
        try
        {
            using var l = new TcpListener(IPAddress.Loopback, preferred);
            l.Start();
            l.Stop();
            return preferred;
        }
        catch
        {
            using var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int p = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return p;
        }
    }

    private int StartAssetServer()
    {
        // Deterministic preferred port keeps localStorage (loadouts, intel dossiers, settings) persistent across launches!
        int port = PickPort(47192);
        _http.Prefixes.Add($"http://127.0.0.1:{port}/");
        _http.Start();

        _ = Task.Run(async () =>
        {
            while (!_cts.IsCancellationRequested)
            {
                HttpListenerContext ctx;
                try { ctx = await _http.GetContextAsync(); }
                catch { break; }
                _ = Task.Run(() => ServeRequest(ctx));
            }
        });
        return port;
    }

    private static void ServeRequest(HttpListenerContext ctx)
    {
        try
        {
            string rawPath = Uri.UnescapeDataString(ctx.Request.Url?.AbsolutePath ?? "/").TrimStart('/');
            if (string.IsNullOrEmpty(rawPath) || rawPath.EndsWith('/')) rawPath += "index.html";

            using var resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("game_dist.zip");
            if (resStream == null)
            {
                ctx.Response.StatusCode = 500;
                ctx.Response.Close();
                return;
            }

            using var zip = new ZipArchive(resStream, ZipArchiveMode.Read, leaveOpen: false);
            var entry = zip.GetEntry(rawPath) ?? zip.GetEntry(rawPath.Replace('\\', '/'));
            if (entry == null)
            {
                ctx.Response.StatusCode = 404;
                ctx.Response.Close();
                return;
            }

            string ext = Path.GetExtension(rawPath);
            ctx.Response.ContentType = MimeTypes.TryGetValue(ext, out var mime) ? mime : "application/octet-stream";
            ctx.Response.ContentLength64 = entry.Length;
            ctx.Response.Headers["Cache-Control"] = ext == ".html" ? "no-cache" : "public, max-age=3600";

            using var es = entry.Open();
            es.CopyTo(ctx.Response.OutputStream);
            ctx.Response.OutputStream.Close();
        }
        catch
        {
            try { ctx.Response.Abort(); } catch { }
        }
    }

    private void ToggleFullscreen()
    {
        _fullscreen = !_fullscreen;
        if (_fullscreen)
        {
            _prevState = WindowState;
            _prevBounds = Bounds;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromControl(this).Bounds;
            TopMost = false;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            Bounds = _prevBounds;
            WindowState = _prevState;
        }
    }

    /// <summary>
    /// Windows assigns a GPU per executable. On hybrid laptops the browsers already carry a
    /// "High performance" preference (chrome.exe / msedge.exe), but the WebView2 host and its GPU
    /// process (msedgewebview2.exe) usually have none, so the game silently renders on the integrated
    /// GPU instead of the discrete one. Register the preference for every installed WebView2 runtime
    /// so the packaged build gets the same adapter the browser benchmark used.
    /// </summary>
    private static void EnsureHighPerformanceGpuPreference()
    {
        const string prefKey = @"Software\Microsoft\DirectX\UserGpuPreferences";
        const string wanted = "GpuPreference=2;";
        string[] roots =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\EdgeWebView\Application"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\EdgeWebView\Application"),
        };

        try
        {
            // HKCU only: no admin rights needed, and easily reverted from Windows Settings > Display > Graphics.
            using var key = Registry.CurrentUser.CreateSubKey(prefKey);
            if (key == null) return;

            foreach (var root in roots)
            {
                if (!Directory.Exists(root)) continue;
                foreach (var dir in Directory.GetDirectories(root))
                {
                    string exe = Path.Combine(dir, "msedgewebview2.exe");
                    if (!File.Exists(exe)) continue;
                    if (key.GetValue(exe) as string == wanted) continue;
                    key.SetValue(exe, wanted, RegistryValueKind.String);
                }
            }
        }
        catch
        {
            // Never fatal: without the preference the game still runs, just on whatever GPU Windows picks.
        }
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            EnsureHighPerformanceGpuPreference();

            string userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "OperationRedSand",
                "WebView2"
            );
            var opts = new CoreWebView2EnvironmentOptions(
                "--autoplay-policy=no-user-gesture-required --ignore-gpu-blocklist --enable-webgl --use-angle=d3d11"
            );
            var env = await CoreWebView2Environment.CreateAsync(null, userData, opts);
            await _webView.EnsureCoreWebView2Async(env);

            var s = _webView.CoreWebView2.Settings;
            s.AreDefaultContextMenusEnabled = false;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = false;
            s.AreDevToolsEnabled = false;
            s.IsBuiltInErrorPageEnabled = true;

            _webView.CoreWebView2.ContainsFullScreenElementChanged += (_, _) =>
            {
                if (_webView.CoreWebView2.ContainsFullScreenElement != _fullscreen)
                    ToggleFullscreen();
            };

            _webView.CoreWebView2.PermissionRequested += (_, e) =>
            {
                e.State = CoreWebView2PermissionState.Allow;
            };

            // F11 toggles true borderless fullscreen!
            _webView.KeyDown += (_, e) =>
            {
                if (e.KeyCode == Keys.F11)
                {
                    ToggleFullscreen();
                    e.Handled = true;
                }
            };

            _webView.CoreWebView2.Navigate($"http://127.0.0.1:{_port}/index.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"无法初始化 WebView2 运行环境（请确保系统已安装 Microsoft Edge WebView2 Runtime）：\n\n{ex.Message}",
                "赤沙行动 · 启动失败",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            Close();
        }
    }
}
