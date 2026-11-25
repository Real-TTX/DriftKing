using DriftKing.Business;
using DriftKing.Data;
using Microsoft.AspNetCore.Mvc;

namespace DriftKing.Pages.Admin;

public sealed class SystemModel(AppDbContext db) : AppPageModel(db)
{
    [BindProperty]
    public int MaxPlayers { get; set; } = GameSettings.Default.MaxPlayers;

    [BindProperty]
    public bool GuestsCreateRooms { get; set; } = true;

    [BindProperty]
    public int MaxPointsPerSecond { get; set; } = GameSettings.Default.MaxPointsPerSecond;

    [BindProperty]
    public string? Announcement { get; set; }

    [BindProperty]
    public int StartMoney { get; set; } = GameSettings.Default.StartMoney;

    [BindProperty]
    public int RewardFactor { get; set; } = GameSettings.Default.RewardFactor;

    public async Task OnGetAsync()
    {
        Guard.Admin(Me);
        var s = await SettingLogic.GetAsync(Db);
        MaxPlayers = s.MaxPlayers;
        GuestsCreateRooms = s.GuestsCreateRooms;
        MaxPointsPerSecond = s.MaxPointsPerSecond;
        Announcement = s.Announcement;
        StartMoney = s.StartMoney;
        RewardFactor = s.RewardFactor;
    }

    public async Task<IActionResult> OnPostAsync()
        => await TryAsync(async () =>
        {
            await SettingLogic.SaveAsync(Db, Me,
                new GameSettings(Announcement ?? string.Empty, MaxPlayers, GuestsCreateRooms, StartMoney, RewardFactor, MaxPointsPerSecond));
            Flash("Gespeichert.");
            return RedirectToPage();
        });
}
