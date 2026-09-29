import { useCursor } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { EARTH_CENTER } from './geo';
import { SUN_DIR } from './Earth';
import { foilBumpTexture, solarCellTexture } from './textures';

/** Parabolic reflector with its boresight along +Z. */
export function parabolaGeometry(
  radius: number,
  depth: number,
  segments = 48,
): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const r = (i / steps) * radius;
    pts.push(new THREE.Vector2(r, (depth * r * r) / (radius * radius)));
  }
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateX(Math.PI / 2);
  return g;
}

export interface SatelliteHandle {
  group: THREE.Group;
  /** World position of the downlink antenna feed. */
  feedWorld(out: THREE.Vector3): THREE.Vector3;
}

interface Props {
  /** Where the satellite is and what its dish should point at, read every frame. */
  getState: () => {
    position: THREE.Vector3;
    target: THREE.Vector3 | null;
    visible: number;
    transmitting: boolean;
  };
  ghost?: boolean;
  onSelect?: () => void;
  hoverable?: boolean;
}

export const SAT_SCALE = 0.86;

const tmpZ = new THREE.Vector3();
const tmpY = new THREE.Vector3();
const tmpX = new THREE.Vector3();
const basis = new THREE.Matrix4();
const localTarget = new THREE.Vector3();

export const Satellite = forwardRef<SatelliteHandle, Props>(function Satellite(
  { getState, ghost = false, onSelect, hoverable = true },
  ref,
) {
  const group = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const wings = useRef<THREE.Group[]>([]);
  const antenna = useRef<THREE.Group>(null!);
  const feed = useRef<THREE.Mesh>(null!);
  const navL = useRef<THREE.MeshBasicMaterial>(null!);
  const navR = useRef<THREE.MeshBasicMaterial>(null!);
  const prev = useRef(new THREE.Vector3());
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && hoverable);

  const mat = useMemo(() => {
    const solar = solarCellTexture();
    const foil = foilBumpTexture();
    const ghostMat = new THREE.MeshBasicMaterial({
      color: '#F8485E',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    if (ghost) {
      return {
        gold: ghostMat,
        silver: ghostMat,
        dark: ghostMat,
        panel: ghostMat,
        panelBack: ghostMat,
        white: ghostMat,
      };
    }
    return {
      gold: new THREE.MeshStandardMaterial({
        color: '#c99a3a',
        metalness: 1,
        roughness: 0.34,
        bumpMap: foil,
        bumpScale: 0.6,
        emissive: '#2a1a05',
      }),
      silver: new THREE.MeshStandardMaterial({ color: '#c8d0da', metalness: 0.85, roughness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: '#15191f', metalness: 0.4, roughness: 0.6 }),
      panel: new THREE.MeshStandardMaterial({
        map: solar,
        metalness: 0.25,
        roughness: 0.55,
        emissive: '#06213f',
        emissiveIntensity: 0.25,
      }),
      panelBack: new THREE.MeshStandardMaterial({
        color: '#dfe5ec',
        metalness: 0.3,
        roughness: 0.55,
      }),
      white: new THREE.MeshStandardMaterial({ color: '#eef2f6', metalness: 0.2, roughness: 0.5 }),
    };
  }, [ghost]);

  const dish = useMemo(() => parabolaGeometry(0.34, 0.12), []);

  useImperativeHandle(ref, () => ({
    group: group.current,
    feedWorld: (out) => feed.current.getWorldPosition(out),
  }));

  useFrame(({ clock }, dt) => {
    const st = getState();
    const g = group.current;
    g.visible = st.visible > 0.01;
    if (!g.visible) {
      prev.current.copy(st.position);
      return;
    }
    g.position.copy(st.position);
    g.scale.setScalar(SAT_SCALE * (0.25 + 0.75 * st.visible));

    // Nadir-pointing attitude: -Y to Earth's centre, +Z along the velocity.
    tmpY.copy(st.position).sub(EARTH_CENTER).normalize();
    tmpZ.copy(st.position).sub(prev.current);
    if (tmpZ.lengthSq() < 1e-8 || dt === 0) tmpZ.set(0, 0, 1);
    tmpZ.addScaledVector(tmpY, -tmpZ.dot(tmpY)).normalize();
    tmpX.crossVectors(tmpY, tmpZ).normalize();
    basis.makeBasis(tmpX, tmpY, tmpZ);
    g.quaternion.setFromRotationMatrix(basis);
    prev.current.copy(st.position);

    // Solar wings track the sun about their boom axis.
    const localSun = SUN_DIR.clone().applyQuaternion(g.quaternion.clone().invert());
    const wingAngle = Math.atan2(localSun.z, localSun.y);
    for (const w of wings.current) if (w) w.rotation.x = -wingAngle;

    // Antenna pointing mechanism steers the dish at the serving station.
    if (st.target) {
      localTarget.copy(st.target);
      antenna.current.parent!.worldToLocal(localTarget);
      localTarget.sub(antenna.current.position);
      antenna.current.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        localTarget.normalize(),
      );
    }

    const t = clock.elapsedTime;
    if (navL.current) navL.current.opacity = Math.sin(t * 5) > 0.6 ? 1 : 0.08;
    if (navR.current) navR.current.opacity = Math.sin(t * 5 + 2) > 0.6 ? 1 : 0.08;
    const feedMat = feed.current.material as THREE.MeshBasicMaterial;
    feedMat.color.set(st.transmitting ? '#4CC9F0' : '#2a3544');
    feedMat.opacity = st.transmitting ? 0.65 + 0.35 * Math.sin(t * 19.6) : 0.4;
    body.current.scale.setScalar(hovered && hoverable ? 1.06 : 1);
  });

  const select = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect?.();
  };

  return (
    <group
      ref={group}
      onClick={onSelect ? select : undefined}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <group ref={body}>
        {/* Bus with gold multi-layer insulation */}
        <mesh material={mat.gold} castShadow>
          <boxGeometry args={[0.95, 0.95, 1.5]} />
        </mesh>
        <mesh material={mat.silver} position={[0, 0.49, 0]}>
          <boxGeometry args={[0.97, 0.03, 1.52]} />
        </mesh>
        <mesh material={mat.silver} position={[0, -0.49, 0]}>
          <boxGeometry args={[0.97, 0.03, 1.52]} />
        </mesh>

        {/* Imaging instrument on the nadir face */}
        <mesh material={mat.dark} position={[0, -0.62, 0.25]}>
          <boxGeometry args={[0.55, 0.26, 0.6]} />
        </mesh>
        <mesh material={mat.silver} position={[0, -0.76, 0.25]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.04, 24]} />
        </mesh>

        {/* Star trackers */}
        {[-0.25, 0.25].map((x) => (
          <group key={x} position={[x, 0.6, -0.5]} rotation={[0.35, 0, x > 0 ? -0.3 : 0.3]}>
            <mesh material={mat.silver}>
              <cylinderGeometry args={[0.07, 0.07, 0.16, 16]} />
            </mesh>
            <mesh material={mat.dark} position={[0, 0.11, 0]}>
              <cylinderGeometry args={[0.1, 0.07, 0.08, 16, 1, true]} />
            </mesh>
          </group>
        ))}

        {/* Thrusters */}
        {[
          [-0.3, -0.3],
          [0.3, -0.3],
          [-0.3, 0.3],
          [0.3, 0.3],
        ].map(([x, y]) => (
          <mesh
            key={`${x}${y}`}
            material={mat.dark}
            position={[x, y, -0.8]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <coneGeometry args={[0.06, 0.12, 12, 1, true]} />
          </mesh>
        ))}

        {/* Omni antennas */}
        <mesh material={mat.white} position={[0.35, 0.72, 0.6]}>
          <cylinderGeometry args={[0.012, 0.012, 0.5, 6]} />
        </mesh>
        <mesh material={mat.white} position={[-0.35, -0.72, -0.6]}>
          <cylinderGeometry args={[0.012, 0.012, 0.5, 6]} />
        </mesh>

        {/* Solar wings on sun-tracking drives */}
        {[-1, 1].map((side, i) => (
          <group key={side} position={[side * 0.5, 0, 0]}>
            <mesh
              material={mat.silver}
              position={[side * 0.28, 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.03, 0.03, 0.56, 10]} />
            </mesh>
            <group
              ref={(el) => {
                if (el) wings.current[i] = el;
              }}
              position={[side * 0.56, 0, 0]}
            >
              {[0, 1, 2].map((k) => (
                <group key={k} position={[side * (0.55 + k * 1.06), 0, 0]}>
                  <mesh material={mat.panel} position={[0, 0.012, 0]}>
                    <boxGeometry args={[1.0, 0.012, 0.9]} />
                  </mesh>
                  <mesh material={mat.panelBack} position={[0, -0.004, 0]}>
                    <boxGeometry args={[1.0, 0.008, 0.9]} />
                  </mesh>
                </group>
              ))}
            </group>
          </group>
        ))}

        {/* X-band downlink antenna on a pointing mechanism */}
        <group position={[0, -0.55, -0.45]}>
          <mesh material={mat.silver} position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 0.18, 12]} />
          </mesh>
          <group ref={antenna} position={[0, -0.2, 0]}>
            <mesh geometry={dish} material={mat.white} />
            {[0, 1, 2].map((k) => {
              const a = (k / 3) * Math.PI * 2;
              return (
                <mesh
                  key={k}
                  material={mat.silver}
                  position={[Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.15]}
                  rotation={[Math.cos(a) * 0.55, -Math.sin(a) * 0.55, 0]}
                >
                  <cylinderGeometry args={[0.007, 0.007, 0.3, 5]} />
                </mesh>
              );
            })}
            <mesh ref={feed} position={[0, 0, 0.27]}>
              <sphereGeometry args={[0.045, 16, 16]} />
              <meshBasicMaterial color="#4CC9F0" transparent toneMapped={false} />
            </mesh>
          </group>
        </group>

        {/* Navigation lights */}
        {!ghost && (
          <>
            <mesh position={[-3.8, 0, 0]}>
              <sphereGeometry args={[0.035, 8, 8]} />
              <meshBasicMaterial ref={navL} color="#ff3b4e" transparent toneMapped={false} />
            </mesh>
            <mesh position={[3.8, 0, 0]}>
              <sphereGeometry args={[0.035, 8, 8]} />
              <meshBasicMaterial ref={navR} color="#34D399" transparent toneMapped={false} />
            </mesh>
          </>
        )}
      </group>

      {/* Generous invisible hit volume so the satellite is easy to click */}
      {onSelect && (
        <mesh>
          <boxGeometry args={[7.6, 1.8, 2.2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      )}
    </group>
  );
});
