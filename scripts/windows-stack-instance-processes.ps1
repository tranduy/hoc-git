$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$query = [string]$env:TOOL_CHENH_STACK_INSTANCE_QUERY
if ($query -notmatch '^[A-Za-z0-9._-]{8,128}$') {
  throw "STACK_INSTANCE_ID_INVALID"
}

if (-not ("ToolChenh.ProcessEnvironment" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace ToolChenh {
  public static class ProcessEnvironment {
    private const uint PROCESS_QUERY_INFORMATION = 0x0400;
    private const uint PROCESS_VM_READ = 0x0010;
    private const int ProcessBasicInformation = 0;
    private const int ProcessWow64Information = 26;
    private const int MaxEnvironmentBytes = 1024 * 1024;

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_BASIC_INFORMATION {
      public IntPtr Reserved1;
      public IntPtr PebBaseAddress;
      public IntPtr Reserved2_0;
      public IntPtr Reserved2_1;
      public IntPtr UniqueProcessId;
      public IntPtr Reserved3;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsWow64Process(IntPtr handle, out bool isWow64);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer,
      int size, out IntPtr bytesRead);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr process, int informationClass,
      ref PROCESS_BASIC_INFORMATION information, int size, out int returnLength);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr process, int informationClass,
      ref IntPtr information, int size, out int returnLength);

    private static byte[] ReadBytes(IntPtr process, IntPtr address, int requested) {
      int size = requested;
      while (size >= 2) {
        byte[] buffer = new byte[size];
        IntPtr bytesRead;
        if (ReadProcessMemory(process, address, buffer, size, out bytesRead) && bytesRead.ToInt64() >= 2) {
          int count = checked((int)bytesRead.ToInt64());
          if (count == buffer.Length) return buffer;
          byte[] exact = new byte[count];
          Buffer.BlockCopy(buffer, 0, exact, 0, count);
          return exact;
        }
        size /= 2;
      }
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    private static IntPtr ReadPointer(IntPtr process, IntPtr address, int pointerSize) {
      byte[] value = ReadBytes(process, address, pointerSize);
      if (pointerSize == 4) return new IntPtr(BitConverter.ToUInt32(value, 0));
      return new IntPtr(BitConverter.ToInt64(value, 0));
    }

    private static IntPtr EnvironmentAddress(IntPtr process) {
      bool wow64;
      if (!IsWow64Process(process, out wow64)) throw new Win32Exception(Marshal.GetLastWin32Error());
      int pointerSize = IntPtr.Size;
      IntPtr peb;
      if (Environment.Is64BitOperatingSystem && wow64) {
        pointerSize = 4;
        peb = IntPtr.Zero;
        int ignored;
        int status = NtQueryInformationProcess(process, ProcessWow64Information, ref peb, IntPtr.Size,
          out ignored);
        if (status != 0 || peb == IntPtr.Zero) throw new InvalidOperationException("WOW64_PEB_UNAVAILABLE");
      } else {
        PROCESS_BASIC_INFORMATION information = new PROCESS_BASIC_INFORMATION();
        int ignored;
        int status = NtQueryInformationProcess(process, ProcessBasicInformation, ref information,
          Marshal.SizeOf<PROCESS_BASIC_INFORMATION>(), out ignored);
        if (status != 0 || information.PebBaseAddress == IntPtr.Zero) {
          throw new InvalidOperationException("PEB_UNAVAILABLE");
        }
        peb = information.PebBaseAddress;
      }
      IntPtr parameters = ReadPointer(process, IntPtr.Add(peb, pointerSize == 8 ? 0x20 : 0x10), pointerSize);
      if (parameters == IntPtr.Zero) throw new InvalidOperationException("PROCESS_PARAMETERS_UNAVAILABLE");
      IntPtr environment = ReadPointer(process,
        IntPtr.Add(parameters, pointerSize == 8 ? 0x80 : 0x48), pointerSize);
      if (environment == IntPtr.Zero) throw new InvalidOperationException("ENVIRONMENT_UNAVAILABLE");
      return environment;
    }

    public static string[] Read(int processId) {
      IntPtr process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, processId);
      if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        IntPtr environment = EnvironmentAddress(process);
        List<byte> bytes = new List<byte>();
        int consecutiveNulls = 0;
        for (int offset = 0; offset < MaxEnvironmentBytes;) {
          byte[] chunk = ReadBytes(process, IntPtr.Add(environment, offset),
            Math.Min(4096, MaxEnvironmentBytes - offset));
          int evenLength = chunk.Length - (chunk.Length % 2);
          for (int index = 0; index < evenLength; index += 2) {
            bytes.Add(chunk[index]);
            bytes.Add(chunk[index + 1]);
            ushort unit = BitConverter.ToUInt16(chunk, index);
            consecutiveNulls = unit == 0 ? consecutiveNulls + 1 : 0;
            if (consecutiveNulls == 2) {
              return Encoding.Unicode.GetString(bytes.ToArray()).Split(new[] { '\0' },
                StringSplitOptions.RemoveEmptyEntries);
            }
          }
          offset += evenLength;
        }
        throw new InvalidOperationException("ENVIRONMENT_TOO_LARGE_OR_UNTERMINATED");
      } finally {
        CloseHandle(process);
      }
    }
  }
}
'@
}

$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$marker = "TOOL_CHENH_STACK_INSTANCE_ID=$query"
$matches = [System.Collections.Generic.List[object]]::new()

foreach ($candidate in @(Get-CimInstance Win32_Process)) {
  try {
    $candidateBirth = $candidate.CreationDate.ToUniversalTime().ToString('o')
  } catch {
    throw "STACK_INSTANCE_DISCOVERY_UNAVAILABLE"
  }
  $environment = $null
  try {
    $environment = [ToolChenh.ProcessEnvironment]::Read([int]$candidate.ProcessId)
  } catch {
    $owner = $null
    try { $owner = Invoke-CimMethod -InputObject $candidate -MethodName GetOwnerSid } catch { }
    $current = $null
    try {
      $current = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$candidate.ProcessId)"
    } catch {
      throw "STACK_INSTANCE_DISCOVERY_UNAVAILABLE"
    }
    if ($null -eq $current) { continue }
    try {
      $currentBirth = $current.CreationDate.ToUniversalTime().ToString('o')
    } catch {
      throw "STACK_INSTANCE_DISCOVERY_UNAVAILABLE"
    }
    if ($candidateBirth -ne $currentBirth) { throw "STACK_INSTANCE_DISCOVERY_UNAVAILABLE" }
    if ($null -ne $owner -and [int]$owner.ReturnValue -eq 0 -and [string]$owner.Sid -ne $currentSid) {
      continue
    }
    throw "STACK_INSTANCE_DISCOVERY_UNAVAILABLE"
  }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$candidate.ProcessId)"
  if ($null -eq $current) { continue }
  $currentBirth = $current.CreationDate.ToUniversalTime().ToString('o')
  if ($candidateBirth -ne $currentBirth) { throw "STACK_INSTANCE_DISCOVERY_UNAVAILABLE" }
  if ($environment -cnotcontains $marker) { continue }
  $matches.Add([pscustomobject]@{
    pid = [int]$current.ProcessId
    parentPid = [int]$current.ParentProcessId
    executablePath = [string]$current.ExecutablePath
    commandLine = [string]$current.CommandLine
    birthMarker = $currentBirth
  })
}

ConvertTo-Json -InputObject @($matches) -Compress
