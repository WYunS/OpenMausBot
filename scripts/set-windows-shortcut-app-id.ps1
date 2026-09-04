param(
  [Parameter(Mandatory = $true)][string]$ShortcutPath,
  [Parameter(Mandatory = $true)][string]$AppId,
  [string]$RelaunchCommand,
  [string]$RelaunchDisplayName,
  [string]$RelaunchIcon
)

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { exit 0 }
if (-not (Test-Path -LiteralPath $ShortcutPath)) { exit 0 }

if (-not ('OpenMausBot.ShortcutProperties' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace OpenMausBot {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  internal class ShellLink { }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
  internal interface IPersistFile {
    void GetClassID(out Guid classId);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string fileName);
  }

  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  internal struct PropertyKey {
    internal Guid formatId;
    internal uint propertyId;
    internal PropertyKey(Guid formatId, uint propertyId) {
      this.formatId = formatId;
      this.propertyId = propertyId;
    }
  }

  [StructLayout(LayoutKind.Explicit)]
  internal struct PropertyValue {
    [FieldOffset(0)] internal ushort type;
    [FieldOffset(8)] internal IntPtr pointer;
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  internal interface IPropertyStore {
    uint GetCount();
    void GetAt(uint index, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropertyValue value);
    void SetValue(ref PropertyKey key, ref PropertyValue value);
    void Commit();
  }

  public static class ShortcutProperties {
    private static void SetString(IPropertyStore store, uint propertyId, string text) {
      if (String.IsNullOrEmpty(text)) return;
      var key = new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), propertyId);
      var value = new PropertyValue {
        type = (ushort)VarEnum.VT_LPWSTR,
        pointer = Marshal.StringToCoTaskMemUni(text),
      };
      try {
        store.SetValue(ref key, ref value);
      } finally {
        Marshal.FreeCoTaskMem(value.pointer);
      }
    }

    public static void SetAppUserModelProperties(string shortcutPath, string appId, string relaunchCommand, string displayName, string icon) {
      var link = new ShellLink();
      try {
        ((IPersistFile)link).Load(shortcutPath, 2);
        var store = (IPropertyStore)link;
        SetString(store, 5, appId);
        SetString(store, 2, relaunchCommand);
        SetString(store, 4, displayName);
        SetString(store, 3, icon);
        store.Commit();
        ((IPersistFile)link).Save(shortcutPath, true);
      } finally {
        Marshal.FinalReleaseComObject(link);
      }
    }
  }
}
'@
}

[OpenMausBot.ShortcutProperties]::SetAppUserModelProperties(
  $ShortcutPath,
  $AppId,
  $RelaunchCommand,
  $RelaunchDisplayName,
  $RelaunchIcon
)
