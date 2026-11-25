using DriftKing.Data;

namespace DriftKing.Business;

/// <summary>The player as the browser sees him (session, home, top bar).</summary>
public sealed record PlayerView(long Id, string DisplayName, bool IsGuest, bool IsAdmin, int Level, long Xp, long XpLevel, long XpNext, long Money);

/// <summary>The numbers of a player (home, profile).</summary>
public sealed record StatsView(int RunsPlayed, int Wins, long TotalScore, long BestScore, long BestCombo, double MaxAngle, double DriftDistanceKm, int? Rank);

/// <summary>The tuning levels of a car.</summary>
public sealed record LevelsView(int Engine, int Turbo, int Suspension, int Tires, int Steering);

/// <summary>A car to drive (garage, room seats): model, look, levels and the numbers of the physics.</summary>
public sealed record CarView(long Id, long CarId, string Key, string Name, string Body, string Drive, string Paint, string Rims, string? Neon, string Decal, int Number,
    LevelsView Levels, CarSpec Spec);

/// <summary>A part of a garage car: level and the price of the next level (null = at the top).</summary>
public sealed record PartView(string Key, string Name, int Level, int? NextPrice);

/// <summary>A car of the player's garage with its parts.</summary>
public sealed record GarageCarView(CarView Car, string Description, IReadOnlyList<PartView> Parts);

/// <summary>The garage: the cars, the selected one and the money.</summary>
public sealed record GarageView(IReadOnlyList<GarageCarView> Cars, long? SelectedId, long Money);

/// <summary>A car of the dealer: values, price, whether the player has it or may buy it yet.</summary>
public sealed record DealerCarView(long Id, string Key, string Name, string Description, string Body, string Drive, int Power, int Grip, int Weight, int Steering,
    int Price, int UnlockLevel, string Paint, CarSpec Spec, bool Owned, bool Locked);

/// <summary>A map in the menus.</summary>
public sealed record MapView(long Id, string Key, string Name, string Description, string TimeOfDay, int DefaultLaps, int UnlockLevel, bool Locked, double LengthM);

/// <summary>The targets of a competition: metric "score" (points, more is better) or "time" (ms, less is better).</summary>
public sealed record GoalsView(string Metric, long Bronze, long Silver, long Gold);

public sealed record RewardsView(int Bronze, int Silver, int Gold);

/// <summary>The player's best in a competition.</summary>
public sealed record CompetitionMineView(long BestScore, int? BestTimeMs, string Medal, int Attempts);

/// <summary>A competition in the menus.</summary>
public sealed record CompetitionView(long Id, string Name, string Description, MapRef Map, string Mode, int Laps, int DurationS, int Bots, int BotSkill,
    GoalsView Goals, RewardsView Rewards, int UnlockLevel, bool Locked, DateTime? StartDate, DateTime? EndDate, CompetitionMineView? Mine);

/// <summary>A short reference to a map (rooms, competitions, history).</summary>
public sealed record MapRef(string Key, string Name, string TimeOfDay);

/// <summary>A row of a leaderboard.</summary>
public sealed record LeaderView(int Rank, long PlayerId, string Name, int Level, long Value, int? TimeMs, string? Medal, bool IsMe);

/// <summary>A past run of the player.</summary>
public sealed record HistoryView(Guid Token, DateTime Date, string Map, string Mode, int Place, int Field, long Score, int? TimeMs, long Money, long Xp, string? Competition);

/// <summary>The profile screen: the player, the numbers, the medals.</summary>
public sealed record ProfileView(PlayerView Player, StatsView Stats, int Gold, int Silver, int Bronze, int Cars);

/// <summary>A personal best on a map in a mode.</summary>
public sealed record BestView(string Map, string Mode, long Score, int? TimeMs, int? BestLapMs);

/// <summary>The catalogue of the menus: dealer, maps, modes.</summary>
public sealed record CatalogView(IReadOnlyList<DealerCarView> Cars, IReadOnlyList<MapView> Maps);

/// <summary>The views of the business layer.</summary>
public static class Views
{
    public static PlayerView Player(Player player, bool isAdmin)
    {
        var level = Progression.LevelOf(player.Xp);
        return new PlayerView(player.Id, player.DisplayName, player.IsGuest, isAdmin, level, player.Xp, Progression.XpOfLevel(level),
            Progression.XpOfLevel(Math.Min(Progression.MaxLevel, level + 1)), player.Money);
    }

    public static StatsView Stats(Player player, int? rank)
        => new(player.RunsPlayed, player.Wins, player.TotalScore, player.BestScore, player.BestCombo, Math.Round(player.MaxAngle, 1),
            Math.Round(player.DriftDistanceM / 1000, 2), rank);

    public static CarView Car(GarageCar garage, Car car)
        => new(garage.Id, car.Id, car.Key, car.Name, car.Body, car.Drive.ToString(), garage.Paint, garage.Rims, garage.Neon, garage.Decal, garage.Number,
            new LevelsView(garage.Engine, garage.Turbo, garage.Suspension, garage.Tires, garage.SteeringKit), Tuning.SpecOf(car, garage));

    public static GarageCarView GarageCar(GarageCar garage, Car car)
        => new(Car(garage, car), car.Description, Enum.GetValues<Part>().Select(part =>
        {
            var level = garage.LevelOf(part);
            return new PartView(PartKey(part), Tuning.PartName(part), level, level >= Tuning.MaxLevel ? null : Tuning.UpgradePrice(car, part, level + 1));
        }).ToList());

    public static DealerCarView Dealer(Car car, bool owned, int playerLevel)
        => new(car.Id, car.Key, car.Name, car.Description, car.Body, car.Drive.ToString(), car.Power, car.Grip, car.Weight, car.Steering, car.Price, car.UnlockLevel,
            car.DefaultPaint, Tuning.SpecOf(car, null), owned, playerLevel < car.UnlockLevel);

    public static MapView Map(Map map, int playerLevel)
        => new(map.Id, map.Key, map.Name, map.Description, Looks.TimeOfDayKey(map.TimeOfDay), map.DefaultLaps, map.UnlockLevel, playerLevel < map.UnlockLevel,
            Math.Round(MapCatalog.LengthOf(map.Key)));

    public static MapRef MapRef(Map map) => new(map.Key, map.Name, Looks.TimeOfDayKey(map.TimeOfDay));

    public static CompetitionView Competition(Competition competition, Map map, int playerLevel, CompetitionResult? mine)
        => new(competition.Id, competition.Name, competition.Description, MapRef(map), Looks.ModeKey(competition.Mode), competition.Laps, competition.DurationS,
            competition.Bots, competition.BotSkill, Goals(competition), new RewardsView(competition.RewardBronze, competition.RewardSilver, competition.RewardGold),
            competition.UnlockLevel, playerLevel < competition.UnlockLevel, competition.StartDate, competition.EndDate,
            mine is null ? null : new CompetitionMineView(mine.BestScore, mine.BestTimeMs, MedalKey(mine.Medal), mine.Attempts));

    public static GoalsView Goals(Competition competition)
        => new(competition.Mode == GameMode.Race ? "time" : "score", competition.Bronze, competition.Silver, competition.Gold);

    public static string PartKey(Part part) => part switch
    {
        Part.Engine => "engine",
        Part.Turbo => "turbo",
        Part.Suspension => "suspension",
        Part.Tires => "tires",
        Part.Steering => "steering",
        _ => part.ToString().ToLowerInvariant(),
    };

    public static Part? PartOf(string? key) => key?.ToLowerInvariant() switch
    {
        "engine" => Part.Engine,
        "turbo" => Part.Turbo,
        "suspension" => Part.Suspension,
        "tires" => Part.Tires,
        "steering" => Part.Steering,
        _ => null,
    };

    public static string MedalKey(Medal medal) => medal.ToString().ToLowerInvariant();
}
