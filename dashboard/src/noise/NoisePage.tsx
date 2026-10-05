import { useRef, useState } from 'react';

import { SIGNAL } from '../sim/linkFacts';
import { NoiseMimicry } from '../ui/explain/NoiseMimicry';
import { SignalFacts } from '../ui/explain/SignalFacts';
import { MINUS } from '../ui/format';
import { DishIcon, PlayIcon } from '../ui/icons';
import { EXPLAINER, VIDEO, fmtClock } from './explainerData';

const dbm = (v: number) => `${MINUS}${Math.abs(v).toFixed(0)}`;

export function NoisePage() {
  const video = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const scenes = EXPLAINER.scenes;
  let current = 0;
  scenes.forEach((s, i) => {
    if (now >= s.start) current = i;
  });

  const seek = (t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = t + 0.05;
    void v.play().catch(() => undefined);
  };

  return (
    <>
      <header className="npage-bar">
        <a className="npage-bar__brand" href="/">
          <DishIcon size={22} />
          <span>Secure Ground-Link Testbed</span>
        </a>
        <nav className="header__nav" aria-label="Pages">
          <a href="/">Live testbed</a>
          <a href="/#noise">Noise mimicry</a>
          <a href={VIDEO.page} aria-current="page">
            Explainer video
          </a>
        </nav>
      </header>

      <main className="npage">
        <section className="npage__hero" aria-labelledby="video-title">
          <div className="explain__head">
            <p className="explain__eyebrow">Explainer video · {fmtClock(EXPLAINER.duration)}</p>
            <h1 id="video-title" className="explain__title">
              Hiding in the noise
            </h1>
            <p className="explain__lead">
              How an attacker can imitate the natural noise on our LEO downlink, and the idea that
              keeps the ground link safe anyway. The carrier sits at {SIGNAL.carrierMHz} MHz and
              reaches Zaghouan at {dbm(SIGNAL.rxDbm.mask)} to {dbm(SIGNAL.rxDbm.zenith)} dBm, an
              amplitude of {SIGNAL.amplitudeUv.mask.toFixed(1)} to{' '}
              {SIGNAL.amplitudeUv.zenith.toFixed(1)} µV.
            </p>
          </div>
          <div className="npage__watch">
            <video
              ref={video}
              className="npage__video"
              controls
              preload="metadata"
              playsInline
              poster={VIDEO.poster}
              onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
            >
              <source src={VIDEO.src} type="video/mp4" />
              <source src={VIDEO.webm} type="video/webm" />
              <track kind="captions" src={VIDEO.captions} srcLang="en" label="English" />
              Your browser cannot play this video. <a href={VIDEO.src}>Download it</a>.
            </video>
            <nav aria-label="Chapters">
              <ol className="chapters">
                <li className="chapters__title">Chapters</li>
                {scenes.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="chapters__btn"
                      aria-current={i === current}
                      onClick={() => seek(s.start)}
                    >
                      <span className="chapters__time">{fmtClock(s.start)}</span>
                      <span>{s.chapter}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </section>

        <section className="npage__summary" aria-label="Summary">
          <div className="npage__card">
            <h2>The phenomenon</h2>
            <p>
              Natural noise is Gaussian and white, fades slowly with the pass, and leaves the
              carrier within tens of hertz of the orbit model. An attacker who copies that signature
              can hide: noise-shaped jamming creeps up like a rain fade, a spoofer matches the
              Doppler and fakes the fading, and a tamperer flips bits that look like ordinary bit
              errors.
            </p>
          </div>
          <div className="npage__card">
            <h2>Our idea</h2>
            <p>
              Make every imitation either harmless or visible. Physics caps how much noise can hide
              (+1.8 dB over the thermal noise, at most 4 dB of SNR). An Isolation Forest scores the
              rhythm of each reading, not just its level. And noise cannot forge the HMAC-SHA256 tag
              on every frame: one failure is resent, a burst quarantines the link.
            </p>
          </div>
        </section>

        <SignalFacts />
        <NoiseMimicry />

        <details className="transcript">
          <summary>Transcript</summary>
          {scenes.map((s) => (
            <div key={s.id}>
              <h3>
                {fmtClock(s.start)} · {s.chapter}
              </h3>
              {s.cues.map((c) => (
                <p key={c.start}>{c.text}</p>
              ))}
            </div>
          ))}
        </details>

        <div className="explain__actions">
          <a className="explain__cta" href="/">
            <PlayIcon size={14} />
            Open the live testbed
          </a>
          <a className="explain__ghost" href="/#noise">
            Back to the noise-mimicry section
          </a>
        </div>
      </main>

      <footer className="npage__foot">
        Emulation only: nothing here transmits or receives RF. Figures come from the testbed’s link
        model and synthetic traffic, to be re-measured on the official reference datasets.
        Voice-over: Piper speech synthesis, Lessac voice.
      </footer>
    </>
  );
}
