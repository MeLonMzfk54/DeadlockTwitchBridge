param(
    [Parameter(Mandatory = $true)][byte]$VkCode,
    [string]$ProcessName = "deadlock",
    [string]$TitleContains = "",
    [switch]$CheckOnly
)

if (-not ("GameKeySender" -as [type])) {
    Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class GameKeySender {
  private const uint INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint WM_KEYDOWN = 0x0100;
  private const uint WM_KEYUP = 0x0101;
  private const int SW_RESTORE = 9;

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

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

  [DllImport("user32.dll")]
  static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll")]
  static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("user32.dll")]
  static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

  [DllImport("user32.dll")]
  static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  static extern ushort MapVirtualKey(ushort uCode, uint uMapType);

  static string GetProcessName(uint pid) {
    try {
      return Process.GetProcessById((int)pid).ProcessName;
    } catch {
      return "";
    }
  }

  public static IntPtr FindGameWindow(string processName, string titleContains) {
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

  static void RaiseGameWindow(IntPtr hWnd) {
    if (IsIconic(hWnd)) {
      ShowWindow(hWnd, SW_RESTORE);
    }
    try {
      SwitchToThisWindow(hWnd, true);
    } catch { }
    SetForegroundWindow(hWnd);
    BringWindowToTop(hWnd);
    Thread.Sleep(60);
  }

  static uint SendHardwareKey(byte vk) {
    var down = new INPUT {
      type = INPUT_KEYBOARD,
      U = new InputUnion {
        ki = new KEYBDINPUT { wVk = vk, dwFlags = 0 }
      }
    };
    var up = new INPUT {
      type = INPUT_KEYBOARD,
      U = new InputUnion {
        ki = new KEYBDINPUT { wVk = vk, dwFlags = KEYEVENTF_KEYUP }
      }
    };

    uint sent = SendInput(1, new[] { down }, Marshal.SizeOf(typeof(INPUT)));
    Thread.Sleep(15);
    sent += SendInput(1, new[] { up }, Marshal.SizeOf(typeof(INPUT)));
    return sent;
  }

  static void PostKeyToWindow(IntPtr hWnd, byte vk) {
    ushort scan = MapVirtualKey(vk, 0);
    IntPtr lDown = (IntPtr)(1u | ((uint)scan << 16));
    IntPtr lUp = (IntPtr)(1u | ((uint)scan << 16) | (1u << 30) | (1u << 31));
    PostMessage(hWnd, WM_KEYDOWN, (IntPtr)vk, lDown);
    Thread.Sleep(15);
    PostMessage(hWnd, WM_KEYUP, (IntPtr)vk, lUp);
  }

  static bool IsProcessForeground(uint pid) {
    IntPtr fg = GetForegroundWindow();
    if (fg == IntPtr.Zero) return false;
    uint fgPid;
    GetWindowThreadProcessId(fg, out fgPid);
    return fgPid == pid;
  }

  public static bool IsProcessRunning(string processName) {
    return Process.GetProcessesByName(processName).Length > 0;
  }

  public static string Press(byte vk, string processName, string titleContains) {
    IntPtr hwnd = FindGameWindow(processName, titleContains);
    if (hwnd == IntPtr.Zero) return "notfound";

    uint gamePid;
    GetWindowThreadProcessId(hwnd, out gamePid);

    RaiseGameWindow(hwnd);
    Thread.Sleep(50);

    uint sendInputCount = SendHardwareKey(vk);
    if (sendInputCount < 2) {
      PostKeyToWindow(hwnd, vk);
    }

    bool focused = IsProcessForeground(gamePid);
    bool keySent = sendInputCount >= 2 || sendInputCount > 0;
    return focused ? "ok" : (keySent ? "sent" : "failed");
  }
}
"@
}

if ($CheckOnly) {
    $running = [GameKeySender]::IsProcessRunning($ProcessName)
    Write-Output (@{
        processRunning = $running
        windowFound    = ([GameKeySender]::FindGameWindow($ProcessName, $TitleContains) -ne [IntPtr]::Zero)
    } | ConvertTo-Json -Compress)
    exit 0
}

$result = [GameKeySender]::Press($VkCode, $ProcessName, $TitleContains)

$windowFound = $result -ne "notfound"
$focused = $result -eq "ok"
$keySent = $result -in @("ok", "sent")

Write-Output (@{
    windowFound    = $windowFound
    focused        = $focused
    keySent        = $keySent
    sendInputCount = if ($keySent) { 2 } else { 0 }
    status         = $result
} | ConvertTo-Json -Compress)
