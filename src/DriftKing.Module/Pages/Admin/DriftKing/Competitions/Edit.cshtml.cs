using DriftKing.Business;
using DriftKing.Data;
using MatGame.Sdk.Controls;
using Microsoft.AspNetCore.Mvc;

namespace DriftKing.Pages.Admin.Competitions;

public sealed class EditModel(AppDbContext db) : AppPageModel(db)
{
    [BindProperty(SupportsGet = true)]
    public long Id { get; set; }

    [BindProperty]
    public string Name { get; set; } = string.Empty;

    [BindProperty]
    public string? Description { get; set; }

    [BindProperty]
    public long MapId { get; set; }

    [BindProperty]
    public GameMode Mode { get; set; } = GameMode.Score;

    [BindProperty]
    public int Laps { get; set; } = 3;

    [BindProperty]
    public int DurationS { get; set; } = 120;

    [BindProperty]
    public int Bots { get; set; } = 3;

    [BindProperty]
    public int BotSkill { get; set; } = 5;

    [BindProperty]
    public long Bronze { get; set; } = 10000;

    [BindProperty]
    public long Silver { get; set; } = 25000;

    [BindProperty]
    public long Gold { get; set; } = 45000;

    [BindProperty]
    public int RewardBronze { get; set; } = 1500;

    [BindProperty]
    public int RewardSilver { get; set; } = 3000;

    [BindProperty]
    public int RewardGold { get; set; } = 6000;

    [BindProperty]
    public int UnlockLevel { get; set; } = 1;

    [BindProperty]
    public DateTime? StartDate { get; set; }

    [BindProperty]
    public DateTime? EndDate { get; set; }

    [BindProperty]
    public int SortOrder { get; set; } = 100;

    [BindProperty]
    public bool IsEnabled { get; set; } = true;

    public bool IsNew => Id == 0;

    public IReadOnlyList<Choice> Maps { get; private set; } = [];

    public IReadOnlyList<Choice> Modes { get; } =
    [
        new(nameof(GameMode.Score), "Drift-Wertung", "auf Zeit, die meisten Punkte"),
        new(nameof(GameMode.Race), "Rennen", "Runden, die schnellste Zeit"),
    ];

    public IReadOnlyList<LeaderView> Board { get; private set; } = [];

    public async Task<IActionResult> OnGetAsync()
    {
        await LoadAsync();
        if (IsNew)
        {
            MapId = long.TryParse(Maps.FirstOrDefault()?.Value, out var first) ? first : 0;
            return Page();
        }

        var c = await CompetitionLogic.GetAsync(Db, Me, Id);
        if (c is null)
        {
            return NotFound();
        }

        Name = c.Name;
        Description = c.Description;
        MapId = c.MapId;
        Mode = c.Mode;
        Laps = c.Laps;
        DurationS = c.DurationS;
        Bots = c.Bots;
        BotSkill = c.BotSkill;
        Bronze = c.Bronze;
        Silver = c.Silver;
        Gold = c.Gold;
        RewardBronze = c.RewardBronze;
        RewardSilver = c.RewardSilver;
        RewardGold = c.RewardGold;
        UnlockLevel = c.UnlockLevel;
        StartDate = c.StartDate;
        EndDate = c.EndDate;
        SortOrder = c.SortOrder;
        IsEnabled = c.IsEnabled;
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
        => await TryAsync(async () =>
        {
            var id = await CompetitionLogic.SaveAsync(Db, Me, new CompetitionInput(Id, Name, Description ?? string.Empty, MapId, Mode, Laps, DurationS, Bots, BotSkill,
                Bronze, Silver, Gold, RewardBronze, RewardSilver, RewardGold, UnlockLevel, StartDate, EndDate, SortOrder, IsEnabled));
            Flash(IsNew ? "Der Wettbewerb wurde angelegt." : "Gespeichert.");
            return RedirectToPage(new { id });
        }, LoadAsync);

    public async Task<IActionResult> OnPostDeleteAsync()
        => await TryAsync(async () =>
        {
            await CompetitionLogic.DeleteAsync(Db, Me, Id);
            Flash("Der Wettbewerb wurde gelöscht.");
            return RedirectToPage("Index");
        }, LoadAsync);

    private async Task LoadAsync()
    {
        var maps = await ContentLogic.ListMapsAsync(Db, Me, new ListRequest(null, new Dictionary<string, string?>(), null, false, 1, 100));
        Maps = maps.Items.Select(m => new Choice(m.Id.ToString(), m.Name)).ToList();
        if (!IsNew)
        {
            Board = await CompetitionLogic.LeaderboardAsync(Db, Me, Id);
        }
    }
}
