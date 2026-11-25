using DriftKing.Business;
using DriftKing.Data;
using Microsoft.AspNetCore.Mvc;

namespace DriftKing.Pages.Admin.Players;

public sealed class EditModel(AppDbContext db) : AppPageModel(db)
{
    [BindProperty(SupportsGet = true)]
    public long Id { get; set; }

    [BindProperty]
    public string DisplayName { get; set; } = string.Empty;

    [BindProperty]
    public long Money { get; set; }

    [BindProperty]
    public long Xp { get; set; }

    public Player? Player { get; private set; }

    public IReadOnlyList<GarageCarView> Garage { get; private set; } = [];

    public async Task<IActionResult> OnGetAsync()
    {
        if (!await LoadAsync())
        {
            return NotFound();
        }

        DisplayName = Player!.DisplayName;
        Money = Player.Money;
        Xp = Player.Xp;
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
        => await TryAsync(async () =>
        {
            await PlayerLogic.SaveAsync(Db, Me, new PlayerInput(Id, DisplayName, Money, Xp));
            Flash("Gespeichert.");
            return RedirectToPage(new { id = Id });
        }, async () => await LoadAsync());

    public async Task<IActionResult> OnPostDeleteAsync()
        => await TryAsync(async () =>
        {
            await PlayerLogic.DeleteAsync(Db, Me, Id);
            Flash("Der Fahrer wurde entfernt.");
            return RedirectToPage("Index");
        }, async () => await LoadAsync());

    private async Task<bool> LoadAsync()
    {
        Player = await PlayerLogic.GetAsync(Db, Me, Id);
        if (Player is null)
        {
            return false;
        }

        Garage = await GarageLogic.OfPlayerAsync(Db, Me, Id);
        return true;
    }
}
