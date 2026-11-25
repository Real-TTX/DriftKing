using System.Text.Json;
using DriftKing.Business;
using DriftKing.Data;

namespace DriftKing.Local;

/// <summary>
/// The offline profile on the device (profile.json in the app's data folder): the local driver with money and experience, the garage, the competition results
/// and the last runs. Offline progress counts only on this device (it is never uploaded).
/// </summary>
public sealed class LocalProfile
{
    public const string FileName = "profile.json";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public Player Player { get; set; } = new();

    public List<GarageCar> Garage { get; set; } = [];

    public List<CompetitionResult> Competitions { get; set; } = [];

    public List<HistoryView> History { get; set; } = [];

    public List<BestView> Bests { get; set; } = [];

    public long NextId { get; set; } = 1;

    [System.Text.Json.Serialization.JsonIgnore]
    public string? Path { get; private set; }

    public long NewId() => NextId++;

    /// <summary>Reads the profile (or starts one: start money, the starter cars of the catalogue).</summary>
    public static LocalProfile Load(string directory, string playerName, IReadOnlyList<Car> catalog)
    {
        var path = System.IO.Path.Combine(directory, FileName);
        LocalProfile profile;
        try
        {
            profile = File.Exists(path) ? JsonSerializer.Deserialize<LocalProfile>(File.ReadAllText(path), Json) ?? new LocalProfile() : new LocalProfile();
        }
        catch (JsonException)
        {
            // a broken file: keep it aside and start again
            File.Copy(path, path + ".broken", overwrite: true);
            profile = new LocalProfile();
        }

        profile.Path = path;
        if (profile.Player.Id == 0)
        {
            profile.Player = new Player
            {
                Id = DriftKingLocal.LocalPlayerId, DisplayName = string.IsNullOrWhiteSpace(playerName) ? "Gast" : playerName, IsGuest = true,
                Money = GarageRules.DefaultStartMoney, LastSeenDate = DateTime.UtcNow,
            };
        }

        if (profile.Garage.Count == 0)
        {
            foreach (var car in catalog.Where(c => c.Price == 0 && c.IsEnabled))
            {
                var garage = GarageRules.NewCar(profile.Player.Id, car, 7);
                garage.Id = profile.NewId();
                garage.Car = null;
                profile.Garage.Add(garage);
            }

            profile.Player.SelectedGarageCarId = profile.Garage.FirstOrDefault()?.Id;
        }

        profile.Save();
        return profile;
    }

    public void Save()
    {
        if (Path is null)
        {
            return;
        }

        foreach (var garage in Garage)
        {
            garage.Car = null;
        }

        var temp = Path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(this, Json));
        File.Move(temp, Path, overwrite: true);
    }
}
