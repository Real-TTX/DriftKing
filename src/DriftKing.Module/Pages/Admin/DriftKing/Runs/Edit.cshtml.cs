using DriftKing.Business;
using DriftKing.Data;
using Microsoft.AspNetCore.Mvc;

namespace DriftKing.Pages.Admin.Runs;

public sealed class EditModel(AppDbContext db) : AppPageModel(db)
{
    [BindProperty(SupportsGet = true)]
    public long Id { get; set; }

    public Run? Run { get; private set; }

    public async Task<IActionResult> OnGetAsync()
    {
        Run = await RunLogic.GetAsync(Db, Me, Id);
        return Run is null ? NotFound() : Page();
    }

    public async Task<IActionResult> OnPostDeleteAsync()
        => await TryAsync(async () =>
        {
            await RunLogic.DeleteAsync(Db, Me, Id);
            Flash("Der Lauf wurde gelöscht.");
            return RedirectToPage("Index");
        }, async () => Run = await RunLogic.GetAsync(Db, Me, Id));
}
