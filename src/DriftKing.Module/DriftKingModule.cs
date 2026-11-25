using DriftKing.Business;
using DriftKing.Data;
using DriftKing.Game;
using DriftKing.Web;
using MatGame.Sdk;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DriftKing;

/// <summary>
/// DriftKing as a game of MatGame: the player app at <c>/driftking/</c>, its API at <c>/driftking/api</c>, the hub at <c>/driftking/hub</c>,
/// the tables in the schema <c>driftking</c>, the admin pages under <c>/Admin/DriftKing</c>. The host (MatGame) signs the players in.
/// </summary>
public sealed class DriftKingModule : IGameModule
{
    /// <summary>The game id (path, schema, apps).</summary>
    public const string Id = "driftking";

    /// <summary>The protocol of the game: rises only with a change of the API or the hub old apps cannot follow.</summary>
    public const int Protocol = 1;

    public static readonly GameInfo Information = new(
        Id,
        "DriftKing",
        "Nacht-Drift auf Bergpass, Parkdeck, Hafen und im Neon-Viertel: eigene Autos, Tuning, Wettbewerbe – gegen Bots oder Freunde.",
        AppInfo.Version,
        Protocol,
        MinClient: null,
        Accent: "#ff2e88",
        Cover: "img/cover.png",
        Icon: "img/icon-512.png");

    public GameInfo Info => Information;

    public IReadOnlyList<AdminLink> Admin { get; } =
    [
        new("Übersicht", "/Admin/DriftKing", "dashboard"),
        new("Fahrer", "/Admin/DriftKing/Players", "users"),
        new("Läufe", "/Admin/DriftKing/Runs", "flag"),
        new("Autos", "/Admin/DriftKing/Cars", "car"),
        new("Strecken", "/Admin/DriftKing/Maps", "route"),
        new("Wettbewerbe", "/Admin/DriftKing/Competitions", "trophy"),
        new("Einstellungen", "/Admin/DriftKing/System", "settings"),
    ];

    public void AddServices(IServiceCollection services, GameEnvironment environment)
    {
        services.AddDbContext<AppDbContext>(o => AppDatabase.Configure(o, environment.ConnectionString));
        services.AddSingleton<RoomRegistry>();
        services.AddHostedService<GameTicker>();
        services.Configure<HubOptions<DriftHub>>(o => o.AddFilter(new HubErrors()));
    }

    public void MapGame(IEndpointRouteBuilder game, GameEnvironment environment)
    {
        game.MapApi(Info);
        game.MapHub<DriftHub>("/hub", o => o.ApplicationMaxBufferSize = 64 * 1024).RequireCors(MatGameProtocol.AppCorsPolicy);
        PlayerApp.Map(game, environment.BasePath);
    }

    public async Task StartAsync(IServiceProvider services, CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var log = scope.ServiceProvider.GetRequiredService<ILogger<DriftKingModule>>();
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.Database.MigrateAsync(ct);
                break;
            }
            catch (Exception e) when (attempt < 15 && !ct.IsCancellationRequested)
            {
                log.LogWarning("DriftKing: the database is not ready yet ({Message}), attempt {Attempt}", e.Message, attempt);
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
            }
        }

        await SeedLogic.EnsureAsync(db, Actor.System);
        var stale = await RunLogic.AbortStaleAsync(db, Actor.System);
        if (stale > 0)
        {
            log.LogInformation("DriftKing: {Count} runs of the last start were closed", stale);
        }
    }

    public Task<GameStats> StatsAsync(IServiceProvider services, CancellationToken ct)
    {
        var registry = services.GetRequiredService<RoomRegistry>();
        var rooms = registry.Rooms.Where(r => r.Status != RoomStatus.Closed).ToList();
        var players = rooms.Sum(r => r.Humans);
        var running = rooms.Count(r => r.Status is RoomStatus.Running or RoomStatus.Countdown);
        return Task.FromResult(new GameStats(players, running));
    }

    public async Task<GameProfile?> ProfileAsync(IServiceProvider services, long accountId, CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var player = await db.Players.AsNoTracking().FirstOrDefaultAsync(p => p.Id == accountId && p.UpdateState != UpdateState.Deleted, ct);
        return player is null
            ? null
            : new GameProfile(Progression.LevelOf(player.Xp), $"Bester Lauf {Plausibility.Describe(player.BestScore)} Punkte · {player.Wins} {(player.Wins == 1 ? "Sieg" : "Siege")}");
    }

    public async Task AccountDeletedAsync(IServiceProvider services, long accountId, CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await PlayerLogic.AccountDeletedAsync(db, Actor.System, accountId);
    }
}
