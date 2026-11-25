using DriftKing.Data;
using Microsoft.EntityFrameworkCore;

namespace DriftKing.Business;

/// <summary>A competition as the administration edits it.</summary>
public sealed record CompetitionInput(long Id, string Name, string Description, long MapId, GameMode Mode, int Laps, int DurationS, int Bots, int BotSkill,
    long Bronze, long Silver, long Gold, int RewardBronze, int RewardSilver, int RewardGold, int UnlockLevel, DateTime? StartDate, DateTime? EndDate,
    int SortOrder, bool IsEnabled);

/// <summary>The competitions ("Wettbewerbe"): tasks with medal targets, played alone against bots; the best result of each player counts.</summary>
public static class CompetitionLogic
{
    /// <summary>The competitions open now, with the player's best.</summary>
    public static async Task<IReadOnlyList<CompetitionView>> ListForPlayerAsync(AppDbContext db, Actor actor)
    {
        Guard.Player(actor);
        var player = await db.Players.AsNoTracking().FirstAsync(p => p.Id == actor.PlayerId);
        var level = Progression.LevelOf(player.Xp);
        var now = DateTime.UtcNow;
        var list = await db.Competitions.AsNoTracking().Include(c => c.Map)
            .Where(c => c.IsEnabled && c.UpdateState != UpdateState.Deleted && c.Map!.IsEnabled && (c.StartDate == null || c.StartDate <= now) && (c.EndDate == null || c.EndDate >= now))
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Id).ToListAsync();
        var mine = await db.CompetitionResults.AsNoTracking().Where(r => r.PlayerId == actor.PlayerId).ToDictionaryAsync(r => r.CompetitionId);
        return list.Select(c => Views.Competition(c, c.Map!, level, mine.GetValueOrDefault(c.Id))).ToList();
    }

    /// <summary>A competition the player may start now (open, unlocked).</summary>
    public static async Task<Competition> PlayableAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Player(actor);
        var now = DateTime.UtcNow;
        var competition = await db.Competitions.AsNoTracking().Include(c => c.Map)
                              .FirstOrDefaultAsync(c => c.Id == id && c.IsEnabled && c.UpdateState != UpdateState.Deleted && c.Map!.IsEnabled)
                          ?? throw new BusinessException("Diesen Wettbewerb gibt es nicht.");
        if ((competition.StartDate is { } start && start > now) || (competition.EndDate is { } end && end < now))
        {
            throw new BusinessException("Dieser Wettbewerb läuft gerade nicht.");
        }

        var player = await db.Players.AsNoTracking().FirstAsync(p => p.Id == actor.PlayerId);
        if (!actor.IsAdmin && Progression.LevelOf(player.Xp) < competition.UnlockLevel)
        {
            throw new BusinessException($"Dieser Wettbewerb öffnet ab Level {competition.UnlockLevel}.");
        }

        return competition;
    }

    /// <summary>The best players of a competition (accounts only; score: most points, race: fastest time).</summary>
    public static async Task<IReadOnlyList<LeaderView>> LeaderboardAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Player(actor);
        var competition = await db.Competitions.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id) ?? throw new BusinessException("Diesen Wettbewerb gibt es nicht.");
        var query = from r in db.CompetitionResults.AsNoTracking()
                    join p in db.Players.AsNoTracking() on r.PlayerId equals p.Id
                    where r.CompetitionId == id && !p.IsGuest && p.UpdateState != UpdateState.Deleted
                    select new { r, p };
        query = competition.Mode == GameMode.Race
            ? query.Where(x => x.r.BestTimeMs != null).OrderBy(x => x.r.BestTimeMs)
            : query.OrderByDescending(x => x.r.BestScore);
        var rows = await query.Take(50).ToListAsync();
        return rows.Select((x, i) => new LeaderView(i + 1, x.p.Id, x.p.DisplayName, Progression.LevelOf(x.p.Xp), x.r.BestScore, x.r.BestTimeMs,
            Views.MedalKey(x.r.Medal), x.p.Id == actor.PlayerId)).ToList();
    }

    // ---- administration

    public static async Task<PagedResult<Competition>> ListAsync(AppDbContext db, Actor actor, ListRequest request)
    {
        Guard.Admin(actor);
        var all = db.Competitions.AsNoTracking().Include(c => c.Map).Where(c => c.UpdateState != UpdateState.Deleted);
        var query = all;
        if (request.Search is { } search)
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(c => EF.Functions.ILike(c.Name, pattern) || EF.Functions.ILike(c.Description, pattern));
        }

        if (request.Filter("mode") is { } mode && Enum.TryParse<GameMode>(mode, out var m))
        {
            query = query.Where(c => c.Mode == m);
        }

        if (request.Filter("map") is { } map && long.TryParse(map, out var mapId))
        {
            query = query.Where(c => c.MapId == mapId);
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
            "level" => query.SortBy(c => c.UnlockLevel, request.Descending),
            "start" => query.SortBy(c => c.StartDate, request.Descending),
            _ => query.SortBy(c => c.SortOrder, request.Descending),
        };
        return new PagedResult<Competition>(await query.Page(request).ToListAsync(), await query.CountAsync(), await all.CountAsync());
    }

    /// <summary>How many players took part in each competition.</summary>
    public static async Task<IReadOnlyDictionary<long, int>> ParticipantsAsync(AppDbContext db, Actor actor)
    {
        Guard.Admin(actor);
        return await db.CompetitionResults.GroupBy(r => r.CompetitionId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count);
    }

    public static async Task<Competition?> GetAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Admin(actor);
        return await db.Competitions.AsNoTracking().Include(c => c.Map).FirstOrDefaultAsync(c => c.Id == id && c.UpdateState != UpdateState.Deleted);
    }

    public static async Task<long> SaveAsync(AppDbContext db, Actor actor, CompetitionInput input)
    {
        Guard.Admin(actor);
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 60)
        {
            throw new BusinessException("Ein Name mit 1 bis 60 Zeichen.", nameof(CompetitionInput.Name));
        }

        if (!await db.Maps.AnyAsync(m => m.Id == input.MapId))
        {
            throw new BusinessException("Bitte eine Strecke wählen.", nameof(CompetitionInput.MapId));
        }

        if (input.Mode == GameMode.Freeride)
        {
            throw new BusinessException("Ein Wettbewerb ist eine Drift-Wertung oder ein Rennen.", nameof(CompetitionInput.Mode));
        }

        if (input.Mode == GameMode.Race && input.Laps is < 1 or > 20)
        {
            throw new BusinessException("1 bis 20 Runden.", nameof(CompetitionInput.Laps));
        }

        if (input.Mode == GameMode.Score && input.DurationS is < 30 or > 900)
        {
            throw new BusinessException("30 bis 900 Sekunden.", nameof(CompetitionInput.DurationS));
        }

        if (input.Bots is < 0 or > 7)
        {
            throw new BusinessException("0 bis 7 Gegner.", nameof(CompetitionInput.Bots));
        }

        if (input.BotSkill is < 1 or > 10)
        {
            throw new BusinessException("Ein Wert von 1 bis 10.", nameof(CompetitionInput.BotSkill));
        }

        CheckTargets(input);
        foreach (var (value, field) in new[] { (input.RewardBronze, nameof(CompetitionInput.RewardBronze)), (input.RewardSilver, nameof(CompetitionInput.RewardSilver)),
                     (input.RewardGold, nameof(CompetitionInput.RewardGold)) })
        {
            if (value is < 0 or > 10_000_000)
            {
                throw new BusinessException("Zwischen 0 und 10 Millionen Yen.", field);
            }
        }

        if (input.RewardBronze > input.RewardSilver || input.RewardSilver > input.RewardGold)
        {
            throw new BusinessException("Gold zahlt mindestens so viel wie Silber, Silber so viel wie Bronze.", nameof(CompetitionInput.RewardGold));
        }

        if (input.UnlockLevel is < 1 or > Progression.MaxLevel)
        {
            throw new BusinessException($"Level 1 bis {Progression.MaxLevel}.", nameof(CompetitionInput.UnlockLevel));
        }

        if (input.StartDate is { } start && input.EndDate is { } end && end <= start)
        {
            throw new BusinessException("Das Ende liegt nach dem Beginn.", nameof(CompetitionInput.EndDate));
        }

        var competition = input.Id == 0
            ? new Competition()
            : await db.Competitions.FirstOrDefaultAsync(c => c.Id == input.Id && c.UpdateState != UpdateState.Deleted) ?? throw new BusinessException("Diesen Wettbewerb gibt es nicht.");
        competition.Name = input.Name.Trim();
        competition.Description = (input.Description ?? string.Empty).Trim();
        competition.MapId = input.MapId;
        competition.Mode = input.Mode;
        competition.Laps = input.Laps;
        competition.DurationS = input.DurationS;
        competition.Bots = input.Bots;
        competition.BotSkill = input.BotSkill;
        competition.Bronze = input.Bronze;
        competition.Silver = input.Silver;
        competition.Gold = input.Gold;
        competition.RewardBronze = input.RewardBronze;
        competition.RewardSilver = input.RewardSilver;
        competition.RewardGold = input.RewardGold;
        competition.UnlockLevel = input.UnlockLevel;
        competition.StartDate = input.StartDate is { } s ? DateTime.SpecifyKind(s, DateTimeKind.Utc) : null;
        competition.EndDate = input.EndDate is { } e ? DateTime.SpecifyKind(e, DateTimeKind.Utc) : null;
        competition.SortOrder = input.SortOrder;
        competition.IsEnabled = input.IsEnabled;
        if (input.Id == 0)
        {
            db.Competitions.Add(competition);
        }

        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
        return competition.Id;
    }

    /// <summary>Removes a competition (soft): the results stay in the database, it leaves the menus.</summary>
    public static async Task DeleteAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Admin(actor);
        var competition = await db.Competitions.FirstOrDefaultAsync(c => c.Id == id) ?? throw new BusinessException("Diesen Wettbewerb gibt es nicht.");
        competition.UpdateState = UpdateState.Deleted;
        competition.IsEnabled = false;
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
    }

    private static void CheckTargets(CompetitionInput input)
    {
        if (input.Bronze <= 0 || input.Silver <= 0 || input.Gold <= 0)
        {
            throw new BusinessException("Jede Medaille braucht ein Ziel über 0.", nameof(CompetitionInput.Bronze));
        }

        var ordered = input.Mode == GameMode.Race
            ? input.Gold <= input.Silver && input.Silver <= input.Bronze
            : input.Gold >= input.Silver && input.Silver >= input.Bronze;
        if (!ordered)
        {
            throw new BusinessException(input.Mode == GameMode.Race
                ? "Bei Rennen ist Gold die kürzeste Zeit: Gold ≤ Silber ≤ Bronze."
                : "Gold verlangt die meisten Punkte: Gold ≥ Silber ≥ Bronze.", nameof(CompetitionInput.Gold));
        }
    }
}
