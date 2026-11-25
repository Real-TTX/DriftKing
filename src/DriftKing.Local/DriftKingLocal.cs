using System.Globalization;
using System.Reflection;
using System.Text.Json;
using DriftKing.Business;
using DriftKing.Data;
using DriftKing.Game;
using MatGame.Local;

namespace DriftKing.Local;

/// <summary>
/// DriftKing offline, inside the app (MatGame.Shell): answers every call the player app makes online – the game API (<see cref="RequestAsync"/>, the same paths and
/// shapes as <c>/driftking/api</c>) and the hub (<see cref="InvokeAsync"/>, the same methods as DriftHub) – with the same rules (<see cref="DriftRoom"/>, tuning,
/// prizes, medals) and sends the same hub messages through <see cref="ILocalHost.Emit"/>. The one local driver is a guest; the profile is a JSON file.
/// The catalogue is the seeded one (<see cref="SeedContent"/>). Offline there are only solo runs (free play, score attack, race, competitions) against bots.
/// </summary>
public sealed class DriftKingLocal : ILocalGame
{
    public const long LocalPlayerId = 1;
    public const string Connection = "local";

    private static readonly TimeSpan Interval = TimeSpan.FromMilliseconds(250);
    private static readonly string Version =
        typeof(DriftKingLocal).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "local";

    private readonly Lock _gate = new();
    private ILocalHost _host = null!;
    private LocalProfile _profile = null!;
    private List<Car> _cars = [];
    private List<Map> _maps = [];
    private List<Competition> _competitions = [];
    private DriftRoom? _room;
    private CancellationTokenSource? _clock;
    private Task? _clockTask;

    public string GameId => "driftking";

    /// <summary>The clock of the rooms (tests move it forward).</summary>
    internal Func<DateTime> Now { get; set; } = () => DateTime.UtcNow;

    /// <summary>The current room (tests look at it).</summary>
    internal DriftRoom? Room => _room;

    internal LocalProfile Profile => _profile;

    public Task StartAsync(ILocalHost host, CancellationToken ct)
    {
        _host = host;
        Directory.CreateDirectory(host.DataDirectory);
        _cars = Numbered(SeedContent.Cars());
        _maps = Numbered(SeedContent.Maps());
        _competitions = Numbered(SeedContent.Competitions(key => _maps.First(m => m.Key == key).Id));
        foreach (var competition in _competitions)
        {
            competition.Map = _maps.First(m => m.Id == competition.MapId);
        }

        _profile = LocalProfile.Load(host.DataDirectory, host.PlayerName, _cars);
        _clock = new CancellationTokenSource();
        _clockTask = RunClockAsync(_clock.Token);
        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        if (_clock is null)
        {
            return;
        }

        await _clock.CancelAsync();
        try
        {
            if (_clockTask is not null)
            {
                await _clockTask;
            }
        }
        catch (OperationCanceledException)
        {
            // the clock stopped
        }

        _clock.Dispose();
        _clock = null;
    }

    // ---------------------------------------------------------------- the game API

    public Task<LocalResponse> RequestAsync(string method, string path, JsonElement? body, CancellationToken ct)
    {
        try
        {
            var route = path.Split('?', 2)[0];
            var s = route.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            LocalResponse answer;
            lock (_gate)
            {
                answer = (method.ToUpperInvariant(), s) switch
                {
                    ("GET", ["session"]) => LocalResponse.Ok(new { signedIn = true, player = PlayerView(), version = Version, offline = true }),
                    ("GET", ["home"]) => Home(),
                    ("GET", ["catalog"]) => LocalResponse.Ok(Catalog()),
                    ("GET", ["garage"]) => LocalResponse.Ok(Garage()),
                    ("POST", ["garage", "buy"]) => Change(() => Buy(Read<BuyBody>(body).CarId)),
                    ("POST", ["garage", var id, "upgrade"]) => Change(() => Upgrade(Long(id), Read<UpgradeBody>(body).Part)),
                    ("PUT", ["garage", var id, "look"]) => Change(() => Look(Long(id), Read<LookBody>(body))),
                    ("PUT", ["garage", "select"]) => Change(() => Select(Read<SelectBody>(body).Id)),
                    ("GET", ["competitions"]) => LocalResponse.Ok(Competitions()),
                    ("GET", ["competitions", var id, "leaderboard"]) => LocalResponse.Ok(CompetitionBoard(Long(id))),
                    ("GET", ["profile"]) => LocalResponse.Ok(ProfileAnswer()),
                    ("GET", ["bests"]) => LocalResponse.Ok(_profile.Bests),
                    ("GET", ["leaderboard"]) => LocalResponse.Ok(Array.Empty<LeaderView>()),
                    ("GET", ["history"]) => LocalResponse.Ok(_profile.History),
                    ("GET", ["info"]) => LocalResponse.Ok(new { game = GameId, version = Version, rooms = _room is null ? 0 : 1, running = _room?.Status == RoomStatus.Running ? 1 : 0 }),
                    _ => LocalResponse.Error(404, "Das gibt es offline nicht."),
                };
            }

            return Task.FromResult(answer);
        }
        catch (BusinessException e)
        {
            var field = string.IsNullOrEmpty(e.Field) ? null : char.ToLower(e.Field[0], CultureInfo.InvariantCulture) + e.Field[1..];
            return Task.FromResult(LocalResponse.Error(400, e.Message, field));
        }
        catch (AccessDeniedException e)
        {
            return Task.FromResult(LocalResponse.Error(403, e.Message));
        }
        catch (Exception e) when (e is JsonException or FormatException or InvalidOperationException)
        {
            return Task.FromResult(LocalResponse.Error(400, "Die Anfrage ist unvollständig."));
        }
    }

    // ---------------------------------------------------------------- the hub

    public Task<JsonElement?> InvokeAsync(string method, IReadOnlyList<JsonElement> args, CancellationToken ct)
    {
        try
        {
            return Task.FromResult(Invoke(method, args));
        }
        catch (BusinessException e)
        {
            throw new InvalidOperationException(e.Message);
        }
        catch (AccessDeniedException e)
        {
            throw new InvalidOperationException(e.Message);
        }
    }

    private JsonElement? Invoke(string method, IReadOnlyList<JsonElement> args)
    {
        lock (_gate)
        {
            object? result = method switch
            {
                "ListRooms" => Array.Empty<RoomListView>(),
                "Solo" => Solo(Arg<RoomOptions>(args, 0)),
                "LeaveRoom" => Leave(),
                "State" => State(Arg<int>(args, 0), Arg<double[]>(args, 1)),
                "Finish" => Finish(Arg<int>(args, 0), Arg<FinishInput>(args, 1)),
                "CreateRoom" or "JoinRoom" or "Configure" or "Ready" or "ChangeCar" or "StartRoom"
                    => throw new BusinessException("Online-Räume gibt es nur mit einem Server – offline fährst du gegen Bots."),
                _ => throw new BusinessException($"Das gibt es offline nicht ({method})."),
            };
            return result is null ? null : JsonSerializer.SerializeToElement(result, LocalJson.Options);
        }
    }

    private RoomView Solo(RoomOptions options)
    {
        Leave();
        RoomSettings settings;
        if (options.CompetitionId is { } competitionId)
        {
            var competition = _competitions.FirstOrDefault(c => c.Id == competitionId && c.IsEnabled) ?? throw new BusinessException("Diesen Wettbewerb gibt es nicht.");
            if (Level() < competition.UnlockLevel)
            {
                throw new BusinessException($"Dieser Wettbewerb öffnet ab Level {competition.UnlockLevel}.");
            }

            settings = RoomSetup.For(competition, competition.Map!);
        }
        else
        {
            var map = (options.Map is null ? _maps.FirstOrDefault() : _maps.FirstOrDefault(m => m.Key == options.Map)) ?? throw new BusinessException("Diese Strecke gibt es nicht.");
            if (Level() < map.UnlockLevel)
            {
                throw new BusinessException($"{map.Name} gibt es erst ab Level {map.UnlockLevel}.");
            }

            settings = RoomSetup.For(map, options, 1, solo: true);
        }

        var now = Now();
        var room = new DriftRoom(RunRules.NewCode(Random.Shared, _ => false), settings, now);
        room.Join(LocalPlayerId, _profile.Player.DisplayName, SelectedCar(), Connection, now);
        var seed = Random.Shared.Next();
        room.Start(Connection, now, seat => GarageRules.BotCar(_cars, seat, settings.BotSkill, seed));
        room.RunId = _profile.NewId();
        _room = room;
        var view = room.View(LocalPlayerId, now);
        _host.Emit("Room", room.View(null, now));
        return view;
    }

    private object? Leave()
    {
        if (_room is null)
        {
            return null;
        }

        var room = _room;
        room.Leave(Connection, Now());
        if (room.Status == RoomStatus.Finished)
        {
            End(room);
        }

        _room = null;
        return null;
    }

    private object? State(int seat, double[] state)
    {
        _room?.AcceptState(Connection, seat, state, Now());
        return null;
    }

    private object? Finish(int seat, FinishInput result)
    {
        var room = _room;
        if (room is null)
        {
            return null;
        }

        var last = room.Finish(Connection, seat, result, Now());
        _host.Emit("Finished", seat);
        if (last)
        {
            End(room);
        }

        return null;
    }

    /// <summary>The end of a run: the same checks and prizes as online, written into the profile.</summary>
    private void End(DriftRoom room)
    {
        if (!room.TryEnd())
        {
            return;
        }

        var outcomes = RunRules.Outcomes(room, Now(), Plausibility.DefaultMaxPointsPerSecond, 100);
        var mine = outcomes.FirstOrDefault(o => o.Seat.PlayerId == LocalPlayerId);
        CompetitionOutcomeView? competitionOutcome = null;
        if (mine is not null)
        {
            RunRules.Apply(_profile.Player, mine, room.Settings.Mode, outcomes.Count);
            if (room.Settings.CompetitionId is { } id && _competitions.FirstOrDefault(c => c.Id == id) is { } competition)
            {
                var result = _profile.Competitions.FirstOrDefault(r => r.CompetitionId == id);
                if (result is null)
                {
                    result = new CompetitionResult { Id = _profile.NewId(), CompetitionId = id, PlayerId = LocalPlayerId };
                    _profile.Competitions.Add(result);
                }

                competitionOutcome = RunRules.ApplyCompetition(_profile.Player, competition, result, mine);
            }

            _profile.History.Insert(0, new HistoryView(room.Token, Now(), room.Settings.Map.Name, Looks.ModeKey(room.Settings.Mode), mine.Place, outcomes.Count,
                mine.Score, mine.TimeMs, mine.Money, mine.Xp, room.Settings.CompetitionName));
            if (_profile.History.Count > 30)
            {
                _profile.History.RemoveRange(30, _profile.History.Count - 30);
            }

            RememberBest(room, mine);
            _profile.Save();
        }

        room.Close();
        _host.Emit("Results", RunRules.View(room, outcomes, competitionOutcome));
    }

    private void RememberBest(DriftRoom room, Outcome mine)
    {
        if (mine.Flagged)
        {
            return;
        }

        var mode = Looks.ModeKey(room.Settings.Mode);
        var best = _profile.Bests.FirstOrDefault(b => b.Map == room.Settings.Map.Key && b.Mode == mode);
        var time = mine.Finished ? mine.TimeMs : null;
        var merged = best is null
            ? new BestView(room.Settings.Map.Key, mode, mine.Score, time, mine.BestLapMs)
            : new BestView(best.Map, best.Mode, Math.Max(best.Score, mine.Score), Min(best.TimeMs, time), Min(best.BestLapMs, mine.BestLapMs));
        _profile.Bests.Remove(best!);
        _profile.Bests.Add(merged);
    }

    private async Task RunClockAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(ct))
        {
            lock (_gate)
            {
                try
                {
                    var room = _room;
                    if (room is null)
                    {
                        continue;
                    }

                    var wasCountdown = room.Status == RoomStatus.Countdown;
                    if (room.Tick(Now()) || (room.Status == RoomStatus.Finished && !room.Ended))
                    {
                        End(room);
                    }
                    else if (wasCountdown && room.Status == RoomStatus.Running)
                    {
                        _host.Emit("Room", room.View(null, Now()));
                    }
                }
                catch (Exception e)
                {
                    _host.Log($"DriftKing: the clock failed: {e.Message}");
                }
            }
        }
    }

    // ---------------------------------------------------------------- answers

    private LocalResponse Home() => LocalResponse.Ok(new
    {
        player = PlayerView(),
        stats = Views.Stats(_profile.Player, null),
        car = SelectedCar(),
        announcement = string.Empty,
        history = _profile.History.Take(6).ToList(),
        settings = new { maxPlayers = 1, guestsCreateRooms = false },
    });

    private CatalogView Catalog()
    {
        var level = Level();
        var owned = _profile.Garage.Select(g => g.CarId).ToHashSet();
        return new CatalogView(_cars.Where(c => c.IsEnabled).Select(c => Views.Dealer(c, owned.Contains(c.Id), level)).ToList(),
            _maps.Where(m => m.IsEnabled).Select(m => Views.Map(m, level)).ToList());
    }

    private GarageView Garage()
        => new(_profile.Garage.Select(g => Views.GarageCar(g, CarOf(g))).OrderBy(g => _cars.FindIndex(c => c.Id == g.Car.CarId)).ToList(),
            _profile.Player.SelectedGarageCarId, _profile.Player.Money);

    private GarageView Buy(long carId)
    {
        var car = _cars.FirstOrDefault(c => c.Id == carId) ?? throw new BusinessException("Dieses Auto gibt es nicht.");
        var bought = GarageRules.Buy(_profile.Player, car, _profile.Garage);
        bought.Id = _profile.NewId();
        bought.Car = null;
        _profile.Garage.Add(bought);
        _profile.Player.SelectedGarageCarId = bought.Id;
        return Garage();
    }

    private GarageView Upgrade(long id, string? partKey)
    {
        var part = Views.PartOf(partKey) ?? throw new BusinessException("Dieses Teil gibt es nicht.", "part");
        var garage = Own(id);
        GarageRules.Upgrade(_profile.Player, garage, CarOf(garage), part);
        return Garage();
    }

    private GarageView Look(long id, LookBody body)
    {
        GarageRules.SetLook(Own(id), body.Paint, body.Rims, body.Neon, body.Decal, body.Number);
        return Garage();
    }

    private GarageView Select(long id)
    {
        _profile.Player.SelectedGarageCarId = Own(id).Id;
        return Garage();
    }

    private IReadOnlyList<CompetitionView> Competitions()
    {
        var level = Level();
        return _competitions.Where(c => c.IsEnabled).Select(c => Views.Competition(c, c.Map!, level, _profile.Competitions.FirstOrDefault(r => r.CompetitionId == c.Id)))
            .ToList();
    }

    private IReadOnlyList<LeaderView> CompetitionBoard(long id)
    {
        var mine = _profile.Competitions.FirstOrDefault(r => r.CompetitionId == id);
        return mine is null
            ? []
            : [new LeaderView(1, LocalPlayerId, _profile.Player.DisplayName, Level(), mine.BestScore, mine.BestTimeMs, Views.MedalKey(mine.Medal), true)];
    }

    private ProfileView ProfileAnswer()
        => new(PlayerView(), Views.Stats(_profile.Player, null), _profile.Competitions.Count(r => r.Medal == Medal.Gold),
            _profile.Competitions.Count(r => r.Medal == Medal.Silver), _profile.Competitions.Count(r => r.Medal == Medal.Bronze), _profile.Garage.Count);

    private PlayerView PlayerView() => Views.Player(_profile.Player, false);

    private CarView SelectedCar()
    {
        var garage = _profile.Garage.FirstOrDefault(g => g.Id == _profile.Player.SelectedGarageCarId) ?? _profile.Garage.FirstOrDefault()
                     ?? throw new BusinessException("Deine Garage ist leer.");
        return Views.Car(garage, CarOf(garage));
    }

    private LocalResponse Change(Func<GarageView> change)
    {
        var result = change();
        _profile.Save();
        return LocalResponse.Ok(result);
    }

    private GarageCar Own(long id) => _profile.Garage.FirstOrDefault(g => g.Id == id) ?? throw new BusinessException("Dieses Auto steht nicht in deiner Garage.");

    private Car CarOf(GarageCar garage) => _cars.FirstOrDefault(c => c.Id == garage.CarId) ?? _cars[0];

    private int Level() => Progression.LevelOf(_profile.Player.Xp);

    private static int? Min(int? a, int? b) => a is null ? b : b is null ? a : Math.Min(a.Value, b.Value);

    private static List<T> Numbered<T>(IEnumerable<T> items) where T : Entity
    {
        long id = 1;
        return items.Select(item =>
        {
            item.Id = id++;
            return item;
        }).ToList();
    }

    private static T Read<T>(JsonElement? body) => body is { } b ? b.Deserialize<T>(LocalJson.Options) ?? throw new FormatException() : throw new FormatException();

    private static T Arg<T>(IReadOnlyList<JsonElement> args, int index)
        => index < args.Count ? args[index].Deserialize<T>(LocalJson.Options)! : throw new BusinessException("Es fehlt eine Angabe.");

    private static long Long(string value) => long.Parse(value, CultureInfo.InvariantCulture);

    private sealed record BuyBody(long CarId);

    private sealed record UpgradeBody(string? Part);

    private sealed record LookBody(string? Paint, string? Rims, string? Neon, string? Decal, int? Number);

    private sealed record SelectBody(long Id);
}
