using System.Text.Json;
using DriftKing.Game;
using DriftKing.Local;
using MatGame.Local;

namespace DriftKing.Tests;

/// <summary>The offline game answers the calls of the player app like the server (docs/PROTOCOL.md).</summary>
public sealed class LocalGameTests : IAsyncLifetime
{
    private readonly FakeHost _host = new();
    private readonly DriftKingLocal _game = new();

    public async Task InitializeAsync() => await _game.StartAsync(_host, CancellationToken.None);

    public async Task DisposeAsync()
    {
        await _game.DisposeAsync();
        Directory.Delete(_host.DataDirectory, recursive: true);
    }

    [Fact]
    public async Task A_new_profile_has_money_and_the_starter_car()
    {
        var session = await GetAsync("/session");
        Assert.True(session.GetProperty("signedIn").GetBoolean());
        Assert.True(session.GetProperty("offline").GetBoolean());
        var garage = await GetAsync("/garage");
        Assert.Equal(1, garage.GetProperty("cars").GetArrayLength());
        Assert.True(garage.GetProperty("money").GetInt64() > 0);
        var home = await GetAsync("/home");
        Assert.Equal("kaze", home.GetProperty("car").GetProperty("key").GetString());
    }

    [Fact]
    public async Task The_catalogue_has_all_cars_with_stable_ids()
    {
        var cars = (await GetAsync("/catalog")).GetProperty("cars").EnumerateArray().ToList();
        Assert.Equal(14, cars.Count);
        long IdOf(string key) => cars.First(c => c.GetProperty("key").GetString() == key).GetProperty("id").GetInt64();
        // profile.json keeps these numbers: the first eight cars keep theirs, the new ones follow
        Assert.Equal(1, IdOf("kaze"));
        Assert.Equal(8, IdOf("tora"));
        Assert.Equal(9, IdOf("s14a"));
        Assert.Equal(14, IdOf("f21"));
        // the dealer shows them in the sort order: the S14a between the Chaser and the RX-7
        var keys = cars.Select(c => c.GetProperty("key").GetString()).ToList();
        Assert.Equal(keys.IndexOf("ronin") + 1, keys.IndexOf("s14a"));
        Assert.Equal(keys.IndexOf("kitsune") - 1, keys.IndexOf("s14a"));
        var s14a = cars.First(c => c.GetProperty("key").GetString() == "s14a");
        Assert.Equal("Nissan 200SX S14a", s14a.GetProperty("name").GetString());
        Assert.Equal("coupe", s14a.GetProperty("body").GetString());
        Assert.Equal("RWD", s14a.GetProperty("drive").GetString());
        Assert.Equal("AWD", cars.First(c => c.GetProperty("key").GetString() == "g81").GetProperty("drive").GetString());
        // the M140i F21 (hatch, RWD) right after the E46
        Assert.Equal(keys.IndexOf("e46") + 1, keys.IndexOf("f21"));
        var f21 = cars.First(c => c.GetProperty("key").GetString() == "f21");
        Assert.Equal("BMW M140i F21", f21.GetProperty("name").GetString());
        Assert.Equal("hatch", f21.GetProperty("body").GetString());
        Assert.Equal("RWD", f21.GetProperty("drive").GetString());
    }

    [Fact]
    public async Task Buying_upgrading_and_painting_change_the_saved_profile()
    {
        var catalog = await GetAsync("/catalog");
        var hotaru = catalog.GetProperty("cars").EnumerateArray().First(c => c.GetProperty("key").GetString() == "hotaru").GetProperty("id").GetInt64();
        var garage = await SendAsync("POST", "/garage/buy", new { carId = hotaru });
        Assert.Equal(2, garage.GetProperty("cars").GetArrayLength());
        var id = garage.GetProperty("selectedId").GetInt64();
        garage = await SendAsync("POST", $"/garage/{id}/upgrade", new { part = "turbo" });
        var car = garage.GetProperty("cars").EnumerateArray().First(c => c.GetProperty("car").GetProperty("id").GetInt64() == id);
        Assert.Equal(1, car.GetProperty("car").GetProperty("levels").GetProperty("turbo").GetInt32());
        await SendAsync("PUT", $"/garage/{id}/look", new { paint = "#29e7ff", neon = "#ff2e88", decal = "sakura", number = 21 });
        Assert.Contains("#29e7ff", await File.ReadAllTextAsync(Path.Combine(_host.DataDirectory, LocalProfile.FileName)));
        var error = await _game.RequestAsync("POST", $"/garage/{id}/upgrade", JsonSerializer.SerializeToElement(new { part = "wings" }), CancellationToken.None);
        Assert.Equal(400, error.Status);
    }

    [Fact]
    public async Task A_solo_run_ends_with_results_and_pays_the_driver()
    {
        var before = (await GetAsync("/session")).GetProperty("player").GetProperty("money").GetInt64();
        var room = await InvokeAsync("Solo", new RoomOptions("deck", "score", null, 60, 2, 3, null, null));
        Assert.Equal("countdown", room.GetProperty("status").GetString());
        var mySeat = room.GetProperty("mySeat").GetInt32();
        var seats = room.GetProperty("seats").EnumerateArray().Select(s => s.GetProperty("seat").GetInt32()).ToList();
        Assert.Equal(3, seats.Count);
        await InvokeAsync("State", mySeat, new double[17]);
        var start = DateTime.UtcNow;
        _game.Now = () => start.AddSeconds(4 + 60);
        foreach (var seat in seats)
        {
            await InvokeAsync("Finish", seat, new FinishInput(seat == mySeat ? 30_000 : 10_000, null, null, 0, 8000, 55, 400, 0));
        }

        var results = _host.Messages.Last(m => m.Name == "Results").Args[0];
        var json = JsonSerializer.SerializeToElement(results, LocalJson.Options);
        var mine = json.GetProperty("entries").EnumerateArray().First(e => e.GetProperty("seat").GetInt32() == mySeat);
        Assert.Equal(1, mine.GetProperty("place").GetInt32());
        var after = (await GetAsync("/session")).GetProperty("player").GetProperty("money").GetInt64();
        Assert.True(after > before);
        Assert.Single((await GetAsync("/history")).EnumerateArray());
    }

    [Fact]
    public async Task A_competition_gives_a_medal()
    {
        var competitions = await GetAsync("/competitions");
        var first = competitions.EnumerateArray().First();
        var id = first.GetProperty("id").GetInt64();
        var gold = first.GetProperty("goals").GetProperty("gold").GetInt64();
        var room = await InvokeAsync("Solo", new RoomOptions(null, null, null, null, null, null, null, id));
        var start = DateTime.UtcNow;
        _game.Now = () => start.AddSeconds(4 + first.GetProperty("durationS").GetInt32());
        var mySeat = room.GetProperty("mySeat").GetInt32();
        foreach (var seat in room.GetProperty("seats").EnumerateArray().Select(s => s.GetProperty("seat").GetInt32()))
        {
            await InvokeAsync("Finish", seat, new FinishInput(seat == mySeat ? gold : 100, null, null, 0, 0, 0, 0, 0));
        }

        competitions = await GetAsync("/competitions");
        var mine = competitions.EnumerateArray().First(c => c.GetProperty("id").GetInt64() == id).GetProperty("mine");
        Assert.Equal("gold", mine.GetProperty("medal").GetString());
    }

    [Fact]
    public async Task Online_rooms_are_not_offline()
        => await Assert.ThrowsAsync<InvalidOperationException>(() => _game.InvokeAsync("CreateRoom", [JsonSerializer.SerializeToElement(new { })], CancellationToken.None));

    private async Task<JsonElement> GetAsync(string path)
    {
        var response = await _game.RequestAsync("GET", path, null, CancellationToken.None);
        Assert.Equal(200, response.Status);
        return response.Body!.Value;
    }

    private async Task<JsonElement> SendAsync(string method, string path, object body)
    {
        var response = await _game.RequestAsync(method, path, JsonSerializer.SerializeToElement(body, LocalJson.Options), CancellationToken.None);
        Assert.True(response.Status == 200, response.Body?.ToString());
        return response.Body!.Value;
    }

    private async Task<JsonElement> InvokeAsync(string method, params object[] args)
    {
        var result = await _game.InvokeAsync(method, args.Select(a => JsonSerializer.SerializeToElement(a, LocalJson.Options)).ToList(), CancellationToken.None);
        return result ?? default;
    }

    private sealed class FakeHost : ILocalHost
    {
        public string DataDirectory { get; } = Path.Combine(Path.GetTempPath(), "driftking-tests-" + Guid.NewGuid().ToString("n"));

        public string PlayerName => "Testfahrer";

        public List<(string Name, object?[] Args)> Messages { get; } = [];

        public void Emit(string name, params object?[] args) => Messages.Add((name, args));

        public void Log(string message)
        {
        }
    }
}
