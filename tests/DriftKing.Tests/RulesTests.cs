using DriftKing.Business;
using DriftKing.Data;

namespace DriftKing.Tests;

public sealed class RulesTests
{
    private static Car Starter => SeedContent.Cars().First(c => c.Price == 0);

    [Fact]
    public void Levels_follow_the_triangle()
    {
        Assert.Equal(1, Progression.LevelOf(0));
        Assert.Equal(1, Progression.LevelOf(499));
        Assert.Equal(2, Progression.LevelOf(500));
        Assert.Equal(3, Progression.LevelOf(1500));
        Assert.Equal(4, Progression.LevelOf(3000));
        Assert.Equal(Progression.MaxLevel, Progression.LevelOf(long.MaxValue / 4));
    }

    [Fact]
    public void Spec_grows_with_the_parts_and_rwd_has_less_rear_grip()
    {
        var car = Starter;
        var stock = Tuning.SpecOf(car, null);
        var tuned = Tuning.SpecOf(car, new GarageCar { Engine = 5, Turbo = 5, Tires = 5, SteeringKit = 5, Suspension = 5 });
        Assert.True(tuned.PowerKw > stock.PowerKw);
        Assert.True(tuned.TopSpeedKmh > stock.TopSpeedKmh);
        Assert.True(tuned.GripFront > stock.GripFront);
        Assert.True(tuned.SteerLockDeg > stock.SteerLockDeg);
        Assert.True(tuned.SteerLockDeg <= 70);
        Assert.True(stock.GripRear < stock.GripFront);
        var awd = Tuning.SpecOf(new Car { Power = 5, Grip = 5, Weight = 5, Steering = 5, Drive = CarDrive.AWD }, null);
        Assert.Equal(awd.GripFront, awd.GripRear);
    }

    [Fact]
    public void Spec_matches_the_javascript_mirror()
    {
        // js/game/catalog.js specOf: power 5, grip 5, weight 5, steering 5, RWD, engine 2, tires 1
        var spec = Tuning.SpecOf(new Car { Power = 5, Grip = 5, Weight = 5, Steering = 5, Drive = CarDrive.RWD }, new GarageCar { Engine = 2, Tires = 1 });
        Assert.Equal(1300, spec.MassKg);
        Assert.Equal(90 + 110 + 24, spec.PowerKw);
        Assert.Equal(170 + 45 + 8, spec.TopSpeedKmh);
        Assert.Equal(1.125, spec.GripFront);
        Assert.Equal(1.057, spec.GripRear);
        Assert.Equal(44.5, spec.SteerLockDeg);
    }

    [Fact]
    public void Seeded_cars_match_the_javascript_mirror()
    {
        // js/game/catalog.js CARS: one line per car with the same name, body, drive and values
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "DriftKing.slnx")))
        {
            root = root.Parent;
        }

        Assert.NotNull(root);
        var catalog = File.ReadAllText(Path.Combine(root.FullName, "src", "DriftKing.Module", "wwwroot", "js", "game", "catalog.js"));
        foreach (var car in SeedContent.Cars())
        {
            var line = $"    {car.Key}: {{ name: '{car.Name}', body: '{car.Body}', drive: '{car.Drive}', power: {car.Power}, grip: {car.Grip}, "
                + $"weight: {car.Weight}, steering: {car.Steering} }},";
            Assert.Contains(line, catalog);
        }

        Assert.Equal(SeedContent.Cars().Count, System.Text.RegularExpressions.Regex.Matches(catalog, @"^    \w+: \{ name: '[^']*', body: '",System.Text.RegularExpressions.RegexOptions.Multiline).Count);
    }

    [Fact]
    public void Buying_needs_money_level_and_a_free_slot()
    {
        var cars = SeedContent.Cars().Select((c, i) => { c.Id = i + 1; return c; }).ToList();
        var player = new Player { Id = 7, Money = 10000, Xp = 0 };
        var hotaru = cars.First(c => c.Key == "hotaru");
        var bought = GarageRules.Buy(player, hotaru, []);
        Assert.Equal(10000 - hotaru.Price, player.Money);
        Assert.Equal(hotaru.Id, bought.CarId);
        Assert.Throws<BusinessException>(() => GarageRules.Buy(player, hotaru, [bought]));
        Assert.Throws<BusinessException>(() => GarageRules.Buy(player, cars.First(c => c.Key == "tora"), []));
        player.Xp = Progression.XpOfLevel(10);
        Assert.Throws<BusinessException>(() => GarageRules.Buy(player, cars.First(c => c.Key == "tora"), []));
    }

    [Fact]
    public void Upgrades_cost_more_each_level_and_stop_at_the_top()
    {
        var car = Starter;
        var player = new Player { Id = 1, Money = 1_000_000 };
        var garage = GarageRules.NewCar(1, car, 7);
        var first = GarageRules.Upgrade(player, garage, car, Part.Engine);
        var second = GarageRules.Upgrade(player, garage, car, Part.Engine);
        Assert.True(second > first);
        for (var i = 2; i < Tuning.MaxLevel; i++)
        {
            GarageRules.Upgrade(player, garage, car, Part.Engine);
        }

        Assert.Equal(Tuning.MaxLevel, garage.Engine);
        Assert.Throws<BusinessException>(() => GarageRules.Upgrade(player, garage, car, Part.Engine));
    }

    [Fact]
    public void Looks_accept_only_known_values()
    {
        var garage = GarageRules.NewCar(1, Starter, 7);
        GarageRules.SetLook(garage, "#FF2E88", "#16151f", "none", "kanji", 86);
        Assert.Equal("#ff2e88", garage.Paint);
        Assert.Null(garage.Neon);
        Assert.Equal("kanji", garage.Decal);
        Assert.Equal(86, garage.Number);
        Assert.Throws<BusinessException>(() => GarageRules.SetLook(garage, "red", null, null, null, null));
        Assert.Throws<BusinessException>(() => GarageRules.SetLook(garage, null, null, null, "skull", null));
        Assert.Throws<BusinessException>(() => GarageRules.SetLook(garage, null, null, null, null, 100));
    }

    [Fact]
    public void Medals_score_more_is_better_race_less_is_better()
    {
        var score = new Competition { Mode = GameMode.Score, Bronze = 100, Silver = 200, Gold = 300, RewardBronze = 10, RewardSilver = 20, RewardGold = 40 };
        Assert.Equal(Medal.None, Medals.Of(score, 99, null));
        Assert.Equal(Medal.Silver, Medals.Of(score, 250, null));
        Assert.Equal(Medal.Gold, Medals.Of(score, 300, null));
        var race = new Competition { Mode = GameMode.Race, Bronze = 90_000, Silver = 80_000, Gold = 70_000 };
        Assert.Equal(Medal.None, Medals.Of(race, 0, null));
        Assert.Equal(Medal.Bronze, Medals.Of(race, 0, 85_000));
        Assert.Equal(Medal.Gold, Medals.Of(race, 0, 69_999));
        Assert.Equal(30, Medals.RewardForUpgrade(score, Medal.Bronze, Medal.Gold));
        Assert.Equal(0, Medals.RewardForUpgrade(score, Medal.Gold, Medal.Silver));
    }

    [Fact]
    public void Seeded_competitions_have_ordered_targets()
    {
        foreach (var c in SeedContent.Competitions(_ => 1))
        {
            if (c.Mode == GameMode.Race)
            {
                Assert.True(c.Gold <= c.Silver && c.Silver <= c.Bronze, c.Name);
            }
            else
            {
                Assert.True(c.Gold >= c.Silver && c.Silver >= c.Bronze, c.Name);
            }

            Assert.True(c.RewardBronze <= c.RewardSilver && c.RewardSilver <= c.RewardGold, c.Name);
        }
    }

    [Fact]
    public void Every_seeded_map_is_one_the_browser_draws()
    {
        foreach (var map in SeedContent.Maps())
        {
            Assert.True(MapCatalog.Exists(map.Key), $"data/maps.json has no map '{map.Key}'");
            Assert.True(MapCatalog.LengthOf(map.Key) > 300);
        }
    }

    [Fact]
    public void Seeded_cars_keep_their_keys_and_order_and_fit_the_scales()
    {
        var cars = SeedContent.Cars();
        // the offline game numbers the cars by their place: the first eight stay where they are, new ones come after them
        Assert.Equal(["kaze", "hotaru", "ronin", "kitsune", "yurei", "raijin", "oni", "tora", "s14a", "g81", "e46", "z33", "gr86"], cars.Select(c => c.Key));
        Assert.Equal(cars.Count, cars.Select(c => c.SortOrder).Distinct().Count());
        Assert.Single(cars, c => c.Price == 0);
        Assert.Equal("kaze", Starter.Key);
        foreach (var car in cars)
        {
            Assert.Contains(car.Body, Looks.Bodies);
            Assert.Contains(car.DefaultPaint, Looks.Paints);
            Assert.All(new[] { car.Power, car.Grip, car.Weight, car.Steering }, value => Assert.InRange(value, 1, 10));
            Assert.InRange(car.Name.Length, 1, 60);
            Assert.InRange(car.Description.Length, 1, 400);
            Assert.InRange(car.UnlockLevel, 1, Progression.MaxLevel);
        }

        // the dealer's order: the price rises with the sort order, the S14a sits between the S13 and the S15
        var sorted = cars.OrderBy(c => c.SortOrder).ToList();
        Assert.Equal(sorted.Select(c => c.Price).Order(), sorted.Select(c => c.Price));
        Assert.Equal(sorted.Select(c => c.UnlockLevel).Order(), sorted.Select(c => c.UnlockLevel));
        var order = sorted.Select(c => c.Key).ToList();
        Assert.True(order.IndexOf("kaze") < order.IndexOf("s14a") && order.IndexOf("s14a") < order.IndexOf("yurei"));
        Assert.Equal(CarDrive.AWD, cars.First(c => c.Key == "g81").Drive);
        Assert.All(new[] { "s14a", "e46", "z33", "gr86" }, key => Assert.Equal(CarDrive.RWD, cars.First(c => c.Key == key).Drive));
    }

    [Fact]
    public void Refresh_renames_the_former_seeded_cars_but_keeps_an_admins_values()
    {
        var untouched = new Car { Key = "kaze", Name = "Kaze 2000", Description = "Leichtes Coupé mit Heckantrieb – gutmütig, ehrlich, der Klassiker zum Driften-Lernen.",
            DefaultPaint = "#f4f2ff", Power = 3, Price = 0 };
        Assert.True(SeedContent.Refresh(untouched));
        Assert.Equal("Nissan Silvia S13", untouched.Name);
        Assert.StartsWith("Der Klassiker", untouched.Description);
        Assert.Equal(3, untouched.Power);
        Assert.False(SeedContent.Refresh(untouched));

        var edited = new Car { Key = "kitsune", Name = "Mein Fuchs", Description = "Spitze Schnauze, flinkes Heck: schnell umgesetzt, schnell gefangen.",
            DefaultPaint = "#ff7a1a", Price = 1 };
        Assert.True(SeedContent.Refresh(edited));
        Assert.Equal("Mein Fuchs", edited.Name);
        Assert.StartsWith("Wankelmotor", edited.Description);
        Assert.Equal("#ff4040", edited.DefaultPaint);
        Assert.Equal(1, edited.Price);

        Assert.False(SeedContent.Refresh(new Car { Key = "s14a", Name = "Irgendwas" }));
        Assert.False(SeedContent.Refresh(new Car { Key = "custom", Name = "Kaze 2000" }));
    }

    [Fact]
    public void Bots_drive_every_class_of_the_catalogue()
    {
        var cars = SeedContent.Cars().Select((c, i) => { c.Id = i + 1; return c; }).ToList();
        var top = Enumerable.Range(0, 40).Select(seat => GarageRules.BotCar(cars, seat, 10, 7).Key).ToHashSet();
        Assert.Contains("tora", top);
        Assert.DoesNotContain("kaze", top);
        var low = Enumerable.Range(0, 40).Select(seat => GarageRules.BotCar(cars, seat, 1, 7).Key).ToHashSet();
        Assert.Subset(new HashSet<string> { "kaze", "hotaru" }, low);
    }

    [Fact]
    public void Money_pays_places_and_points()
    {
        Assert.True(Economy.MoneyOf(GameMode.Race, 1, 4, 0, true, 100) > Economy.MoneyOf(GameMode.Race, 2, 4, 0, true, 100));
        Assert.Equal(0, Economy.MoneyOf(GameMode.Race, 1, 4, 0, false, 100));
        Assert.True(Economy.MoneyOf(GameMode.Score, 1, 1, 40_000, true, 100) >= 1000);
        Assert.Equal(2 * Economy.MoneyOf(GameMode.Score, 1, 4, 40_000, true, 100), Economy.MoneyOf(GameMode.Score, 1, 4, 40_000, true, 200));
    }
}
