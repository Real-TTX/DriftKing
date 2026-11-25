using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using DriftKing.Data;

namespace DriftKing.Business;

/// <summary>
/// The driving numbers of a car as the browser's physics reads them (<c>CarView.spec</c>). <see cref="Tuning.SpecOf"/> is the only source;
/// <c>js/game/catalog.js specOf</c> mirrors it for the previews.
/// </summary>
public sealed record CarSpec(
    int MassKg,
    int PowerKw,
    int TopSpeedKmh,
    double GripFront,
    double GripRear,
    double SteerLockDeg,
    double HandbrakeGrip,
    double Stability,
    string Drive,
    int Gears);

/// <summary>Tuning: the spec of a car with its parts and the prices of the parts.</summary>
public static class Tuning
{
    public const int MaxLevel = 5;

    public static CarSpec SpecOf(Car car, GarageCar? garage)
    {
        var engine = garage?.Engine ?? 0;
        var turbo = garage?.Turbo ?? 0;
        var suspension = garage?.Suspension ?? 0;
        var tires = garage?.Tires ?? 0;
        var steering = garage?.SteeringKit ?? 0;
        var gripFront = Round(0.95 + car.Grip * 0.03 + tires * 0.025);
        return new CarSpec(
            MassKg: 1000 + car.Weight * 60,
            PowerKw: 90 + car.Power * 22 + engine * 12 + turbo * 16,
            TopSpeedKmh: 170 + car.Power * 9 + engine * 4 + turbo * 5,
            GripFront: gripFront,
            GripRear: Round(gripFront * (car.Drive == CarDrive.AWD ? 1 : 0.94)),
            SteerLockDeg: Math.Min(70, 32 + car.Steering * 2.5 + steering * 4),
            HandbrakeGrip: 0.45,
            Stability: Round(0.5 + suspension * 0.1),
            Drive: car.Drive.ToString(),
            Gears: 6);
    }

    /// <summary>The price of the next level of a part: grows with the level and with the price class of the car (rounded to 50 yen).</summary>
    public static int UpgradePrice(Car car, Part part, int nextLevel)
    {
        var basePrice = part switch
        {
            Part.Engine => 1200,
            Part.Turbo => 1600,
            Part.Suspension => 900,
            Part.Tires => 700,
            Part.Steering => 1000,
            _ => 1000,
        };
        var carClass = 1 + car.Price / 40000.0;
        var price = basePrice * nextLevel * carClass;
        return (int)(Math.Round(price / 50) * 50);
    }

    public static string PartName(Part part) => part switch
    {
        Part.Engine => "Motor",
        Part.Turbo => "Turbo",
        Part.Suspension => "Fahrwerk",
        Part.Tires => "Reifen",
        Part.Steering => "Lenkwinkel-Kit",
        _ => part.ToString(),
    };

    private static double Round(double value) => Math.Round(value, 3, MidpointRounding.AwayFromZero);
}

/// <summary>Levels from experience points: level L needs 500 × (L−1) × L / 2 XP (500, 1 500, 3 000 …).</summary>
public static class Progression
{
    public const int MaxLevel = 50;

    public static long XpOfLevel(int level) => 500L * (level - 1) * level / 2;

    public static int LevelOf(long xp)
    {
        var level = 1;
        while (level < MaxLevel && xp >= XpOfLevel(level + 1))
        {
            level++;
        }

        return level;
    }
}

/// <summary>The prize money and the experience of a run.</summary>
public static class Economy
{
    private static readonly int[] RacePlaceMoney = [3000, 1800, 1100, 700, 450, 300, 200, 150];
    private static readonly int[] ScorePlaceMoney = [1500, 900, 500, 300, 200, 150, 100, 100];

    /// <summary>
    /// The money of one car: by points (score, freeride) and by place (score, race: only with more than one car and only when driven to the end).
    /// <paramref name="factorPercent"/> scales it.
    /// </summary>
    public static long MoneyOf(GameMode mode, int place, int field, long score, bool finished, int factorPercent)
    {
        double money = mode switch
        {
            GameMode.Freeride => Math.Min(5000, score / 80.0),
            GameMode.Score => Math.Min(20000, score / 40.0) + (field > 1 && finished && score > 0 ? ScorePlaceMoney[Math.Clamp(place - 1, 0, 7)] : 0),
            GameMode.Race => finished ? RacePlaceMoney[Math.Clamp(place - 1, 0, 7)] * (field > 1 ? 1 : 0.5) + Math.Min(2000, score / 100.0) : 0,
            _ => 0,
        };
        return (long)Math.Round(money * Math.Clamp(factorPercent, 0, 1000) / 100.0);
    }

    public static long XpOf(GameMode mode, int place, int field, long score, bool finished)
    {
        var placeXp = field > 1 ? (field - place) * 30 : 0;
        return mode switch
        {
            GameMode.Freeride => Math.Min(400, score / 400),
            GameMode.Score => (finished ? 50 + placeXp : 0) + Math.Min(1500, score / 200),
            GameMode.Race => finished ? 100 + placeXp + Math.Min(500, score / 400) : 20,
            _ => 0,
        };
    }
}

/// <summary>What a car may look like.</summary>
public static partial class Looks
{
    public static readonly IReadOnlyList<string> Bodies = ["coupe", "hatch", "sedan", "fastback", "wide", "muscle"];

    public static readonly IReadOnlyList<string> Decals = ["none", "stripes", "split", "kanji", "sakura", "flames"];

    public static readonly IReadOnlyList<string> Paints =
        ["#f4f2ff", "#16151f", "#ff2e88", "#29e7ff", "#ffb020", "#3ef08a", "#8b5cf6", "#ff4040", "#2f6bff", "#c9ccd6", "#ffe14a", "#ff7a1a"];

    public static readonly IReadOnlyList<string> Neons = ["#ff2e88", "#29e7ff", "#8b5cf6", "#3ef08a", "#ffb020", "#ff4040", "#ffffff"];

    public static bool IsColor(string? value) => value is not null && ColorPattern().IsMatch(value);

    public static string BodyName(string body) => body switch
    {
        "coupe" => "Coupé",
        "hatch" => "Kompakt",
        "sedan" => "Limousine",
        "fastback" => "Fastback",
        "wide" => "Widebody GT",
        "muscle" => "Muscle",
        _ => body,
    };

    public static string DecalName(string decal) => decal switch
    {
        "none" => "Ohne",
        "stripes" => "Rennstreifen",
        "split" => "Zweifarbig",
        "kanji" => "Schriftzeichen",
        "sakura" => "Kirschblüten",
        "flames" => "Flammen",
        _ => decal,
    };

    public static string DriveName(CarDrive drive) => drive == CarDrive.AWD ? "Allrad" : "Heckantrieb";

    public static string ModeName(GameMode mode) => mode switch
    {
        GameMode.Freeride => "Freies Fahren",
        GameMode.Score => "Drift-Wertung",
        GameMode.Race => "Rennen",
        _ => mode.ToString(),
    };

    public static string ModeKey(GameMode mode) => mode switch
    {
        GameMode.Freeride => "freeride",
        GameMode.Score => "score",
        GameMode.Race => "race",
        _ => "score",
    };

    public static GameMode? ModeOf(string? key) => key?.ToLowerInvariant() switch
    {
        "freeride" => GameMode.Freeride,
        "score" => GameMode.Score,
        "race" => GameMode.Race,
        _ => null,
    };

    public static string TimeOfDayKey(TimeOfDay time) => time == TimeOfDay.Dusk ? "dusk" : "night";

    public static string TimeOfDayName(TimeOfDay time) => time == TimeOfDay.Dusk ? "Dämmerung" : "Nacht";

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex ColorPattern();
}

/// <summary>A map as the browser draws it (<c>data/maps.json</c>, embedded): the key, the name, the length of the course and the default laps.</summary>
public sealed record MapGeometry(string Key, string Name, double LengthM, int DefaultLaps);

/// <summary>The maps of the browser (read once from the embedded <c>maps.json</c>).</summary>
public static class MapCatalog
{
    private static readonly Lazy<IReadOnlyDictionary<string, MapGeometry>> All = new(Load);

    /// <summary>The fallback when a key is not in the file: a course of 2 km.</summary>
    public const double DefaultLengthM = 2000;

    public static IReadOnlyCollection<MapGeometry> Maps => All.Value.Values.ToList();

    public static bool Exists(string key) => All.Value.ContainsKey(key);

    public static MapGeometry? Find(string key) => All.Value.TryGetValue(key, out var map) ? map : null;

    public static double LengthOf(string key) => Find(key)?.LengthM ?? DefaultLengthM;

    private static IReadOnlyDictionary<string, MapGeometry> Load()
    {
        using var stream = typeof(MapCatalog).Assembly.GetManifestResourceStream("DriftKing.maps.json");
        if (stream is null)
        {
            return new Dictionary<string, MapGeometry>();
        }

        using var document = JsonDocument.Parse(stream);
        var maps = new Dictionary<string, MapGeometry>(StringComparer.Ordinal);
        foreach (var item in document.RootElement.EnumerateArray())
        {
            var key = item.GetProperty("key").GetString() ?? string.Empty;
            var name = item.TryGetProperty("name", out var n) ? n.GetString() ?? key : key;
            var length = item.TryGetProperty("lengthM", out var l) && l.ValueKind == JsonValueKind.Number ? l.GetDouble() : DefaultLengthM;
            var laps = item.TryGetProperty("defaultLaps", out var d) && d.ValueKind == JsonValueKind.Number ? d.GetInt32() : 3;
            maps[key] = new MapGeometry(key, name, length, laps);
        }

        return maps;
    }
}

/// <summary>
/// The checks of a reported result: the browser simulates and scores its own car, the server only accepts what is possible.
/// Points are capped by time × <see cref="DefaultMaxPointsPerSecond"/> (setting), race times must not be faster than <see cref="MaxSpeedKmh"/> on average.
/// </summary>
public static class Plausibility
{
    public const int DefaultMaxPointsPerSecond = 8000;

    public const double MaxSpeedKmh = 330;

    /// <summary>The most points a run of this many seconds can have.</summary>
    public static long MaxScore(double seconds, int maxPointsPerSecond) => (long)(Math.Max(0, seconds) * maxPointsPerSecond);

    /// <summary>The fastest possible time for the laps of a course.</summary>
    public static int MinRaceTimeMs(double lengthM, int laps) => (int)(lengthM * laps / (MaxSpeedKmh / 3.6) * 1000);

    public static string Describe(long value) => value.ToString("N0", CultureInfo.GetCultureInfo("de-DE"));
}

/// <summary>The medals of competitions: points (more is better) or a race time in ms (less is better).</summary>
public static class Medals
{
    public static Medal Of(Competition competition, long score, int? timeMs)
    {
        if (competition.Mode == GameMode.Race)
        {
            if (timeMs is not { } time || time <= 0)
            {
                return Medal.None;
            }

            return time <= competition.Gold ? Medal.Gold : time <= competition.Silver ? Medal.Silver : time <= competition.Bronze ? Medal.Bronze : Medal.None;
        }

        return score >= competition.Gold ? Medal.Gold : score >= competition.Silver ? Medal.Silver : score >= competition.Bronze ? Medal.Bronze : Medal.None;
    }

    /// <summary>The prize of a medal (the medals below it are part of it: reaching gold at once pays gold).</summary>
    public static int RewardOf(Competition competition, Medal medal) => medal switch
    {
        Medal.Gold => competition.RewardGold,
        Medal.Silver => competition.RewardSilver,
        Medal.Bronze => competition.RewardBronze,
        _ => 0,
    };

    /// <summary>What a better medal pays now: the prize of the new medal minus what the old one already paid.</summary>
    public static int RewardForUpgrade(Competition competition, Medal previous, Medal reached)
        => reached > previous ? Math.Max(0, RewardOf(competition, reached) - RewardOf(competition, previous)) : 0;

    public static string Name(Medal medal) => medal switch
    {
        Medal.Gold => "Gold",
        Medal.Silver => "Silber",
        Medal.Bronze => "Bronze",
        _ => "Keine",
    };

    /// <summary>Is the result better than the best so far (score: higher, race: faster)?</summary>
    public static bool IsBetter(GameMode mode, long score, int? timeMs, long bestScore, int? bestTimeMs)
        => mode == GameMode.Race
            ? timeMs is > 0 && (bestTimeMs is null || timeMs < bestTimeMs)
            : score > bestScore;
}
