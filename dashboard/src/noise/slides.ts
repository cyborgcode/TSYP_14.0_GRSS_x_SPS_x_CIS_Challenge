// The pitch deck as still slides (1920 × 1080 renders of the team's presentation), shown on
// /slides: arrows or the thumbnails to move, F for full screen.

const ALT = [
  'No Silent Failure: securing the satellite ground link with cryptography and physics',
  'The failure that doesn’t alarm: station online, frames valid, data wrong',
  'One link, ten attacks against integrity, freshness, availability and provenance; the attacker needs no key',
  'Intact seal, compromised path: relay, delay and phase slip pass every cryptographic check',
  'Two independent locks, content and path: each of the ten attacks is caught by at least one at 100 %',
  'Every frame passes three tiers, data, physical and statistical, then five outcomes and a SHA-256 ledger',
  'Subtract the orbit, see the attack: ±201 kHz of Doppler over a real pass, and a forged carrier flagged from tens of hertz',
  'A single tier can be blind: delay detection goes from 4.7 % with the Isolation Forest alone to 100 % with the physical tier',
  'Every attack flagged: 90,000 of 90,000 attack packets, 1.59 % of genuine packets held, 0.3 ms per packet',
  'Where does detection break: an adaptive attacker that knows the gates, and jamming below the gate',
  'The uplink is a target too: command tampering, injection and replay on the S-band telecommand channel',
  'Every command checked on board: tag, then sequence count; 0 of 900 hostile telecommands executed',
  'Never a silent gap: every outcome has a visible response, and the ledger catches an edited block',
  'See it live: TerraSAR-X’s next real pass over Zaghouan, attacked and defended in the browser',
];

export const SLIDES = ALT.map((alt, i) => ({
  src: `/media/slides/slide-${String(i + 1).padStart(2, '0')}.jpg`,
  alt,
}));
