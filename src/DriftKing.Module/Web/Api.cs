using System.Globalization;
using DriftKing.Business;
using DriftKing.Data;
using MatGame.Sdk;

namespace DriftKing.Web;

/// <summary>
/// The JSON interface of the player app under <c>/driftking/api</c>: session, home, catalogue, garage, maps, competitions, profile, leaderboards, history.
/// Accounts (sign-in, registration, guests) are MatGame's host API (<c>/api/matgame/...</c>). Every call goes through the business layer (which checks
/// the permission); <see cref="GameApi.ForGame"/> checks the app version and the antiforgery token of cookie requests. Errors: 400 <c>{ error, field }</c>,
/// 401 not signed in, 403 denied. The offline game of the app (DriftKing.Local) answers the same calls with the same shapes (docs/PROTOCOL.md).
/// </summary>
public static class Api
{
    public sealed record BuyRequest(long CarId);

    public sealed record UpgradeRequest(string? Part);

    public sealed record LookRequest(string? Paint, string? Rims, string? Neon, string? Decal, int? Number);

    public sealed record SelectRequest(long Id);

    public static void MapApi(this IEndpointRouteBuilder game, GameInfo info)
    {
        var api = game.MapGroup("/api").ForGame(info).AddEndpointFilter(Errors).AllowAnonymous();

        api.MapGet("/session", async (HttpContext http, AppDbContext db) =>
        {
            if (Players.ActorOf(http.User) is null)
            {
                return Results.Ok(new { signedIn = false, player = (object?)null, version = AppInfo.Version, offline = false });
            }

            var me = await Players.RequireAsync(http, db);
            var player = await PlayerLogic.GetAsync(db, me, me.PlayerId) ?? throw new AccessDeniedException();
            return Results.Ok(new { signedIn = true, player = Views.Player(player, me.IsAdmin), version = AppInfo.Version, offline = false });
        });

        api.MapGet("/home", async (HttpContext http, AppDbContext db) =>
        {
            var me = await Players.RequireAsync(http, db);
            var player = await PlayerLogic.GetAsync(db, me, me.PlayerId) ?? throw new AccessDeniedException();
            var settings = await SettingLogic.GetAsync(db);
            return Results.Ok(new
            {
                player = Views.Player(player, me.IsAdmin),
                stats = Views.Stats(player, await PlayerLogic.RankAsync(db, player)),
                car = await GarageLogic.SelectedCarAsync(db, me),
                announcement = settings.Announcement,
                history = await RunLogic.HistoryAsync(db, me, 6),
                settings = new { settings.MaxPlayers, guestsCreateRooms = settings.GuestsCreateRooms },
            });
        });

        api.MapGet("/catalog", async (HttpContext http, AppDbContext db) => Results.Ok(await ContentLogic.CatalogAsync(db, await Players.RequireAsync(http, db))));

        // ---- garage
        api.MapGet("/garage", async (HttpContext http, AppDbContext db) => Results.Ok(await GarageLogic.GarageAsync(db, await Players.RequireAsync(http, db))));
        api.MapPost("/garage/buy", async (BuyRequest body, HttpContext http, AppDbContext db) =>
            Results.Ok(await GarageLogic.BuyAsync(db, await Players.RequireAsync(http, db), body.CarId)));
        api.MapPost("/garage/{id:long}/upgrade", async (long id, UpgradeRequest body, HttpContext http, AppDbContext db) =>
        {
            var part = Views.PartOf(body.Part) ?? throw new BusinessException("Dieses Teil gibt es nicht.", "part");
            return Results.Ok(await GarageLogic.UpgradeAsync(db, await Players.RequireAsync(http, db), id, part));
        });
        api.MapPut("/garage/{id:long}/look", async (long id, LookRequest body, HttpContext http, AppDbContext db) =>
            Results.Ok(await GarageLogic.SetLookAsync(db, await Players.RequireAsync(http, db), id, body.Paint, body.Rims, body.Neon, body.Decal, body.Number)));
        api.MapPut("/garage/select", async (SelectRequest body, HttpContext http, AppDbContext db) =>
            Results.Ok(await GarageLogic.SelectAsync(db, await Players.RequireAsync(http, db), body.Id)));

        // ---- competitions
        api.MapGet("/competitions", async (HttpContext http, AppDbContext db) =>
            Results.Ok(await CompetitionLogic.ListForPlayerAsync(db, await Players.RequireAsync(http, db))));
        api.MapGet("/competitions/{id:long}/leaderboard", async (long id, HttpContext http, AppDbContext db) =>
            Results.Ok(await CompetitionLogic.LeaderboardAsync(db, await Players.RequireAsync(http, db), id)));

        // ---- profile, records and leaderboard
        api.MapGet("/profile", async (HttpContext http, AppDbContext db) => Results.Ok(await PlayerLogic.ProfileAsync(db, await Players.RequireAsync(http, db))));
        api.MapGet("/bests", async (HttpContext http, AppDbContext db) => Results.Ok(await RunLogic.BestsAsync(db, await Players.RequireAsync(http, db))));
        api.MapGet("/leaderboard", async (string? by, HttpContext http, AppDbContext db) =>
            Results.Ok(await PlayerLogic.LeaderboardAsync(db, await Players.RequireAsync(http, db), by)));
        api.MapGet("/history", async (HttpContext http, AppDbContext db) => Results.Ok(await RunLogic.HistoryAsync(db, await Players.RequireAsync(http, db), 30)));

        // ---- the numbers of the server (portal, monitoring)
        api.MapGet("/info", (Game.RoomRegistry rooms) =>
            Results.Ok(new { game = DriftKingModule.Id, version = AppInfo.Version, rooms = rooms.Rooms.Count, running = rooms.Rooms.Count(r => r.Status == Game.RoomStatus.Running) }));
    }

    private static async ValueTask<object?> Errors(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        try
        {
            return await next(context);
        }
        catch (BusinessException e)
        {
            var field = string.IsNullOrEmpty(e.Field) ? null : char.ToLower(e.Field[0], CultureInfo.InvariantCulture) + e.Field[1..];
            return Results.BadRequest(new { error = e.Message, field });
        }
        catch (AccessDeniedException e)
        {
            var signedIn = context.HttpContext.User.Identity?.IsAuthenticated == true;
            return Results.Json(new { error = e.Message }, statusCode: signedIn ? 403 : 401);
        }
        catch (BadHttpRequestException)
        {
            return Results.BadRequest(new { error = "Die Anfrage ist unvollständig.", field = (string?)null });
        }
    }
}
