using DriftKing.Business;
using DriftKing.Data;
using MatGame.Sdk.Web;

namespace DriftKing.Pages.Admin.Runs;

public sealed class IndexModel(AppDbContext db) : AppPageModel(db)
{
    private IReadOnlyDictionary<string, string> _maps = new Dictionary<string, string>();

    public IReadOnlyList<Run> Items { get; private set; } = [];

    public ToolbarModel Toolbar { get; private set; } = null!;

    public PagerModel Pager { get; private set; } = null!;

    public async Task OnGetAsync()
    {
        var request = ReadList(["mode", "map", "status", "kind"]);
        var result = await RunLogic.ListAsync(Db, Me, request);
        Items = result.Items;
        var maps = await ContentLogic.ListMapsAsync(Db, Me, new ListRequest(null, new Dictionary<string, string?>(), null, false, 1, 100));
        _maps = maps.Items.ToDictionary(m => m.Key, m => m.Name);
        Toolbar = new ToolbarModel
        {
            Id = "runs", Action = "/Admin/DriftKing/Runs", Label = "Läufe", Search = request.Search, SearchField = true, SearchPlaceholder = "Code oder Fahrer",
            Filters =
            [
                new FilterField("mode", "Modus", Enum.GetValues<GameMode>().Select(m => new FilterOption(m.ToString(), Looks.ModeName(m))).ToList(), request.Filter("mode")),
                new FilterField("map", "Strecke", maps.Items.Select(m => new FilterOption(m.Key, m.Name)).ToList(), request.Filter("map")),
                new FilterField("kind", "Art", [new FilterOption("solo", "Solo"), new FilterOption("online", "Online")], request.Filter("kind")),
                new FilterField("status", "Status", Enum.GetValues<RunStatus>().Select(s => new FilterOption(s.ToString(), StatusName(s))).ToList(), request.Filter("status")),
            ],
            SortOptions = [new SortOption("start", "Start"), new SortOption("map", "Strecke"), new SortOption("humans", "Fahrer")],
            Sort = request.Sort, Descending = request.Descending, DefaultSort = "start",
            Total = result.Total, Matching = result.Matching, Noun = "Läufe", NounOne = "Lauf",
        };
        Pager = BuildPager(Toolbar, request.Page, request.PageSize, result.Matching);
    }

    public string MapName(string key) => _maps.GetValueOrDefault(key, key);

    public static string StatusName(RunStatus status) => status switch
    {
        RunStatus.Running => "Läuft",
        RunStatus.Finished => "Fertig",
        _ => "Abgebrochen",
    };
}
