using System.Text.RegularExpressions;
using DriftKing.Data;
using Microsoft.EntityFrameworkCore;

namespace DriftKing.Business;

/// <summary>A car of the dealer as the administration edits it.</summary>
public sealed record CarInput(long Id, string Key, string Name, string Description, string Body, CarDrive Drive, int Power, int Grip, int Weight, int Steering,
    int Price, int UnlockLevel, string DefaultPaint, int SortOrder, bool IsEnabled);

/// <summary>A map as the administration edits it (the key must be one of the browser's maps).</summary>
public sealed record MapInput(long Id, string Key, string Name, string Description, TimeOfDay TimeOfDay, int DefaultLaps, int UnlockLevel, int SortOrder,
    bool IsEnabled);

/// <summary>The content of the game: the dealer's cars and the maps (the menus read them, the administration edits them).</summary>
public static partial class ContentLogic
{
    /// <summary>The dealer and the maps for the menus (locked ones included, marked).</summary>
    public static async Task<CatalogView> CatalogAsync(AppDbContext db, Actor actor)
    {
        Guard.Player(actor);
        var player = await db.Players.AsNoTracking().FirstAsync(p => p.Id == actor.PlayerId);
        var level = Progression.LevelOf(player.Xp);
        var owned = await db.GarageCars.Where(g => g.PlayerId == actor.PlayerId && g.UpdateState != UpdateState.Deleted).Select(g => g.CarId).ToListAsync();
        var cars = await CarsAsync(db);
        var maps = await MapsAsync(db);
        return new CatalogView(cars.Select(c => Views.Dealer(c, owned.Contains(c.Id), level)).ToList(), maps.Select(m => Views.Map(m, level)).ToList());
    }

    /// <summary>The cars in the dealer's shop (for the menus and the bots).</summary>
    public static async Task<IReadOnlyList<Car>> CarsAsync(AppDbContext db)
        => await db.Cars.AsNoTracking().Where(c => c.IsEnabled && c.UpdateState != UpdateState.Deleted).OrderBy(c => c.SortOrder).ThenBy(c => c.Id).ToListAsync();

    public static async Task<IReadOnlyList<Map>> MapsAsync(AppDbContext db)
        => await db.Maps.AsNoTracking().Where(m => m.IsEnabled).OrderBy(m => m.SortOrder).ThenBy(m => m.Id).ToListAsync();

    /// <summary>A map the player may drive now (enabled, unlocked); null key = the first one.</summary>
    public static async Task<Map> PlayableMapAsync(AppDbContext db, Actor actor, string? key)
    {
        Guard.Player(actor);
        var maps = await MapsAsync(db);
        var map = (key is null ? maps.FirstOrDefault() : maps.FirstOrDefault(m => m.Key == key)) ?? throw new BusinessException("Diese Strecke gibt es nicht.", "map");
        var player = await db.Players.AsNoTracking().FirstAsync(p => p.Id == actor.PlayerId);
        if (!actor.IsAdmin && Progression.LevelOf(player.Xp) < map.UnlockLevel)
        {
            throw new BusinessException($"{map.Name} gibt es erst ab Level {map.UnlockLevel}.", "map");
        }

        return map;
    }

    // ---- administration: cars

    public static async Task<PagedResult<Car>> ListCarsAsync(AppDbContext db, Actor actor, ListRequest request)
    {
        Guard.Admin(actor);
        var all = db.Cars.AsNoTracking().Where(c => c.UpdateState != UpdateState.Deleted);
        var query = all;
        if (request.Search is { } search)
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(c => EF.Functions.ILike(c.Name, pattern) || EF.Functions.ILike(c.Key, pattern) || EF.Functions.ILike(c.Description, pattern));
        }

        if (request.Filter("drive") is { } drive && Enum.TryParse<CarDrive>(drive, out var d))
        {
            query = query.Where(c => c.Drive == d);
        }

        query = request.Filter("status") switch
        {
            "enabled" => query.Where(c => c.IsEnabled),
            "disabled" => query.Where(c => !c.IsEnabled),
            _ => query,
        };
        query = request.Sort switch
        {
            "name" => query.SortBy(c => c.Name, request.Descending),
            "price" => query.SortBy(c => c.Price, request.Descending),
            "level" => query.SortBy(c => c.UnlockLevel, request.Descending),
            "power" => query.SortBy(c => c.Power, request.Descending),
            _ => query.SortBy(c => c.SortOrder, request.Descending),
        };
        return new PagedResult<Car>(await query.Page(request).ToListAsync(), await query.CountAsync(), await all.CountAsync());
    }

    public static async Task<Car?> GetCarAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Admin(actor);
        return await db.Cars.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id && c.UpdateState != UpdateState.Deleted);
    }

    public static async Task<long> SaveCarAsync(AppDbContext db, Actor actor, CarInput input)
    {
        Guard.Admin(actor);
        var key = (input.Key ?? string.Empty).Trim().ToLowerInvariant();
        if (!KeyPattern().IsMatch(key))
        {
            throw new BusinessException("2 bis 24 Kleinbuchstaben oder Ziffern.", nameof(CarInput.Key));
        }

        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 60)
        {
            throw new BusinessException("Ein Name mit 1 bis 60 Zeichen.", nameof(CarInput.Name));
        }

        if (!Looks.Bodies.Contains(input.Body))
        {
            throw new BusinessException("Diese Karosserie gibt es nicht.", nameof(CarInput.Body));
        }

        foreach (var (value, field) in new[] { (input.Power, nameof(CarInput.Power)), (input.Grip, nameof(CarInput.Grip)), (input.Weight, nameof(CarInput.Weight)),
                     (input.Steering, nameof(CarInput.Steering)) })
        {
            if (value is < 1 or > 10)
            {
                throw new BusinessException("Ein Wert von 1 bis 10.", field);
            }
        }

        if (input.Price is < 0 or > 10_000_000)
        {
            throw new BusinessException("Zwischen 0 und 10 Millionen Yen.", nameof(CarInput.Price));
        }

        if (input.UnlockLevel is < 1 or > Progression.MaxLevel)
        {
            throw new BusinessException($"Level 1 bis {Progression.MaxLevel}.", nameof(CarInput.UnlockLevel));
        }

        if (!Looks.IsColor(input.DefaultPaint))
        {
            throw new BusinessException("Eine Farbe wie #ff2e88.", nameof(CarInput.DefaultPaint));
        }

        if (await db.Cars.AnyAsync(c => c.Key == key && c.Id != input.Id))
        {
            throw new BusinessException("Diesen Schlüssel hat schon ein anderes Auto.", nameof(CarInput.Key));
        }

        var car = input.Id == 0 ? new Car() : await db.Cars.FirstOrDefaultAsync(c => c.Id == input.Id && c.UpdateState != UpdateState.Deleted)
                                               ?? throw new BusinessException("Dieses Auto gibt es nicht.");
        car.Key = key;
        car.Name = input.Name.Trim();
        car.Description = (input.Description ?? string.Empty).Trim();
        car.Body = input.Body;
        car.Drive = input.Drive;
        car.Power = input.Power;
        car.Grip = input.Grip;
        car.Weight = input.Weight;
        car.Steering = input.Steering;
        car.Price = input.Price;
        car.UnlockLevel = input.UnlockLevel;
        car.DefaultPaint = input.DefaultPaint.ToLowerInvariant();
        car.SortOrder = input.SortOrder;
        car.IsEnabled = input.IsEnabled;
        if (input.Id == 0)
        {
            db.Cars.Add(car);
        }

        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
        return car.Id;
    }

    /// <summary>Takes a car off the market (soft): who has it keeps it.</summary>
    public static async Task DeleteCarAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Admin(actor);
        var car = await db.Cars.FirstOrDefaultAsync(c => c.Id == id) ?? throw new BusinessException("Dieses Auto gibt es nicht.");
        car.UpdateState = UpdateState.Deleted;
        car.IsEnabled = false;
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
    }

    /// <summary>How many players own each car (the list of the administration).</summary>
    public static async Task<IReadOnlyDictionary<long, int>> OwnersAsync(AppDbContext db, Actor actor)
    {
        Guard.Admin(actor);
        return await db.GarageCars.Where(g => g.UpdateState != UpdateState.Deleted).GroupBy(g => g.CarId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count);
    }

    // ---- administration: maps

    public static async Task<PagedResult<Map>> ListMapsAsync(AppDbContext db, Actor actor, ListRequest request)
    {
        Guard.Admin(actor);
        var all = db.Maps.AsNoTracking();
        var query = all;
        if (request.Search is { } search)
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(m => EF.Functions.ILike(m.Name, pattern) || EF.Functions.ILike(m.Key, pattern) || EF.Functions.ILike(m.Description, pattern));
        }

        query = request.Filter("status") switch
        {
            "enabled" => query.Where(m => m.IsEnabled),
            "disabled" => query.Where(m => !m.IsEnabled),
            _ => query,
        };
        query = request.Sort switch
        {
            "name" => query.SortBy(m => m.Name, request.Descending),
            "level" => query.SortBy(m => m.UnlockLevel, request.Descending),
            _ => query.SortBy(m => m.SortOrder, request.Descending),
        };
        return new PagedResult<Map>(await query.Page(request).ToListAsync(), await query.CountAsync(), await all.CountAsync());
    }

    public static async Task<Map?> GetMapAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Admin(actor);
        return await db.Maps.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id);
    }

    public static async Task<long> SaveMapAsync(AppDbContext db, Actor actor, MapInput input)
    {
        Guard.Admin(actor);
        var key = (input.Key ?? string.Empty).Trim();
        if (!MapCatalog.Exists(key) && !SeedContent.Maps().Any(m => m.Key == key))
        {
            throw new BusinessException("Diese Karte kennt das Spiel nicht.", nameof(MapInput.Key));
        }

        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 60)
        {
            throw new BusinessException("Ein Name mit 1 bis 60 Zeichen.", nameof(MapInput.Name));
        }

        if (input.DefaultLaps is < 1 or > 20)
        {
            throw new BusinessException("1 bis 20 Runden.", nameof(MapInput.DefaultLaps));
        }

        if (input.UnlockLevel is < 1 or > Progression.MaxLevel)
        {
            throw new BusinessException($"Level 1 bis {Progression.MaxLevel}.", nameof(MapInput.UnlockLevel));
        }

        if (await db.Maps.AnyAsync(m => m.Key == key && m.Id != input.Id))
        {
            throw new BusinessException("Diese Karte gibt es schon.", nameof(MapInput.Key));
        }

        var map = input.Id == 0 ? new Map() : await db.Maps.FirstOrDefaultAsync(m => m.Id == input.Id) ?? throw new BusinessException("Diese Strecke gibt es nicht.");
        map.Key = key;
        map.Name = input.Name.Trim();
        map.Description = (input.Description ?? string.Empty).Trim();
        map.TimeOfDay = input.TimeOfDay;
        map.DefaultLaps = input.DefaultLaps;
        map.UnlockLevel = input.UnlockLevel;
        map.SortOrder = input.SortOrder;
        map.IsEnabled = input.IsEnabled;
        if (input.Id == 0)
        {
            db.Maps.Add(map);
        }

        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
        return map.Id;
    }

    /// <summary>Deletes a map (only when no competition uses it; switch it off otherwise).</summary>
    public static async Task DeleteMapAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Admin(actor);
        var map = await db.Maps.FirstOrDefaultAsync(m => m.Id == id) ?? throw new BusinessException("Diese Strecke gibt es nicht.");
        if (await db.Competitions.AnyAsync(c => c.MapId == id))
        {
            throw new BusinessException("Wettbewerbe fahren auf dieser Strecke – schalte sie stattdessen ab.");
        }

        db.Maps.Remove(map);
        await db.SaveChangesAsync();
    }

    /// <summary>The keys of the browser's maps that have no record yet (for "new map").</summary>
    public static async Task<IReadOnlyList<string>> FreeMapKeysAsync(AppDbContext db, Actor actor)
    {
        Guard.Admin(actor);
        var used = await db.Maps.Select(m => m.Key).ToListAsync();
        return MapCatalog.Maps.Select(m => m.Key).Concat(SeedContent.Maps().Select(m => m.Key)).Distinct().Where(k => !used.Contains(k)).ToList();
    }

    [GeneratedRegex("^[a-z0-9]{2,24}$")]
    private static partial Regex KeyPattern();
}
