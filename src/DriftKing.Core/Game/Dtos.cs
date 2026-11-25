using DriftKing.Business;

namespace DriftKing.Game;

/// <summary>What a player asks for when creating or changing a room (all optional: the server fills defaults and clamps).</summary>
public sealed record RoomOptions(string? Map, string? Mode, int? Laps, int? DurationS, int? Bots, int? BotSkill, bool? IsPrivate, long? CompetitionId);

/// <summary>The result one browser reports for one car (its own, or a bot it drove).</summary>
public sealed record FinishInput(long Score, int? TimeMs, int? BestLapMs, int Laps, long BestCombo, double MaxAngle, double DriftDistanceM, int Collisions);

/// <summary>A seat of a room as every client sees it. Kind: "human" or "bot".</summary>
public sealed record SeatView(int Seat, string Name, string Kind, long? PlayerId, bool Ready, bool Connected, bool Finished, int Skill, CarView Car);

/// <summary>
/// A room as the clients see it. <see cref="StartAt"/> and <see cref="ServerNow"/> are Unix milliseconds of the server: the client corrects its clock
/// by <c>ServerNow - Date.now()</c>. <see cref="HostSeat"/> drives the bots (simulateBots).
/// </summary>
public sealed record RoomView(
    string Code,
    Guid Token,
    string Status,
    int HostSeat,
    int? MySeat,
    MapRef Map,
    string Mode,
    int Laps,
    int DurationS,
    int MaxPlayers,
    int Bots,
    int BotSkill,
    bool IsPrivate,
    bool IsSolo,
    long? CompetitionId,
    string? CompetitionName,
    GoalsView? Goals,
    IReadOnlyList<SeatView> Seats,
    long? StartAt,
    long ServerNow);

/// <summary>An open room in the lobby list.</summary>
public sealed record RoomListView(string Code, string Host, MapRef Map, string Mode, int Humans, int MaxPlayers, int Bots);

/// <summary>One car in the results.</summary>
public sealed record ResultEntryView(int Seat, string Name, bool IsBot, long? PlayerId, string CarName, int Place, long Score, int? TimeMs, int? BestLapMs,
    long BestCombo, double MaxAngle, double DriftDistanceM, bool Finished, long Money, long Xp, bool Flagged);

/// <summary>What a competition run brought: the medal reached, the one before, the prize paid now, a new personal best.</summary>
public sealed record CompetitionOutcomeView(long Id, string Name, string Medal, string PreviousMedal, int Reward, bool IsNewBest, long BestScore, int? BestTimeMs,
    GoalsView Goals);

/// <summary>The end of a run: every car with place, points, time and what it earned.</summary>
public sealed record ResultsView(Guid Token, string Code, MapRef Map, string Mode, IReadOnlyList<ResultEntryView> Entries, CompetitionOutcomeView? Competition);
