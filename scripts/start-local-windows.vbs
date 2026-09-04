Option Explicit

Dim shell, files, scriptDir, powershell, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

scriptDir = files.GetParentFolderName(WScript.ScriptFullName)
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
command = Chr(34) & powershell & Chr(34) _
  & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " _
  & Chr(34) & scriptDir & "\start-local-windows.ps1" & Chr(34)

' WScript has no console window, so a desktop double-click never flashes cmd.
shell.Run command, 0, False
