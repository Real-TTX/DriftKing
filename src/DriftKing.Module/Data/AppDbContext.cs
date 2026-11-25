using Microsoft.EntityFrameworkCore;

namespace DriftKing.Data;

/// <summary>
/// The tables of DriftKing in the database of MatGame (PostgreSQL), all in the schema <see cref="Schema"/> with their own migration history there.
/// Tables and columns are PascalCase (singular table names), every key is a bigint "Id" (the key of <see cref="Player"/> is the MatGame account id).
/// Saving fills the audit columns: CreateDate/CreateUserId for new records, UpdateDate/UpdateUserId always, UpdateState = Updated for changed soft-delete records.
/// The business layer says who acts with <see cref="ActingAs"/>.
/// </summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public const string Schema = "driftking";

    public DbSet<Player> Players => Set<Player>();

    public DbSet<Car> Cars => Set<Car>();

    public DbSet<GarageCar> GarageCars => Set<GarageCar>();

    public DbSet<Map> Maps => Set<Map>();

    public DbSet<Competition> Competitions => Set<Competition>();

    public DbSet<CompetitionResult> CompetitionResults => Set<CompetitionResult>();

    public DbSet<Run> Runs => Set<Run>();

    public DbSet<RunEntry> RunEntries => Set<RunEntry>();

    public DbSet<Setting> Settings => Set<Setting>();

    /// <summary>The player whose changes are saved (null = the system).</summary>
    public long? ActorId { get; private set; }

    public AppDbContext ActingAs(long? playerId)
    {
        ActorId = playerId;
        return this;
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);

        modelBuilder.Entity<Player>(e =>
        {
            e.ToTable("Player");
            e.Property(p => p.Id).ValueGeneratedNever();
            e.Property(p => p.DisplayName).HasMaxLength(60);
            e.HasIndex(p => p.Xp);
            e.HasIndex(p => p.BestScore);
        });

        modelBuilder.Entity<Car>(e =>
        {
            e.ToTable("Car");
            e.Property(c => c.Key).HasMaxLength(24);
            e.Property(c => c.Name).HasMaxLength(60);
            e.Property(c => c.Description).HasMaxLength(400);
            e.Property(c => c.Body).HasMaxLength(24);
            e.Property(c => c.DefaultPaint).HasMaxLength(7);
            e.Property(c => c.Drive).HasConversion<int>();
            e.HasIndex(c => c.Key).IsUnique();
        });

        modelBuilder.Entity<GarageCar>(e =>
        {
            e.ToTable("GarageCar");
            e.Property(g => g.Paint).HasMaxLength(7);
            e.Property(g => g.Rims).HasMaxLength(7);
            e.Property(g => g.Neon).HasMaxLength(7);
            e.Property(g => g.Decal).HasMaxLength(24);
            e.HasOne(g => g.Car).WithMany().HasForeignKey(g => g.CarId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Player>().WithMany().HasForeignKey(g => g.PlayerId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(g => new { g.PlayerId, g.CarId }).IsUnique();
        });

        modelBuilder.Entity<Map>(e =>
        {
            e.ToTable("Map");
            e.Property(m => m.Key).HasMaxLength(24);
            e.Property(m => m.Name).HasMaxLength(60);
            e.Property(m => m.Description).HasMaxLength(400);
            e.Property(m => m.TimeOfDay).HasConversion<int>();
            e.HasIndex(m => m.Key).IsUnique();
        });

        modelBuilder.Entity<Competition>(e =>
        {
            e.ToTable("Competition");
            e.Property(c => c.Name).HasMaxLength(60);
            e.Property(c => c.Description).HasMaxLength(400);
            e.Property(c => c.Mode).HasConversion<int>();
            e.HasOne(c => c.Map).WithMany().HasForeignKey(c => c.MapId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<CompetitionResult>(e =>
        {
            e.ToTable("CompetitionResult");
            e.Property(r => r.Medal).HasConversion<int>();
            e.HasOne(r => r.Competition).WithMany().HasForeignKey(r => r.CompetitionId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Player>().WithMany().HasForeignKey(r => r.PlayerId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(r => new { r.CompetitionId, r.PlayerId }).IsUnique();
        });

        modelBuilder.Entity<Run>(e =>
        {
            e.ToTable("Run");
            e.Property(r => r.Code).HasMaxLength(8);
            e.Property(r => r.MapKey).HasMaxLength(24);
            e.Property(r => r.Mode).HasConversion<int>();
            e.Property(r => r.Status).HasConversion<int>();
            e.HasIndex(r => r.Token).IsUnique();
            e.HasIndex(r => r.Status);
            e.HasIndex(r => r.StartDate);
            e.HasMany(r => r.Entries).WithOne(x => x.Run).HasForeignKey(x => x.RunId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RunEntry>(e =>
        {
            e.ToTable("RunEntry");
            e.Property(x => x.Name).HasMaxLength(60);
            e.Property(x => x.CarName).HasMaxLength(60);
            e.Property(x => x.CarBody).HasMaxLength(24);
            e.HasIndex(x => x.PlayerId);
            e.HasIndex(x => new { x.RunId, x.Seat }).IsUnique();
        });

        modelBuilder.Entity<Setting>(e =>
        {
            e.ToTable("Setting");
            e.Property(s => s.Key).HasMaxLength(80);
            e.Property(s => s.Value).HasMaxLength(2000);
            e.HasIndex(s => s.Key).IsUnique();
        });
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        foreach (var entry in ChangeTracker.Entries<Entity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.CreateDate = now;
                entry.Entity.CreateUserId = ActorId;
                entry.Entity.UpdateDate = now;
                entry.Entity.UpdateUserId = ActorId;
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Entity.UpdateDate = now;
                entry.Entity.UpdateUserId = ActorId;
                if (entry.Entity is SoftDeleteEntity soft && soft.UpdateState != UpdateState.Deleted)
                {
                    soft.UpdateState = UpdateState.Updated;
                }
            }
        }

        return base.SaveChangesAsync(cancellationToken);
    }
}

/// <summary>How the plugin and the tools open the database: Npgsql, the migration history in the game's own schema.</summary>
public static class AppDatabase
{
    public static void Configure(DbContextOptionsBuilder options, string connectionString)
        => options.UseNpgsql(connectionString, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", AppDbContext.Schema));
}

/// <summary>For <c>dotnet ef migrations add</c> (no host needed): the local Postgres of DriftKing's stack (port 2780).</summary>
public sealed class AppDbContextFactory : Microsoft.EntityFrameworkCore.Design.IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>();
        AppDatabase.Configure(options, Environment.GetEnvironmentVariable("DRIFTKING_DESIGN_DB")
                                       ?? "Host=localhost;Port=2780;Database=matgame;Username=matgame;Password=matgame");
        return new AppDbContext(options.Options);
    }
}
