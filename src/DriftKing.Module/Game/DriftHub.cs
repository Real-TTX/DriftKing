using DriftKing.Business;
using DriftKing.Data;
using DriftKing.Web;
using MatGame.Sdk;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace DriftKing.Game;

/// <summary>
/// The hub of DriftKing (<c>/driftking/hub</c>): rooms (create, join, ready, configure, start), solo runs and competitions, and the run itself
/// (state relay, finishes, results). Signed in with MatGame's cookie (browser) or device token (apps); the version of an app is checked on connect.
/// The browsers simulate their cars (the host's the bots); the room checks who may send what (docs/PROTOCOL.md). DriftKing.Local has the same methods.
/// Messages to the clients: <c>Room</c>(RoomView), <c>State</c>(seat, state), <c>Left</c>(seat), <c>Finished</c>(seat), <c>Results</c>(ResultsView), <c>Closed</c>(reason).
/// </summary>
[Authorize(AuthenticationSchemes = GameAccounts.AnyScheme)]
public sealed class DriftHub(RoomRegistry registry, AppDbContext db) : Hub
{
    public override async Task OnConnectedAsync()
    {
        var http = Context.GetHttpContext();
        if (http is not null && GameApi.ClientProblem(http.Request, DriftKingModule.Information) is { } problem)
        {
            await Clients.Caller.SendAsync("Closed", problem);
            Context.Abort();
            return;
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await LeaveRoom();
        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>The open public rooms (lobby).</summary>
    public IReadOnlyList<RoomListView> ListRooms()
        => registry.Rooms.Where(r => r.Status == RoomStatus.Lobby && !r.Settings.IsPrivate && r.Humans > 0).OrderByDescending(r => r.CreatedAt)
            .Select(r => r.ListView()).ToList();

    /// <summary>Opens a room for others (code and invitation link); the caller hosts it.</summary>
    public async Task<RoomView> CreateRoom(RoomOptions options)
    {
        var me = await MeAsync();
        await LeaveRoom();
        var settings = await SettingLogic.GetAsync(db);
        if (options.IsPrivate != true && Players.IsGuest(Context.User!) && !settings.GuestsCreateRooms)
        {
            throw new HubException("Gäste dürfen hier keine öffentlichen Räume eröffnen.");
        }

        var map = await ContentLogic.PlayableMapAsync(db, me, options.Map);
        var room = registry.Add(code => new DriftRoom(code, RoomSetup.For(map, options, settings.MaxPlayers, solo: false), DateTime.UtcNow));
        return await JoinAsync(room, me);
    }

    /// <summary>A run alone (free play, score attack or race against bots, or a competition) that starts at once.</summary>
    public async Task<RoomView> Solo(RoomOptions options)
    {
        var me = await MeAsync();
        await LeaveRoom();
        RoomSettings roomSettings;
        if (options.CompetitionId is { } competitionId)
        {
            var competition = await CompetitionLogic.PlayableAsync(db, me, competitionId);
            roomSettings = RoomSetup.For(competition, competition.Map!);
        }
        else
        {
            var map = await ContentLogic.PlayableMapAsync(db, me, options.Map);
            roomSettings = RoomSetup.For(map, options, 1, solo: true);
        }

        var room = registry.Add(code => new DriftRoom(code, roomSettings, DateTime.UtcNow));
        await JoinAsync(room, me);
        await StartAsync(room);
        return room.View(me.PlayerId, DateTime.UtcNow);
    }

    public async Task<RoomView> JoinRoom(string code)
    {
        var me = await MeAsync();
        var room = registry.ByCode(code) ?? throw new HubException("Diesen Raum gibt es nicht (mehr).");
        if (registry.OfConnection(Context.ConnectionId) is { } current && current != room)
        {
            await LeaveRoom();
        }

        return await JoinAsync(room, me);
    }

    public async Task LeaveRoom()
    {
        var room = registry.OfConnection(Context.ConnectionId);
        if (room is null)
        {
            return;
        }

        registry.Unbind(Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, room.Code);
        var seat = room.Leave(Context.ConnectionId, DateTime.UtcNow);
        if (seat is null)
        {
            return;
        }

        await Clients.Group(room.Code).SendAsync("Left", seat.Number);
        if (room.Status == RoomStatus.Finished)
        {
            await registry.EndAsync(room);
        }
        else if (room.Status != RoomStatus.Closed)
        {
            await registry.BroadcastAsync(room);
        }
    }

    public async Task<RoomView> Ready(bool ready)
    {
        var (room, me) = await RoomAsync();
        room.SetReady(Context.ConnectionId, ready);
        await registry.BroadcastAsync(room);
        return room.View(me.PlayerId, DateTime.UtcNow);
    }

    /// <summary>The host changes map, mode, laps, time or bots (lobby only).</summary>
    public async Task<RoomView> Configure(RoomOptions options)
    {
        var (room, me) = await RoomAsync();
        var settings = await SettingLogic.GetAsync(db);
        var map = await ContentLogic.PlayableMapAsync(db, me, options.Map);
        room.Configure(Context.ConnectionId, RoomSetup.For(map, options, settings.MaxPlayers, solo: false));
        await registry.BroadcastAsync(room);
        return room.View(me.PlayerId, DateTime.UtcNow);
    }

    /// <summary>The player chose another car in the garage: the room takes it (lobby only).</summary>
    public async Task<RoomView> ChangeCar()
    {
        var (room, me) = await RoomAsync();
        room.SetCar(Context.ConnectionId, await GarageLogic.SelectedCarAsync(db, me));
        await registry.BroadcastAsync(room);
        return room.View(me.PlayerId, DateTime.UtcNow);
    }

    public async Task<RoomView> StartRoom()
    {
        var (room, me) = await RoomAsync();
        await StartAsync(room);
        return room.View(me.PlayerId, DateTime.UtcNow);
    }

    /// <summary>The state of a car (own seat, or a bot of the host), many times a second: passed on to the others in the room.</summary>
    public async Task State(int seat, double[] state)
    {
        var room = registry.OfConnection(Context.ConnectionId);
        if (room is null || !room.AcceptState(Context.ConnectionId, seat, state, DateTime.UtcNow))
        {
            return;
        }

        await Clients.OthersInGroup(room.Code).SendAsync("State", seat, state);
    }

    /// <summary>A car crossed the line / the time ran out. The last one ends the run (results to everybody).</summary>
    public async Task Finish(int seat, FinishInput result)
    {
        var room = registry.OfConnection(Context.ConnectionId);
        if (room is null)
        {
            return;
        }

        var last = room.Finish(Context.ConnectionId, seat, result, DateTime.UtcNow);
        await Clients.Group(room.Code).SendAsync("Finished", seat);
        if (last)
        {
            await registry.EndAsync(room);
        }
    }

    private async Task StartAsync(DriftRoom room)
    {
        var cars = await ContentLogic.CarsAsync(db);
        var seed = Random.Shared.Next();
        room.Start(Context.ConnectionId, DateTime.UtcNow, seat => GarageRules.BotCar(cars, seat, room.Settings.BotSkill, seed));
        await registry.StartedAsync(room);
        await registry.BroadcastAsync(room);
    }

    private async Task<RoomView> JoinAsync(DriftRoom room, Actor me)
    {
        var car = await GarageLogic.SelectedCarAsync(db, me);
        room.Join(me.PlayerId, me.DisplayName, car, Context.ConnectionId, DateTime.UtcNow);
        registry.Bind(Context.ConnectionId, room);
        await Groups.AddToGroupAsync(Context.ConnectionId, room.Code);
        await registry.BroadcastAsync(room);
        return room.View(me.PlayerId, DateTime.UtcNow);
    }

    private async Task<(DriftRoom Room, Actor Me)> RoomAsync()
    {
        var me = await MeAsync();
        var room = registry.OfConnection(Context.ConnectionId) ?? throw new HubException("Du bist in keinem Raum.");
        return (room, me);
    }

    private Task<Actor> MeAsync() => Players.RequireAsync(Context.User!, db);
}

/// <summary>The messages of the business layer become the German text of a <see cref="HubException"/> (the browser shows it).</summary>
public sealed class HubErrors : IHubFilter
{
    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext context, Func<HubInvocationContext, ValueTask<object?>> next)
    {
        try
        {
            return await next(context);
        }
        catch (BusinessException e)
        {
            throw new HubException(e.Message);
        }
        catch (AccessDeniedException e)
        {
            throw new HubException(e.Message);
        }
    }
}
