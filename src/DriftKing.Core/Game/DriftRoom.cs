using DriftKing.Business;
using DriftKing.Data;

namespace DriftKing.Game;

/// <summary>The life of a room: players gather (lobby), the host starts (countdown), everybody drives (running), the results are in (finished).</summary>
public enum RoomStatus
{
    Lobby,
    Countdown,
    Running,
    Finished,
    Closed,
}

/// <summary>The fixed facts of a room (what, where, how long). The server makes them from <see cref="RoomOptions"/>, a competition, and the settings.</summary>
public sealed record RoomSettings(
    MapRef Map,
    double LengthM,
    GameMode Mode,
    int Laps,
    int DurationS,
    int Bots,
    int BotSkill,
    bool IsPrivate,
    bool IsSolo,
    int MaxPlayers,
    long? CompetitionId = null,
    string? CompetitionName = null,
    GoalsView? Goals = null);

/// <summary>A place in a room: a player (with the connection that drives it) or a bot (driven by the host's browser).</summary>
public sealed class Seat
{
    public int Number { get; init; }

    public long? PlayerId { get; init; }

    public string Name { get; init; } = string.Empty;

    public bool IsBot => PlayerId is null;

    /// <summary>Bots: 1 to 10.</summary>
    public int Skill { get; init; }

    public CarView Car { get; set; } = null!;

    public string? ConnectionId { get; set; }

    public bool Ready { get; set; }

    public bool Connected { get; set; } = true;

    public FinishInput? Result { get; set; }

    public DateTime? FinishedAt { get; set; }

    /// <summary>The last state the seat sent (packed array, see docs/PROTOCOL.md): the fallback result of a car that never finished.</summary>
    public double[]? LastState { get; set; }
}

/// <summary>
/// One room in memory (online in the plugin's registry, offline in the app's local game). Thread safe: every method locks the room.
/// The browsers simulate their own cars (the host's browser the bots too) and report states and results; the room decides who may send what,
/// when the run starts and ends, and the order. Points and times are checked in <see cref="RunRules"/>.
/// </summary>
public sealed class DriftRoom
{
    /// <summary>Index of the points in a packed state.</summary>
    public const int StateScore = 12;

    /// <summary>Index of the lap in a packed state.</summary>
    public const int StateLap = 14;

    /// <summary>Index of the progress (0..1 of a lap) in a packed state.</summary>
    public const int StateProgress = 15;

    public const int MaxStateLength = 24;

    public static readonly TimeSpan CountdownTime = TimeSpan.FromSeconds(4);

    private readonly object _lock = new();
    private readonly List<Seat> _seats = [];
    private int _ended;

    public DriftRoom(string code, RoomSettings settings, DateTime now)
    {
        Code = code;
        Settings = settings;
        CreatedAt = now;
        LastActivity = now;
    }

    public string Code { get; }

    public Guid Token { get; } = Guid.NewGuid();

    public RoomSettings Settings { get; private set; }

    public RoomStatus Status { get; private set; } = RoomStatus.Lobby;

    public int HostSeat { get; private set; }

    public DateTime CreatedAt { get; }

    public DateTime LastActivity { get; private set; }

    public DateTime? StartAt { get; private set; }

    /// <summary>The id of the run in the database (or the offline history) once it started.</summary>
    public long RunId { get; set; }

    public int Humans
    {
        get
        {
            lock (_lock)
            {
                return _seats.Count(s => !s.IsBot && s.Connected);
            }
        }
    }

    public IReadOnlyList<Seat> Seats
    {
        get
        {
            lock (_lock)
            {
                return _seats.ToList();
            }
        }
    }

    /// <summary>The seat of a player, or null.</summary>
    public Seat? SeatOf(long playerId)
    {
        lock (_lock)
        {
            return _seats.FirstOrDefault(s => s.PlayerId == playerId);
        }
    }

    public Seat? SeatOfConnection(string connectionId)
    {
        lock (_lock)
        {
            return _seats.FirstOrDefault(s => s.ConnectionId == connectionId && s.Connected);
        }
    }

    /// <summary>Takes a player in (in the lobby), or gives a player who drops back in his seat (any time).</summary>
    public Seat Join(long playerId, string name, CarView car, string connectionId, DateTime now)
    {
        lock (_lock)
        {
            LastActivity = now;
            var mine = _seats.FirstOrDefault(s => s.PlayerId == playerId);
            if (mine is not null)
            {
                mine.ConnectionId = connectionId;
                mine.Connected = true;
                if (Status == RoomStatus.Lobby)
                {
                    mine.Car = car;
                }

                return mine;
            }

            if (Status is not RoomStatus.Lobby)
            {
                throw new BusinessException("Dieser Lauf hat schon begonnen.");
            }

            if (Settings.IsSolo && _seats.Any(s => !s.IsBot))
            {
                throw new BusinessException("Das ist ein Solo-Lauf.");
            }

            if (_seats.Count(s => !s.IsBot) >= Settings.MaxPlayers)
            {
                throw new BusinessException("Der Raum ist voll.");
            }

            var seat = new Seat { Number = FreeSeatNumber(), PlayerId = playerId, Name = name, Car = car, ConnectionId = connectionId };
            _seats.Add(seat);
            if (_seats.Count(s => !s.IsBot) == 1)
            {
                HostSeat = seat.Number;
            }

            return seat;
        }
    }

    /// <summary>
    /// A connection leaves. In the lobby its seat goes (the next player hosts; the last one closes the room), during a run the car stays as it was
    /// (it never finishes). Returns the seat that left, or null.
    /// </summary>
    public Seat? Leave(string connectionId, DateTime now)
    {
        lock (_lock)
        {
            LastActivity = now;
            var seat = _seats.FirstOrDefault(s => s.ConnectionId == connectionId && s.Connected);
            if (seat is null)
            {
                return null;
            }

            seat.Connected = false;
            seat.ConnectionId = null;
            if (Status == RoomStatus.Lobby)
            {
                _seats.Remove(seat);
            }

            var humans = _seats.Where(s => !s.IsBot && s.Connected).ToList();
            if (humans.Count == 0)
            {
                Status = Status is RoomStatus.Countdown or RoomStatus.Running ? RoomStatus.Finished : RoomStatus.Closed;
            }
            else if (seat.Number == HostSeat)
            {
                HostSeat = humans[0].Number;
            }

            return seat;
        }
    }

    public void SetReady(string connectionId, bool ready)
    {
        lock (_lock)
        {
            var seat = RequireSeat(connectionId);
            RequireStatus(RoomStatus.Lobby);
            seat.Ready = ready;
        }
    }

    public void SetCar(string connectionId, CarView car)
    {
        lock (_lock)
        {
            var seat = RequireSeat(connectionId);
            RequireStatus(RoomStatus.Lobby);
            seat.Car = car;
            seat.Ready = false;
        }
    }

    /// <summary>The host changes map, mode, laps, time, bots (lobby only; everybody has to be ready again).</summary>
    public void Configure(string connectionId, RoomSettings settings)
    {
        lock (_lock)
        {
            RequireHost(connectionId);
            RequireStatus(RoomStatus.Lobby);
            Settings = settings with { IsSolo = Settings.IsSolo, MaxPlayers = Math.Max(settings.MaxPlayers, _seats.Count(s => !s.IsBot)) };
            foreach (var seat in _seats)
            {
                seat.Ready = false;
            }
        }
    }

    /// <summary>
    /// The host starts: the bots take the free seats (<paramref name="botCar"/> gives each bot a car by its number), the lights go green in
    /// <see cref="CountdownTime"/>. Every other player has to be ready.
    /// </summary>
    public void Start(string connectionId, DateTime now, Func<int, CarView> botCar)
    {
        lock (_lock)
        {
            RequireHost(connectionId);
            RequireStatus(RoomStatus.Lobby);
            if (_seats.Any(s => !s.IsBot && s.Number != HostSeat && !s.Ready))
            {
                throw new BusinessException("Noch nicht alle sind bereit.");
            }

            var free = Math.Max(0, Math.Min(Settings.Bots, 8 - _seats.Count));
            for (var i = 0; i < free; i++)
            {
                var number = FreeSeatNumber();
                var skill = Math.Clamp(Settings.BotSkill + (i % 3) - 1, 1, 10);
                _seats.Add(new Seat
                {
                    Number = number,
                    Name = SeedContent.BotNames[(number + Code.Length + Code[0]) % SeedContent.BotNames.Count],
                    Skill = skill,
                    Car = botCar(number),
                    Connected = true,
                    Ready = true,
                });
            }

            StartAt = now + CountdownTime;
            Status = RoomStatus.Countdown;
            LastActivity = now;
        }
    }

    /// <summary>May this connection send the state or the result of this seat? Its own seat, and the bots when it is the host.</summary>
    public bool MayDrive(string connectionId, int seatNumber)
    {
        lock (_lock)
        {
            var sender = _seats.FirstOrDefault(s => s.ConnectionId == connectionId && s.Connected);
            var seat = _seats.FirstOrDefault(s => s.Number == seatNumber);
            if (sender is null || seat is null || Status is not (RoomStatus.Countdown or RoomStatus.Running))
            {
                return false;
            }

            return seat == sender || (seat.IsBot && sender.Number == HostSeat);
        }
    }

    /// <summary>Keeps the latest state of a seat (validated: finite numbers, not too long). False when the sender may not drive it.</summary>
    public bool AcceptState(string connectionId, int seatNumber, double[] state, DateTime now)
    {
        if (state.Length == 0 || state.Length > MaxStateLength || state.Any(v => !double.IsFinite(v)) || !MayDrive(connectionId, seatNumber))
        {
            return false;
        }

        lock (_lock)
        {
            var seat = _seats.First(s => s.Number == seatNumber);
            if (seat.Result is null)
            {
                seat.LastState = state;
            }

            LastActivity = now;
            return true;
        }
    }

    /// <summary>A car finished. Returns true when this was the last one the run waited for (the run is over).</summary>
    public bool Finish(string connectionId, int seatNumber, FinishInput result, DateTime now)
    {
        if (!MayDrive(connectionId, seatNumber))
        {
            return false;
        }

        lock (_lock)
        {
            var seat = _seats.First(s => s.Number == seatNumber);
            if (seat.Result is not null)
            {
                return false;
            }

            seat.Result = result;
            seat.FinishedAt = now;
            LastActivity = now;
            if (Status == RoomStatus.Countdown)
            {
                Status = RoomStatus.Running;
            }

            if (_seats.Where(s => s.Connected).All(s => s.Result is not null))
            {
                Status = RoomStatus.Finished;
                return true;
            }

            return false;
        }
    }

    /// <summary>
    /// The clock: countdown → running, and the end when the time is up (the time of the mode plus some grace, or 30 s after the last player finished).
    /// Returns true when the run ended in this tick.
    /// </summary>
    public bool Tick(DateTime now)
    {
        lock (_lock)
        {
            if (Status == RoomStatus.Countdown && StartAt is { } start && now >= start)
            {
                Status = RoomStatus.Running;
            }

            if (Status != RoomStatus.Running)
            {
                return false;
            }

            var humansDone = _seats.Where(s => !s.IsBot && s.Connected).All(s => s.Result is not null);
            var lastHuman = _seats.Where(s => !s.IsBot && s.FinishedAt is not null).Select(s => s.FinishedAt!.Value).DefaultIfEmpty(now).Max();
            if (now >= Deadline() || (humansDone && now >= lastHuman.AddSeconds(30)))
            {
                Status = RoomStatus.Finished;
                return true;
            }

            return false;
        }
    }

    /// <summary>When the run ends at the latest.</summary>
    public DateTime Deadline()
    {
        var start = StartAt ?? CreatedAt;
        return Settings.Mode switch
        {
            GameMode.Score => start.AddSeconds(Settings.DurationS + 15),
            GameMode.Race => start.AddSeconds(Math.Clamp(Settings.LengthM * Settings.Laps / 6, 300, 1800)),
            _ => start.AddHours(2),
        };
    }

    /// <summary>The room as one client sees it (<paramref name="playerId"/> names its seat).</summary>
    public RoomView View(long? playerId, DateTime now)
    {
        lock (_lock)
        {
            var mine = playerId is null ? null : _seats.FirstOrDefault(s => s.PlayerId == playerId);
            return new RoomView(Code, Token, StatusKey(Status), HostSeat, mine?.Number, Settings.Map, Looks.ModeKey(Settings.Mode), Settings.Laps, Settings.DurationS,
                Settings.MaxPlayers, Settings.Bots, Settings.BotSkill, Settings.IsPrivate, Settings.IsSolo, Settings.CompetitionId, Settings.CompetitionName,
                Settings.Goals,
                _seats.OrderBy(s => s.Number).Select(s => new SeatView(s.Number, s.Name, s.IsBot ? "bot" : "human", s.PlayerId, s.Ready || s.Number == HostSeat,
                    s.Connected, s.Result is not null, s.Skill, s.Car)).ToList(),
                StartAt is { } start ? ToUnixMs(start) : null, ToUnixMs(now));
        }
    }

    public RoomListView ListView()
    {
        lock (_lock)
        {
            var host = _seats.FirstOrDefault(s => s.Number == HostSeat)?.Name ?? "?";
            return new RoomListView(Code, host, Settings.Map, Looks.ModeKey(Settings.Mode), _seats.Count(s => !s.IsBot && s.Connected), Settings.MaxPlayers,
                Settings.Bots);
        }
    }

    /// <summary>True once: the caller writes the results of the finished run (the clock and the last finish may both see the end).</summary>
    public bool TryEnd() => Status == RoomStatus.Finished && Interlocked.Exchange(ref _ended, 1) == 0;

    /// <summary>The results were written.</summary>
    public bool Ended => Volatile.Read(ref _ended) == 1;

    /// <summary>Closes the room for good (the registry forgets it).</summary>
    public void Close()
    {
        lock (_lock)
        {
            Status = RoomStatus.Closed;
        }
    }

    public static string StatusKey(RoomStatus status) => status.ToString().ToLowerInvariant();

    public static long ToUnixMs(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    private int FreeSeatNumber()
    {
        var number = 0;
        while (_seats.Any(s => s.Number == number))
        {
            number++;
        }

        return number;
    }

    private Seat RequireSeat(string connectionId)
        => _seats.FirstOrDefault(s => s.ConnectionId == connectionId && s.Connected) ?? throw new BusinessException("Du bist nicht in diesem Raum.");

    private void RequireHost(string connectionId)
    {
        if (RequireSeat(connectionId).Number != HostSeat)
        {
            throw new BusinessException("Nur der Gastgeber darf das.");
        }
    }

    private void RequireStatus(RoomStatus status)
    {
        if (Status != status)
        {
            throw new BusinessException(status == RoomStatus.Lobby ? "Der Lauf hat schon begonnen." : "Das geht gerade nicht.");
        }
    }
}
