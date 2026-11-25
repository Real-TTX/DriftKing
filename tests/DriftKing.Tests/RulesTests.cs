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
    public void Money_pays_places_and_points()
    {
        Assert.True(Economy.MoneyOf(GameMode.Race, 1, 4, 0, true, 100) > Economy.MoneyOf(GameMode.Race, 2, 4, 0, true, 100));
        Assert.Equal(0, Economy.MoneyOf(GameMode.Race, 1, 4, 0, false, 100));
        Assert.True(Economy.MoneyOf(GameMode.Score, 1, 1, 40_000, true, 100) >= 1000);
        Assert.Equal(2 * Economy.MoneyOf(GameMode.Score, 1, 4, 40_000, true, 100), Economy.MoneyOf(GameMode.Score, 1, 4, 40_000, true, 200));
    }
}
