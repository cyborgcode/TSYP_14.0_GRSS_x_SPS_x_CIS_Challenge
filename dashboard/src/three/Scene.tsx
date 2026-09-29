import { Html, OrbitControls, Stars } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import type { Focus } from '../engineContext';
import { clamp, easeInOutCubic, smooth } from '../sim/noise';
import type { Engine } from '../sim/engine';
import { ArcBeam, Beam, type BeamState } from './Beam';
import { Jammer, RelayArcs, RogueTransmitter, StationMarker, stationPosition } from './Actors';
import { Earth, SUN_DIR } from './Earth';
import { ATTACKERS, STATIONS, orbitArcPoints, orbitPoint, surfacePoint } from './geo';
import { GroundStation, type StationHandle, type StationTone } from './GroundStation';
import { Satellite, type SatelliteHandle } from './Satellite';

const COLORS = {
  accent: new THREE.Color('#4CC9F0'),
  bad: new THREE.Color('#F8485E'),
  warn: new THREE.Color('#FBBF24'),
  ok: new THREE.Color('#34D399'),
  idle: new THREE.Color('#7D8EA3'),
};

const STATION_ORIGIN = new THREE.Vector3(0, 0, 0);
const KIR = stationPosition('GS-KIR');

interface SceneProps {
  engine: Engine;
  focus: Focus;
  setFocus: (f: Focus) => void;
  reduced: boolean;
}

export default function Scene(props: SceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 38, near: 0.1, far: 900, position: [26, 11, 20] }}
      gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }}
      aria-label="3D view of the S2A satellite passing over the GS-LAB ground station"
    >
      <color attach="background" args={['#04070C']} />
      <SceneContent {...props} />
    </Canvas>
  );
}

function satVisibility(elevationDeg: number): number {
  return smooth(-2.5, 2, elevationDeg);
}

function SceneContent({ engine, focus, setFocus, reduced }: SceneProps) {
  const sat = useRef<SatelliteHandle>(null);
  const station = useRef<StationHandle>(null);
  const satLabel = useRef<THREE.Group>(null!);
  const ghostLabel = useRef<THREE.Group>(null!);
  const ghostLabelEl = useRef<HTMLDivElement>(null);

  const satPos = useMemo(() => new THREE.Vector3(), []);
  const ghostPos = useMemo(() => new THREE.Vector3(), []);
  const feedA = useMemo(() => new THREE.Vector3(), []);
  const feedB = useMemo(() => new THREE.Vector3(), []);
  const spoofPos = useMemo(() => surfacePoint(ATTACKERS.spoof.lat, ATTACKERS.spoof.lon, 0.55), []);
  const mimicPos = useMemo(() => surfacePoint(ATTACKERS.mimic.lat, ATTACKERS.mimic.lon, 0.55), []);
  const stationAim = useMemo(() => new THREE.Vector3(0, 1.1, 0), []);

  const orbitLine = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(orbitArcPoints(240));
    const line = new THREE.Line(
      g,
      new THREE.LineDashedMaterial({
        color: '#CEE6FF',
        dashSize: 0.35,
        gapSize: 0.28,
        transparent: true,
        opacity: 0.4,
      }),
    );
    line.computeLineDistances();
    return line;
  }, []);

  // Per-frame read models shared by the actors.
  const kindActive = (kind: string) => (engine.attack?.kind === kind ? engine.attackEnvelope : 0);
  const serving = () => (engine.route === 'KIR' ? KIR : feedB);

  useFrame(() => {
    const pass = engine.visualPass();
    orbitPoint(pass.sceneAngle, satPos);
    if (station.current) station.current.feedWorld(feedB);
    if (sat.current) sat.current.feedWorld(feedA);
    const lag = engine.visualPass(16);
    orbitPoint(lag.sceneAngle, ghostPos);
    satLabel.current.position.copy(satPos).add(new THREE.Vector3(0, 2.1, 0));
    satLabel.current.visible = pass.inView;
    ghostLabel.current.position.copy(ghostPos).add(new THREE.Vector3(0, 2.1, 0));
    if (ghostLabelEl.current) {
      ghostLabelEl.current.style.opacity = kindActive('replay') > 0.1 ? '1' : '0';
    }
  });

  const stationTone = (): StationTone => {
    if (engine.quarantined) return 'idle';
    const kind = engine.attack?.kind;
    if (kind && engine.attackEnvelope > 0.2)
      return kind === 'jam' ? (engine.route === 'KIR' ? 'idle' : 'warn') : 'bad';
    return 'ok';
  };

  const downlink = (): BeamState => {
    const pass = engine.visualPass();
    const jam = engine.route === 'LAB' ? kindActive('jam') : 0;
    const quarantined = engine.quarantined;
    const lost = engine.current?.timingUs === null;
    return {
      a: feedA,
      b: serving(),
      visible: pass.linkActive,
      color: quarantined ? COLORS.idle : engine.route === 'KIR' ? COLORS.ok : COLORS.accent,
      opacity: quarantined ? 0.45 : lost ? 0.35 : 1,
      dashed: quarantined || lost,
      flicker: clamp(jam * 1.4),
      speed: engine.attack && engine.attackEnvelope > 0.2 ? 2.6 : 1.6,
    };
  };

  const ghostBeam = (): BeamState => {
    const r = kindActive('replay');
    return {
      a: ghostPos,
      b: feedB,
      visible: r > 0.02,
      color: COLORS.bad,
      opacity: r * 0.9,
      dashed: true,
      speed: 2.6,
    };
  };

  return (
    <>
      <ambientLight intensity={0.5} color="#9db8d8" />
      <directionalLight
        position={SUN_DIR.clone().multiplyScalar(60)}
        intensity={2.8}
        color="#fff6e8"
      />
      <directionalLight position={[20, -14, 24]} intensity={0.55} color="#4CC9F0" />
      <hemisphereLight args={['#2b4a6b', '#04070C', 0.35]} />

      <Stars
        radius={320}
        depth={90}
        count={6000}
        factor={6}
        saturation={0}
        fade
        speed={reduced ? 0 : 0.35}
      />
      <Earth />
      <primitive object={orbitLine} />

      <RelayArcs
        getState={() => ({
          alertLink:
            engine.attack && engine.attack.kind !== 'jam' && engine.attackEnvelope > 0.2
              ? 'GS-LAB-GS-SVB'
              : null,
        })}
      />

      {STATIONS.filter((s) => s.id !== 'GS-LAB').map((s) => (
        <StationMarker
          key={s.id}
          id={s.id}
          showLabel={s.id === 'GS-KIR' || s.id === 'GS-SVB'}
          getState={() => {
            const handover = s.id === 'GS-KIR' && engine.route === 'KIR';
            return { color: handover ? COLORS.ok : COLORS.accent, speed: handover ? 2 : 1 };
          }}
        />
      ))}

      <GroundStation
        ref={station}
        onSelect={() => setFocus('station')}
        getState={() => ({
          target: engine.visualPass().linkActive && engine.route === 'LAB' ? satPos : null,
          tone: stationTone(),
          ringSpeed: stationTone() === 'bad' ? 2.6 : stationTone() === 'warn' ? 2 : 1,
        })}
      />
      <group position={[0, 2.6, 0]}>
        <Html center zIndexRange={[20, 0]}>
          <button className="scene-label scene-label--button" onClick={() => setFocus('station')}>
            GS-LAB (testbed)
            {focus === 'overview' && <span className="scene-label__hint">click to zoom</span>}
          </button>
        </Html>
      </group>

      <Satellite
        ref={sat}
        onSelect={() => setFocus('sat')}
        getState={() => {
          const pass = engine.visualPass();
          return {
            position: satPos,
            target: pass.linkActive ? serving() : null,
            visible: satVisibility(pass.elevationDeg),
            transmitting: pass.linkActive,
          };
        }}
      />
      <group ref={satLabel}>
        <Html center zIndexRange={[20, 0]}>
          <button className="scene-label scene-label--button" onClick={() => setFocus('sat')}>
            S2A
            {focus === 'overview' && <span className="scene-label__hint">click to zoom</span>}
          </button>
        </Html>
      </group>

      <Satellite
        ghost
        hoverable={false}
        getState={() => ({
          position: ghostPos,
          target: stationAim,
          visible: kindActive('replay'),
          transmitting: true,
        })}
      />
      <group ref={ghostLabel}>
        <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={ghostLabelEl} className="scene-label scene-label--bad" style={{ opacity: 0 }}>
            S2A (replayed)
          </div>
        </Html>
      </group>

      <Beam getState={downlink} radiusA={0.04} radiusB={0.3} packetCount={5} />
      <Beam getState={ghostBeam} radiusA={0.04} radiusB={0.3} packetCount={3} packetSize={0.07} />

      <RogueTransmitter
        lat={ATTACKERS.spoof.lat}
        lon={ATTACKERS.spoof.lon}
        aim={STATION_ORIGIN}
        label="UNKNOWN-TX"
        getState={() => ({ strength: kindActive('spoof'), color: COLORS.bad })}
      />
      <ArcBeam
        from={spoofPos}
        to={stationAim}
        lift={1.8}
        getState={() => ({ color: COLORS.bad, opacity: kindActive('spoof'), speed: 2.6 })}
      />

      <RogueTransmitter
        lat={ATTACKERS.mimic.lat}
        lon={ATTACKERS.mimic.lon}
        aim={STATION_ORIGIN}
        label="UNKNOWN-TX"
        getState={() => ({
          strength: kindActive('mimic'),
          color:
            engine.run?.kind === 'mimic' && engine.run.escalatedAt !== null
              ? COLORS.bad
              : COLORS.warn,
        })}
      />
      <ArcBeam
        from={mimicPos}
        to={stationAim}
        lift={1.5}
        getState={() => ({
          color:
            engine.run?.kind === 'mimic' && engine.run.escalatedAt !== null
              ? COLORS.bad
              : COLORS.warn,
          opacity: kindActive('mimic'),
          speed: 2.4,
        })}
      />

      <Jammer
        lat={ATTACKERS.jam.lat}
        lon={ATTACKERS.jam.lon}
        getState={() => ({ strength: kindActive('jam'), power: engine.appliedPower })}
      />

      <CameraRig engine={engine} focus={focus} reduced={reduced} satPos={satPos} />

      <EffectComposer multisampling={4}>
        <Bloom
          mipmapBlur
          intensity={1.05}
          luminanceThreshold={0.62}
          luminanceSmoothing={0.25}
          radius={0.72}
        />
        <Vignette offset={0.28} darkness={0.55} />
      </EffectComposer>
    </>
  );
}

type Mode = Focus | 'attack';

const POSES: Record<Exclude<Mode, 'sat'>, { target: THREE.Vector3; offset: THREE.Vector3 }> = {
  overview: { target: new THREE.Vector3(0.5, 4.4, 0), offset: new THREE.Vector3(21, 6.4, 16) },
  attack: { target: new THREE.Vector3(-0.6, 1.4, 0.4), offset: new THREE.Vector3(9.5, 4.6, 10.5) },
  station: { target: new THREE.Vector3(0, 1.1, 0), offset: new THREE.Vector3(5.2, 2.4, 5.8) },
};
const SAT_OFFSET = new THREE.Vector3(8.8, 2.1, 10.2);
const DISTANCE_LIMITS: Record<Mode, [number, number]> = {
  overview: [8, 70],
  attack: [5, 40],
  station: [2.6, 16],
  sat: [2.4, 18],
};

function CameraRig({
  engine,
  focus,
  reduced,
  satPos,
}: {
  engine: Engine;
  focus: Focus;
  reduced: boolean;
  satPos: THREE.Vector3;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const shift = useRef(0);
  const [mode, setMode] = useState<Mode>('overview');
  const modeRef = useRef<Mode>('overview');
  const anim = useRef<{
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    t0: number;
    dur: number;
  } | null>(null);
  const followed = useRef(new THREE.Vector3());
  const focusPoint = useRef(new THREE.Vector3());

  const pointFor = (m: Mode, out: THREE.Vector3) =>
    m === 'sat' ? out.copy(satPos) : out.copy(POSES[m].target);
  // Portrait screens need the camera further back to keep both bodies in frame.
  const aspectScale = Math.max(1, Math.pow(1.5 / (size.width / Math.max(size.height, 1)), 0.85));
  const offsetFor = (m: Mode) =>
    m === 'sat'
      ? SAT_OFFSET
      : m === 'station'
        ? POSES[m].offset
        : POSES[m].offset.clone().multiplyScalar(aspectScale);

  const go = (m: Mode) => {
    if (!controls.current) return;
    anim.current = {
      fromPos: camera.position.clone(),
      fromTarget: controls.current.target.clone(),
      t0: performance.now(),
      dur: reduced ? 0 : m === 'attack' || modeRef.current === 'attack' ? 1.0 : 1.35,
    };
    modeRef.current = m;
    setMode(m);
  };

  useEffect(() => {
    go(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;

    // Shift the projection centre left while the detail overlay covers the right side.
    const wantShift =
      focus !== 'overview' && size.width > 900 ? Math.min(size.width * 0.23, 260) : 0;
    shift.current += (wantShift - shift.current) * (reduced ? 1 : 1 - Math.exp(-dt * 5));
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(shift.current) > 0.5)
      cam.setViewOffset(size.width, size.height, shift.current, 0, size.width, size.height);
    else if (cam.view?.enabled) cam.clearViewOffset();

    // In the overview, attacks pull the camera to the station region and release it afterwards.
    if (focus === 'overview') {
      const hot = engine.state === 'UNDER ATTACK' || engine.state === 'JAMMING';
      if (hot && modeRef.current === 'overview' && !anim.current) go('attack');
      if (!hot && !engine.attack && modeRef.current === 'attack' && !anim.current) go('overview');
    }

    const m = modeRef.current;
    const fp = pointFor(m, focusPoint.current);
    const a = anim.current;
    if (a) {
      const p = a.dur === 0 ? 1 : easeInOutCubic((performance.now() - a.t0) / (a.dur * 1000));
      c.target.lerpVectors(a.fromTarget, fp, p);
      camera.position.lerpVectors(a.fromPos, fp.clone().add(offsetFor(m)), p);
      c.enabled = false;
      if (p >= 1) {
        anim.current = null;
        c.enabled = true;
        followed.current.copy(fp);
      }
    } else if (m === 'sat') {
      // Follow the moving satellite while keeping the user's orbit around it.
      const delta = fp.clone().sub(followed.current);
      camera.position.add(delta);
      c.target.add(delta);
      followed.current.copy(fp);
    }
  });

  const [minD, maxD] = DISTANCE_LIMITS[mode];
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      minDistance={minD}
      maxDistance={maxD}
      maxPolarAngle={Math.PI * 0.49}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
    />
  );
}
