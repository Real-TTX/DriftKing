using DriftKing.Data;

namespace DriftKing.Business;

/// <summary>
/// The content of a new server (and of the offline game): the dealer's cars, the four maps and the first competitions.
/// The plugin seeds what is missing (by key / name) at start; the offline game plays with exactly this.
/// The cars are real ones (the owner holds the licences); maps, competitions and bots carry DriftKing's own names.
/// </summary>
public static class SeedContent
{
    /// <summary>
    /// The dealer's cars. The order is a contract: the offline game numbers the cars by their place in this list (profile.json keeps the numbers),
    /// so a new car goes to the end (its place in the menus comes from the sort order) and none is ever removed or moved.
    /// The car key is also the key of the 3D model (js/game/car).
    /// </summary>
    public static IReadOnlyList<Car> Cars() =>
    [
        Car("kaze", "Nissan Silvia S13", "coupe", CarDrive.RWD, 3, 4, 4, 6, 0, 1, "#f4f2ff", 10,
            "Der Klassiker zum Driften-Lernen: leichtes Coupé mit Heckantrieb und Turbo-Vierzylinder – gutmütig, ehrlich, verzeiht viel."),
        Car("hotaru", "Toyota Sprinter Trueno AE86", "hatch", CarDrive.RWD, 3, 5, 2, 6, 6000, 1, "#ffe14a", 20,
            "Federleicht, Klappscheinwerfer, drehfreudiger Sauger: wenig Leistung, aber die Kurven gehören ihm."),
        Car("ronin", "Toyota Chaser JZX100", "sedan", CarDrive.RWD, 5, 5, 6, 6, 14000, 2, "#16151f", 30,
            "Vier Türen, Reihensechser mit Turbo, langer Radstand – die Limousine für ruhige, lange Drifts."),
        Car("kitsune", "Mazda RX-7 FD3S", "fastback", CarDrive.RWD, 6, 6, 5, 7, 24000, 3, "#ff4040", 40,
            "Wankelmotor mit Biturbo, spitze Schnauze, flinkes Heck: schnell umgesetzt, schnell gefangen."),
        Car("yurei", "Nissan Silvia S15 Spec-R", "coupe", CarDrive.RWD, 7, 7, 4, 8, 36000, 5, "#8b5cf6", 50,
            "Die letzte Silvia: leicht, viel Lenkwinkel, Turbo mit Pfeifen – der Geist der Hausberge."),
        Car("raijin", "Nissan Skyline GT-R R34", "wide", CarDrive.AWD, 8, 8, 7, 5, 42000, 6, "#2f6bff", 60,
            "Allrad, Reihensechser mit Biturbo, breite Backen: zieht wie ein Gewitter, driftet nur mit Nachdruck."),
        Car("oni", "Ford Mustang GT", "muscle", CarDrive.RWD, 9, 5, 8, 6, 52000, 8, "#ff4040", 70,
            "V8 statt Feingefühl: das Heck kommt, wann es will – und es will oft."),
        Car("tora", "Toyota Supra A80 Widebody", "wide", CarDrive.RWD, 10, 7, 6, 9, 80000, 10, "#ff2e88", 80,
            "Der König der Nacht: Reihensechser mit Biturbo, breit, laut, irrer Lenkeinschlag."),

        // added with the real cars (at the end: see above)
        Car("s14a", "Nissan 200SX S14a", "coupe", CarDrive.RWD, 5, 6, 4, 7, 18000, 3, "#c9ccd6", 35,
            "Das Drift-Auto schlechthin: SR20DET mit Turbo, Heckantrieb, längerer Radstand als die S13 – stabil im Winkel, satt im Übergang, "
            + "dankbar für jedes Teil."),
        Car("g81", "BMW M3 Competition Touring G81", "sedan", CarDrive.AWD, 9, 9, 9, 5, 64000, 9, "#3ef08a", 75,
            "Ein Kombi mit über 500 PS und xDrive-Allrad: absurd schnell, schwer zu provozieren – aber wenn, dann richtig."),
        Car("e46", "BMW M3 E46", "coupe", CarDrive.RWD, 7, 6, 7, 7, 31000, 4, "#29e7ff", 46,
            "Hochdrehender Reihensechser, Heckantrieb, ausgewogene Achslast: präzise und berechenbar im Winkel."),
        Car("z33", "Nissan 350Z", "fastback", CarDrive.RWD, 6, 7, 6, 7, 27000, 4, "#ffb020", 43,
            "V6-Sauger mit Drehmoment von unten, kurzer Radstand: quer kommt er leicht, halten will gelernt sein."),
        Car("gr86", "Toyota GR86", "coupe", CarDrive.RWD, 4, 6, 4, 6, 10000, 2, "#2f6bff", 25,
            "Boxer-Sauger, Heckantrieb, Sperre ab Werk: der ehrliche Einstieg in die neue Zeit."),
        Car("f21", "BMW M140i F21", "hatch", CarDrive.RWD, 7, 6, 6, 8, 33500, 4, "#2f6bff", 48,
            "Der letzte Kompakte mit Reihensechser und Heckantrieb: 340 PS Turbo, kurzer Radstand, viel Drehmoment von unten – "
            + "kommt auf Zug sofort quer, will aber mit Gefühl gehalten werden."),
    ];

    /// <summary>
    /// What the first eight cars were seeded with before they got their real names. A database that still carries one of these values
    /// gets the new one (<see cref="Refresh"/>); a value an administrator changed stays.
    /// </summary>
    public static readonly IReadOnlyList<(string Key, string Name, string Description, string Paint)> FormerCars =
    [
        ("kaze", "Kaze 2000", "Leichtes Coupé mit Heckantrieb – gutmütig, ehrlich, der Klassiker zum Driften-Lernen.", "#f4f2ff"),
        ("hotaru", "Hotaru Kompakt", "Federleicht und quirlig: wenig Leistung, aber die Kurven gehören ihm.", "#ffe14a"),
        ("ronin", "Ronin S", "Vier Türen, Reihensechser, langer Radstand – ruhige, lange Drifts.", "#16151f"),
        ("kitsune", "Kitsune RS", "Spitze Schnauze, flinkes Heck: schnell umgesetzt, schnell gefangen.", "#ff7a1a"),
        ("yurei", "Yūrei Turbo", "Der Geist der Hausberge: leicht, viel Lenkwinkel, Turbo mit Pfeifen.", "#8b5cf6"),
        ("raijin", "Raijin GT-W", "Allrad-Bolide mit Wide-Body: zieht wie ein Gewitter, driftet nur mit Nachdruck.", "#2f6bff"),
        ("oni", "Oni V8", "Hubraum statt Feingefühl: das Heck kommt, wann es will – und es will oft.", "#ff4040"),
        ("tora", "Tora Wide", "Der König der Nacht: breit, laut, irrer Lenkeinschlag.", "#ff2e88"),
    ];

    /// <summary>
    /// Brings a stored car of the seed up to date: name, description and factory paint change only where they still carry the former seeded value.
    /// Returns whether something changed. Values, prices, levels and the cars of the players are never touched.
    /// </summary>
    public static bool Refresh(Car car)
    {
        var seeded = Cars().FirstOrDefault(c => c.Key == car.Key);
        var former = FormerCars.FirstOrDefault(f => f.Key == car.Key);
        if (seeded is null || former.Key is null)
        {
            return false;
        }

        var changed = false;
        if (car.Name == former.Name && car.Name != seeded.Name)
        {
            car.Name = seeded.Name;
            changed = true;
        }

        if (car.Description == former.Description && car.Description != seeded.Description)
        {
            car.Description = seeded.Description;
            changed = true;
        }

        if (car.DefaultPaint == former.Paint && car.DefaultPaint != seeded.DefaultPaint)
        {
            car.DefaultPaint = seeded.DefaultPaint;
            changed = true;
        }

        return changed;
    }

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
