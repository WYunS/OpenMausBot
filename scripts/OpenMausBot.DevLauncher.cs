using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("OpenMausBot")]
[assembly: AssemblyProduct("OpenMausBot")]
[assembly: AssemblyDescription("OpenMausBot local development launcher")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class OpenMausBotDevLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            var scriptDirectory = AppDomain.CurrentDomain.BaseDirectory;
            var scriptPath = Path.Combine(scriptDirectory, "start-local-windows.ps1");
            if (!File.Exists(scriptPath))
            {
                throw new FileNotFoundException("The OpenMausBot development start script is missing.", scriptPath);
            }

            var windowsDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            var powershell = Path.Combine(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            var startInfo = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + scriptPath.Replace("\"", "\\\"") + "\"",
                WorkingDirectory = Path.GetDirectoryName(scriptDirectory.TrimEnd(Path.DirectorySeparatorChar)) ?? scriptDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            Process.Start(startInfo);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "OpenMausBot could not start.\n\n" + error.Message,
                "OpenMausBot",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}
