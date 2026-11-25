using System.Collections.Concurrent;
using DriftKing.Business;
using DriftKing.Data;
using Microsoft.AspNetCore.SignalR;

namespace DriftKing.Game;

/// <summary>
/// The rooms in memory (online): by code, which connection sits where, the room's messages, and the database work around a run (its record at the start,
/// the results at the end). A restart of the server ends every room (<see cref="RunLogic.AbortStaleAsync"/>).
/// </summary>
public sealed class RoomRegistry(IHubContext<DriftHub> hub, IServiceScopeFactory scopes, ILogger<RoomRegistry> log)
{
    private readonly ConcurrentDictionary<string, DriftRoom> _rooms = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, string> _byConnection = new();
    private readonly Lock _create = new();

    public IReadOnlyCollection<DriftRoom> Rooms => _rooms.Values.ToList();

    public DriftRoom Add(Func<string, DriftRoom> create)
    {
        lock (_create)
        {
            var code = RunRules.NewCode(Random.Shared, _rooms.ContainsKey);
            var room = create(code);
            _rooms[code] = room;
            return room;
        }
    }

    public DriftRoom? ByCode(string? code)
        => string.IsNullOrWhiteSpace(code) ? null : _rooms.TryGetValue(code.Trim(), out var room) && room.Status != RoomStatus.Closed ? room : null;

    public DriftRoom? OfConnection(string connection)
        => _byConnection.TryGetValue(connection, out var code) && _rooms.TryGetValue(code, out var room) ? room : null;

    public void Bind(string connection, DriftRoom room) => _byConnection[connection] = room.Code;

    public void Unbind(string connection) => _byConnection.TryRemove(connection, out _);

    /// <summary>Everybody in the room gets the room as it is now.</summary>
    public Task BroadcastAsync(DriftRoom room) => hub.Clients.Group(room.Code).SendAsync("Room", room.View(null, DateTime.UtcNow));

    /// <summary>The run started: its record in the database.</summary>
    public async Task StartedAsync(DriftRoom room)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            room.RunId = await RunLogic.StartedAsync(db, Actor.System, room);
        }
        catch (Exception e)
        {
            log.LogError(e, "DriftKing: the start of run {Code} was not saved", room.Code);
        }
    }

    /// <summary>The run is over: check and order the results, pay the players (once), tell everybody, close the room.</summary>
    public async Task EndAsync(DriftRoom room)
    {
        if (!room.TryEnd())
        {
            return;
        }

        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var settings = await SettingLogic.GetAsync(db);
            var outcomes = RunRules.Outcomes(room, DateTime.UtcNow, settings.MaxPointsPerSecond, settings.RewardFactor);
            var results = await RunLogic.FinishedAsync(db, Actor.System, room, outcomes);
            await hub.Clients.Group(room.Code).SendAsync("Results", results);
        }
        catch (Exception e)
        {
            log.LogError(e, "DriftKing: the results of run {Code} were not saved", room.Code);
            await hub.Clients.Group(room.Code).SendAsync("Closed", "Die Ergebnisse konnten nicht gespeichert werden.");
        }
        finally
        {
            room.Close();
        }
    }

    /// <summary>Forgets closed rooms and lobbies nobody used for half an hour; a run that never ended is marked aborted.</summary>
    public async Task SweepAsync(DateTime now)
    {
        foreach (var room in _rooms.Values.ToList())
        {
            var idleLobby = room.Status == RoomStatus.Lobby && now - room.LastActivity > TimeSpan.FromMinutes(30);
            var closed = room.Status == RoomStatus.Closed && now - room.LastActivity > TimeSpan.FromMinutes(1);
            if (!idleLobby && !closed)
            {
                continue;
            }

            _rooms.TryRemove(room.Code, out _);
            foreach (var pair in _byConnection.Where(p => p.Value.Equals(room.Code, StringComparison.OrdinalIgnoreCase)).ToList())
            {
                _byConnection.TryRemove(pair.Key, out _);
            }

            if (room.RunId != 0 && !room.Ended)
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    await RunLogic.AbortAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), Actor.System, room.Token);
                }
                catch (Exception e)
                {
                    log.LogWarning(e, "DriftKing: run {Code} could not be marked aborted", room.Code);
                }
            }
        }
    }
}

/// <summary>The clock of the rooms: every 250 ms each room ticks (countdown → running, the end of the time); finished runs are written; old rooms swept.</summary>
public sealed class GameTicker(RoomRegistry registry, ILogger<GameTicker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
        var sweep = DateTime.UtcNow;
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var now = DateTime.UtcNow;
            foreach (var room in registry.Rooms)
            {
                try
                {
                    var wasCountdown = room.Status == RoomStatus.Countdown;
                    if (room.Tick(now) || (room.Status == RoomStatus.Finished && !room.Ended))
                    {
                        await registry.EndAsync(room);
                    }
                    else if (wasCountdown && room.Status == RoomStatus.Running)
                    {
                        await registry.BroadcastAsync(room);
                    }
                }
                catch (Exception e)
                {
                    log.LogError(e, "DriftKing: the clock of room {Code} failed", room.Code);
                }
            }

            if (now - sweep > TimeSpan.FromSeconds(20))
            {
                sweep = now;
                await registry.SweepAsync(now);
            }
        }
    }
}
