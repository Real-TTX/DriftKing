using System.Reflection;
using DriftKing.Local;
using MatGame.Shell;

namespace DriftKing.App;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args) => ShellApp.Run(args, new ShellOptions
    {
        GameId = "driftking",
        Title = "DriftKing",
        DefaultServer = typeof(Program).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "MatGameDefaultServer")?.Value,
        Repository = "Real-TTX/DriftKing",
        LocalGame = () => new DriftKingLocal(),
        Background = Color.FromArgb(0x0b, 0x0a, 0x18),
    });
}
