import { useMemo } from 'react';
import * as THREE from 'three';

import landDots from '../data/land-dots.json';
import { EARTH_CENTER, EARTH_R, directionFor } from './geo';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();

const oceanVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const oceanFragment = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float day = smoothstep(-0.25, 0.35, dot(vNormal, uSun));
    vec3 deep = vec3(0.010, 0.024, 0.044);
    vec3 lit = vec3(0.028, 0.068, 0.115);
    vec3 col = mix(deep * 0.55, mix(deep, lit, 0.6), day);
    float rim = pow(clamp(1.0 - dot(vNormal, vView), 0.0, 1.0), 3.0);
    col += vec3(0.30, 0.79, 0.94) * rim * 0.22;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const dotVertex = /* glsl */ `
  uniform float uSize;
  uniform vec3 uSun;
  varying float vLight;
  varying float vFacing;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(world.xyz - vec3(0.0, ${(-EARTH_R).toFixed(1)}, 0.0));
    vLight = smoothstep(-0.2, 0.35, dot(n, uSun));
    vFacing = clamp(dot(n, normalize(cameraPosition - world.xyz)), 0.0, 1.0);
    vec4 mv = viewMatrix * world;
    gl_PointSize = uSize * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const dotFragment = /* glsl */ `
  varying float vLight;
  varying float vFacing;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.18, d);
    vec3 day = vec3(0.60, 0.74, 0.88);
    vec3 night = vec3(0.30, 0.79, 0.94) * 0.32;
    vec3 col = mix(night, day, vLight);
    gl_FragColor = vec4(col, a * (0.22 + 0.40 * vLight) * (0.35 + 0.65 * vFacing));
  }
`;

// Atmosphere in three layers. Each approximates single scattering along the view ray: optical
// depth grows towards the limb, Rayleigh scattering lights the day side blue and the terminator
// orange, and a Henyey-Greenstein Mie lobe adds the forward-scattered haze around the sun.

/** Layer 1: Rayleigh scattering inside the shell, drawn over the surface. */
const rayleighFragment = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float mu = clamp(dot(vNormal, vView), 0.0, 1.0);
    float depth = pow(1.0 - mu, 2.2);
    float sun = dot(vNormal, uSun);
    float day = smoothstep(-0.18, 0.35, sun);
    float terminator = exp(-pow((sun + 0.02) / 0.16, 2.0));
    float cosT = dot(vView, uSun);
    float phase = 0.75 * (1.0 + cosT * cosT);
    vec3 sky = vec3(0.16, 0.40, 0.78) * phase * day;
    vec3 dusk = vec3(1.0, 0.45, 0.18) * terminator * 0.9;
    gl_FragColor = vec4((sky + dusk) * depth, depth * (0.14 + 0.38 * day + 0.3 * terminator));
  }
`;

/** Layer 2: limb glow seen past the planet's edge, bright on the day side. */
const limbFragment = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(clamp(1.0 - abs(dot(vNormal, vView)), 0.0, 1.0), 2.4);
    float lit = smoothstep(-0.35, 0.4, dot(vNormal, uSun));
    vec3 col = mix(vec3(0.10, 0.22, 0.45), vec3(0.30, 0.79, 0.94), lit);
    gl_FragColor = vec4(col, rim * 0.46 * (0.3 + 0.7 * lit));
  }
`;

/** Layer 3: outer Mie haze, strongest when looking towards the sun through the limb. */
const mieFragment = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(clamp(1.0 - abs(dot(vNormal, vView)), 0.0, 1.0), 4.0);
    float g = 0.76;
    float cosT = dot(-vView, uSun);
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
    float lit = smoothstep(-0.2, 0.5, dot(vNormal, uSun));
    gl_FragColor = vec4(vec3(0.95, 0.9, 0.82), rim * lit * min(0.36, 0.04 + 0.045 * hg));
  }
`;

export function Earth() {
  const dots = useMemo(() => {
    const data = landDots as number[];
    const positions = new Float32Array((data.length / 2) * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < data.length; i += 2) {
      directionFor(data[i] / 10, data[i + 1] / 10, v)
        .multiplyScalar(EARTH_R * 1.002)
        .add(EARTH_CENTER);
      positions.set([v.x, v.y, v.z], (i / 2) * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  const uniforms = useMemo(() => ({ uSun: { value: SUN_DIR }, uSize: { value: 0.16 } }), []);

  const graticule = useMemo(() => {
    const pts: number[] = [];
    const v = new THREE.Vector3();
    const push = (lat: number, lon: number) => {
      directionFor(lat, lon, v)
        .multiplyScalar(EARTH_R * 1.001)
        .add(EARTH_CENTER);
      pts.push(v.x, v.y, v.z);
    };
    for (let lat = -75; lat <= 75; lat += 15) {
      for (let lon = -180; lon < 180; lon += 3) {
        push(lat, lon);
        push(lat, lon + 3);
      }
    }
    for (let lon = -180; lon < 180; lon += 15) {
      for (let lat = -84; lat < 84; lat += 3) {
        push(lat, lon);
        push(lat + 3, lon);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  return (
    <group>
      <mesh position={EARTH_CENTER} renderOrder={0}>
        <sphereGeometry args={[EARTH_R, 128, 128]} />
        <shaderMaterial
          vertexShader={oceanVertex}
          fragmentShader={oceanFragment}
          uniforms={uniforms}
        />
      </mesh>
      <lineSegments geometry={graticule}>
        <lineBasicMaterial color="#4CC9F0" transparent opacity={0.06} depthWrite={false} />
      </lineSegments>
      <points geometry={dots} renderOrder={1}>
        <shaderMaterial
          vertexShader={dotVertex}
          fragmentShader={dotFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
        />
      </points>
      <mesh position={EARTH_CENTER} renderOrder={2}>
        <sphereGeometry args={[EARTH_R * 1.012, 96, 96]} />
        <shaderMaterial
          vertexShader={oceanVertex}
          fragmentShader={rayleighFragment}
          uniforms={uniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh position={EARTH_CENTER} renderOrder={2}>
        <sphereGeometry args={[EARTH_R * 1.045, 96, 96]} />
        <shaderMaterial
          vertexShader={oceanVertex}
          fragmentShader={limbFragment}
          uniforms={uniforms}
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh position={EARTH_CENTER} renderOrder={2}>
        <sphereGeometry args={[EARTH_R * 1.09, 64, 64]} />
        <shaderMaterial
          vertexShader={oceanVertex}
          fragmentShader={mieFragment}
          uniforms={uniforms}
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
