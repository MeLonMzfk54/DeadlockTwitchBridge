param(
    [string]$ProcessName = "deadlock",
    [string]$TitleContains = "",
    [int]$Fps = 45,
    [string]$Axis = "horizontal",
    [switch]$SyncAd,
    [string]$LeftKey = "a",
    [string]$RightKey = "d",
    [string]$MonitorIndex = ""
)

function Get-VirtualKeyCode([string]$KeyName) {
    $normalized = $KeyName.Trim().ToUpperInvariant()
    if ($normalized -match '^[A-Z]$') {
        return [byte][char]$normalized
    }
    throw "Unsupported movement key '$KeyName'. Use A through Z."
}

if ($Fps -lt 5) { $Fps = 5 }
if ($Fps -gt 60) { $Fps = 60 }

$vkLeft = Get-VirtualKeyCode $LeftKey
$vkRight = Get-VirtualKeyCode $RightKey
$syncAdFlag = [bool]$SyncAd
$axisNormalized = $Axis.Trim().ToLowerInvariant()
if ($axisNormalized -ne "horizontal" -and $axisNormalized -ne "vertical") {
    $axisNormalized = "horizontal"
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("ScreenFlipOverlay" -as [type])) {
    Add-Type -ReferencedAssemblies @("System.Windows.Forms.dll", "System.Drawing.dll", "System.dll") @"
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public class ScreenFlipOverlay : Form {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_KEYUP = 0x0101;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int WM_SYSKEYUP = 0x0105;
  private const uint INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_SCANCODE = 0x0008;
  private const uint LLKHF_INJECTED = 0x10;
  private const uint MAPVK_VK_TO_VSC = 0;
  private const uint PW_RENDERFULLCONTENT = 0x00000002;
  private const int GWL_EXSTYLE = -20;
  private const int WS_EX_LAYERED = 0x00080000;
  private const int WS_EX_TRANSPARENT = 0x00000020;
  private const int WS_EX_TOPMOST = 0x00000008;
  private const int WS_EX_NOACTIVATE = 0x08000000;
  private const int WS_EX_TOOLWINDOW = 0x00000080;
  private const int HWND_TOPMOST = -1;
  private const uint SWP_NOSIZE = 0x0001;
  private const uint SWP_NOMOVE = 0x0002;
  private const uint SWP_NOACTIVATE = 0x0010;
  private const uint SWP_SHOWWINDOW = 0x0040;
  private const uint LWA_ALPHA = 0x00000002;
  private const int SRCCOPY = 0x00CC0020;

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct POINT {
    public int x;
    public int y;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll")]
  static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  static extern bool IsWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

  [DllImport("user32.dll")]
  static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

  [DllImport("user32.dll")]
  static extern IntPtr GetWindowDC(IntPtr hWnd);

  [DllImport("user32.dll")]
  static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

  [DllImport("gdi32.dll")]
  static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight,
    IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

  [DllImport("user32.dll", SetLastError = true)]
  static extern int GetWindowLong(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", SetLastError = true)]
  static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

  [DllImport("user32.dll", SetLastError = true)]
  static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

  [DllImport("user32.dll", SetLastError = true)]
  static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

  [DllImport("user32.dll")]
  static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("user32.dll")]
  static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  static extern ushort MapVirtualKey(ushort uCode, uint uMapType);

  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  static extern IntPtr GetModuleHandle(string lpModuleName);

  [DllImport("kernel32.dll")]
  static extern uint GetLastError();

  static ScreenFlipOverlay _instance;
  static string _processName = "deadlock";
  static string _titleContains = "";
  static bool _syncAd;
  static bool _flipVertical;
  static byte _vkLeft;
  static byte _vkRight;
  static IntPtr _gameHwnd = IntPtr.Zero;
  static IntPtr _hookId = IntPtr.Zero;
  static GCHandle _procHandle;
  static readonly LowLevelKeyboardProc _hookProc = HookCallback;
  static int _refreshCounter;

  System.Windows.Forms.Timer _timer;
  Bitmap _frame;
  int _clientW;
  int _clientH;
  bool _paused;
  int _missCount;

  protected override bool ShowWithoutActivation { get { return true; } }

  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
      return cp;
    }
  }

  public ScreenFlipOverlay(int fps) {
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    TopMost = true;
    StartPosition = FormStartPosition.Manual;
    BackColor = Color.Black;
    // WinForms Opacity sets LWA_ALPHA so a WS_EX_LAYERED window actually paints.
    Opacity = 1.0;
    DoubleBuffered = true;
    SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);

    int intervalMs = Math.Max(16, 1000 / Math.Max(5, Math.Min(60, fps)));
    _timer = new System.Windows.Forms.Timer();
    _timer.Interval = intervalMs;
    _timer.Tick += OnTick;
  }

  public static void Run(
    string processName,
    string titleContains,
    int fps,
    string axis,
    bool syncAd,
    byte vkLeft,
    byte vkRight,
    string monitorIndex
  ) {
    _processName = string.IsNullOrEmpty(processName) ? "deadlock" : processName;
    _titleContains = titleContains ?? "";
    _syncAd = syncAd;
    _flipVertical = string.Equals(axis, "vertical", StringComparison.OrdinalIgnoreCase);
    _vkLeft = vkLeft;
    _vkRight = vkRight;
    // monitorIndex reserved for multi-monitor fallback; HWND path preferred.
    if (monitorIndex != null && monitorIndex.Length > 0) {
      // no-op in MVP
    }

    if (Process.GetProcessesByName(_processName).Length == 0) {
      throw new InvalidOperationException("Deadlock process not found.");
    }

    _gameHwnd = FindGameWindow(_processName, _titleContains);
    if (_gameHwnd == IntPtr.Zero) {
      throw new InvalidOperationException("Deadlock window not found. Use Borderless Windowed mode.");
    }

    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);

    _instance = new ScreenFlipOverlay(fps);

    Rectangle startBounds;
    if (TryGetClientScreenRect(_gameHwnd, out startBounds)) {
      _instance.Bounds = startBounds;
    } else {
      _instance.Bounds = Screen.PrimaryScreen.Bounds;
    }

    if (_syncAd) {
      InstallAdHook();
    }

    Console.WriteLine("screen-flip: ready hwnd=" + ((long)_gameHwnd).ToString("X") +
      " bounds=" + _instance.Bounds.Width + "x" + _instance.Bounds.Height +
      "@" + _instance.Bounds.X + "," + _instance.Bounds.Y);
    Application.Run(_instance);
  }

  static string GetProcessName(uint pid) {
    try {
      return Process.GetProcessById((int)pid).ProcessName;
    } catch {
      return "";
    }
  }

  static IntPtr FindGameWindow(string processName, string titleContains) {
    Process[] processes = Process.GetProcessesByName(processName);
    foreach (Process proc in processes) {
      if (proc.MainWindowHandle == IntPtr.Zero) continue;

      if (!string.IsNullOrEmpty(titleContains)) {
        var sb = new StringBuilder(512);
        GetWindowText(proc.MainWindowHandle, sb, 512);
        string title = sb.ToString();
        if (title.Length > 0 &&
            title.IndexOf(titleContains, StringComparison.OrdinalIgnoreCase) < 0) {
          continue;
        }
      }

      return proc.MainWindowHandle;
    }

    IntPtr best = IntPtr.Zero;
    long bestArea = 0;

    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;

      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (!GetProcessName(pid).Equals(processName, StringComparison.OrdinalIgnoreCase)) {
        return true;
      }

      var sb = new StringBuilder(512);
      GetWindowText(hWnd, sb, 512);
      string title = sb.ToString();

      if (!string.IsNullOrEmpty(titleContains) &&
          title.IndexOf(titleContains, StringComparison.OrdinalIgnoreCase) < 0) {
        return true;
      }

      RECT rect;
      if (!GetWindowRect(hWnd, out rect)) return true;
      long area = (long)(rect.Right - rect.Left) * (rect.Bottom - rect.Top);
      if (area <= 0) return true;

      if (area > bestArea) {
        bestArea = area;
        best = hWnd;
      }
      return true;
    }, IntPtr.Zero);

    return best;
  }

  static bool TryGetClientScreenRect(IntPtr hwnd, out Rectangle bounds) {
    bounds = Rectangle.Empty;
    if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || IsIconic(hwnd) || !IsWindowVisible(hwnd)) {
      return false;
    }

    RECT client;
    if (!GetClientRect(hwnd, out client)) return false;
    int w = client.Right - client.Left;
    int h = client.Bottom - client.Top;
    if (w <= 0 || h <= 0) return false;

    POINT topLeft = new POINT { x = 0, y = 0 };
    if (!ClientToScreen(hwnd, ref topLeft)) return false;

    bounds = new Rectangle(topLeft.x, topLeft.y, w, h);
    return true;
  }

  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    int ex = GetWindowLong(Handle, GWL_EXSTYLE);
    SetWindowLong(Handle, GWL_EXSTYLE,
      ex | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
    ApplyClickThrough();
  }

  protected override void OnShown(EventArgs e) {
    base.OnShown(e);
    ApplyClickThrough();
    _timer.Start();
  }

  protected override void OnFormClosed(FormClosedEventArgs e) {
    _timer.Stop();
    if (_frame != null) {
      _frame.Dispose();
      _frame = null;
    }
    UninstallAdHook();
    base.OnFormClosed(e);
  }

  void ApplyClickThrough() {
    if (!IsHandleCreated) return;
    int ex = GetWindowLong(Handle, GWL_EXSTYLE);
    SetWindowLong(Handle, GWL_EXSTYLE,
      ex | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
    // Required for WS_EX_LAYERED windows to become visible under GDI/WM_PAINT.
    SetLayeredWindowAttributes(Handle, 0, 255, LWA_ALPHA);
    Opacity = 1.0;
    TopMost = true;
    SetWindowPos(Handle, (IntPtr)HWND_TOPMOST, Left, Top, Width, Height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }

  void OnTick(object sender, EventArgs e) {
    try {
      RefreshGameWindow();
      Rectangle bounds;
      if (!TryGetClientScreenRect(_gameHwnd, out bounds)) {
        EnterPause();
        return;
      }

      if (_paused) {
        _paused = false;
        _missCount = 0;
        Visible = true;
      }

      if (Bounds.X != bounds.X || Bounds.Y != bounds.Y || Bounds.Width != bounds.Width || Bounds.Height != bounds.Height) {
        Bounds = bounds;
      }

      CaptureAndStore(_gameHwnd, bounds.Width, bounds.Height);
      ApplyClickThrough();
      Invalidate();
      Update();
    } catch (Exception ex) {
      Console.Error.WriteLine("screen-flip tick error: " + ex.Message);
    }
  }

  void EnterPause() {
    _missCount++;
    if (!_paused && _missCount >= 2) {
      _paused = true;
      Visible = false;
      if (_frame != null) {
        _frame.Dispose();
        _frame = null;
      }
    }

    if (_missCount % 15 == 0) {
      _gameHwnd = FindGameWindow(_processName, _titleContains);
    }
  }

  static bool IsMostlyBlack(Bitmap bmp) {
    if (bmp == null) return true;
    int w = bmp.Width;
    int h = bmp.Height;
    if (w < 2 || h < 2) return true;
    int[] xs = new int[] { w / 4, w / 2, (3 * w) / 4 };
    int[] ys = new int[] { h / 4, h / 2, (3 * h) / 4 };
    int dark = 0;
    int total = 0;
    for (int i = 0; i < xs.Length; i++) {
      for (int j = 0; j < ys.Length; j++) {
        Color c = bmp.GetPixel(xs[i], ys[j]);
        total++;
        if (c.R < 8 && c.G < 8 && c.B < 8) dark++;
      }
    }
    return dark >= total - 1;
  }

  void CaptureAndStore(IntPtr hwnd, int width, int height) {
    if (_frame == null || _clientW != width || _clientH != height) {
      if (_frame != null) _frame.Dispose();
      _frame = new Bitmap(width, height, PixelFormat.Format32bppArgb);
      _clientW = width;
      _clientH = height;
    }

    bool ok = false;
    using (Graphics g = Graphics.FromImage(_frame)) {
      IntPtr hdcDest = g.GetHdc();
      try {
        ok = PrintWindow(hwnd, hdcDest, PW_RENDERFULLCONTENT);
        if (!ok) {
          IntPtr hdcSrc = GetWindowDC(hwnd);
          if (hdcSrc != IntPtr.Zero) {
            try {
              RECT windowRect;
              GetWindowRect(hwnd, out windowRect);
              POINT clientOrigin = new POINT { x = 0, y = 0 };
              ClientToScreen(hwnd, ref clientOrigin);
              int offsetX = clientOrigin.x - windowRect.Left;
              int offsetY = clientOrigin.y - windowRect.Top;
              ok = BitBlt(hdcDest, 0, 0, width, height, hdcSrc, offsetX, offsetY, SRCCOPY);
            } finally {
              ReleaseDC(hwnd, hdcSrc);
            }
          }
        }
      } finally {
        g.ReleaseHdc(hdcDest);
      }
    }

    if (ok && IsMostlyBlack(_frame)) {
      ok = false;
    }

    // PrintWindow/GetDC often fail on D3D. Avoid feedback loop: hide overlay, copy screen, show again.
    if (!ok) {
      bool wasVisible = Visible;
      Visible = false;
      try {
        using (Graphics g = Graphics.FromImage(_frame)) {
          g.CopyFromScreen(Bounds.X, Bounds.Y, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
          ok = true;
        }
      } catch {
        ok = false;
      } finally {
        if (wasVisible) {
          Visible = true;
          ApplyClickThrough();
        }
      }
    }

    if (!ok) {
      using (Graphics g = Graphics.FromImage(_frame)) {
        g.Clear(Color.Black);
      }
    }
  }

  protected override void OnPaint(PaintEventArgs e) {
    base.OnPaint(e);
    if (_frame == null || _paused) return;

    e.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
    e.Graphics.PixelOffsetMode = PixelOffsetMode.Half;
    e.Graphics.CompositingMode = CompositingMode.SourceCopy;

    if (_flipVertical) {
      e.Graphics.TranslateTransform(0, Height);
      e.Graphics.ScaleTransform(1f, -1f);
    } else {
      e.Graphics.TranslateTransform(Width, 0);
      e.Graphics.ScaleTransform(-1f, 1f);
    }

    e.Graphics.DrawImage(_frame, 0, 0, Width, Height);
  }

  static void RefreshGameWindow() {
    _refreshCounter++;
    if (_refreshCounter % 32 != 0 && _gameHwnd != IntPtr.Zero && IsWindow(_gameHwnd)) return;
    IntPtr found = FindGameWindow(_processName, _titleContains);
    if (found != IntPtr.Zero) _gameHwnd = found;
  }

  static void InstallAdHook() {
    _procHandle = GCHandle.Alloc(_hookProc);
    IntPtr[] moduleHandles = new IntPtr[] {
      Marshal.GetHINSTANCE(typeof(ScreenFlipOverlay).Module),
      GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName),
      IntPtr.Zero
    };

    foreach (IntPtr moduleHandle in moduleHandles) {
      IntPtr hook = SetWindowsHookEx(WH_KEYBOARD_LL, _hookProc, moduleHandle, 0);
      if (hook != IntPtr.Zero) {
        _hookId = hook;
        return;
      }
    }

    if (_procHandle.IsAllocated) _procHandle.Free();
    throw new InvalidOperationException("SetWindowsHookEx failed for A/D sync (error " + GetLastError() + ").");
  }

  static void UninstallAdHook() {
    if (_hookId != IntPtr.Zero) {
      UnhookWindowsHookEx(_hookId);
      _hookId = IntPtr.Zero;
    }
    if (_procHandle.IsAllocated) _procHandle.Free();
  }

  static bool IsGameForeground() {
    IntPtr fg = GetForegroundWindow();
    if (fg == IntPtr.Zero) return false;
    uint fgPid;
    GetWindowThreadProcessId(fg, out fgPid);
    foreach (Process proc in Process.GetProcessesByName(_processName)) {
      if ((uint)proc.Id == fgPid) return true;
    }
    return false;
  }

  static byte? SwapAdVk(uint vkCode) {
    byte vk = (byte)vkCode;
    if (vk == _vkLeft) return _vkRight;
    if (vk == _vkRight) return _vkLeft;
    return null;
  }

  static void SendSwappedKey(byte vk, bool keyDown) {
    ushort scan = MapVirtualKey(vk, MAPVK_VK_TO_VSC);
    uint flags = KEYEVENTF_SCANCODE;
    if (!keyDown) flags |= KEYEVENTF_KEYUP;

    var input = new INPUT {
      type = INPUT_KEYBOARD,
      U = new InputUnion {
        ki = new KEYBDINPUT {
          wVk = 0,
          wScan = scan,
          dwFlags = flags
        }
      }
    };
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));

    RefreshGameWindow();
    if (_gameHwnd != IntPtr.Zero) {
      IntPtr lDown = (IntPtr)(1u | ((uint)scan << 16));
      IntPtr lUp = (IntPtr)(1u | ((uint)scan << 16) | (1u << 30) | (1u << 31));
      uint msg = keyDown ? (uint)WM_KEYDOWN : (uint)WM_KEYUP;
      IntPtr lParam = keyDown ? lDown : lUp;
      PostMessage(_gameHwnd, msg, (IntPtr)vk, lParam);
    }
  }

  static bool IsKeyUp(IntPtr wParam) {
    return wParam == (IntPtr)WM_KEYUP || wParam == (IntPtr)WM_SYSKEYUP;
  }

  static bool IsKeyEvent(IntPtr wParam) {
    return wParam == (IntPtr)WM_KEYDOWN ||
           wParam == (IntPtr)WM_KEYUP ||
           wParam == (IntPtr)WM_SYSKEYDOWN ||
           wParam == (IntPtr)WM_SYSKEYUP;
  }

  static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (_syncAd && nCode >= 0 && IsKeyEvent(wParam) && IsGameForeground()) {
      KBDLLHOOKSTRUCT data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
      if ((data.flags & LLKHF_INJECTED) == 0) {
        byte? swapped = SwapAdVk(data.vkCode);
        if (swapped != null) {
          bool keyDown = !IsKeyUp(wParam);
          byte swappedVk = swapped.Value;
          ThreadPool.QueueUserWorkItem(_ => SendSwappedKey(swappedVk, keyDown));
          return (IntPtr)1;
        }
      }
    }

    return CallNextHookEx(_hookId, nCode, wParam, lParam);
  }
}
"@
}

try {
    [ScreenFlipOverlay]::Run(
        $ProcessName,
        $TitleContains,
        $Fps,
        $axisNormalized,
        $syncAdFlag,
        $vkLeft,
        $vkRight,
        $MonitorIndex
    )
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
