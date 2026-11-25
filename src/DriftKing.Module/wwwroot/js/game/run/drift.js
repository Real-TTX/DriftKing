// DriftKing · run/drift.js – the drift score of one car. A drift counts from 12° and 30 km/h; its points flow into a chain:
//   points/s = km/h × (0.5 + angle/45) × multiplier (×1..×5: +1 for every 3 s of unbroken chain and for every change of direction)
//              × 1.25 close to a wall ("Wandkuss", < 1.5 m) × 1.5 in tandem (another drifting car closer than 8 m), at most 7 500/s.
// The chain is banked 1.5 s after the last drift; a hit during the chain loses it ("CRASH").

export const DRIFT_MIN_ANGLE = 12;
export const DRIFT_MIN_SPEED = 30;
export const MAX_RATE = 7500;
const BANK_AFTER = 1.5;
const CRASH_IMPACT = 3.2;

/** The score of one car: total (banked), the running chain, its multiplier and the records of the run. */
export class DriftScore {
    constructor() {
        this.total = 0;
        this.chain = 0;
        this.multiplier = 1;
        this.chainTime = 0;
        this.transitions = 0;
        this.side = 0;
        this.since = 0;
        this.drifting = false;
        this.wall = false;
        this.tandem = false;
        this.bestCombo = 0;
        this.maxAngle = 0;
        this.chainMaxAngle = 0;
        this.distance = 0;
        this.crashes = 0;
    }

    /** The score shown and sent: banked points plus the running chain. */
    get live() {
        return this.total + this.chain;
    }

    /**
     * One frame. angle: signed drift angle (°), speedKmh, wallDistance (m), tandem: another drifting car is close, impact: hit strength (m/s).
     * Returns the events of this frame for the HUD: { kind: 'start'|'bank'|'crash'|'wall'|'tandem'|'multiplier', points?, value? }.
     */
    update(dt, { angle, speedKmh, wallDistance = 99, tandem = false, impact = 0 }) {
        const events = [];
        const abs = Math.abs(angle);
        const drifting = abs >= DRIFT_MIN_ANGLE && speedKmh >= DRIFT_MIN_SPEED;
        if (impact >= CRASH_IMPACT && this.chain > 0) {
            events.push({ kind: 'crash', points: Math.round(this.chain) });
            this.crashes++;
            this.resetChain();
        }
        if (drifting) {
            if (!this.drifting && this.chain === 0) events.push({ kind: 'start' });
            const side = Math.sign(angle);
            if (this.side !== 0 && side !== this.side && this.chain > 0) this.transitions++;
            this.side = side;
            this.since = 0;
            this.chainTime += dt;
            const multiplier = Math.min(5, 1 + Math.floor(this.chainTime / 3) + this.transitions);
            if (multiplier > this.multiplier) events.push({ kind: 'multiplier', value: multiplier });
            this.multiplier = multiplier;
            const wall = wallDistance < 1.5;
            if (wall && !this.wall) events.push({ kind: 'wall' });
            this.wall = wall;
            if (tandem && !this.tandem) events.push({ kind: 'tandem' });
            this.tandem = tandem;
            const rate = Math.min(MAX_RATE, speedKmh * (0.5 + abs / 45) * this.multiplier * (wall ? 1.25 : 1) * (tandem ? 1.5 : 1));
            this.chain += rate * dt;
            this.distance += (speedKmh / 3.6) * dt;
            this.maxAngle = Math.max(this.maxAngle, abs);
            this.chainMaxAngle = Math.max(this.chainMaxAngle, abs);
        } else {
            this.wall = false;
            this.tandem = false;
            if (this.chain > 0) {
                this.since += dt;
                if (this.since >= BANK_AFTER) events.push(this.bank());
            }
        }
        this.drifting = drifting;
        return events;
    }

    /** Banks the running chain (at the end of a run too). */
    bank() {
        const points = Math.round(this.chain);
        this.total += points;
        this.bestCombo = Math.max(this.bestCombo, points);
        this.resetChain();
        return { kind: 'bank', points };
    }

    resetChain() {
        this.chain = 0;
        this.multiplier = 1;
        this.chainTime = 0;
        this.transitions = 0;
        this.side = 0;
        this.since = 0;
        this.chainMaxAngle = 0;
    }
}
