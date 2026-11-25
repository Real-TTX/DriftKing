using DriftKing.Data;
using Microsoft.EntityFrameworkCore;

namespace DriftKing.Business;

/// <summary>What the administration may change of a player.</summary>
public sealed record PlayerInput(long Id, string DisplayName, long Money, long Xp);

/// <summary>The players of DriftKing (one per MatGame account).</summary>
public static class PlayerLogic
{
    /// <summary>
    /// The player of an account: made at the first visit with the start money and the starter cars (price 0); the name follows the account.
    /// Returns null when an administrator removed the player.
    /// </summary>
    public static async Task<Player?> EnsureAsync(AppDbContext db, Actor actor, bool isGuest)
    {
        Guard.Player(actor);
        var player = await db.Players.FirstOrDefaultAsync(p => p.Id == actor.PlayerId);
        var now = DateTime.UtcNow;
        if (player is not null)
        {
            if (player.UpdateState == UpdateState.Deleted)
            {
                return null;
            }

            if (player.DisplayName != actor.DisplayName || player.IsGuest != isGuest || now - player.LastSeenDate > TimeSpan.FromMinutes(5))
            {
                player.DisplayName = actor.DisplayName;
                player.IsGuest = isGuest;
                player.LastSeenDate = now;
                db.ActingAs(actor.AuditId);
                await db.SaveChangesAsync();
            }

            return player;
        }

        var settings = await SettingLogic.GetAsync(db);
        player = new Player { Id = actor.PlayerId, DisplayName = actor.DisplayName, IsGuest = isGuest, Money = settings.StartMoney, LastSeenDate = now };
        db.Players.Add(player);
        var starters = await db.Cars.Where(c => c.Price == 0 && c.IsEnabled && c.UpdateState != UpdateState.Deleted).OrderBy(c => c.SortOrder).ToListAsync();
        foreach (var car in starters)
        {
            db.GarageCars.Add(GarageRules.NewCar(player.Id, car, (int)(player.Id % 98) + 1));
        }

        db.ActingAs(actor.AuditId);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // two first requests at once: the other one made the player
            db.ChangeTracker.Clear();
            return await db.Players.FirstOrDefaultAsync(p => p.Id == actor.PlayerId && p.UpdateState != UpdateState.Deleted);
        }

        var first = await db.GarageCars.Where(g => g.PlayerId == player.Id).OrderBy(g => g.Id).FirstOrDefaultAsync();
        if (first is not null)
        {
            player.SelectedGarageCarId = first.Id;
            await db.SaveChangesAsync();
        }

        return player;
    }

    public static async Task<Player?> GetAsync(AppDbContext db, Actor actor, long playerId)
    {
        Guard.AdminOrSelf(actor, playerId);
        return await db.Players.AsNoTracking().FirstOrDefaultAsync(p => p.Id == playerId && p.UpdateState != UpdateState.Deleted);
    }

    /// <summary>The place in the leaderboard (by XP; guests have none).</summary>
    public static async Task<int?> RankAsync(AppDbContext db, Player player)
    {
        if (player.IsGuest)
        {
            return null;
        }

        return await db.Players.CountAsync(p => !p.IsGuest && p.UpdateState != UpdateState.Deleted && p.Xp > player.Xp) + 1;
    }

    public static async Task<ProfileView> ProfileAsync(AppDbContext db, Actor actor)
    {
        Guard.Player(actor);
        var player = await db.Players.AsNoTracking().FirstAsync(p => p.Id == actor.PlayerId);
        var medals = await db.CompetitionResults.Where(r => r.PlayerId == actor.PlayerId).GroupBy(r => r.Medal).Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync();
        var cars = await db.GarageCars.CountAsync(g => g.PlayerId == actor.PlayerId && g.UpdateState != UpdateState.Deleted);
        return new ProfileView(Views.Player(player, actor.IsAdmin), Views.Stats(player, await RankAsync(db, player)),
            medals.FirstOrDefault(m => m.Key == Medal.Gold)?.Count ?? 0, medals.FirstOrDefault(m => m.Key == Medal.Silver)?.Count ?? 0,
            medals.FirstOrDefault(m => m.Key == Medal.Bronze)?.Count ?? 0, cars);
    }

    /// <summary>The leaderboard of the players with an account: by level (xp), best run (score), wins or total points.</summary>
    public static async Task<IReadOnlyList<LeaderView>> LeaderboardAsync(AppDbContext db, Actor actor, string? by)
    {
        Guard.Player(actor);
        var query = db.Players.AsNoTracking().Where(p => !p.IsGuest && p.UpdateState != UpdateState.Deleted);
        var ordered = by switch
        {
            "score" => query.OrderByDescending(p => p.BestScore),
            "wins" => query.OrderByDescending(p => p.Wins),
            "total" => query.OrderByDescending(p => p.TotalScore),
            _ => query.OrderByDescending(p => p.Xp),
        };
        var top = await ordered.ThenBy(p => p.Id).Take(50).ToListAsync();
        return top.Select((p, i) => new LeaderView(i + 1, p.Id, p.DisplayName, Progression.LevelOf(p.Xp), by switch
        {
            "score" => p.BestScore,
            "wins" => p.Wins,
            "total" => p.TotalScore,
            _ => p.Xp,
        }, null, null, p.Id == actor.PlayerId)).ToList();
    }

    /// <summary>The account was deleted in MatGame: the player goes (garage, results cascade); the runs keep their names.</summary>
    public static async Task AccountDeletedAsync(AppDbContext db, Actor actor, long playerId)
    {
        Guard.Admin(actor);
        var player = await db.Players.FirstOrDefaultAsync(p => p.Id == playerId);
        if (player is null)
        {
            return;
        }

        await db.RunEntries.Where(e => e.PlayerId == playerId).ExecuteUpdateAsync(s => s.SetProperty(e => e.PlayerId, (long?)null));
        db.Players.Remove(player);
        await db.SaveChangesAsync();
    }

    // ---- administration

    public static async Task<PagedResult<Player>> ListAsync(AppDbContext db, Actor actor, ListRequest request)
    {
        Guard.Admin(actor);
        var all = db.Players.AsNoTracking().Where(p => p.UpdateState != UpdateState.Deleted);
        var query = all;
        if (request.Search is { } search)
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(p => EF.Functions.ILike(p.DisplayName, pattern));
        }

        query = request.Filter("kind") switch
        {
            "guest" => query.Where(p => p.IsGuest),
            "account" => query.Where(p => !p.IsGuest),
            _ => query,
        };
        query = request.Sort switch
        {
            "name" => query.SortBy(p => p.DisplayName, request.Descending),
            "money" => query.SortBy(p => p.Money, request.Descending),
            "runs" => query.SortBy(p => p.RunsPlayed, request.Descending),
            "score" => query.SortBy(p => p.BestScore, request.Descending),
            "seen" => query.SortBy(p => p.LastSeenDate, request.Descending),
            _ => query.SortBy(p => p.Xp, !request.Descending),
        };
        return new PagedResult<Player>(await query.Page(request).ToListAsync(), await query.CountAsync(), await all.CountAsync());
    }

    public static async Task SaveAsync(AppDbContext db, Actor actor, PlayerInput input)
    {
        Guard.Admin(actor);
        var player = await db.Players.FirstOrDefaultAsync(p => p.Id == input.Id && p.UpdateState != UpdateState.Deleted)
                     ?? throw new BusinessException("Diesen Fahrer gibt es nicht.");
        if (string.IsNullOrWhiteSpace(input.DisplayName) || input.DisplayName.Trim().Length > 60)
        {
            throw new BusinessException("Ein Name mit 1 bis 60 Zeichen.", nameof(PlayerInput.DisplayName));
        }

        if (input.Money is < 0 or > 1_000_000_000)
        {
            throw new BusinessException("Zwischen 0 und 1 Milliarde Yen.", nameof(PlayerInput.Money));
        }

        if (input.Xp is < 0 or > 100_000_000)
        {
            throw new BusinessException("Zwischen 0 und 100 Millionen XP.", nameof(PlayerInput.Xp));
        }

        player.DisplayName = input.DisplayName.Trim();
        player.Money = input.Money;
        player.Xp = input.Xp;
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
    }

    /// <summary>Removes a player from DriftKing (soft): the account stays in MatGame, a new visit does not bring the player back.</summary>
    public static async Task DeleteAsync(AppDbContext db, Actor actor, long playerId)
    {
        Guard.Admin(actor);
        var player = await db.Players.FirstOrDefaultAsync(p => p.Id == playerId) ?? throw new BusinessException("Diesen Fahrer gibt es nicht.");
        player.UpdateState = UpdateState.Deleted;
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
    }

    /// <summary>Gives a removed player a fresh start (his records are deleted, the next visit makes him new).</summary>
    public static async Task ResetAsync(AppDbContext db, Actor actor, long playerId)
    {
        Guard.Admin(actor);
        await AccountDeletedAsync(db, Actor.System, playerId);
    }
}
