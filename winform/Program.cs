using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Zalo Sync — giao diện WinForms gốc. Điều phối toàn bộ logic qua Node CLI (app/cli.js).
// Biên dịch bằng csc.exe in-box (.NET Framework 4.x). Không cần SDK/runtime cài thêm.

namespace ZaloSync
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            // Task Scheduler gọi "ZaloSync.exe --scheduled": đồng bộ ẩn rồi thoát, không mở giao diện.
            if (args.Contains("--scheduled")) return Cli.RunScheduled();
            bool tray = args.Contains("--tray"); // mục Startup (HKCU\…\Run) mở thẳng xuống khay
            // Chỉ 1 giao diện: app đã tự mở ở khay lúc đăng nhập → bấm lối tắt thì hiện cửa sổ đang chạy, không mở bản thứ 2.
            // Báo bằng sự kiện có tên, KHÔNG broadcast: form ẩn ở khay (ShowInTaskbar=false) là cửa sổ "được sở hữu"
            // → không nhận tin HWND_BROADCAST (đã thử: cửa sổ không hiện).
            bool first;
            using (new System.Threading.Mutex(true, @"Local\ZaloSync_GUI", out first))
            using (var show = new System.Threading.EventWaitHandle(false, System.Threading.EventResetMode.AutoReset, @"Local\ZaloSync_Show"))
            {
                if (!first)
                {
                    if (!tray) { Native.AllowSetForegroundWindow(-1); show.Set(); } // cho bản đang chạy được đưa cửa sổ lên trước
                    return 0;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                try { Cli.EnsureRuntime(); }
                catch (Exception ex) { MessageBox.Show("Không chuẩn bị được runtime: " + ex.Message, "Lỗi"); return 1; }
                try { Application.Run(new MainForm(tray, show)); }
                catch (Exception ex) { MessageBox.Show(ex.ToString(), "Lỗi khởi động"); return 1; }
                return 0;
            }
        }
    }

    static class Native
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern bool AllowSetForegroundWindow(int pid);
    }

    // ---- Cầu nối Node CLI ----
    static class Cli
    {
        static readonly JavaScriptSerializer J = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
        public static string ExeDir = AppDomain.CurrentDomain.BaseDirectory;
        public static string RuntimeDir; // nơi giải nén node+app+engine (bản 1-file); null nếu chạy dev

        // Giải nén node.exe + JS + engine (nhúng trong exe) ra %LOCALAPPDATA%\ZaloSync\runtime\<ver> 1 lần.
        public static void EnsureRuntime()
        {
            var asm = Assembly.GetExecutingAssembly();
            var names = asm.GetManifestResourceNames().Where(n => n.IndexOf('/') >= 0).ToArray();
            if (names.Length == 0) return; // bản dev không nhúng → dùng đường dẫn nguồn (fallback bên dưới)

            string exe = Application.ExecutablePath;
            string ver = File.GetLastWriteTimeUtc(exe).Ticks.ToString(); // build mới → giải nén lại
            string baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZaloSync", "runtime");
            RuntimeDir = Path.Combine(baseDir, ver);
            string marker = Path.Combine(RuntimeDir, ".ready");
            if (!File.Exists(marker))
            {
                foreach (var n in names)
                {
                    string dest = Path.Combine(RuntimeDir, n.Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    using (var rs = asm.GetManifestResourceStream(n))
                    using (var fo = File.Create(dest)) rs.CopyTo(fo);
                }
                File.WriteAllText(marker, ver);
                try { foreach (var d in Directory.GetDirectories(baseDir))
                        if (!string.Equals(d, RuntimeDir, StringComparison.OrdinalIgnoreCase)) Directory.Delete(d, true); } catch { }
            }
        }

        public static string NodeExe()
        {
            if (!string.IsNullOrEmpty(RuntimeDir)) { string r = Path.Combine(RuntimeDir, "node", "node.exe"); if (File.Exists(r)) return r; }
            string bundled = Path.Combine(ExeDir, "node", "node.exe");
            if (File.Exists(bundled)) return bundled;
            string up = Path.Combine(ExeDir, "..", "node", "node.exe");
            if (File.Exists(up)) return Path.GetFullPath(up);
            return "node"; // dựa vào PATH
        }

        public static string CliJs()
        {
            if (!string.IsNullOrEmpty(RuntimeDir)) { string r = Path.Combine(RuntimeDir, "app", "cli.js"); if (File.Exists(r)) return r; }
            string env = Environment.GetEnvironmentVariable("ZALOSYNC_CLI");
            if (!string.IsNullOrEmpty(env) && File.Exists(env)) return Path.GetFullPath(env);
            string[] cands = {
                Path.Combine(ExeDir, "app", "cli.js"),
                Path.Combine(ExeDir, "cli.js"),
                Path.Combine(ExeDir, "..", "cli.js"),
                Path.Combine(ExeDir, "..", "..", "cli.js"),
            };
            foreach (var c in cands) if (File.Exists(c)) return Path.GetFullPath(c);
            throw new FileNotFoundException("Không tìm thấy cli.js (đặt biến ZALOSYNC_CLI để chỉ định).");
        }

        static ProcessStartInfo Psi(string argTail)
        {
            var psi = new ProcessStartInfo
            {
                FileName = NodeExe(),
                Arguments = "\"" + CliJs() + "\" " + argTail,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.WorkingDirectory = Path.GetDirectoryName(CliJs());
            if (!string.IsNullOrEmpty(RuntimeDir)) psi.EnvironmentVariables["ZALOSYNC_ENGINE_DIR"] = Path.Combine(RuntimeDir, "engine");
            psi.EnvironmentVariables["ZALOSYNC_EXE"] = Application.ExecutablePath; // lịch chạy gọi lại chính exe này (--scheduled)
            return psi;
        }

        // Lượt chạy theo lịch. Exe là ứng dụng GUI + node chạy CreateNoWindow → không có cửa sổ cmd nào để lỡ tay đóng
        // giữa chừng. Node tự quyết có đến hạn không (chạy bù đúng 1 lần), tự ghi log + state; exe chỉ trả mã thoát.
        public static int RunScheduled()
        {
            try
            {
                EnsureRuntime(); // runtime bị xoá (bản exe khác đã chạy) → giải nén lại, lịch không hỏng
                using (var p = StartStream("run --scheduled"))
                {
                    p.BeginOutputReadLine(); p.BeginErrorReadLine(); // xả pipe để node không bị nghẽn (log do runner ghi)
                    p.WaitForExit();
                    return p.ExitCode;
                }
            }
            catch (Exception ex)
            {
                // Không MessageBox (lúc 4 giờ sáng không ai bấm) → ghi lỗi vào log của app.
                try
                {
                    string logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZaloSync", "logs");
                    Directory.CreateDirectory(logDir);
                    File.AppendAllText(Path.Combine(logDir, "daily_sync.log"), "\r\n[TỰ ĐỘNG] " + DateTime.Now.ToString("s") + " LỖI khởi chạy: " + ex.Message + "\r\n", new UTF8Encoding(false));
                }
                catch { }
                return 1;
            }
        }

        // Chạy 1 lệnh, trả về stdout (chặn — gọi trong Task.Run).
        public static string Run(string argTail)
        {
            using (var p = Process.Start(Psi(argTail)))
            {
                string o = p.StandardOutput.ReadToEnd();
                string e = p.StandardError.ReadToEnd();
                p.WaitForExit();
                if (p.ExitCode != 0 && string.IsNullOrWhiteSpace(o))
                    throw new Exception("Node CLI lỗi: " + e);
                return o;
            }
        }

        public static Dictionary<string, object> RunJson(string argTail)
        {
            string o = Run(argTail).Trim();
            int nl = o.LastIndexOf('\n');
            if (nl >= 0) o = o.Substring(nl + 1).Trim(); // dòng JSON cuối
            return (Dictionary<string, object>)J.DeserializeObject(o);
        }

        public static Process StartStream(string argTail) { return Process.Start(Psi(argTail)); }

        public static string Esc(string s) { return "\"" + (s ?? "").Replace("\"", "\\\"") + "\""; }
        public static string ToJson(object o) { return J.Serialize(o); }
    }

    class MainForm : Form
    {
        readonly FlowLayoutPanel header = new FlowLayoutPanel();
        readonly Label hTitle = new Label();
        readonly Label hNode = new Label();
        readonly Panel content = new Panel();

        // khay hệ thống
        NotifyIcon tray;
        bool reallyExit = false;
        bool trayHinted = false;
        Button _runNow; // tham chiếu nút "Chạy ngay" của dashboard (cho menu khay)
        string _dataDir; // thư mục lưu dữ liệu hiện tại (cho nút "Thư mục dữ liệu")

        // trạng thái thiết lập
        Dictionary<string, object> account;   // tài khoản Zalo đã chọn
        string coreDir, uid, key;
        List<Dictionary<string, object>> groups = new List<Dictionary<string, object>>();
        Dictionary<string, object> savedCfg;  // cấu hình đang dùng khi "Thiết lập lại" → wizard điền sẵn; null = thiết lập mới

        object Saved(string k) { object v; return savedCfg != null && savedCfg.TryGetValue(k, out v) ? v : null; }

        static readonly Color BG = Color.FromArgb(15, 20, 25);
        static readonly Color PANEL = Color.FromArgb(26, 34, 44);
        static readonly Color ACCENT = Color.FromArgb(255, 122, 26);
        static readonly Color TEXT = Color.FromArgb(230, 237, 243);
        static readonly Color MUTED = Color.FromArgb(139, 151, 165);

        public MainForm(bool startInTray, System.Threading.WaitHandle showSignal)
        {
            // bản thứ 2 (bấm lối tắt khi app đang ở khay) bật sự kiện → hiện cửa sổ đang chạy
            Load += (s, e) => System.Threading.ThreadPool.RegisterWaitForSingleObject(showSignal,
                (o, timedOut) => BeginInvoke((Action)ShowFromTray), null, -1, false);
            if (startInTray)
            {
                // trong suốt + không nút taskbar tới khi ẩn xong (không chớp cửa sổ); Load vẫn chạy → Boot (migrate, đối chiếu lịch)
                Opacity = 0; ShowInTaskbar = false; trayHinted = true; // không bóng thông báo mỗi lần đăng nhập
                Shown += (s, e) => { HideToTray(); Opacity = 1; };
            }
            Text = "Zalo Sync — Trình thu thập dữ liệu nhóm";
            Size = new Size(860, 640); // đủ rộng để 6 nút bảng điều khiển nằm trên 1 hàng
            MinimumSize = new Size(720, 560);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = BG; ForeColor = TEXT;
            Font = new Font("Segoe UI", 9.5f);

            // header & content cùng lề trái 18 → tiêu đề thẳng hàng với nội dung
            header.Dock = DockStyle.Top; header.AutoSize = true; header.BackColor = PANEL;
            header.FlowDirection = FlowDirection.TopDown; header.WrapContents = false; header.Padding = new Padding(18, 10, 18, 10);
            hTitle.Text = "Zalo Sync"; hTitle.Font = new Font("Segoe UI", 15f, FontStyle.Bold);
            hTitle.ForeColor = TEXT; hTitle.AutoSize = true; hTitle.Margin = Padding.Empty;
            hNode.AutoSize = true; hNode.ForeColor = MUTED; hNode.Margin = new Padding(0, 2, 0, 0);
            hNode.Text = "đang kiểm tra môi trường…";
            header.Controls.Add(hTitle); header.Controls.Add(hNode);

            content.Dock = DockStyle.Fill; content.Padding = new Padding(18);
            Controls.Add(content); Controls.Add(header);

            // app.ico nhúng nguyên file (nhiều cỡ) → thanh tiêu đề/khay lấy đúng ảnh 16 px thay vì thu nhỏ ảnh 32 px
            try { using (var ico = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico")) Icon = new Icon(ico); } catch { }
            SetupTray();
            // Đóng (X) hoặc thu nhỏ → ẩn xuống khay, vẫn chạy nền. Chỉ thoát hẳn qua menu khay.
            // Chỉ chặn khi NGƯỜI DÙNG bấm X — Windows tắt máy/đăng xuất mà Cancel thì bị "app đang chặn tắt máy".
            FormClosing += (s, e) => { if (!reallyExit && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; HideToTray(); } };
            Resize += (s, e) => { if (WindowState == FormWindowState.Minimized) HideToTray(); };

            Load += async (s, e) => await Boot();
        }

        void SetupTray()
        {
            tray = new NotifyIcon();
            tray.Icon = new Icon(this.Icon ?? SystemIcons.Application, SystemInformation.SmallIconSize);
            tray.Text = "Zalo Sync — đang chạy nền";
            tray.Visible = true;
            var menu = new ContextMenuStrip();
            menu.Items.Add("Mở bảng điều khiển", null, (s, e) => ShowFromTray());
            menu.Items.Add("Chạy đồng bộ ngay", null, (s, e) => { ShowFromTray(); if (_runNow != null && _runNow.Enabled) _runNow.PerformClick(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Thoát hẳn", null, (s, e) => { reallyExit = true; if (tray != null) tray.Visible = false; Application.Exit(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => ShowFromTray();
        }

        void HideToTray()
        {
            Hide(); ShowInTaskbar = false;
            if (!trayHinted) { trayHinted = true; tray.ShowBalloonTip(2500, "Zalo Sync", "Vẫn đang chạy nền ở khay hệ thống. Bấm đúp biểu tượng để mở lại.", ToolTipIcon.Info); }
        }

        void ShowFromTray()
        {
            Show(); ShowInTaskbar = true; WindowState = FormWindowState.Normal; Activate();
        }

        // ---- helpers tạo control (bố cục co giãn theo cửa sổ — không dùng toạ độ cố định) ----
        // UseMnemonic = false: hiện đúng ký tự '&' (vd "Nơi lưu & lịch chạy") thay vì coi là phím tắt.
        Label H2(string t) { return new Label { Text = t, UseMnemonic = false, Font = new Font("Segoe UI", 14f, FontStyle.Bold), ForeColor = TEXT, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 10) }; }
        Label P(string t) { return new Label { Text = t, UseMnemonic = false, ForeColor = MUTED, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 6, 0, 4) }; }
        TextBox Input(string t = "") { return new TextBox { Text = t, BackColor = PANEL, ForeColor = TEXT, BorderStyle = BorderStyle.FixedSingle, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 4) }; }
        Button Btn(string t, bool primary = false)
        {
            var b = new Button { Text = t, UseMnemonic = false, AutoSize = true, Padding = new Padding(10, 6, 10, 6), Margin = new Padding(0, 4, 8, 4), FlatStyle = FlatStyle.Flat, ForeColor = primary ? Color.Black : TEXT };
            b.BackColor = primary ? ACCENT : Color.FromArgb(34, 44, 56);
            b.FlatAppearance.BorderColor = Color.FromArgb(45, 58, 72);
            return b;
        }

        // Hàng nút trái → phải, tự xuống dòng khi cửa sổ hẹp. Nút cuối không chừa lề phải (thẳng mép).
        FlowLayoutPanel Row(params Control[] cs)
        {
            var r = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Fill, Margin = new Padding(0, 6, 0, 0) };
            var last = cs[cs.Length - 1];
            last.Margin = new Padding(last.Margin.Left, last.Margin.Top, 0, last.Margin.Bottom);
            r.Controls.AddRange(cs);
            return r;
        }

        // 2 cột cùng hàng: trái giãn hết bề ngang, phải vừa nội dung, căn giữa theo chiều dọc (ô nhập + nút, thanh điều hướng).
        TableLayoutPanel Split(Control left, Control right)
        {
            var t = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = new Padding(0, 0, 0, 4) };
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            t.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            if (left != null) { left.Anchor = AnchorStyles.Left | AnchorStyles.Right; left.Margin = new Padding(0, 0, 8, 0); t.Controls.Add(left, 0, 0); }
            right.Anchor = AnchorStyles.Right; right.Margin = Padding.Empty; t.Controls.Add(right, 1, 0);
            return t;
        }

        // Thanh điều hướng wizard: "Quay lại" bên trái, nút chính bên phải; bám đáy ô chứa nó.
        Control Nav(Button back, Button next)
        {
            var n = Split(back == null ? null : Row(back), next);
            n.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom; n.Margin = new Padding(0, 10, 0, 0);
            return n;
        }

        // Xếp các hàng từ trên xuống, giãn theo bề ngang cửa sổ; hàng `grow` nhận phần chiều cao còn dư
        // (danh sách/log giãn ra, hoặc thanh điều hướng → bị đẩy xuống đáy).
        void SetPage(Control grow, params Control[] rows)
        {
            var page = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = rows.Length };
            page.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            for (int i = 0; i < rows.Length; i++)
            {
                page.RowStyles.Add(rows[i] == grow ? new RowStyle(SizeType.Percent, 100) : new RowStyle(SizeType.AutoSize));
                page.Controls.Add(rows[i], 0, i);
            }
            content.Controls.Clear(); content.Controls.Add(page);
        }

        async Task Boot()
        {
            try
            {
                // 1 lần: chuyển cấu hình + lịch chạy của bản cài cũ sang tên mới — TRƯỚC khi đọc cấu hình.
                var mig = await Task.Run(() => Cli.RunJson("migrate"));
                if (!(mig.ContainsKey("ok") && Convert.ToBoolean(mig["ok"])))
                    MessageBox.Show(this, "Chưa chuyển xong dữ liệu của bản cũ: " + (mig.ContainsKey("error") ? mig["error"] : "không rõ") +
                        "\r\nỨng dụng sẽ thử lại ở lần mở sau.", "Cảnh báo", MessageBoxButtons.OK, MessageBoxIcon.Warning);

                var env = await Task.Run(() => Cli.RunJson("env"));
                var node = (Dictionary<string, object>)env["node"];
                bool sqliteOk = Convert.ToBoolean(node["sqliteOk"]);
                hNode.Text = "Node " + node["version"] + (sqliteOk ? "  ✓" : "  ✗ cần ≥ " + node["minRequired"]);
                hNode.ForeColor = sqliteOk ? Color.FromArgb(46, 160, 67) : Color.FromArgb(248, 81, 73);

                var cfg = await Task.Run(() => Cli.RunJson("get-config"));
                if (cfg.ContainsKey("exists") && Convert.ToBoolean(cfg["exists"]))
                {
                    await ShowDashboard();
                    // Lịch đang bật nhưng lệch cấu hình/exe hiện tại (exe mới hoặc bị di chuyển, tác vụ bản cũ còn chạy
                    // run_sync.bat có cửa sổ cmd) → đăng ký lại.
                    string w = await SyncSchedule("schedule-refresh");
                    if (w != null) AppendLog("\r\n[CẢNH BÁO] Không cập nhật được lịch chạy tự động: " + w);
                }
                else ShowStep1(env);
            }
            catch (Exception ex) { var err = P(ex.Message); SetPage(err, H2("Lỗi"), err); }
        }

        // Chạy 1 lệnh lịch (schedule-set/-del/-refresh) rồi cập nhật thẻ trạng thái. Trả lỗi (null = ổn) để nơi gọi tự báo.
        async Task<string> SyncSchedule(string cmd)
        {
            string err = null;
            try
            {
                var r = await Task.Run(() => Cli.RunJson(cmd));
                if (!(r.ContainsKey("ok") && Convert.ToBoolean(r["ok"]))) err = r.ContainsKey("error") ? Convert.ToString(r["error"]) : "không rõ";
            }
            catch (Exception ex) { err = ex.Message; }
            if (refreshDashboard != null) await refreshDashboard();
            return err;
        }

        // ---- BƯỚC 1: phát hiện Zalo ----
        void ShowStep1(Dictionary<string, object> env)
        {
            var accounts = ((object[])env["accounts"]).Cast<Dictionary<string, object>>().ToList();
            var title = H2("Bước 1 — Phát hiện Zalo trên máy");
            var desc = P("Ứng dụng chỉ đọc dữ liệu Zalo của chính bạn trên máy này.");

            if (accounts.Count == 0)
            {
                var reload = Btn("↻ Tải lại"); reload.Click += async (s, e) => await Boot();
                var nav0 = Nav(null, reload);
                SetPage(nav0, title, desc, P("⚠ Chưa phát hiện tài khoản Zalo. Hãy mở Zalo PC, đăng nhập, rồi bấm Tải lại."), nav0);
                return;
            }

            var lb = new ListBox { Height = 120, Dock = DockStyle.Fill, Margin = new Padding(0, 6, 0, 0), BackColor = PANEL, ForeColor = TEXT, BorderStyle = BorderStyle.FixedSingle };
            foreach (var a in accounts)
                lb.Items.Add("Tài khoản Zalo  —  UID " + a["uid"] + "   (" + a["messageDbCount"] + " nhóm/hội thoại, hoạt động " + ShortDate(a["lastActivity"]) + ")");
            lb.SelectedIndex = 0;

            var next = Btn("Tiếp tục →", true);
            next.Click += (s, e) =>
            {
                account = accounts[lb.SelectedIndex];
                coreDir = (string)account["coreDir"];
                uid = (string)account["uid"];
                ShowStep2();
            };
            var nav = Nav(null, next);
            SetPage(nav, title, desc, lb, nav);
        }

        // ---- BƯỚC 2: tự dò khóa ----
        void ShowStep2()
        {
            var title = H2("Bước 2 — Khóa giải mã (tự động)");
            var desc = P("Ứng dụng tự dò khóa để đọc dữ liệu Zalo CỦA CHÍNH BẠN trên máy này — bạn không cần tìm hay nhập gì cả.");
            var status = new Label { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 10, 0, 10), Font = new Font("Segoe UI", 10f), ForeColor = MUTED, Text = "⏳ Đang tự dò khóa…" };
            var manualLbl = P("Nếu tự dò thất bại, dán khóa 32 ký tự hex vào đây:");
            var keyBox = Input();
            var verify = Btn("Kiểm tra");
            var keyRow = Split(keyBox, verify);
            var next = Btn("Tiếp tục →", true); next.Enabled = false;
            manualLbl.Visible = false; keyRow.Visible = false;

            var nav = Nav(null, next);
            SetPage(nav, title, desc, status, manualLbl, keyRow, nav);

            Action showManual = () => { manualLbl.Visible = keyRow.Visible = true; };

            verify.Click += async (s, e) =>
            {
                status.Text = "⏳ Đang kiểm tra khóa…"; status.ForeColor = MUTED;
                var r = await Task.Run(() => Cli.RunJson("verify --dir " + Cli.Esc(coreDir) + " --key " + Cli.Esc(keyBox.Text.Trim())));
                if (Convert.ToBoolean(r["ok"])) { key = keyBox.Text.Trim(); status.Text = "✔ Khóa hợp lệ (" + r["groupCount"] + " nhóm)."; status.ForeColor = Color.FromArgb(46, 160, 67); next.Enabled = true; }
                else { status.Text = "✗ " + r["error"]; status.ForeColor = Color.FromArgb(248, 81, 73); }
            };
            next.Click += (s, e) => ShowStep3();

            // chạy tự dò
            Task.Run(() => Cli.RunJson("detect-key --dir " + Cli.Esc(coreDir))).ContinueWith(t =>
            {
                this.Invoke((Action)(() =>
                {
                    if (t.IsFaulted) { status.Text = "✗ Lỗi dò khóa: " + t.Exception.GetBaseException().Message; showManual(); return; }
                    var r = t.Result;
                    if (r.ContainsKey("ok") && Convert.ToBoolean(r["ok"]))
                    {
                        key = (string)r["key"];
                        status.Text = "✔ Đã tự dò được khóa và xác minh thành công.";
                        status.ForeColor = Color.FromArgb(46, 160, 67);
                        next.Enabled = true;
                    }
                    else { status.Text = "⚠ " + (r.ContainsKey("reason") ? r["reason"] : "Không tự dò được."); status.ForeColor = Color.FromArgb(210, 153, 34); showManual(); }
                }));
            });
        }

        // ---- BƯỚC 3: chọn nhóm ----
        async void ShowStep3()
        {
            var title = H2("Bước 3 — Chọn nhóm cần đồng bộ");
            var info = P("Đang đọc danh sách nhóm…");
            var clb = new CheckedListBox { Dock = DockStyle.Fill, IntegralHeight = false, Margin = new Padding(0, 4, 0, 0), BackColor = PANEL, ForeColor = TEXT, BorderStyle = BorderStyle.FixedSingle, CheckOnClick = true };
            var selAll = Btn("Chọn tất cả"); var selNone = Btn("Bỏ chọn");
            var next = Btn("Tiếp tục →", true); next.Enabled = false;
            var back = Btn("← Quay lại");
            SetPage(clb, title, info, Row(selAll, selNone), clb, Nav(back, next));

            var r = await Task.Run(() => Cli.RunJson("discover --dir " + Cli.Esc(coreDir) + " --key " + Cli.Esc(key)));
            if (!Convert.ToBoolean(r["ok"])) { info.Text = "✗ " + r["error"]; info.ForeColor = Color.FromArgb(248, 81, 73); return; }
            groups = ((object[])r["groups"]).Cast<Dictionary<string, object>>().ToList();
            // "Thiết lập lại": giữ các nhóm đang đồng bộ; thiết lập mới (hoặc đổi tài khoản, không còn nhóm cũ nào): chọn tất cả.
            var saved = Saved("targetGroups") as object[];
            var keep = saved == null ? null : new HashSet<string>(saved.Cast<Dictionary<string, object>>().Select(g => Convert.ToString(g["id"])));
            int kept = keep == null ? 0 : groups.Count(g => keep.Contains(Convert.ToString(g["id"])));
            if (kept == 0) keep = null;
            info.Text = (keep == null ? "Tích chọn nhóm (mặc định chọn tất cả)" : "Tích chọn nhóm (giữ nguyên " + kept + " nhóm đang đồng bộ)") + ". Tổng: " + groups.Count + " nhóm.";
            foreach (var g in groups) clb.Items.Add(g["name"] + "   (" + g["totalMember"] + " tv)", keep == null || keep.Contains(Convert.ToString(g["id"])));

            selAll.Click += (s, e) => { for (int i = 0; i < clb.Items.Count; i++) clb.SetItemChecked(i, true); };
            selNone.Click += (s, e) => { for (int i = 0; i < clb.Items.Count; i++) clb.SetItemChecked(i, false); };
            back.Click += (s, e) => ShowStep2();
            clb.ItemCheck += (s, e) => BeginInvoke((Action)(() => next.Enabled = clb.CheckedIndices.Count > 0));
            next.Enabled = clb.CheckedIndices.Count > 0;
            next.Click += (s, e) =>
            {
                var picked = new List<Dictionary<string, object>>();
                foreach (int i in clb.CheckedIndices) picked.Add(groups[i]);
                ShowStep4(picked);
            };
        }

        // ---- BƯỚC 4: nơi lưu & lịch ----
        void ShowStep4(List<Dictionary<string, object>> picked)
        {
            var title = H2("Bước 4 — Nơi lưu & lịch chạy");
            var l1 = P("Tên dự án (hiển thị trong báo cáo):");
            // "Thiết lập lại" điền sẵn thiết lập đang dùng — không âm thầm đổi về mặc định khi bấm Hoàn tất.
            var projBox = Input(Convert.ToString(Saved("projectLabel") ?? "Zalo Sync — dữ liệu nhóm công trường"));
            var l2 = P("Thư mục lưu dữ liệu:");
            var savedDir = Saved("downloadDir") as string; // config lưu 'C:/…' → GetFullPath đổi về dạng Windows
            var dirBox = Input(string.IsNullOrEmpty(savedDir) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "ZaloSync", "data") : Path.GetFullPath(savedDir));
            var browse = Btn("Chọn…");
            var l3 = P("Giờ chạy tự động hằng ngày (nên 04:15 để gom trọn ngày hôm trước):");
            var timePick = new DateTimePicker { Width = 120, Margin = new Padding(0, 0, 0, 4), Format = DateTimePickerFormat.Time, ShowUpDown = true };
            timePick.Value = DateTime.Today.AddHours(4).AddMinutes(15);
            var app = Saved("_app") as Dictionary<string, object>; object savedTime; TimeSpan ts;
            if (app != null && app.TryGetValue("scheduleTime", out savedTime) && TimeSpan.TryParse(Convert.ToString(savedTime), out ts)) timePick.Value = DateTime.Today + ts;
            var back = Btn("← Quay lại");
            var finish = Btn("✔ Hoàn tất & lưu", true);
            var status = new Label { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 10, 0, 0), ForeColor = MUTED };
            var nav = Nav(back, finish);
            SetPage(nav, title, l1, projBox, l2, Split(dirBox, browse), l3, timePick, status, nav);

            browse.Click += (s, e) => { using (var d = new FolderBrowserDialog { SelectedPath = dirBox.Text.Trim() }) { if (d.ShowDialog() == DialogResult.OK) dirBox.Text = d.SelectedPath; } };
            back.Click += (s, e) => ShowStep3();
            finish.Click += async (s, e) =>
            {
                finish.Enabled = false; status.Text = "⏳ Đang lưu cấu hình…"; status.ForeColor = MUTED;
                var tg = picked.Select(g => new Dictionary<string, object> { { "id", g["id"] }, { "code", g["id"] }, { "name", g["name"] } }).ToList();
                string time = timePick.Value.ToString("HH:mm");
                var payload = new Dictionary<string, object>
                {
                    { "uid", uid }, { "coreDir", coreDir }, { "key", key },
                    { "projectLabel", projBox.Text.Trim() }, { "targetGroups", tg },
                    { "downloadDir", dirBox.Text.Trim() }, { "scheduleTime", time },
                };
                string tmp = Path.Combine(Path.GetTempPath(), "zalosync_cfg_" + Guid.NewGuid().ToString("N") + ".json");
                File.WriteAllText(tmp, Cli.ToJson(payload), new UTF8Encoding(false)); // KHÔNG BOM (Node JSON.parse vỡ với BOM)
                try
                {
                    var sr = await Task.Run(() => Cli.RunJson("save-config --payload " + Cli.Esc(tmp)));
                    try { File.Delete(tmp); } catch { }
                    if (sr != null && sr.ContainsKey("ok") && Convert.ToBoolean(sr["ok"]))
                    {
                        await ShowDashboard();
                        // Thiết lập lần đầu → bật lịch luôn theo giờ vừa chọn. "Thiết lập lại" → lịch đang bật thì đăng ký lại
                        // theo giờ mới (trước đây chỉ ghi giờ vào cấu hình, tác vụ vẫn chạy giờ cũ); đang tắt thì giữ tắt.
                        string w = await SyncSchedule(savedCfg == null ? "schedule-set --time " + Cli.Esc(time) : "schedule-refresh");
                        if (w != null) MessageBox.Show(this, "Đã lưu cấu hình, nhưng lịch chạy tự động CHƯA cập nhật được:\r\n" + w,
                            "Cảnh báo", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                    else { status.Text = "✗ Lưu cấu hình thất bại: " + (sr != null && sr.ContainsKey("error") ? sr["error"] : "không rõ"); status.ForeColor = Color.FromArgb(248, 81, 73); finish.Enabled = true; }
                }
                catch (Exception ex) { status.Text = "✗ " + ex.Message; status.ForeColor = Color.FromArgb(248, 81, 73); finish.Enabled = true; }
            };
        }

        // ---- BẢNG ĐIỀU KHIỂN ----
        TextBox logBox;
        Func<Task> refreshDashboard; // cập nhật thẻ trạng thái của bảng điều khiển (null = chưa hiện lần nào)
        async Task ShowDashboard()
        {
            var title = H2("Bảng điều khiển");
            var cards = new Label { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 4), ForeColor = TEXT, Font = new Font("Consolas", 10f) };
            var runNow = Btn("▶ Chạy ngay", true);
            _runNow = runNow;
            var runDry = Btn("Chạy thử");
            var toggle = Btn("⏰ Tự động");
            var openData = Btn("📁 Thư mục dữ liệu");
            var exportLog = Btn("📋 Xuất log");
            var recfg = Btn("⚙ Thiết lập lại");
            logBox = new TextBox { Dock = DockStyle.Fill, Margin = new Padding(0, 8, 0, 0), Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.FromArgb(10, 14, 18), ForeColor = Color.FromArgb(201, 212, 224), Font = new Font("Consolas", 9f), WordWrap = false };
            SetPage(logBox, title, cards, Row(runNow, runDry, toggle, openData, exportLog, recfg), logBox);

            Func<Task> refresh = async () =>
            {
                var st = await Task.Run(() => Cli.RunJson("status"));
                var sched = (Dictionary<string, object>)st["schedule"];
                bool on = sched.ContainsKey("exists") && Convert.ToBoolean(sched["exists"]);
                cards.Text =
                    "Số nhóm theo dõi : " + st["groupCount"] + "\n" +
                    "Tự động hằng ngày: " + (on ? "BẬT · " + st["scheduleTime"] + "   (kế tiếp " + ShortDate(sched.ContainsKey("nextRun") ? sched["nextRun"] : null) + ")" : "TẮT") + "\n" +
                    "Lần chạy cuối    : " + ShortDate(st["lastRunAt"]) + (st["lastRunExit"] != null ? (Convert.ToInt32(st["lastRunExit"]) == 0 ? "  ✓" : "  ✗") : "") + "\n" +
                    "Dữ liệu cập nhật : " + ShortDate(st["dataFresh"]) + "\n" +
                    "Thư mục dữ liệu  : " + st["dataDir"];
                toggle.Text = on ? "⏸ Tắt tự động" : "⏰ Bật tự động";
                toggle.Tag = on;
                _dataDir = Convert.ToString(st["dataDir"]);
            };
            refreshDashboard = refresh;
            await refresh();
            var loadLog = await Task.Run(() => Cli.RunJson("log --tail 200"));
            if (loadLog.ContainsKey("lines")) logBox.Text = string.Join("\r\n", ((object[])loadLog["lines"]).Select(x => Convert.ToString(x)));

            runNow.Click += async (s, e) => await DoRun(true, false, runNow, runDry);
            runDry.Click += async (s, e) => await DoRun(false, true, runNow, runDry);
            openData.Click += async (s, e) => { string d = _dataDir; await Task.Run(() => Cli.Run("open-folder" + (string.IsNullOrEmpty(d) ? "" : " --path " + Cli.Esc(d)))); };
            // Gom log lượt chạy gần nhất + trạng thái + cấu hình (đã che khóa) vào 1 file rồi mở thư mục chứa nó.
            exportLog.Click += async (s, e) =>
            {
                exportLog.Enabled = false;
                try
                {
                    var r = await Task.Run(() => Cli.RunJson("export-log"));
                    if (r.ContainsKey("ok") && Convert.ToBoolean(r["ok"]))
                    {
                        string f = Convert.ToString(r["file"]);
                        AppendLog("\r\n[XUẤT LOG] Đã lưu — gửi file này cho AI để debug: " + f);
                        await Task.Run(() => Cli.Run("open-folder --path " + Cli.Esc(Path.GetDirectoryName(f))));
                    }
                    else AppendLog("\r\n[LỖI] Xuất log thất bại: " + (r.ContainsKey("error") ? r["error"] : "không rõ"));
                }
                catch (Exception ex) { AppendLog("\r\n[LỖI] Xuất log thất bại: " + ex.Message); }
                exportLog.Enabled = true;
            };
            recfg.Click += async (s, e) =>
            {
                var gc = await Task.Run(() => Cli.RunJson("get-config"));
                savedCfg = gc.ContainsKey("config") ? gc["config"] as Dictionary<string, object> : null; // wizard giữ thiết lập đang dùng
                var env = await Task.Run(() => Cli.RunJson("env")); ShowStep1(env);
            };
            toggle.Click += async (s, e) =>
            {
                toggle.Enabled = false;
                bool on = toggle.Tag != null && (bool)toggle.Tag;
                string w;
                try
                {
                    var st = await Task.Run(() => Cli.RunJson("status"));
                    string tm = Convert.ToString(st["scheduleTime"]) ?? "04:15";
                    w = await SyncSchedule(on ? "schedule-del" : "schedule-set --time " + Cli.Esc(tm));
                }
                catch (Exception ex) { w = ex.Message; }
                // báo lỗi rõ ràng — không để nút im lặng trở về trạng thái cũ
                if (w != null) MessageBox.Show(this, (on ? "Không tắt được" : "Không bật được") + " lịch chạy tự động:\r\n" + w,
                    "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                toggle.Enabled = true;
            };
        }

        async Task DoRun(bool all, bool dry, Button runNow, Button runDry)
        {
            runNow.Enabled = runDry.Enabled = false;
            logBox.AppendText("\r\n");
            string tail = "run" + (all ? " --all" : "") + (dry ? " --dry-run" : "");
            try
            {
                var p = Cli.StartStream(tail);
                p.OutputDataReceived += (s, e) => { if (e.Data != null) AppendLog(e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) AppendLog(e.Data); };
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                await Task.Run(() => p.WaitForExit());
                AppendLog("\r\n[HOÀN TẤT] exit=" + p.ExitCode);
            }
            catch (Exception ex) { AppendLog("\r\n[LỖI] " + ex.Message); }
            runNow.Enabled = runDry.Enabled = true;
        }

        void AppendLog(string line)
        {
            if (logBox.InvokeRequired) { logBox.BeginInvoke((Action)(() => AppendLog(line))); return; }
            logBox.AppendText(line + "\r\n");
        }

        static string ShortDate(object iso)
        {
            var s = Convert.ToString(iso);
            if (string.IsNullOrEmpty(s)) return "—";
            DateTime d;
            if (DateTime.TryParse(s, null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out d))
                return d.ToLocalTime().ToString("dd/MM/yyyy HH:mm");
            return s;
        }
    }
}
