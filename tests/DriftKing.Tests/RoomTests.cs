using DriftKing.Business;
using DriftKing.Data;
using DriftKing.Game;

namespace DriftKing.Tests;

public sealed class RoomTests
{
    private static readonly DateTime T0 = new(2026, 11, 25, 20, 0, 0, DateTimeKind.Utc);
    private static readonly IReadOnlyList<Car> Cars = SeedContent.Cars().Select((c, i) => { c.Id = i + 1; return c; }).ToList();
    private static readonly Map Deck = SeedContent.Maps().First(m => m.Key == "deck");

    private static CarView Car(int seat = 0) => GarageRules.BotCar(Cars, seat, 5, 1);

    private static DriftRoom Room(GameMode mode, int bots = 2, bool solo = false)
        => new("ABCD", RoomSetup.For(Deck, new RoomOptions("deck", Looks.ModeKey(mode), 2, 60, bots, 5, false, null), 8, solo), T0);

    [Fact]
    public void The_first_player_hosts_and_the_host_passes_on()
    {
        var room = Room(GameMode.Score);
        room.Join(1, "Ann", Car(), "c1", T0);
        room.Join(2, "Ben", Car(), "c2", T0);
        Assert.Equal(0, room.HostSeat);
        room.Leave("c1", T0);
        Assert.Equal(1, room.HostSeat);
        room.Leave("c2", T0);
        Assert.Equal(RoomStatus.Closed, room.Status);
    }

    [Fact]
    public void Only_the_host_starts_and_everybody_has_to_be_ready()
    {
        var room = Room(GameMode.Score);
        room.Join(1, "Ann", Car(), "c1", T0);
        room.Join(2, "Ben", Car(), "c2", T0);
        Assert.Throws<BusinessException>(() => room.Start("c2", T0, Car));
        Assert.Throws<BusinessException>(() => room.Start("c1", T0, Car));
        room.SetReady("c2", true);
        room.Start("c1", T0, Car);
        Assert.Equal(RoomStatus.Countdown, room.Status);
        Assert.Equal(4, room.Seats.Count);
        Assert.Equal(2, room.Seats.Count(s => s.IsBot));
        Assert.Throws<BusinessException>(() => room.Join(3, "Cid", Car(), "c3", T0));
    }

    [Fact]
    public void Players_drive_their_own_seat_and_the_host_the_bots()
    {
        var room = Room(GameMode.Score);
        room.Join(1, "Ann", Car(), "c1", T0);
        room.Join(2, "Ben", Car(), "c2", T0);
        room.SetReady("c2", true);
        room.Start("c1", T0, Car);
        var bot = room.Seats.First(s => s.IsBot).Number;
        Assert.True(room.MayDrive("c1", 0));
        Assert.True(room.MayDrive("c1", bot));
        Assert.True(room.MayDrive("c2", 1));
        Assert.False(room.MayDrive("c2", 0));
        Assert.False(room.MayDrive("c2", bot));
        Assert.False(room.AcceptState("c1", 0, [1, double.NaN], T0));
        Assert.True(room.AcceptState("c1", 0, new double[17], T0));
    }

    [Fact]
    public void The_run_ends_when_everybody_finished_and_places_follow_the_points()
    {
        var room = Room(GameMode.Score, bots: 1, solo: true);
        room.Join(1, "Ann", Car(), "c1", T0);
        room.Start("c1", T0, Car);
        room.Tick(T0.AddSeconds(5));
        Assert.Equal(RoomStatus.Running, room.Status);
        Assert.False(room.Finish("c1", 0, new FinishInput(20_000, null, null, 0, 5000, 50, 300, 0), T0.AddSeconds(64)));
        Assert.True(room.Finish("c1", 1, new FinishInput(12_000, null, null, 0, 3000, 40, 200, 0), T0.AddSeconds(64)));
        Assert.True(room.TryEnd());
        Assert.False(room.TryEnd());
        var outcomes = RunRules.Outcomes(room, T0.AddSeconds(65), Plausibility.DefaultMaxPointsPerSecond, 100);
        Assert.Equal("Ann", outcomes[0].Seat.Name);
        Assert.Equal(1, outcomes[0].Place);
        Assert.True(outcomes[0].Money > 0);
        Assert.Equal(0, outcomes[1].Money);
    }

    [Fact]
    public void Quitting_a_score_run_early_keeps_the_points_but_not_the_place_prize()
    {
        var room = Room(GameMode.Score, bots: 1, solo: true);
        room.Join(1, "Ann", Car(), "c1", T0);
        room.Start("c1", T0, Car);
        room.Finish("c1", 0, new FinishInput(0, null, null, 0, 0, 0, 0, 0), T0.AddSeconds(10));
        room.Finish("c1", 1, new FinishInput(0, null, null, 0, 0, 0, 0, 0), T0.AddSeconds(10));
        var ann = RunRules.Outcomes(room, T0.AddSeconds(10), 8000, 100).Single(o => o.Seat.PlayerId == 1);
        Assert.False(ann.Finished);
        Assert.Equal(0, ann.Money);
        Assert.Equal(0, ann.Xp);
        var player = new Player { Id = 1 };
        RunRules.Apply(player, ann, GameMode.Score, 2);
        Assert.Equal(0, player.Wins);
    }

    [Fact]
    public void Impossible_points_are_cut_and_flagged()
    {
        var room = Room(GameMode.Score, bots: 0, solo: true);
        room.Join(1, "Ann", Car(), "c1", T0);
        room.Start("c1", T0, Car);
        room.Finish("c1", 0, new FinishInput(50_000_000, null, null, 0, 0, 0, 0, 0), T0.AddSeconds(64));
        var outcome = RunRules.Outcomes(room, T0.AddSeconds(64), 8000, 100).Single();
        Assert.True(outcome.Flagged);
        Assert.True(outcome.Score <= 8000L * 70);
    }

    [Fact]
    public void A_race_too_fast_does_not_count_as_finished()
    {
        var room = Room(GameMode.Race, bots: 1, solo: true);
        room.Join(1, "Ann", Car(), "c1", T0);
        room.Start("c1", T0, Car);
        room.Finish("c1", 0, new FinishInput(0, 1000, 500, 2, 0, 0, 0, 0), T0.AddSeconds(6));
        room.Finish("c1", 1, new FinishInput(0, 200_000, 99_000, 2, 0, 0, 0, 0), T0.AddSeconds(210));
        var outcomes = RunRules.Outcomes(room, T0.AddSeconds(210), 8000, 100);
        var ann = outcomes.Single(o => o.Seat.PlayerId == 1);
        Assert.True(ann.Flagged);
        Assert.False(ann.Finished);
        Assert.Equal(2, ann.Place);
    }

    [Fact]
    public void The_clock_ends_a_score_run_after_its_time()
    {
        var room = Room(GameMode.Score, bots: 1, solo: true);
        room.Join(1, "Ann", Car(), "c1", T0);
        room.Start("c1", T0, Car);
        Assert.False(room.Tick(T0.AddSeconds(30)));
        Assert.True(room.Tick(T0.AddSeconds(4 + 60 + 16)));
        Assert.Equal(RoomStatus.Finished, room.Status);
    }

    [Fact]
    public void Competition_pays_a_better_medal_once()
    {
        var competition = new Competition { Id = 3, Mode = GameMode.Score, Bronze = 100, Silver = 200, Gold = 300, RewardBronze = 10, RewardSilver = 20, RewardGold = 40 };
        var player = new Player { Id = 1 };
        var result = new CompetitionResult { CompetitionId = 3, PlayerId = 1 };
        var seat = new Seat { Number = 0, PlayerId = 1, Name = "Ann", Car = Car() };
        var silver = RunRules.ApplyCompetition(player, competition, result, new Outcome(seat, 1, 250, null, null, 0, 0, 0, true, false, 0, 0));
        Assert.Equal("silver", silver.Medal);
        Assert.Equal(20, player.Money);
        RunRules.ApplyCompetition(player, competition, result, new Outcome(seat, 1, 220, null, null, 0, 0, 0, true, false, 0, 0));
        Assert.Equal(20, player.Money);
        var gold = RunRules.ApplyCompetition(player, competition, result, new Outcome(seat, 1, 310, null, null, 0, 0, 0, true, false, 0, 0));
        Assert.Equal(20, gold.Reward);
        Assert.Equal(40, player.Money);
        Assert.Equal(310, result.BestScore);
        Assert.Equal(3, result.Attempts);
    }
}
