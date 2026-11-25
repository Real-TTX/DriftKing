using DriftKing.Data;

namespace DriftKing.Business;

/// <summary>
/// The content of a new server (and of the offline game): the dealer's cars, the four maps and the first competitions.
/// The plugin seeds what is missing (by key / name) at start; the offline game plays with exactly this.
/// All names are DriftKing's own.
/// </summary>
public static class SeedContent
{
    public static IReadOnlyList<Car> Cars() =>
    [
        Car("kaze", "Kaze 2000", "coupe", CarDrive.RWD, 3, 4, 4, 6, 0, 1, "#f4f2ff", 10,
            "Leichtes Coupé mit Heckantrieb – gutmütig, ehrlich, der Klassiker zum Driften-Lernen."),
        Car("hotaru", "Hotaru Kompakt", "hatch", CarDrive.RWD, 3, 5, 2, 6, 6000, 1, "#ffe14a", 20,
            "Federleicht und quirlig: wenig Leistung, aber die Kurven gehören ihm."),
        Car("ronin", "Ronin S", "sedan", CarDrive.RWD, 5, 5, 6, 6, 14000, 2, "#16151f", 30,
            "Vier Türen, Reihensechser, langer Radstand – ruhige, lange Drifts."),
        Car("kitsune", "Kitsune RS", "fastback", CarDrive.RWD, 6, 6, 5, 7, 24000, 3, "#ff7a1a", 40,
            "Spitze Schnauze, flinkes Heck: schnell umgesetzt, schnell gefangen."),
        Car("yurei", "Yūrei Turbo", "coupe", CarDrive.RWD, 7, 7, 4, 8, 36000, 5, "#8b5cf6", 50,
            "Der Geist der Hausberge: leicht, viel Lenkwinkel, Turbo mit Pfeifen."),
        Car("raijin", "Raijin GT-W", "wide", CarDrive.AWD, 8, 8, 7, 5, 42000, 6, "#2f6bff", 60,
            "Allrad-Bolide mit Wide-Body: zieht wie ein Gewitter, driftet nur mit Nachdruck."),
        Car("oni", "Oni V8", "muscle", CarDrive.RWD, 9, 5, 8, 6, 52000, 8, "#ff4040", 70,
            "Hubraum statt Feingefühl: das Heck kommt, wann es will – und es will oft."),
        Car("tora", "Tora Wide", "wide", CarDrive.RWD, 10, 7, 6, 9, 80000, 10, "#ff2e88", 80,
            "Der König der Nacht: breit, laut, irrer Lenkeinschlag."),
    ];

    public static IReadOnlyList<Map> Maps() =>
    [
        Map("pass", "Tenjō-Pass", TimeOfDay.Night, 2, 1, 10,
            "Der Hausberg: Haarnadeln bergauf und bergab, Leitplanken links und rechts, unten die Lichter der Stadt."),
        Map("deck", "Parkdeck 7", TimeOfDay.Night, 3, 1, 20,
            "Das oberste Deck eines Parkhauses: Pfeiler, Pylonen und viel Beton über den Dächern."),
        Map("harbor", "Kaikō-Docks", TimeOfDay.Dusk, 3, 2, 30,
            "Container, Kräne, Natriumlicht: breite Gassen zwischen gestapelten Stahlkisten am Wasser."),
        Map("city", "Neon-Viertel", TimeOfDay.Night, 3, 3, 40,
            "Ein Rundkurs um die Blocks: Leuchtreklamen, Kreuzungen, ein langer Bogen."),
    ];

    /// <summary>The first competitions; <paramref name="mapIdOf"/> gives the id of a map key (the database's or the offline game's).</summary>
    public static IReadOnlyList<Competition> Competitions(Func<string, long> mapIdOf) =>
    [
        Competition(mapIdOf("deck"), "Erste Linie", "Neunzig Sekunden auf dem Parkdeck: zeig, dass du das Heck im Griff hast.",
            GameMode.Score, 3, 90, 2, 3, 8000, 18000, 32000, 1000, 2000, 4000, 1, 10),
        Competition(mapIdOf("harbor"), "Containerschlange", "Zwei Minuten zwischen den Containern – jede Wand bringt Bonus, jeder Kuss zu viel kostet die Kette.",
            GameMode.Score, 3, 120, 3, 5, 12000, 26000, 45000, 1500, 3000, 6000, 2, 20),
        Competition(mapIdOf("city"), "Neon-Sprint", "Drei Runden ums Viertel gegen fünf Fahrer. Ankommen reicht nicht.",
            GameMode.Race, 3, 0, 5, 5, RaceTarget("city", 3, 70), RaceTarget("city", 3, 85), RaceTarget("city", 3, 100), 1500, 3000, 6000, 3, 30),
        Competition(mapIdOf("pass"), "Bergkönig", "Zweieinhalb Minuten am Hausberg: Punkte in den Haarnadeln, Nerven an den Planken.",
            GameMode.Score, 2, 150, 3, 7, 15000, 35000, 60000, 2500, 5000, 10000, 4, 40),
        Competition(mapIdOf("pass"), "Talfahrt", "Zwei Runden über den Pass gegen die Schnellsten der Gegend.",
            GameMode.Race, 2, 0, 5, 8, RaceTarget("pass", 2, 65), RaceTarget("pass", 2, 80), RaceTarget("pass", 2, 95), 3000, 6000, 12000, 6, 50),
    ];

    /// <summary>A race target: the time for the laps at an average speed (km/h), rounded to the second.</summary>
    public static long RaceTarget(string mapKey, int laps, double averageKmh)
        => (long)(Math.Round(MapCatalog.LengthOf(mapKey) * laps / (averageKmh / 3.6)) * 1000);

    /// <summary>The names of the bots (original, no characters of anything).</summary>
    public static readonly IReadOnlyList<string> BotNames = ["Kaito", "Ryo", "Mika", "Shin", "Aya", "Ren", "Yuki", "Kenji", "Sora", "Nao", "Hiro", "Emi"];

    private static Car Car(string key, string name, string body, CarDrive drive, int power, int grip, int weight, int steering, int price, int level, string paint,
        int order, string description) => new()
    {
        Key = key, Name = name, Body = body, Drive = drive, Power = power, Grip = grip, Weight = weight, Steering = steering, Price = price,
        UnlockLevel = level, DefaultPaint = paint, SortOrder = order, Description = description, IsEnabled = true,
    };

    private static Map Map(string key, string name, TimeOfDay time, int laps, int level, int order, string description) => new()
    {
        Key = key, Name = name, TimeOfDay = time, DefaultLaps = MapCatalog.Find(key)?.DefaultLaps ?? laps, UnlockLevel = level, SortOrder = order,
        Description = description, IsEnabled = true,
    };

    private static Competition Competition(long mapId, string name, string description, GameMode mode, int laps, int durationS, int bots, int skill,
        long bronze, long silver, long gold, int rewardBronze, int rewardSilver, int rewardGold, int level, int order) => new()
    {
        MapId = mapId, Name = name, Description = description, Mode = mode, Laps = laps, DurationS = durationS, Bots = bots, BotSkill = skill,
        Bronze = bronze, Silver = silver, Gold = gold, RewardBronze = rewardBronze, RewardSilver = rewardSilver, RewardGold = rewardGold,
        UnlockLevel = level, SortOrder = order, IsEnabled = true,
    };
}
