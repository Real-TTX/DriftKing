using DriftKing.Business;
using DriftKing.Data;
using MatGame.Sdk.Web;

namespace DriftKing.Pages.Admin.Maps;

public sealed class IndexModel(AppDbContext db) : AppPageModel(db)
{
    public IReadOnlyList<Map> Items { get; private set; } = [];

    /// <summary>Only a map the browser can draw may get a record: "new" is offered while one of them has none.</summary>
    public bool CanCreate { get; private set; }

    public ToolbarModel Toolbar { get; private set; } = null!;

    public PagerModel Pager { get; private set; } = null!;

    public async Task OnGetAsync()
    {
        var request = ReadList(["status"]);
        var result = await ContentLogic.ListMapsAsync(Db, Me, request);
        Items = result.Items;
        CanCreate = (await ContentLogic.FreeMapKeysAsync(Db, Me)).Count > 0;
        Toolbar = new ToolbarModel
        {
            Id = "maps", Action = "/Admin/DriftKing/Maps", Label = "Strecken", Search = request.Search, SearchField = true, SearchPlaceholder = "Name, Karte oder Beschreibung",
            Filters = [new FilterField("status", "Status", [new FilterOption("enabled", "Fahrbar"), new FilterOption("disabled", "Aus")], request.Filter("status"))],
            SortOptions = [new SortOption("order", "Reihenfolge"), new SortOption("name", "Name"), new SortOption("level", "Level")],
            Sort = request.Sort, Descending = request.Descending, DefaultSort = "order",
            Total = result.Total, Matching = result.Matching, Noun = "Strecken", NounOne = "Strecke",
        };
        Pager = BuildPager(Toolbar, request.Page, request.PageSize, result.Matching);
    }
}
