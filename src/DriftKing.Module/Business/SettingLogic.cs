using System.Globalization;
using DriftKing.Data;
using Microsoft.EntityFrameworkCore;

namespace DriftKing.Business;

/// <summary>The settings of the game as the administration keeps them.</summary>
/// <param name="Announcement">A text in the main menu (empty = none).</param>
/// <param name="MaxPlayers">The most players a room may have (2 to 8).</param>
/// <param name="GuestsCreateRooms">Guests may open public rooms (they may always join one and play alone).</param>
/// <param name="StartMoney">What a new player gets (yen).</param>
/// <param name="RewardFactor">The prize money of runs in percent (100 = normal).</param>
/// <param name="MaxPointsPerSecond">The plausibility limit of drift points per second (results above are cut and flagged).</param>
public sealed record GameSettings(string Announcement, int MaxPlayers, bool GuestsCreateRooms, int StartMoney, int RewardFactor, int MaxPointsPerSecond)
{
    public static readonly GameSettings Default = new(string.Empty, 8, true, (int)GarageRules.DefaultStartMoney, 100, Plausibility.DefaultMaxPointsPerSecond);
}

public static class SettingLogic
{
    private const string AnnouncementKey = "Announcement";
    private const string MaxPlayersKey = "MaxPlayers";
    private const string GuestsCreateRoomsKey = "GuestsCreateRooms";
    private const string StartMoneyKey = "StartMoney";
    private const string RewardFactorKey = "RewardFactor";
    private const string MaxPointsPerSecondKey = "MaxPointsPerSecond";

    /// <summary>The settings (everybody may read them: the menus show the announcement, the rooms use the limits).</summary>
    public static async Task<GameSettings> GetAsync(AppDbContext db)
    {
        var all = await db.Settings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value);
        var fallback = GameSettings.Default;
        return new GameSettings(
            all.GetValueOrDefault(AnnouncementKey, fallback.Announcement),
            Number(all, MaxPlayersKey, fallback.MaxPlayers),
            all.GetValueOrDefault(GuestsCreateRoomsKey, "true") == "true",
            Number(all, StartMoneyKey, fallback.StartMoney),
            Number(all, RewardFactorKey, fallback.RewardFactor),
            Number(all, MaxPointsPerSecondKey, fallback.MaxPointsPerSecond));
    }

    public static async Task SaveAsync(AppDbContext db, Actor actor, GameSettings settings)
    {
        Guard.Admin(actor);
        if (settings.MaxPlayers is < 2 or > 8)
        {
            throw new BusinessException("2 bis 8 Spieler.", nameof(GameSettings.MaxPlayers));
        }

        if (settings.StartMoney is < 0 or > 1_000_000)
        {
            throw new BusinessException("Das Startgeld liegt zwischen 0 und 1 Million.", nameof(GameSettings.StartMoney));
        }

        if (settings.RewardFactor is < 0 or > 1000)
        {
            throw new BusinessException("Zwischen 0 und 1000 Prozent.", nameof(GameSettings.RewardFactor));
        }

        if (settings.MaxPointsPerSecond is < 1000 or > 100_000)
        {
            throw new BusinessException("Zwischen 1 000 und 100 000 Punkten pro Sekunde.", nameof(GameSettings.MaxPointsPerSecond));
        }

        if ((settings.Announcement ?? string.Empty).Length > 500)
        {
            throw new BusinessException("Höchstens 500 Zeichen.", nameof(GameSettings.Announcement));
        }

        await SetAsync(db, AnnouncementKey, (settings.Announcement ?? string.Empty).Trim());
        await SetAsync(db, MaxPlayersKey, settings.MaxPlayers.ToString(CultureInfo.InvariantCulture));
        await SetAsync(db, GuestsCreateRoomsKey, settings.GuestsCreateRooms ? "true" : "false");
        await SetAsync(db, StartMoneyKey, settings.StartMoney.ToString(CultureInfo.InvariantCulture));
        await SetAsync(db, RewardFactorKey, settings.RewardFactor.ToString(CultureInfo.InvariantCulture));
        await SetAsync(db, MaxPointsPerSecondKey, settings.MaxPointsPerSecond.ToString(CultureInfo.InvariantCulture));
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
    }

    private static int Number(Dictionary<string, string> all, string key, int fallback)
        => int.TryParse(all.GetValueOrDefault(key), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : fallback;

    private static async Task SetAsync(AppDbContext db, string key, string value)
    {
        var setting = await db.Settings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting is null)
        {
            db.Settings.Add(new Setting { Key = key, Value = value });
        }
        else
        {
            setting.Value = value;
        }
    }
}

/// <summary>The seeded content: added to a new (or older) database by key / name; what an administrator changed stays.</summary>
public static class SeedLogic
{
    public static async Task EnsureAsync(AppDbContext db, Actor actor)
    {
        Guard.Admin(actor);
        db.ActingAs(actor.AuditId);
        var cars = await db.Cars.Select(c => c.Key).ToListAsync();
        db.Cars.AddRange(SeedContent.Cars().Where(c => !cars.Contains(c.Key)));

        var maps = await db.Maps.Select(m => m.Key).ToListAsync();
        db.Maps.AddRange(SeedContent.Maps().Where(m => !maps.Contains(m.Key)));
        await db.SaveChangesAsync();

        // the competitions only on a fresh database: an administrator may delete or rename them
        if (!await db.Competitions.AnyAsync())
        {
            var ids = await db.Maps.ToDictionaryAsync(m => m.Key, m => m.Id);
            db.Competitions.AddRange(SeedContent.Competitions(key => ids[key]));
            await db.SaveChangesAsync();
        }
    }
}
