# CI-only launcher: remove administrator rights from the installed GUI app.
# WebView2 150+ intentionally ignores environment overrides on elevated hosts.
# Keep that protection intact and exercise the installed app at normal user IL.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Use only on disposable GitHub runners' }
if (!$env:PL_NATIVE_PROCESS_EVIDENCE -or !$env:PL_NATIVE_APP) { throw 'Native test environment missing' }

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

public static class NativeStandardUser {
    [StructLayout(LayoutKind.Sequential)]
    struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo {
        public uint cb;
        public string reserved, desktop, title;
        public uint x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
        public ushort showWindow, reserved2Length;
        public IntPtr reserved2, stdInput, stdOutput, stdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process, thread; public uint processId, threadId; }

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool CreateRestrictedToken(IntPtr token, uint flags, uint disabledCount, IntPtr disabled,
        uint deletedCount, IntPtr deleted, uint restrictedCount, IntPtr restricted, out IntPtr result);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ConvertStringSidToSid(string value, out IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern uint GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SetTokenInformation(IntPtr token, int kind, ref SidAndAttributes value, uint length);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr value, uint length, out uint needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessAsUser(IntPtr token, string application, StringBuilder command,
        IntPtr processSecurity, IntPtr threadSecurity, bool inheritHandles, uint flags,
        IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")]
    static extern IntPtr LocalFree(IntPtr pointer);

    static void Check(bool ok, string operation) {
        if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }
    static string Integrity(IntPtr token) {
        uint length;
        GetTokenInformation(token, 25, IntPtr.Zero, 0, out length); // TokenIntegrityLevel
        if (length == 0) throw new InvalidOperationException("Token integrity unavailable");
        IntPtr buffer = Marshal.AllocHGlobal((int)length);
        try {
            Check(GetTokenInformation(token, 25, buffer, length, out length), "Read integrity");
            return new SecurityIdentifier(Marshal.ReadIntPtr(buffer)).Value;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static bool IsAdmin(IntPtr token) {
        using (var identity = new WindowsIdentity(token))
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }
    public static int Run(string application, string directory, string evidence) {
        IntPtr original = IntPtr.Zero, limited = IntPtr.Zero, medium = IntPtr.Zero, childToken = IntPtr.Zero;
        ProcessInfo child = new ProcessInfo();
        bool exited = false;
        try {
            Check(OpenProcessToken(Process.GetCurrentProcess().Handle, 0x02000000, out original), "Open runner token");
            string parentIntegrity = Integrity(original);
            // LUA_TOKEN + DISABLE_MAX_PRIVILEGE only. Never use SANDBOX_INERT.
            Check(CreateRestrictedToken(original, 0x5, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out limited), "Remove administrator privileges");
            Check(ConvertStringSidToSid("S-1-16-8192", out medium), "Create medium integrity SID");
            var label = new SidAndAttributes { Sid = medium, Attributes = 0x20 };
            Check(SetTokenInformation(limited, 25, ref label, (uint)Marshal.SizeOf(label) + GetLengthSid(medium)), "Lower token integrity");
            if (Integrity(limited) != "S-1-16-8192" || IsAdmin(limited))
                throw new InvalidOperationException("App token must be medium integrity without administrator membership");
            var startup = new StartupInfo { cb = (uint)Marshal.SizeOf(typeof(StartupInfo)) };
            var command = new StringBuilder("\"" + application + "\"");
            // Suspend until the actual child token is verified. Environment and
            // user profile remain those of this disposable runner account.
            Check(CreateProcessAsUser(limited, application, command, IntPtr.Zero, IntPtr.Zero, false, 0x4,
                IntPtr.Zero, directory, ref startup, out child), "Start standard user app");
            Check(OpenProcessToken(child.process, 0xa, out childToken), "Inspect child token");
            string childIntegrity = Integrity(childToken);
            bool childAdmin = IsAdmin(childToken);
            if (childIntegrity != "S-1-16-8192" || childAdmin)
                throw new InvalidOperationException("Native app retained elevated privileges");
            File.WriteAllText(evidence, "{\"parentIntegrity\":\"" + parentIntegrity + "\",\"childIntegrity\":\"" +
                childIntegrity + "\",\"childAdministrator\":false,\"childPid\":" + child.processId + "}");
            Console.WriteLine(File.ReadAllText(evidence));
            using (var process = Process.GetProcessById((int)child.processId)) {
                if (ResumeThread(child.thread) == UInt32.MaxValue) Check(false, "Resume native app");
                if (!process.WaitForExit(7 * 60 * 1000)) throw new TimeoutException("Native app session exceeded 7 minutes; inspect progress and final evidence separately");
                exited = true;
                return process.ExitCode;
            }
        } finally {
            if (child.process != IntPtr.Zero && !exited) TerminateProcess(child.process, 1);
            if (childToken != IntPtr.Zero) CloseHandle(childToken);
            if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
            if (child.process != IntPtr.Zero) CloseHandle(child.process);
            if (medium != IntPtr.Zero) LocalFree(medium);
            if (limited != IntPtr.Zero) CloseHandle(limited);
            if (original != IntPtr.Zero) CloseHandle(original);
        }
    }
}
'@

$code = [NativeStandardUser]::Run($env:PL_NATIVE_APP, $PWD.Path, $env:PL_NATIVE_PROCESS_EVIDENCE)
exit $code
