using DriftKing.Business;
using DriftKing.Data;
using MatGame.Sdk.Web;

namespace DriftKing.Pages.Admin.Competitions;

public sealed class IndexModel(AppDbContext db) : AppPageModel(db)
{
    public IReadOnlyList<Competition> Items { get; private set; } = [];

    public IReadOnlyDictionary<long, int> Participants { get; private set; } = new Dictionary<long, int>();

    public ToolbarModel Toolbar { get; private set; } = null!;

    public PagerModel Pager { get; private set; } = null!;

    public async Task OnGetAsync()
    {
        var request = ReadList(["mode", "map", "status"]);
        var result = await CompetitionLogic.ListAsync(Db, Me, request);
        Items = result.Items;
        Participants = await CompetitionLogic.ParticipantsAsync(Db, Me);
        var maps = await ContentLogic.ListMapsAsync(Db, Me, new ListRequest(null, new Dictionary<string, string?>(), null, false, 1, 100));
        Toolbar = new ToolbarModel
        {
            Id = "competitions", Action = "/Admin/DriftKing/Competitions", Label = "Wettbewerbe", Search = request.Search, SearchField = true,
            SearchPlaceholder = "Name oder Beschreibung",
            Filters =
            [
                new FilterField("mode", "Art", [new FilterOption(nameof(GameMode.Score), "Drift-Wertung"), new FilterOption(nameof(GameMode.Race), "Rennen")], request.Filter("mode")),
                new FilterField("map", "Strecke", maps.Items.Select(m => new FilterOption(m.Id.ToString(), m.Name)).ToList(), request.Filter("map")),
                new FilterField("status", "Status", [new FilterOption("enabled", "Offen"), new FilterOption("disabled", "Aus")], request.Filter("status")),
            ],
            SortOptions = [new SortOption("order", "Reihenfolge"), new SortOption("name", "Name"), new SortOption("level", "Level"), new SortOption("start", "Beginn")],
            Sort = request.Sort, Descending = request.Descending, DefaultSort = "order",
            Total = result.Total, Matching = result.Matching, Noun = "Wettbewerbe", NounOne = "Wettbewerb",
        };
        Pager = BuildPager(Toolbar, request.Page, request.PageSize, result.Matching);
    }

    /// <summary>A medal target as people read it: points, or a time m:ss.f for races.</summary>
    public static string Target(Competition competition, long value)
        => competition.Mode == GameMode.Race ? TimeSpan.FromMilliseconds(value).ToString(@"m\:ss\.f") : Plausibility.Describe(value);
}
