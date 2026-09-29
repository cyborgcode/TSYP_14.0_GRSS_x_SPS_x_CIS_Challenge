import { useState, type MouseEvent } from 'react';

import { useEngine } from '../engineContext';
import { ATTACK_BUTTONS } from '../sim/copy';
import type { AttackKind } from '../sim/signals';
import { ATTACK_ICONS, LockIcon, PlayIcon, StopIcon } from './icons';
import { MINUS } from './format';
import { Panel } from './Panel';

const ORDER: AttackKind[] = ['spoof', 'replay', 'jam', 'mimic'];

function AttackButton({ kind }: { kind: AttackKind }) {
  const engine = useEngine(15);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const copy = ATTACK_BUTTONS[kind];
  const Icon = ATTACK_ICONS[kind];
  const running = engine.attack?.kind === kind;
  const disabled = engine.busy || engine.demo.active;
  const attack = engine.attack;
  const progress =
    running && attack
      ? Math.min(
          1,
          (engine.s - attack.tTrigger) / Math.max(0.1, attack.tResponse + 0.6 - attack.tTrigger),
        )
      : 0;

  const click = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const id = performance.now();
    setRipples((r) => [...r, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    window.setTimeout(() => setRipples((r) => r.filter((p) => p.id !== id)), 650);
    engine.trigger(kind);
  };

  return (
    <button
      type="button"
      className={`attack attack--${kind} ${running ? 'attack--running' : ''}`}
      onClick={click}
      disabled={disabled && !running}
      aria-pressed={running}
    >
      <span className="attack__icon">
        <Icon size={18} />
      </span>
      <span className="attack__text">
        <span className="attack__label">{copy.label}</span>
        <span className="attack__sub">{running ? 'running…' : copy.sub}</span>
      </span>
      {running && (
        <span className="attack__progress" style={{ transform: `scaleX(${progress})` }} />
      )}
      {ripples.map((r) => (
        <span key={r.id} className="attack__ripple" style={{ left: r.x, top: r.y }} />
      ))}
    </button>
  );
}

function Toggle({
  label,
  on,
  onChange,
  disabled,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`toggle ${on ? 'toggle--on' : ''}`}
      onClick={() => onChange(!on)}
      disabled={disabled}
    >
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__label">{label}</span>
    </button>
  );
}

export function ControlDeckPanel() {
  const engine = useEngine(15);
  const power = engine.appliedPower;
  const powerText = `${power < 0 ? MINUS : '+'}${Math.abs(power).toFixed(1)} dB`;
  const statusTone =
    engine.state === 'UNDER ATTACK'
      ? 'bad'
      : engine.state === 'JAMMING' || engine.state === 'CHECKING' || engine.state === 'RECOVERING'
        ? 'warn'
        : engine.busy
          ? 'warn'
          : 'ok';
  const compromised = engine.compromisedNow;
  const remaining =
    compromised && engine.compromised
      ? Math.max(0, Math.ceil(engine.compromised.to - engine.s))
      : 0;
  const jamming = engine.attack?.kind === 'jam';

  return (
    <Panel
      badge="4"
      title="Red-team control deck"
      tag="D5 · Response"
      alert={engine.state === 'UNDER ATTACK'}
      className="panel--deck"
    >
      <div className="deck__head">
        <span className="overline">Attack scenarios</span>
        <span className="deck__heldout">held-out set: {engine.heldOut ? 'on' : 'off'}</span>
      </div>
      <div className="attacks">
        {ORDER.map((k) => (
          <AttackButton key={k} kind={k} />
        ))}
      </div>

      <div className={`power ${jamming ? 'power--live' : ''}`}>
        <label className="overline" htmlFor="attack-power">
          Attack power
        </label>
        <input
          id="attack-power"
          type="range"
          min={0}
          max={15}
          step={0.5}
          value={power}
          disabled={engine.demo.active}
          onChange={(e) => engine.setPower(Number(e.target.value))}
          style={{ ['--fill' as string]: `${(power / 15) * 100}%` }}
          aria-valuetext={powerText}
        />
        <span className="power__value mono">{powerText}</span>
      </div>
      <p className="deck__hint">
        {jamming
          ? 'Drag the slider: jammer power drives the SNR drop live.'
          : 'The slider sets jammer power and spoofer excess power.'}
      </p>

      <div className="toggles">
        <Toggle
          label="Auto-response (quarantine + re-key)"
          on={engine.autoResponse}
          disabled={engine.demo.active}
          onChange={(v) => (engine.autoResponse = v)}
        />
        <Toggle
          label="Log every event to the ledger"
          on={engine.logEvents}
          onChange={(v) => (engine.logEvents = v)}
        />
      </div>

      <div className="deck__foot">
        <div className={`status-line status-line--${statusTone}`}>
          <span className="status-line__dot" />
          <span>{engine.statusLine}</span>
        </div>
        <button
          type="button"
          className={`demo-button ${engine.demo.active ? 'demo-button--active' : ''}`}
          onClick={() => (engine.demo.active ? engine.stopDemo() : engine.playDemo())}
          disabled={engine.busy && !engine.demo.active}
        >
          {engine.demo.active ? <StopIcon size={12} /> : <PlayIcon size={12} />}
          {engine.demo.active ? 'Stop demo' : 'Play demo'}
          {engine.demo.active && (
            <span
              className="demo-button__progress"
              style={{ transform: `scaleX(${engine.demoProgress})` }}
            />
          )}
        </button>
      </div>

      {compromised && (
        <div className="compromised" role="alert">
          <LockIcon size={28} />
          <div className="compromised__title">Compromised state</div>
          <div className="compromised__detail">Deck locked while the link is quarantined</div>
          <div className="compromised__count mono">Auto-response in 00:0{remaining}</div>
        </div>
      )}
    </Panel>
  );
}
