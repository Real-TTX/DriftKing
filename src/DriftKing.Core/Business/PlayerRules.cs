using DriftKing.Data;
using DriftKing.Game;

namespace DriftKing.Business;

/// <summary>
/// The rules of the garage on plain objects (no database): the plugin loads and saves the records around them, the offline game applies them to its profile.
/// Each method checks what it may and throws <see cref="BusinessException"/> with a German message.
/// </summary>
public static class GarageRules
{
    public const long DefaultStartMoney = 15000;

    /// <summary>A new car in a garage, in the dealer's paint.</summary>
    public static GarageCar NewCar(long playerId, Car car, int number) => new()
    {
        PlayerId = playerId,
        CarId = car.Id,
        Car = car,
        Paint = car.DefaultPaint,
        Rims = "#c9ccd6",
        Neon = null,
        Decal = "none",
        Number = Math.Clamp(number, 1, 99),
    };

    /// <summary>Buys a car: unlocked, enabled, not owned yet, enough money. Takes the money and returns the new garage car.</summary>
    public static GarageCar Buy(Player player, Car car, IEnumerable<GarageCar> owned)
    {
        if (!car.IsEnabled || car.UpdateState == UpdateState.Deleted)
        {
            throw new BusinessException("Dieses Auto gibt es nicht mehr.");
        }

        if (owned.Any(g => g.CarId == car.Id && g.UpdateState != UpdateState.Deleted))
        {
            throw new BusinessException("Das Auto steht schon in deiner Garage.");
        }

        if (Progression.LevelOf(player.Xp) < car.UnlockLevel)
        {
            throw new BusinessException($"{car.Name} gibt es erst ab Level {car.UnlockLevel}.");
        }

        if (player.Money < car.Price)
        {
            throw new BusinessException("Dafür reicht dein Geld nicht.");
        }

        player.Money -= car.Price;
        return NewCar(player.Id, car, (int)(player.Id % 98) + 1);
    }

    /// <summary>Raises a part by one level: not at the top yet, enough money. Returns the price paid.</summary>
    public static int Upgrade(Player player, GarageCar garage, Car car, Part part)
    {
        if (garage.PlayerId != player.Id)
        {
            throw new AccessDeniedException();
        }

        var level = garage.LevelOf(part);
        if (level >= Tuning.MaxLevel)
        {
            throw new BusinessException($"{Tuning.PartName(part)} ist schon ganz oben.", "part");
        }

        var price = Tuning.UpgradePrice(car, part, level + 1);
        if (player.Money < price)
        {
            throw new BusinessException("Dafür reicht dein Geld nicht.", "part");
        }

        player.Money -= price;
        garage.SetLevel(part, level + 1);
        return price;
    }

    /// <summary>Changes the look: paint and rims any colour (#rrggbb), neon one of the neon colours or none, a decal of the list, a number 1..99.</summary>
    public static void SetLook(GarageCar garage, string? paint, string? rims, string? neon, string? decal, int? number)
    {
        if (paint is not null)
        {
            garage.Paint = Looks.IsColor(paint) ? paint.ToLowerInvariant() : throw new BusinessException("Diese Farbe gibt es nicht.", "paint");
        }

        if (rims is not null)
        {
            garage.Rims = Looks.IsColor(rims) ? rims.ToLowerInvariant() : throw new BusinessException("Diese Felgenfarbe gibt es nicht.", "rims");
        }

        if (neon is not null)
        {
            garage.Neon = neon.Length == 0 || neon == "none" ? null
                : Looks.IsColor(neon) ? neon.ToLowerInvariant() : throw new BusinessException("Diese Neonfarbe gibt es nicht.", "neon");
        }

        if (decal is not null)
        {
            garage.Decal = Looks.Decals.Contains(decal) ? decal : throw new BusinessException("Dieses Design gibt es nicht.", "decal");
        }

        if (number is not null)
        {
            garage.Number = number is >= 1 and <= 99 ? number.Value : throw new BusinessException("Die Startnummer geht von 1 bis 99.", "number");
        }
    }

    /// <summary>A bot's car: a car of the catalogue that fits the skill, in a random paint, tuned by the skill.</summary>
    public static CarView BotCar(IReadOnlyList<Car> cars, int seat, int skill, int seed)
    {
        var pool = cars.Where(c => c.IsEnabled).OrderBy(c => c.SortOrder).ToList();
        if (pool.Count == 0)
        {
            pool = SeedContent.Cars().ToList();
        }

        var random = new Random(seed * 31 + seat);
        var top = Math.Clamp((int)Math.Ceiling(pool.Count * Math.Clamp(skill, 1, 10) / 10.0), 1, pool.Count);
        var car = pool[random.Next(Math.Max(0, top - 3), top)];
        var level = Math.Clamp(skill / 2, 0, Tuning.MaxLevel);
        var garage = new GarageCar
        {
            Id = 0,
            CarId = car.Id,
            Paint = Looks.Paints[random.Next(Looks.Paints.Count)],
            Rims = random.Next(2) == 0 ? "#16151f" : "#c9ccd6",
            Neon = random.Next(3) == 0 ? null : Looks.Neons[random.Next(Looks.Neons.Count)],
            Decal = Looks.Decals[random.Next(Looks.Decals.Count)],
            Number = random.Next(1, 100),
            Engine = level,
            Turbo = level,
            Suspension = level,
            Tires = level,
            SteeringKit = level,
        };
        return Views.Car(garage, car);
    }
}

/// <summary>The outcome of one car of a run: its place, its (checked) result and what it earned.</summary>
public sealed record Outcome(Seat Seat, int Place, long Score, int? TimeMs, int? BestLapMs, long BestCombo, double MaxAngle, double DriftDistanceM, bool Finished,
    bool Flagged, long Money, long Xp);

/// <summary>The end of a run: checks the results, orders the cars, pays the players, writes the competition results.</summary>
public static class RunRules
{
    /// <summary>
    /// The outcomes of every car in order. A car without a result counts with its last state (not finished). Points above
    /// <see cref="Plausibility.MaxScore"/> and race times below <see cref="Plausibility.MinRaceTimeMs"/> are cut and flagged.
    /// </summary>
    public static IReadOnlyList<Outcome> Outcomes(DriftRoom room, DateTime now, int maxPointsPerSecond, int rewardFactorPercent)
    {
        var settings = room.Settings;
        var start = room.StartAt ?? room.CreatedAt;
        var rows = room.Seats.Select(seat =>
        {
            var result = seat.Result;
            var state = seat.LastState;
            var score = result?.Score ?? (long)(state is { Length: > DriftRoom.StateScore } ? state[DriftRoom.StateScore] : 0);
            var lap = result?.Laps ?? (int)(state is { Length: > DriftRoom.StateLap } ? state[DriftRoom.StateLap] : 0);
            var progress = state is { Length: > DriftRoom.StateProgress } ? state[DriftRoom.StateProgress] : 0;
            var elapsed = ((seat.FinishedAt ?? now) - start).TotalSeconds;
            var seconds = elapsed + 2;
            if (settings.Mode == GameMode.Score)
            {
                seconds = Math.Min(seconds, settings.DurationS + 5);
            }

            var flagged = false;
            var maxScore = Plausibility.MaxScore(seconds, maxPointsPerSecond);
            if (score > maxScore || score < 0)
            {
                score = Math.Clamp(score, 0, maxScore);
                flagged = true;
            }

            var time = result?.TimeMs;
            // a score attack counts as driven to the end only when its time ran out (quitting early keeps the points, not the place prize)
            var finished = result is not null && (settings.Mode != GameMode.Score || elapsed >= settings.DurationS - 3);
            if (settings.Mode == GameMode.Race)
            {
                finished = result is not null && time is > 0 && lap >= settings.Laps;
                if (finished && time < Plausibility.MinRaceTimeMs(settings.LengthM, settings.Laps))
                {
                    flagged = true;
                    finished = false;
                }

                if (!finished)
                {
                    time = null;
                }
            }

            return new { Seat = seat, Score = score, Time = time, Lap = lap + progress, Finished = finished, Flagged = flagged, Result = result };
        }).ToList();

        var ordered = settings.Mode == GameMode.Race
            ? rows.OrderByDescending(r => r.Finished).ThenBy(r => r.Time ?? int.MaxValue).ThenByDescending(r => r.Lap).ThenByDescending(r => r.Score).ToList()
            : rows.OrderByDescending(r => r.Score).ThenBy(r => r.Seat.Number).ToList();

        var field = ordered.Count;
        return ordered.Select((r, index) =>
        {
            var place = index + 1;
            var human = !r.Seat.IsBot;
            return new Outcome(r.Seat, place, r.Score, r.Time, r.Finished ? r.Result?.BestLapMs : null, Math.Max(0, r.Result?.BestCombo ?? 0),
                Math.Clamp(r.Result?.MaxAngle ?? 0, 0, 180), Math.Clamp(r.Result?.DriftDistanceM ?? 0, 0, 1_000_000), r.Finished, r.Flagged,
                human ? Economy.MoneyOf(settings.Mode, place, field, r.Score, r.Finished, rewardFactorPercent) : 0,
                human ? Economy.XpOf(settings.Mode, place, field, r.Score, r.Finished) : 0);
        }).ToList();
    }

    /// <summary>Adds a run to a player's numbers and pays him.</summary>
    public static void Apply(Player player, Outcome outcome, GameMode mode, int field)
    {
        player.RunsPlayed++;
        if (outcome.Place == 1 && field > 1 && mode != GameMode.Freeride && outcome.Finished)
        {
            player.Wins++;
        }

        player.TotalScore += outcome.Score;
        player.BestScore = Math.Max(player.BestScore, outcome.Score);
        player.BestCombo = Math.Max(player.BestCombo, outcome.BestCombo);
        player.MaxAngle = Math.Max(player.MaxAngle, outcome.MaxAngle);
        player.DriftDistanceM += outcome.DriftDistanceM;
        player.Money += outcome.Money;
        player.Xp += outcome.Xp;
    }

    /// <summary>
    /// Writes a competition run into the player's result (best, medal, attempts) and pays a better medal once. Returns what the results screen shows.
    /// </summary>
    public static CompetitionOutcomeView ApplyCompetition(Player player, Competition competition, CompetitionResult result, Outcome outcome)
    {
        var previous = result.Medal;
        var isNewBest = Medals.IsBetter(competition.Mode, outcome.Score, outcome.TimeMs, result.BestScore, result.BestTimeMs) || result.Attempts == 0;
        result.Attempts++;
        if (isNewBest)
        {
            result.BestScore = competition.Mode == GameMode.Race && outcome.TimeMs is null ? result.BestScore : outcome.Score;
            result.BestTimeMs = outcome.TimeMs ?? result.BestTimeMs;
        }

        var reached = Medals.Of(competition, outcome.Score, outcome.TimeMs);
        var reward = Medals.RewardForUpgrade(competition, previous, reached);
        if (reached > previous)
        {
            result.Medal = reached;
        }

        player.Money += reward;
        return new CompetitionOutcomeView(competition.Id, competition.Name, Views.MedalKey(reached), Views.MedalKey(previous), reward, isNewBest,
            result.BestScore, result.BestTimeMs, Views.Goals(competition));
    }

    /// <summary>The results as every client sees them.</summary>
    public static ResultsView View(DriftRoom room, IReadOnlyList<Outcome> outcomes, CompetitionOutcomeView? competition)
        => new(room.Token, room.Code, room.Settings.Map, Looks.ModeKey(room.Settings.Mode),
            outcomes.Select(o => new ResultEntryView(o.Seat.Number, o.Seat.Name, o.Seat.IsBot, o.Seat.PlayerId, o.Seat.Car.Name, o.Place, o.Score, o.TimeMs,
                o.BestLapMs, o.BestCombo, Math.Round(o.MaxAngle, 1), Math.Round(o.DriftDistanceM), o.Finished, o.Money, o.Xp, o.Flagged)).ToList(),
            competition);

    /// <summary>A free room code: four letters without I and O.</summary>
    public static string NewCode(Random random, Func<string, bool> taken)
    {
        const string letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        while (true)
        {
            var code = new string(Enumerable.Range(0, 4).Select(_ => letters[random.Next(letters.Length)]).ToArray());
            if (!taken(code))
            {
                return code;
            }
        }
    }
}
