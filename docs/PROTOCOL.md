# DriftKing – Protokoll

Wie der Browser-Teil (`/driftking/`, `wwwroot`) mit dem Server spricht – online mit dem Plugin in MatGame, offline in der App mit `DriftKing.Local`.
Beide Seiten antworten mit **denselben Pfaden, Methoden und JSON-Formen** (camelCase). Anmeldung, Gäste und Geräte-Login sind Sache von MatGame
(`/api/matgame/...`, siehe `../MatGame/docs/PROTOCOL.md`); DriftKing liest nur das Konto der Anfrage.

Protokollnummer: `DriftKingModule.Protocol = 1` (steigt nur, wenn alte Apps nicht mehr mitkommen).

## Wer entscheidet was

| Was | Wer |
|---|---|
| Fahrphysik, Driftwinkel, Punkte, Ketten, Runden, Zeiten des **eigenen** Autos | der Browser, der es fährt |
| Physik und Punkte der **Bots** | der Browser des Gastgebers (`hostSeat`; solo: der Spieler) |
| Wer welchen Platz senden darf, Start, Countdown, Ende, Reihenfolge, Geld, XP, Medaillen | der Raum (`DriftRoom`) und `RunRules` |
| Plausibilität | Server: Punkte ≤ Sekunden × `MaxPointsPerSecond` (Einstellung, Standard 8 000), Rennzeit ≥ Länge × Runden ÷ 330 km/h; darüber wird gekappt und markiert (`flagged`) |

## API (`/driftking/api`)

Fehler: `400 { error, field }`, `401` nicht angemeldet, `403` verboten, `426 { error, update: true }` App zu alt (MatGame SDK).
Änderungen aus dem Browser tragen das Antiforgery-Token (`RequestVerificationToken`), Apps ein Bearer-Token.

| Methode | Pfad | Antwort |
|---|---|---|
| GET | `/session` | `{ signedIn, player: PlayerView?, version, offline }` |
| GET | `/home` | `{ player, stats: StatsView, car: CarView, announcement, history: HistoryView[], settings: { maxPlayers, guestsCreateRooms } }` |
| GET | `/catalog` | `{ cars: DealerCarView[], maps: MapView[] }` |
| GET | `/garage` | `GarageView { cars: [{ car: CarView, description, parts: [{ key, name, level, nextPrice? }] }], selectedId, money }` |
| POST | `/garage/buy` `{ carId }` | `GarageView` (das gekaufte Auto ist gewählt) |
| POST | `/garage/{id}/upgrade` `{ part: engine\|turbo\|suspension\|tires\|steering }` | `GarageView` |
| PUT | `/garage/{id}/look` `{ paint?, rims?, neon? ('none' = aus), decal?, number? }` | `GarageView` |
| PUT | `/garage/select` `{ id }` | `GarageView` |
| GET | `/competitions` | `CompetitionView[]` (mit `mine { bestScore, bestTimeMs, medal, attempts }`) |
| GET | `/competitions/{id}/leaderboard` | `LeaderView[]` |
| GET | `/profile` | `{ player, stats, gold, silver, bronze, cars }` |
| GET | `/bests` | `[{ map, mode, score, timeMs, bestLapMs }]` |
| GET | `/leaderboard?by=xp\|score\|wins\|total` | `LeaderView[]` (nur Konten) |
| GET | `/history` | `HistoryView[]` |
| GET | `/info` | `{ game, version, rooms, running }` |

`CarView` = `{ id, carId, key, name, body, drive: 'RWD'|'AWD', paint, rims, neon, decal, number, levels { engine, turbo, suspension, tires, steering },
spec { massKg, powerKw, topSpeedKmh, gripFront, gripRear, steerLockDeg, handbrakeGrip, stability, drive, gears } }` – `spec` kommt immer vom Server
(`Tuning.SpecOf`); `js/game/catalog.js specOf` spiegelt die Formel nur für Vorschauen.

## Hub (`/driftking/hub`, SignalR)

Methoden (Client → Server):

| Methode | Antwort | |
|---|---|---|
| `ListRooms()` | `RoomListView[]` | offene, öffentliche Räume in der Lobby |
| `CreateRoom(RoomOptions)` | `RoomView` | Raum aufmachen, der Aufrufer ist Gastgeber |
| `Solo(RoomOptions)` | `RoomView` (Status `countdown`) | Lauf allein gegen Bots – oder ein Wettbewerb (`competitionId`) –, startet sofort |
| `JoinRoom(code)` | `RoomView` | in der Lobby beitreten; nach einem Verbindungsabbruch zurück auf den eigenen Platz |
| `LeaveRoom()` | – | |
| `Ready(bool)` / `Configure(RoomOptions)` / `ChangeCar()` | `RoomView` | Lobby; `Configure` nur der Gastgeber |
| `StartRoom()` | `RoomView` | Gastgeber; alle anderen müssen bereit sein; Bots füllen die freien Plätze |
| `State(seat, number[])` | – | ~12×/s: eigener Platz, beim Gastgeber auch die Bots |
| `Finish(seat, FinishInput)` | – | `{ score, timeMs?, bestLapMs?, laps, bestCombo, maxAngle, driftDistanceM, collisions }` (ganze Zahlen außer Winkel/Strecke) |

`RoomOptions` = `{ map?, mode?: freeride|score|race, laps?, durationS?, bots?, botSkill? (1–10), isPrivate?, competitionId? }`.

Nachrichten (Server → Client): `Room(RoomView)` bei jeder Änderung, `State(seat, number[])` der anderen, `Left(seat)`, `Finished(seat)`,
`Results(ResultsView)` am Ende, `Closed(reason)`.

`RoomView.startAt` und `serverNow` sind Unix-Millisekunden des Servers: der Client rechnet `startAt - (serverNow - Date.now())` in seine Uhr um.
Der Countdown dauert 4 s. Ende: alle Autos fertig, oder die Zeit des Modus plus 15 s (Drift-Wertung), oder 30 s nach dem letzten menschlichen Fahrer.

### Gepackter Zustand (`State`)

`[tMs, x, y, z, yaw, vx, vz, steer, throttle, brake, handbrake, driftAngleDeg, score, combo, lap, progress, flags]` – der Server liest nur
`score` (12), `lap` (14) und `progress` (15) als Rückfall für Autos ohne `Finish`; höchstens 24 endliche Zahlen. `flags`: Bit 0 fertig, Bit 1 driftet, Bit 2 Bremslicht.

## Offline (App)

`DriftKing.Local` beantwortet dieselbe API und die Hub-Methoden `ListRooms` (leer), `Solo`, `LeaveRoom`, `State`, `Finish` mit denselben Formen und sendet
`Room`, `Finished`, `Results` über die Brücke der App. `CreateRoom`, `JoinRoom`, `Ready`, `Configure`, `ChangeCar`, `StartRoom` gibt es nur online.
Der Fortschritt liegt in `%APPDATA%\MatGame\driftking\profile.json` (nur auf dem Gerät). Neue Endpunkte brauchen ihre Offline-Antwort und einen Test in `LocalGameTests`.
