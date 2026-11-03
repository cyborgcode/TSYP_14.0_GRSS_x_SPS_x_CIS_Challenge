import { useRef, useState } from 'react';

import { EXPLAINER, VIDEO, fmtClock } from '../noise/explainerData';
import { SIGNAL } from '../sim/linkFacts';
import { MINUS } from '../ui/format';
import { DocPage } from './DocPage';

const dbm = (v: number) => `${MINUS}${Math.abs(v).toFixed(1)}`;

export function VideoPage() {
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
    <DocPage
      path="/noise"
      eyebrow={`Explainer video · ${fmtClock(EXPLAINER.duration)}`}
      lead={
        <>
          How an attacker can imitate the natural noise on the TerraSAR-X downlink, and the idea
          that keeps the ground link safe anyway. The carrier sits at {SIGNAL.carrierMHz} MHz and
          reaches Zaghouan at {dbm(SIGNAL.rxDbm.mask)} to {dbm(SIGNAL.rxDbm.zenith)} dBm, an
          amplitude of {SIGNAL.amplitudeUv.mask.toFixed(1)} to{' '}
          {SIGNAL.amplitudeUv.zenith.toFixed(1)} µV.
        </>
      }
    >
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
      <section className="npage__summary" aria-label="Summary">
        <div className="npage__card">
          <h2>The phenomenon</h2>
          <p>
            Natural noise is Gaussian and white, fades slowly with the pass, and leaves the carrier
            within tens of hertz of the orbit model. An attacker who copies that signature can hide:
            noise-shaped jamming creeps up like a rain fade, a spoofer matches the Doppler and fakes
            the fading, and a tamperer flips bits that look like ordinary bit errors.
          </p>
        </div>
        <div className="npage__card">
          <h2>Our idea</h2>
          <p>
            Make every imitation either visible, or bounded. The physical layer, a χ² engine on
            range, Doppler, power and phase, caps how much noise can hide (overhead 5.3 dB below the
            thermal noise, at most 1.1 dB of SNR; 1.7 dB at the 2° mask, where the gate widens). The
            statistical layer, an Isolation Forest, reads what the χ² cannot see: the EVM, lost
            frames, arrival jitter, failed tags and how fast carrier and power change. And noise
            cannot forge the data layer’s HMAC-SHA256 tag on every frame: one failure is treated as
            possibly benign and resent, a burst of 3 within 10 frames quarantines the link.
          </p>
        </div>
      </section>
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
      <p className="npage__credit">Voice-over: Piper speech synthesis, Lessac voice.</p>
    </DocPage>
  );
}
