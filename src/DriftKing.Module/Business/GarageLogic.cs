using DriftKing.Data;
using Microsoft.EntityFrameworkCore;

namespace DriftKing.Business;

/// <summary>The player's garage: buying cars, tuning, the look, the car to drive. The rules are <see cref="GarageRules"/>.</summary>
public static class GarageLogic
{
    public static async Task<GarageView> GarageAsync(AppDbContext db, Actor actor)
    {
        Guard.Player(actor);
        var player = await db.Players.AsNoTracking().FirstAsync(p => p.Id == actor.PlayerId);
        var cars = await OwnedAsync(db, actor.PlayerId, tracking: false);
        return new GarageView(cars.Select(g => Views.GarageCar(g, g.Car!)).ToList(), player.SelectedGarageCarId ?? cars.FirstOrDefault()?.Id, player.Money);
    }

    public static async Task<GarageView> BuyAsync(AppDbContext db, Actor actor, long carId)
    {
        Guard.Player(actor);
        var player = await db.Players.FirstAsync(p => p.Id == actor.PlayerId);
        var car = await db.Cars.FirstOrDefaultAsync(c => c.Id == carId) ?? throw new BusinessException("Dieses Auto gibt es nicht.");
        var owned = await db.GarageCars.Where(g => g.PlayerId == actor.PlayerId).ToListAsync();
        var bought = GarageRules.Buy(player, car, owned);
        db.GarageCars.Add(bought);
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
        player.SelectedGarageCarId = bought.Id;
        await db.SaveChangesAsync();
        return await GarageAsync(db, actor);
    }

    public static async Task<GarageView> UpgradeAsync(AppDbContext db, Actor actor, long garageCarId, Part part)
    {
        Guard.Player(actor);
        var player = await db.Players.FirstAsync(p => p.Id == actor.PlayerId);
        var garage = await OwnAsync(db, actor, garageCarId);
        GarageRules.Upgrade(player, garage, garage.Car!, part);
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
        return await GarageAsync(db, actor);
    }

    public static async Task<GarageView> SetLookAsync(AppDbContext db, Actor actor, long garageCarId, string? paint, string? rims, string? neon, string? decal,
        int? number)
    {
        Guard.Player(actor);
        var garage = await OwnAsync(db, actor, garageCarId);
        GarageRules.SetLook(garage, paint, rims, neon, decal, number);
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
        return await GarageAsync(db, actor);
    }

    public static async Task<GarageView> SelectAsync(AppDbContext db, Actor actor, long garageCarId)
    {
        Guard.Player(actor);
        var garage = await OwnAsync(db, actor, garageCarId);
        var player = await db.Players.FirstAsync(p => p.Id == actor.PlayerId);
        player.SelectedGarageCarId = garage.Id;
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
        return await GarageAsync(db, actor);
    }

    /// <summary>The car the player drives now (the selected one, else the first of the garage). Throws when the garage is empty.</summary>
    public static async Task<CarView> SelectedCarAsync(AppDbContext db, Actor actor)
    {
        Guard.Player(actor);
        var player = await db.Players.AsNoTracking().FirstAsync(p => p.Id == actor.PlayerId);
        var cars = await OwnedAsync(db, actor.PlayerId, tracking: false);
        var garage = cars.FirstOrDefault(g => g.Id == player.SelectedGarageCarId) ?? cars.FirstOrDefault()
                     ?? throw new BusinessException("Deine Garage ist leer – kauf dir erst ein Auto.");
        return Views.Car(garage, garage.Car!);
    }

    /// <summary>The garage cars of a player for the administration.</summary>
    public static async Task<IReadOnlyList<GarageCarView>> OfPlayerAsync(AppDbContext db, Actor actor, long playerId)
    {
        Guard.Admin(actor);
        var cars = await OwnedAsync(db, playerId, tracking: false);
        return cars.Select(g => Views.GarageCar(g, g.Car!)).ToList();
    }

    private static async Task<List<GarageCar>> OwnedAsync(AppDbContext db, long playerId, bool tracking)
    {
        var query = db.GarageCars.Include(g => g.Car).Where(g => g.PlayerId == playerId && g.UpdateState != UpdateState.Deleted);
        if (!tracking)
        {
            query = query.AsNoTracking();
        }

        return await query.OrderBy(g => g.Car!.SortOrder).ThenBy(g => g.Id).ToListAsync();
    }

    private static async Task<GarageCar> OwnAsync(AppDbContext db, Actor actor, long garageCarId)
    {
        var garage = await db.GarageCars.Include(g => g.Car).FirstOrDefaultAsync(g => g.Id == garageCarId && g.UpdateState != UpdateState.Deleted)
                     ?? throw new BusinessException("Dieses Auto steht nicht in deiner Garage.");
        Guard.AdminOrSelf(actor, garage.PlayerId);
        if (garage.PlayerId != actor.PlayerId)
        {
            throw new AccessDeniedException();
        }

        return garage;
    }
}
