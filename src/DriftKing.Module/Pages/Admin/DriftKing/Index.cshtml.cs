using DriftKing.Business;
using DriftKing.Data;
using DriftKing.Game;

namespace DriftKing.Pages.Admin;

public sealed class IndexModel(AppDbContext db, RoomRegistry registry) : AppPageModel(db)
{
    public DashboardView Numbers { get; private set; } = null!;

    public IReadOnlyList<DriftRoom> Rooms { get; private set; } = [];

    public int Running => Rooms.Count(r => r.Status is RoomStatus.Running or RoomStatus.Countdown);

    public int Lobbies => Rooms.Count(r => r.Status == RoomStatus.Lobby);

    public int Drivers => Rooms.Sum(r => r.Humans);

    public async Task OnGetAsync()
    {
        Numbers = await RunLogic.DashboardAsync(Db, Me);
        Rooms = registry.Rooms.Where(r => r.Status != RoomStatus.Closed).OrderByDescending(r => r.CreatedAt).ToList();
    }

    public static string StatusName(RoomStatus status) => status switch
    {
        RoomStatus.Lobby => "Lobby",
        RoomStatus.Countdown => "Start",
        RoomStatus.Running => "Läuft",
        RoomStatus.Finished => "Fertig",
        _ => "Zu",
    };
}
