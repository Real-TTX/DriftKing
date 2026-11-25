using DriftKing.Business;
using DriftKing.Data;

namespace DriftKing.Game;

/// <summary>From what a player asks (<see cref="RoomOptions"/>) or a competition to the <see cref="RoomSettings"/> of a room: defaults and limits.</summary>
public static class RoomSetup
{
    public const int DefaultDurationS = 120;

    /// <summary>A room on a map (free play, score attack or race; online or solo).</summary>
    public static RoomSettings For(Map map, RoomOptions options, int maxPlayers, bool solo)
    {
        var mode = Looks.ModeOf(options.Mode) ?? GameMode.Score;
        var laps = Math.Clamp(options.Laps is > 0 ? options.Laps.Value : map.DefaultLaps, 1, 20);
        var duration = Math.Clamp(options.DurationS is > 0 ? options.DurationS.Value : DefaultDurationS, 30, 900);
        var players = solo ? 1 : Math.Clamp(maxPlayers, 2, 8);
        var bots = Math.Clamp(options.Bots ?? (solo ? 3 : 0), 0, 7);
        return new RoomSettings(Views.MapRef(map), MapCatalog.LengthOf(map.Key), mode, laps, duration, bots, Math.Clamp(options.BotSkill ?? 5, 1, 10),
            solo || (options.IsPrivate ?? false), solo, players);
    }

    /// <summary>A competition: always solo, the competition's map, mode, laps, time and bots.</summary>
    public static RoomSettings For(Competition competition, Map map)
        => new(Views.MapRef(map), MapCatalog.LengthOf(map.Key), competition.Mode, Math.Clamp(competition.Laps, 1, 20), Math.Clamp(competition.DurationS, 30, 900),
            Math.Clamp(competition.Bots, 0, 7), Math.Clamp(competition.BotSkill, 1, 10), true, true, 1, competition.Id, competition.Name,
            Views.Goals(competition));
}
