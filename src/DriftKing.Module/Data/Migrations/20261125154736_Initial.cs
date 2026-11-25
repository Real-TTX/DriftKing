using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace DriftKing.Data.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "driftking");

            migrationBuilder.CreateTable(
                name: "Car",
                schema: "driftking",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Key = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Description = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    Body = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Drive = table.Column<int>(type: "integer", nullable: false),
                    Power = table.Column<int>(type: "integer", nullable: false),
                    Grip = table.Column<int>(type: "integer", nullable: false),
                    Weight = table.Column<int>(type: "integer", nullable: false),
                    Steering = table.Column<int>(type: "integer", nullable: false),
                    Price = table.Column<int>(type: "integer", nullable: false),
                    UnlockLevel = table.Column<int>(type: "integer", nullable: false),
                    DefaultPaint = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateState = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Car", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Map",
                schema: "driftking",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Key = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Description = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    TimeOfDay = table.Column<int>(type: "integer", nullable: false),
                    DefaultLaps = table.Column<int>(type: "integer", nullable: false),
                    UnlockLevel = table.Column<int>(type: "integer", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdateUserId = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Map", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Player",
                schema: "driftking",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    IsGuest = table.Column<bool>(type: "boolean", nullable: false),
                    Money = table.Column<long>(type: "bigint", nullable: false),
                    Xp = table.Column<long>(type: "bigint", nullable: false),
                    RunsPlayed = table.Column<int>(type: "integer", nullable: false),
                    Wins = table.Column<int>(type: "integer", nullable: false),
                    TotalScore = table.Column<long>(type: "bigint", nullable: false),
                    BestScore = table.Column<long>(type: "bigint", nullable: false),
                    BestCombo = table.Column<long>(type: "bigint", nullable: false),
                    MaxAngle = table.Column<double>(type: "double precision", nullable: false),
                    DriftDistanceM = table.Column<double>(type: "double precision", nullable: false),
                    SelectedGarageCarId = table.Column<long>(type: "bigint", nullable: true),
                    LastSeenDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateState = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Player", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Run",
                schema: "driftking",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Token = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    MapKey = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Mode = table.Column<int>(type: "integer", nullable: false),
                    Laps = table.Column<int>(type: "integer", nullable: false),
                    DurationS = table.Column<int>(type: "integer", nullable: false),
                    CompetitionId = table.Column<long>(type: "bigint", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    IsOnline = table.Column<bool>(type: "boolean", nullable: false),
                    Humans = table.Column<int>(type: "integer", nullable: false),
                    Bots = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdateUserId = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Run", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Setting",
                schema: "driftking",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Value = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CreateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdateUserId = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Setting", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Competition",
                schema: "driftking",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Description = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    MapId = table.Column<long>(type: "bigint", nullable: false),
                    Mode = table.Column<int>(type: "integer", nullable: false),
                    Laps = table.Column<int>(type: "integer", nullable: false),
                    DurationS = table.Column<int>(type: "integer", nullable: false),
                    Bots = table.Column<int>(type: "integer", nullable: false),
                    BotSkill = table.Column<int>(type: "integer", nullable: false),
                    Bronze = table.Column<long>(type: "bigint", nullable: false),
                    Silver = table.Column<long>(type: "bigint", nullable: false),
                    Gold = table.Column<long>(type: "bigint", nullable: false),
                    RewardBronze = table.Column<int>(type: "integer", nullable: false),
                    RewardSilver = table.Column<int>(type: "integer", nullable: false),
                    RewardGold = table.Column<int>(type: "integer", nullable: false),
                    UnlockLevel = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EndDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateState = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Competition", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Competition_Map_MapId",
                        column: x => x.MapId,
                        principalSchema: "driftking",
                        principalTable: "Map",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GarageCar",
                schema: "driftking",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<long>(type: "bigint", nullable: false),
                    CarId = table.Column<long>(type: "bigint", nullable: false),
                    Paint = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    Rims = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    Neon = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: true),
                    Decal = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    Engine = table.Column<int>(type: "integer", nullable: false),
                    Turbo = table.Column<int>(type: "integer", nullable: false),
                    Suspension = table.Column<int>(type: "integer", nullable: false),
                    Tires = table.Column<int>(type: "integer", nullable: false),
                    SteeringKit = table.Column<int>(type: "integer", nullable: false),
                    CreateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateState = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GarageCar", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GarageCar_Car_CarId",
                        column: x => x.CarId,
                        principalSchema: "driftking",
                        principalTable: "Car",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GarageCar_Player_PlayerId",
                        column: x => x.PlayerId,
                        principalSchema: "driftking",
                        principalTable: "Player",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RunEntry",
                schema: "driftking",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RunId = table.Column<long>(type: "bigint", nullable: false),
                    Seat = table.Column<int>(type: "integer", nullable: false),
                    PlayerId = table.Column<long>(type: "bigint", nullable: true),
                    IsBot = table.Column<bool>(type: "boolean", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    CarName = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    CarBody = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Score = table.Column<long>(type: "bigint", nullable: false),
                    TimeMs = table.Column<int>(type: "integer", nullable: true),
                    BestLapMs = table.Column<int>(type: "integer", nullable: true),
                    BestCombo = table.Column<long>(type: "bigint", nullable: false),
                    MaxAngle = table.Column<double>(type: "double precision", nullable: false),
                    DriftDistanceM = table.Column<double>(type: "double precision", nullable: false),
                    Finished = table.Column<bool>(type: "boolean", nullable: false),
                    Place = table.Column<int>(type: "integer", nullable: false),
                    Money = table.Column<long>(type: "bigint", nullable: false),
                    Xp = table.Column<long>(type: "bigint", nullable: false),
                    Flagged = table.Column<bool>(type: "boolean", nullable: false),
                    CreateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdateUserId = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RunEntry", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RunEntry_Run_RunId",
                        column: x => x.RunId,
                        principalSchema: "driftking",
                        principalTable: "Run",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CompetitionResult",
                schema: "driftking",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<long>(type: "bigint", nullable: false),
                    PlayerId = table.Column<long>(type: "bigint", nullable: false),
                    BestScore = table.Column<long>(type: "bigint", nullable: false),
                    BestTimeMs = table.Column<int>(type: "integer", nullable: true),
                    Medal = table.Column<int>(type: "integer", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    CreateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreateUserId = table.Column<long>(type: "bigint", nullable: true),
                    UpdateDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdateUserId = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompetitionResult", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CompetitionResult_Competition_CompetitionId",
                        column: x => x.CompetitionId,
                        principalSchema: "driftking",
                        principalTable: "Competition",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CompetitionResult_Player_PlayerId",
                        column: x => x.PlayerId,
                        principalSchema: "driftking",
                        principalTable: "Player",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Car_Key",
                schema: "driftking",
                table: "Car",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Competition_MapId",
                schema: "driftking",
                table: "Competition",
                column: "MapId");

            migrationBuilder.CreateIndex(
                name: "IX_CompetitionResult_CompetitionId_PlayerId",
                schema: "driftking",
                table: "CompetitionResult",
                columns: new[] { "CompetitionId", "PlayerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CompetitionResult_PlayerId",
                schema: "driftking",
                table: "CompetitionResult",
                column: "PlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_GarageCar_CarId",
                schema: "driftking",
                table: "GarageCar",
                column: "CarId");

            migrationBuilder.CreateIndex(
                name: "IX_GarageCar_PlayerId_CarId",
                schema: "driftking",
                table: "GarageCar",
                columns: new[] { "PlayerId", "CarId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Map_Key",
                schema: "driftking",
                table: "Map",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Player_BestScore",
                schema: "driftking",
                table: "Player",
                column: "BestScore");

            migrationBuilder.CreateIndex(
                name: "IX_Player_Xp",
                schema: "driftking",
                table: "Player",
                column: "Xp");

            migrationBuilder.CreateIndex(
                name: "IX_Run_StartDate",
                schema: "driftking",
                table: "Run",
                column: "StartDate");

            migrationBuilder.CreateIndex(
                name: "IX_Run_Status",
                schema: "driftking",
                table: "Run",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_Run_Token",
                schema: "driftking",
                table: "Run",
                column: "Token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RunEntry_PlayerId",
                schema: "driftking",
                table: "RunEntry",
                column: "PlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_RunEntry_RunId_Seat",
                schema: "driftking",
                table: "RunEntry",
                columns: new[] { "RunId", "Seat" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Setting_Key",
                schema: "driftking",
                table: "Setting",
                column: "Key",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CompetitionResult",
                schema: "driftking");

            migrationBuilder.DropTable(
                name: "GarageCar",
                schema: "driftking");

            migrationBuilder.DropTable(
                name: "RunEntry",
                schema: "driftking");

            migrationBuilder.DropTable(
                name: "Setting",
                schema: "driftking");

            migrationBuilder.DropTable(
                name: "Competition",
                schema: "driftking");

            migrationBuilder.DropTable(
                name: "Car",
                schema: "driftking");

            migrationBuilder.DropTable(
                name: "Player",
                schema: "driftking");

            migrationBuilder.DropTable(
                name: "Run",
                schema: "driftking");

            migrationBuilder.DropTable(
                name: "Map",
                schema: "driftking");
        }
    }
}
