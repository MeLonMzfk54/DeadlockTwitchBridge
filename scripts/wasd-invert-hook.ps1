param(
    [string]$ProcessName = "deadlock",
    [string]$TitleContains = "",
    [string]$ForwardKey = "w",
    [string]$BackKey = "s",
    [string]$LeftKey = "a",
    [string]$RightKey = "d"
)

function Get-VirtualKeyCode([string]$KeyName) {
    $normalized = $KeyName.Trim().ToUpperInvariant()
    if ($normalized -match '^[A-Z]$') {
        return [byte][char]$normalized
    }
    throw "Unsupported movement key '$KeyName'. Use A through Z."
}

$vkForward = Get-VirtualKeyCode $ForwardKey
$vkBack = Get-VirtualKeyCode $BackKey
$vkLeft = Get-VirtualKeyCode $LeftKey
$vkRight = Get-VirtualKeyCode $RightKey

if (-not ("WasdInvertHook" -as [type])) {
    Add-Type @"
using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class WasdInvertHook {
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

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct MSG {
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public POINT pt;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct POINT {
    public int x;
    public int y;
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

  [StructLayout(LayoutKind.Sequential)]
  struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

  [DllImport("user32.dll")]
  static extern bool TranslateMessage(ref MSG lpMsg);

  [DllImport("user32.dll")]
  static extern IntPtr DispatchMessage(ref MSG lpMsg);

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
  static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

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

  static readonly LowLevelKeyboardProc _proc = HookCallback;
  static IntPtr _hookId = IntPtr.Zero;
  static GCHandle _procHandle;
  static string _processName = "deadlock";
  static string _titleContains = "";
  static IntPtr _gameHwnd = IntPtr.Zero;
  static byte _vkForward;
  static byte _vkBack;
  static byte _vkLeft;
  static byte _vkRight;
  static int _refreshCounter;

  public static void Run(string processName, string titleContains, byte vkForward, byte vkBack, byte vkLeft, byte vkRight) {
    _processName = processName ?? "deadlock";
    _titleContains = titleContains ?? "";
    _vkForward = vkForward;
    _vkBack = vkBack;
    _vkLeft = vkLeft;
    _vkRight = vkRight;

    if (Process.GetProcessesByName(_processName).Length == 0) {
      throw new InvalidOperationException("Deadlock process not found.");
    }

    _gameHwnd = FindGameWindow(_processName, _titleContains);
    _procHandle = GCHandle.Alloc(_proc);
    _hookId = InstallHook();

    if (_hookId == IntPtr.Zero) {
      _procHandle.Free();
      throw new InvalidOperationException("SetWindowsHookEx failed (error " + GetLastError() + ").");
    }

    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0)) {
      TranslateMessage(ref msg);
      DispatchMessage(ref msg);
    }

    UnhookWindowsHookEx(_hookId);
    _hookId = IntPtr.Zero;
    if (_procHandle.IsAllocated) _procHandle.Free();
  }

  static string GetProcessName(uint pid) {
    try {
      return Process.GetProcessById((int)pid).ProcessName;
    } catch {
      return "";
    }
  }

  static IntPtr InstallHook() {
    IntPtr[] moduleHandles = new IntPtr[] {
      Marshal.GetHINSTANCE(typeof(WasdInvertHook).Module),
      GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName),
      IntPtr.Zero
    };

    foreach (IntPtr moduleHandle in moduleHandles) {
      IntPtr hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, moduleHandle, 0);
      if (hook != IntPtr.Zero) return hook;
    }

    return IntPtr.Zero;
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

  static void RefreshGameWindow() {
    _refreshCounter++;
    if (_refreshCounter % 32 != 0 && _gameHwnd != IntPtr.Zero) return;
    _gameHwnd = FindGameWindow(_processName, _titleContains);
  }

  // W -> S, S -> W, A -> D, D -> A
  static byte? SwapVk(uint vkCode) {
    byte vk = (byte)vkCode;
    if (vk == _vkForward) return _vkBack;
    if (vk == _vkBack) return _vkForward;
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
    if (nCode >= 0 && IsKeyEvent(wParam) && IsGameForeground()) {
      KBDLLHOOKSTRUCT data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
      if ((data.flags & LLKHF_INJECTED) == 0) {
        byte? swapped = SwapVk(data.vkCode);
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
    [WasdInvertHook]::Run($ProcessName, $TitleContains, $vkForward, $vkBack, $vkLeft, $vkRight)
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
