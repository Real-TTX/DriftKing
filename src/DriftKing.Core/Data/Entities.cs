namespace DriftKing.Data;

/// <summary>Soft delete state of a record: 0 = deleted, 1 = created, 2 = updated.</summary>
public enum UpdateState
{
    Deleted = 0,
    Created = 1,
    Updated = 2,
}

/// <summary>Every record: a bigint key and the audit columns (filled when saving).</summary>
public abstract class Entity
{
    public long Id { get; set; }

    public DateTime CreateDate { get; set; }

    public long? CreateUserId { get; set; }

    public DateTime UpdateDate { get; set; }

    public long? UpdateUserId { get; set; }
}

/// <summary>A record that is never removed, only marked deleted.</summary>
public abstract class SoftDeleteEntity : Entity
{
    public UpdateState UpdateState { get; set; } = UpdateState.Created;
}

/// <summary>Which wheels drive: rear wheel drive slides easily, all wheel drive pulls the car straight.</summary>
public enum CarDrive
{
    RWD = 0,
    AWD = 1,
}

/// <summary>How a run is played.</summary>
public enum GameMode
{
    /// <summary>Free driving without a clock: points count, there is no winner.</summary>
    Freeride = 0,

    /// <summary>Drift score attack on time: the most points win.</summary>
    Score = 1,

    /// <summary>A race over laps: the fastest wins.</summary>
    Race = 2,
}

/// <summary>The light of a map.</summary>
public enum TimeOfDay
{
    Night = 0,
    Dusk = 1,
}

/// <summary>The state of a run in the database.</summary>
public enum RunStatus
{
    Running = 0,
    Finished = 1,
    Aborted = 2,
}

/// <summary>The medal of a competition result.</summary>
public enum Medal
{
    None = 0,
    Bronze = 1,
    Silver = 2,
    Gold = 3,
}

/// <summary>The tuning parts of a garage car.</summary>
public enum Part
{
    Engine = 0,
    Turbo = 1,
    Suspension = 2,
    Tires = 3,
    Steering = 4,
}

/// <summary>
/// A player of DriftKing: the key is the MatGame account id. Made at the first request with the start money and the starter car.
/// </summary>
public sealed class Player : SoftDeleteEntity
{
    public string DisplayName { get; set; } = string.Empty;

    public bool IsGuest { get; set; }

    /// <summary>Money in yen.</summary>
    public long Money { get; set; }

    public long Xp { get; set; }

    public int RunsPlayed { get; set; }

    public int Wins { get; set; }

    public long TotalScore { get; set; }

    public long BestScore { get; set; }

    public long BestCombo { get; set; }

    public double MaxAngle { get; set; }

    public double DriftDistanceM { get; set; }

    public long? SelectedGarageCarId { get; set; }

    public DateTime LastSeenDate { get; set; }
}

/// <summary>A car of the dealer (the catalogue). Values 1 to 10; <see cref="Body"/> names the 3D model of the browser.</summary>
public sealed class Car : SoftDeleteEntity
{
    /// <summary>Stable key (bots, seeds): lower case letters and digits.</summary>
    public string Key { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string Body { get; set; } = "coupe";

    public CarDrive Drive { get; set; }

    public int Power { get; set; } = 5;

    public int Grip { get; set; } = 5;

    public int Weight { get; set; } = 5;

    public int Steering { get; set; } = 5;

    /// <summary>Price in yen; 0 = the starter car every new player gets.</summary>
    public int Price { get; set; }

    public int UnlockLevel { get; set; } = 1;

    public string DefaultPaint { get; set; } = "#f4f2ff";

    public int SortOrder { get; set; } = 100;

    public bool IsEnabled { get; set; } = true;
}

/// <summary>A car a player owns, with its tuning levels and its look.</summary>
public sealed class GarageCar : SoftDeleteEntity
{
    public long PlayerId { get; set; }

    public long CarId { get; set; }

    public Car? Car { get; set; }

    public string Paint { get; set; } = "#f4f2ff";

    public string Rims { get; set; } = "#c9ccd6";

    /// <summary>The underglow colour, null = none.</summary>
    public string? Neon { get; set; }

    public string Decal { get; set; } = "none";

    public int Number { get; set; } = 7;

    public int Engine { get; set; }

    public int Turbo { get; set; }

    public int Suspension { get; set; }

    public int Tires { get; set; }

    public int SteeringKit { get; set; }

    public int LevelOf(Part part) => part switch
    {
        Part.Engine => Engine,
        Part.Turbo => Turbo,
        Part.Suspension => Suspension,
        Part.Tires => Tires,
        Part.Steering => SteeringKit,
        _ => 0,
    };

    public void SetLevel(Part part, int level)
    {
        switch (part)
        {
            case Part.Engine: Engine = level; break;
            case Part.Turbo: Turbo = level; break;
            case Part.Suspension: Suspension = level; break;
            case Part.Tires: Tires = level; break;
            case Part.Steering: SteeringKit = level; break;
        }
    }
}

/// <summary>A map of the game. The geometry lives in the browser (<c>js/game/world</c>, <c>data/maps.json</c>); the key is the contract.</summary>
public sealed class Map : Entity
{
    public string Key { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public TimeOfDay TimeOfDay { get; set; }

    public int DefaultLaps { get; set; } = 3;

    public int UnlockLevel { get; set; } = 1;

    public int SortOrder { get; set; } = 100;

    public bool IsEnabled { get; set; } = true;
}

/// <summary>
/// A competition ("Wettbewerb"): a fixed task on a map (score attack or race) with medal targets and prize money. Players play it alone against bots,
/// their best result counts. For <see cref="GameMode.Score"/> the targets are points (more is better), for <see cref="GameMode.Race"/> milliseconds (less is better).
/// </summary>
public sealed class Competition : SoftDeleteEntity
{
    public string Name { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public long MapId { get; set; }

    public Map? Map { get; set; }

    public GameMode Mode { get; set; } = GameMode.Score;

    public int Laps { get; set; } = 3;

    public int DurationS { get; set; } = 120;

    public int Bots { get; set; } = 3;

    /// <summary>How well the bots drive, 1 to 10.</summary>
    public int BotSkill { get; set; } = 5;

    public long Bronze { get; set; }

    public long Silver { get; set; }

    public long Gold { get; set; }

    public int RewardBronze { get; set; } = 1500;

    public int RewardSilver { get; set; } = 3000;

    public int RewardGold { get; set; } = 6000;

    public int UnlockLevel { get; set; } = 1;

    public DateTime? StartDate { get; set; }

    public DateTime? EndDate { get; set; }

    public int SortOrder { get; set; } = 100;

    public bool IsEnabled { get; set; } = true;
}

/// <summary>The best result of a player in a competition; the medals are paid once each.</summary>
public sealed class CompetitionResult : Entity
{
    public long CompetitionId { get; set; }

    public Competition? Competition { get; set; }

    public long PlayerId { get; set; }

    public long BestScore { get; set; }

    public int? BestTimeMs { get; set; }

    public Medal Medal { get; set; }

    public int Attempts { get; set; }
}

/// <summary>A played run (a room that started): who drove, where, what came out. The token is the run's address in links and logs.</summary>
public sealed class Run : Entity
{
    public Guid Token { get; set; } = Guid.NewGuid();

    /// <summary>The code of the room (4 letters).</summary>
    public string Code { get; set; } = string.Empty;

    public string MapKey { get; set; } = string.Empty;

    public GameMode Mode { get; set; }

    public int Laps { get; set; }

    public int DurationS { get; set; }

    public long? CompetitionId { get; set; }

    public RunStatus Status { get; set; }

    public bool IsOnline { get; set; }

    public int Humans { get; set; }

    public int Bots { get; set; }

    public DateTime StartDate { get; set; }

    public DateTime? EndDate { get; set; }

    public List<RunEntry> Entries { get; set; } = [];
}

/// <summary>One car of a run and its result. Bots have no player.</summary>
public sealed class RunEntry : Entity
{
    public long RunId { get; set; }

    public Run? Run { get; set; }

    public int Seat { get; set; }

    public long? PlayerId { get; set; }

    public bool IsBot { get; set; }

    public string Name { get; set; } = string.Empty;

    public string CarName { get; set; } = string.Empty;

    public string CarBody { get; set; } = string.Empty;

    public long Score { get; set; }

    public int? TimeMs { get; set; }

    public int? BestLapMs { get; set; }

    public long BestCombo { get; set; }

    public double MaxAngle { get; set; }

    public double DriftDistanceM { get; set; }

    public bool Finished { get; set; }

    public int Place { get; set; }

    public long Money { get; set; }

    public long Xp { get; set; }

    /// <summary>The result was not plausible (too many points or too fast) and was cut.</summary>
    public bool Flagged { get; set; }
}

/// <summary>A setting of the game (key/value).</summary>
public sealed class Setting : Entity
{
    public string Key { get; set; } = string.Empty;

    public string Value { get; set; } = string.Empty;
}
