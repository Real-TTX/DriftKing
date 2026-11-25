using DriftKing.Business;
using DriftKing.Data;
using MatGame.Sdk.Controls;
using Microsoft.AspNetCore.Mvc;

namespace DriftKing.Pages.Admin.Maps;

public sealed class EditModel(AppDbContext db) : AppPageModel(db)
{
    [BindProperty(SupportsGet = true)]
    public long Id { get; set; }

    [BindProperty]
    public string Key { get; set; } = string.Empty;

    [BindProperty]
    public string Name { get; set; } = string.Empty;

    [BindProperty]
    public string? Description { get; set; }

    [BindProperty]
    public TimeOfDay TimeOfDay { get; set; }

    [BindProperty]
    public int DefaultLaps { get; set; } = 3;

    [BindProperty]
    public int UnlockLevel { get; set; } = 1;

    [BindProperty]
    public int SortOrder { get; set; } = 100;

    [BindProperty]
    public bool IsEnabled { get; set; } = true;

    public bool IsNew => Id == 0;

    public IReadOnlyList<Choice> Keys { get; private set; } = [];

    public IReadOnlyList<Choice> Times { get; } =
    [
        new(nameof(TimeOfDay.Night), "Nacht", "Neon, Laternen, Scheinwerfer"),
        new(nameof(TimeOfDay.Dusk), "Dämmerung", "der letzte rote Himmel"),
    ];

    public async Task<IActionResult> OnGetAsync()
    {
        await LoadKeysAsync();
        if (IsNew)
        {
            Key = Keys.FirstOrDefault()?.Value ?? string.Empty;
            return Page();
        }

        var map = await ContentLogic.GetMapAsync(Db, Me, Id);
        if (map is null)
        {
            return NotFound();
        }

        Key = map.Key;
        Name = map.Name;
        Description = map.Description;
        TimeOfDay = map.TimeOfDay;
        DefaultLaps = map.DefaultLaps;
        UnlockLevel = map.UnlockLevel;
        SortOrder = map.SortOrder;
        IsEnabled = map.IsEnabled;
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
        => await TryAsync(async () =>
        {
            var id = await ContentLogic.SaveMapAsync(Db, Me, new MapInput(Id, Key, Name, Description ?? string.Empty, TimeOfDay, DefaultLaps, UnlockLevel, SortOrder, IsEnabled));
            Flash(IsNew ? "Die Strecke wurde angelegt." : "Gespeichert.");
            return RedirectToPage(new { id });
        }, LoadKeysAsync);

    public async Task<IActionResult> OnPostDeleteAsync()
        => await TryAsync(async () =>
        {
            await ContentLogic.DeleteMapAsync(Db, Me, Id);
            Flash("Die Strecke wurde gelöscht.");
            return RedirectToPage("Index");
        }, LoadKeysAsync);

    private async Task LoadKeysAsync()
        => Keys = (await ContentLogic.FreeMapKeysAsync(Db, Me)).Select(k => new Choice(k, MapCatalog.Find(k)?.Name ?? k)).ToList();
}
