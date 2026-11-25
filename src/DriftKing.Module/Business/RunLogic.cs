using DriftKing.Data;
using DriftKing.Game;
using Microsoft.EntityFrameworkCore;

namespace DriftKing.Business;

/// <summary>The numbers of the overview page.</summary>
public sealed record DashboardView(int Players, int Accounts, int ActiveToday, int RunsToday, int RunsTotal, long BestScore, string? BestScoreBy, int Competitions,
    IReadOnlyList<(string Map, int Runs)> PopularMaps);

/// <summary>The runs in the database: written at start and end by the room registry, read by the history, the leaderboards and the administration.</summary>
public static class RunLogic
{
    /// <summary>A run started: its record (running).</summary>
    public static async Task<long> StartedAsync(AppDbContext db, Actor actor, DriftRoom room)
    {
        Guard.Admin(actor);
        var seats = room.Seats;
        var run = new Run
        {
            Token = room.Token,
            Code = room.Code,
            MapKey = room.Settings.Map.Key,
            Mode = room.Settings.Mode,
            Laps = room.Settings.Laps,
            DurationS = room.Settings.DurationS,
            CompetitionId = room.Settings.CompetitionId,
            Status = RunStatus.Running,
            IsOnline = !room.Settings.IsSolo,
            Humans = seats.Count(s => !s.IsBot),
            Bots = seats.Count(s => s.IsBot),
            StartDate = room.StartAt ?? DateTime.UtcNow,
        };
        db.Runs.Add(run);
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
        return run.Id;
    }

    /// <summary>
    /// A run ended: the entries with their outcome, the players' numbers and money, the competition result. Returns the competition outcome per player
    /// (competition runs are solo: at most one).
    /// </summary>
    public static async Task<ResultsView> FinishedAsync(AppDbContext db, Actor actor, DriftRoom room, IReadOnlyList<Outcome> outcomes)
    {
        Guard.Admin(actor);
        db.ActingAs(actor.AuditId);
        var run = await db.Runs.FirstOrDefaultAsync(r => r.Token == room.Token);
        if (run is null)
        {
            run = new Run { Token = room.Token, Code = room.Code, MapKey = room.Settings.Map.Key, Mode = room.Settings.Mode, StartDate = room.StartAt ?? DateTime.UtcNow };
            db.Runs.Add(run);
        }

        run.Status = RunStatus.Finished;
        run.EndDate = DateTime.UtcNow;
        run.Humans = outcomes.Count(o => !o.Seat.IsBot);
        run.Bots = outcomes.Count(o => o.Seat.IsBot);
        foreach (var o in outcomes)
        {
            run.Entries.Add(new RunEntry
            {
                Seat = o.Seat.Number, PlayerId = o.Seat.PlayerId, IsBot = o.Seat.IsBot, Name = o.Seat.Name, CarName = o.Seat.Car.Name, CarBody = o.Seat.Car.Body,
                Score = o.Score, TimeMs = o.TimeMs, BestLapMs = o.BestLapMs, BestCombo = o.BestCombo, MaxAngle = o.MaxAngle, DriftDistanceM = o.DriftDistanceM,
                Finished = o.Finished, Place = o.Place, Money = o.Money, Xp = o.Xp, Flagged = o.Flagged,
            });
        }

        var ids = outcomes.Where(o => o.Seat.PlayerId is not null).Select(o => o.Seat.PlayerId!.Value).ToList();
        var players = await db.Players.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        CompetitionOutcomeView? competitionOutcome = null;
        var competition = room.Settings.CompetitionId is { } cid ? await db.Competitions.FirstOrDefaultAsync(c => c.Id == cid) : null;
        foreach (var o in outcomes.Where(o => o.Seat.PlayerId is not null))
        {
            if (!players.TryGetValue(o.Seat.PlayerId!.Value, out var player))
            {
                continue;
            }

            RunRules.Apply(player, o, room.Settings.Mode, outcomes.Count);
            if (competition is not null)
            {
                var result = await db.CompetitionResults.FirstOrDefaultAsync(r => r.CompetitionId == competition.Id && r.PlayerId == player.Id);
                if (result is null)
                {
                    result = new CompetitionResult { CompetitionId = competition.Id, PlayerId = player.Id };
                    db.CompetitionResults.Add(result);
                }

                competitionOutcome = RunRules.ApplyCompetition(player, competition, result, o);
            }
        }

        await db.SaveChangesAsync();
        return RunRules.View(room, outcomes, competitionOutcome);
    }

    /// <summary>A run that ended without results (everybody left, a restart).</summary>
    public static async Task AbortAsync(AppDbContext db, Actor actor, Guid token)
    {
        Guard.Admin(actor);
        var run = await db.Runs.FirstOrDefaultAsync(r => r.Token == token && r.Status == RunStatus.Running);
        if (run is null)
        {
            return;
        }

        run.Status = RunStatus.Aborted;
        run.EndDate = DateTime.UtcNow;
        db.ActingAs(actor.AuditId);
        await db.SaveChangesAsync();
    }

    /// <summary>At start: the runs of the last life of the server are over.</summary>
    public static async Task<int> AbortStaleAsync(AppDbContext db, Actor actor)
    {
        Guard.Admin(actor);
        return await db.Runs.Where(r => r.Status == RunStatus.Running)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, RunStatus.Aborted).SetProperty(r => r.EndDate, DateTime.UtcNow));
    }

    /// <summary>The last runs of the player.</summary>
    public static async Task<IReadOnlyList<HistoryView>> HistoryAsync(AppDbContext db, Actor actor, int take)
    {
        Guard.Player(actor);
        var rows = await (from e in db.RunEntries.AsNoTracking()
                          join r in db.Runs.AsNoTracking() on e.RunId equals r.Id
                          where e.PlayerId == actor.PlayerId && r.Status == RunStatus.Finished
                          orderby r.StartDate descending
                          select new { e, r, Field = r.Humans + r.Bots, Competition = db.Competitions.Where(c => c.Id == r.CompetitionId).Select(c => c.Name).FirstOrDefault() })
            .Take(Math.Clamp(take, 1, 100)).ToListAsync();
        var maps = await db.Maps.AsNoTracking().ToDictionaryAsync(m => m.Key, m => m.Name);
        return rows.Select(x => new HistoryView(x.r.Token, x.r.StartDate, maps.GetValueOrDefault(x.r.MapKey, x.r.MapKey), Looks.ModeKey(x.r.Mode), x.e.Place, x.Field,
            x.e.Score, x.e.TimeMs, x.e.Money, x.e.Xp, x.Competition)).ToList();
    }

    /// <summary>The player's best per map and mode: points (score, freeride) and race time.</summary>
    public static async Task<IReadOnlyList<BestView>> BestsAsync(AppDbContext db, Actor actor)
    {
        Guard.Player(actor);
        var rows = await (from e in db.RunEntries.AsNoTracking()
                          join r in db.Runs.AsNoTracking() on e.RunId equals r.Id
                          where e.PlayerId == actor.PlayerId && r.Status == RunStatus.Finished && !e.Flagged
                          group new { e, r } by new { r.MapKey, r.Mode } into g
                          select new
                          {
                              g.Key.MapKey,
                              g.Key.Mode,
                              Score = g.Max(x => x.e.Score),
                              Time = g.Where(x => x.e.Finished && x.e.TimeMs != null).Min(x => x.e.TimeMs),
                              Lap = g.Where(x => x.e.BestLapMs != null).Min(x => x.e.BestLapMs),
                          }).ToListAsync();
        return rows.Select(x => new BestView(x.MapKey, Looks.ModeKey(x.Mode), x.Score, x.Time, x.Lap)).ToList();
    }

    // ---- administration

    public static async Task<PagedResult<Run>> ListAsync(AppDbContext db, Actor actor, ListRequest request)
    {
        Guard.Admin(actor);
        var all = db.Runs.AsNoTracking();
        var query = all;
        if (request.Search is { } search)
        {
            var text = search.Trim().ToUpperInvariant();
            query = query.Where(r => r.Code == text || r.Entries.Any(e => EF.Functions.ILike(e.Name, $"%{search.Trim()}%")));
        }

        if (request.Filter("mode") is { } mode && Enum.TryParse<GameMode>(mode, out var m))
        {
            query = query.Where(r => r.Mode == m);
        }

        if (request.Filter("map") is { } map)
        {
            query = query.Where(r => r.MapKey == map);
        }

        if (request.Filter("status") is { } status && Enum.TryParse<RunStatus>(status, out var s))
        {
            query = query.Where(r => r.Status == s);
        }

        query = request.Filter("kind") switch
        {
            "online" => query.Where(r => r.IsOnline),
            "solo" => query.Where(r => !r.IsOnline),
            _ => query,
        };
        query = request.Sort switch
        {
            "humans" => query.SortBy(r => r.Humans, request.Descending),
            "map" => query.SortBy(r => r.MapKey, request.Descending),
            _ => query.SortBy(r => r.StartDate, !request.Descending),
        };
        return new PagedResult<Run>(await query.Include(r => r.Entries).Page(request).ToListAsync(), await query.CountAsync(), await all.CountAsync());
    }

    public static async Task<Run?> GetAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Admin(actor);
        return await db.Runs.AsNoTracking().Include(r => r.Entries.OrderBy(e => e.Place)).FirstOrDefaultAsync(r => r.Id == id);
    }

    /// <summary>Deletes a run (its entries go with it; the players keep what they earned).</summary>
    public static async Task DeleteAsync(AppDbContext db, Actor actor, long id)
    {
        Guard.Admin(actor);
        var run = await db.Runs.FirstOrDefaultAsync(r => r.Id == id) ?? throw new BusinessException("Diesen Lauf gibt es nicht.");
        db.Runs.Remove(run);
        await db.SaveChangesAsync();
    }

    public static async Task<DashboardView> DashboardAsync(AppDbContext db, Actor actor)
    {
        Guard.Admin(actor);
        var today = DateTime.UtcNow.Date;
        var players = db.Players.AsNoTracking().Where(p => p.UpdateState != UpdateState.Deleted);
        var best = await players.OrderByDescending(p => p.BestScore).Select(p => new { p.BestScore, p.DisplayName }).FirstOrDefaultAsync();
        var popular = await db.Runs.AsNoTracking().Where(r => r.Status == RunStatus.Finished).GroupBy(r => r.MapKey)
            .Select(g => new { g.Key, Count = g.Count() }).OrderByDescending(g => g.Count).Take(4).ToListAsync();
        var names = await db.Maps.AsNoTracking().ToDictionaryAsync(m => m.Key, m => m.Name);
        return new DashboardView(
            await players.CountAsync(),
            await players.CountAsync(p => !p.IsGuest),
            await players.CountAsync(p => p.LastSeenDate >= today),
            await db.Runs.CountAsync(r => r.StartDate >= today),
            await db.Runs.CountAsync(),
            best?.BestScore ?? 0,
            best is { BestScore: > 0 } ? best.DisplayName : null,
            await db.Competitions.CountAsync(c => c.UpdateState != UpdateState.Deleted && c.IsEnabled),
            popular.Select(p => (names.GetValueOrDefault(p.Key, p.Key), p.Count)).ToList());
    }
}
