using DriftKing.Business;
using DriftKing.Data;
using MatGame.Sdk.Web;

namespace DriftKing.Pages.Admin.Players;

public sealed class IndexModel(AppDbContext db) : AppPageModel(db)
{
    public IReadOnlyList<Player> Items { get; private set; } = [];

    public ToolbarModel Toolbar { get; private set; } = null!;

    public PagerModel Pager { get; private set; } = null!;

    public async Task OnGetAsync()
    {
        var request = ReadList(["kind"]);
        var result = await PlayerLogic.ListAsync(Db, Me, request);
        Items = result.Items;
        Toolbar = new ToolbarModel
        {
            Id = "players", Action = "/Admin/DriftKing/Players", Label = "Fahrer", Search = request.Search, SearchField = true, SearchPlaceholder = "Name",
            Filters = [new FilterField("kind", "Art", [new FilterOption("account", "Mit Konto"), new FilterOption("guest", "Gäste")], request.Filter("kind"))],
            SortOptions =
            [
                new SortOption("level", "Level"), new SortOption("name", "Name"), new SortOption("money", "Geld"), new SortOption("runs", "Läufe"),
                new SortOption("score", "Bester Lauf"), new SortOption("seen", "Zuletzt"),
            ],
            Sort = request.Sort, Descending = request.Descending, DefaultSort = "level",
            Total = result.Total, Matching = result.Matching, Noun = "Fahrer", NounOne = "Fahrer",
        };
        Pager = BuildPager(Toolbar, request.Page, request.PageSize, result.Matching);
    }
}
