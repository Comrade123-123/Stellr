/*
 * Shader code for Cosmoscope's worlds. The Sun sits at the world origin, so every surface is lit
 * from -position. Noise: simplex and cellular noise after Stefan Gustavson and Ashima Arts
 * (MIT licence, github.com/ashima/webgl-noise and github.com/stegu/webgl-noise).
 */

export const NOISE = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec3 permute3(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * snoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  // Distance to the nearest of a jittered grid of points (F1), and that point's random value.
  vec2 cellular(vec3 P) {
    vec3 Pi = mod289(floor(P));
    vec3 Pf = fract(P);
    float best = 8.0;
    float id = 0.0;
    for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
    for (int k = -1; k <= 1; k++) {
      vec3 o = vec3(float(i), float(j), float(k));
      vec3 h = permute3(permute3(permute3(Pi.x + o.x + vec3(0.0, 57.0, 113.0)) + Pi.y + o.y) + Pi.z + o.z);
      vec3 r = o + fract(h * (1.0 / 41.0)) * 0.8 + 0.1 - Pf;
      float d = dot(r, r);
      if (d < best) { best = d; id = fract(h.x * 0.0243); }
    }
    return vec2(sqrt(best), id);
  }

  // Bowl-shaped craters of random sizes: returns a shade multiplier around 1.
  float craters(vec3 p, float scale, float amount) {
    vec2 c = cellular(p * scale);
    float r = 0.08 + 0.3 * c.y * c.y;
    float d = c.x / r;
    float floorDark = smoothstep(1.0, 0.45, d) * 0.16;
    float rim = smoothstep(0.7, 1.0, d) * smoothstep(1.4, 1.0, d) * 0.2;
    float keep = step(0.55, c.y) * (0.6 + 0.4 * c.y);
    return 1.0 + amount * keep * (rim - floorDark);
  }
`;

/** Shared by every world: local (unit-sphere) position, world position and world normal. */
export const WORLD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vLocal = normalize(position);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** Soft-terminator lighting from the Sun at the origin, with a fill light for looking at the night side. */
const LIGHT = /* glsl */ `
  uniform float uFill;
  float sunlight(vec3 n, vec3 l) {
    float d = dot(n, l);
    return smoothstep(-0.06, 0.35, d) * (0.35 + 0.65 * max(d, 0.0));
  }
  float lit(float sun) { return max(sun, 0.0) + 0.018 + uFill * 0.32; }
  // Procedural colours are picked by eye in sRGB; lighting works in linear light.
  vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
`;

/*
 * The planets. Defines pick the extras: EARTH (night lights, ocean glint, twilight), JUPITER
 * (polar cyclones), SATURN (north polar hexagon, south polar vortex, ring shadow), GIANT (limb
 * darkening), PLUTO (procedural surface, as there's no texture to ship), SUN (self-lit,
 * granulation). Everything is in the planet's own axes: y north, x the prime meridian.
 */
export const PLANET_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform sampler2D nightMap;
  uniform sampler2D ringMap;
  uniform vec3 uCenter;
  uniform vec3 uNorth;
  uniform float uRadius;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  ${NOISE}
  ${LIGHT}

  // A cyclone at polar-plane point c, radius r: spiral cloud lanes, bright core.
  vec2 cyclone(vec2 q, vec2 c, float r, float turn) {
    vec2 d = q - c;
    float dist = length(d) / r;
    if (dist > 1.4) return vec2(0.0);
    float a = atan(d.y, d.x);
    // Tightly wound cloud lanes, roughened so they don't read as a drawing.
    float lanes = sin(a * 2.0 + turn * log(dist + 0.03) * 10.0 + snoise(vec3(d * 90.0, 3.0)) * 1.2);
    float body = smoothstep(1.2, 0.05, dist);
    float core = smoothstep(0.22, 0.0, dist);
    return vec2(body, clamp(lanes * body * 0.8 + core, -1.0, 1.0));
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(-vWorld);
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 p = vLocal;
    float sun = sunlight(n, l);
    float mu = max(dot(n, v), 0.0);

    #ifdef SUN
      // Boiling plasma: two layers of warped noise (large convection patterns and a fine,
      // faster boil) mapped through a temperature ramp, deep red in the cool lanes to yellow-white
      // in the hottest upwellings; limb darkening cools and dims it towards the edge; a few dark
      // sunspots sit in the active belts.
      float t = uTime * 0.03;
      vec3 base = texture2D(map, vUv).rgb;
      float px = length(fwidth(p));
      float fineFade = 1.0 - smoothstep(0.02, 0.06, px * 6.0);
      vec3 q = p * 2.6;
      #ifdef LOW
        // Cheaper on weak GPUs: one warp instead of three, and a single noise for the boil.
        vec3 w = vec3(fbm(q + vec3(0.0, t, 0.0)));
        float big = fbm(q * 1.8 + w * 1.7);
        float boil = snoise(p * 26.0 + w * 2.2 + vec3(0.0, t * 3.0, 0.0));
      #else
        vec3 w = vec3(fbm(q + vec3(0.0, t, 0.0)), fbm(q + vec3(5.2, 1.3, t)), fbm(q + vec3(t, 2.8, 9.1)));
        float big = fbm(q * 1.8 + w * 1.7 + vec3(0.0, 0.0, t * 0.6));
        float boil = fbm(p * 26.0 + w * 2.2 + vec3(0.0, t * 3.0, t * 1.5));
      #endif
      float heat = 0.6 + 0.28 * big + 0.14 * boil * fineFade + 0.05 * (dot(base, vec3(0.33)) - 0.5);
      heat -= (1.0 - mu) * 0.2;
      // Sunspots: dark cores with a brown, streaked surround.
      float lat = abs(p.y);
      float belt = smoothstep(0.08, 0.16, lat) * smoothstep(0.55, 0.35, lat);
      vec3 sq = p + vec3(0.0, 0.0, uTime * 0.0015);
      float region = smoothstep(0.35, 0.6, snoise(sq * 2.4) * 0.65 + snoise(sq * 5.5) * 0.35) * belt;
      float spotField = snoise(sq * 12.0) * 0.6 + snoise(sq * 26.0) * 0.4;
      float penumbra = smoothstep(0.48, 0.56, spotField) * region;
      float umbra = smoothstep(0.64, 0.72, spotField) * region;
      heat -= penumbra * 0.3 + umbra * 0.5;
      heat = clamp(heat, 0.0, 1.0);
      vec3 c = mix(vec3(0.42, 0.05, 0.0), vec3(1.0, 0.32, 0.02), smoothstep(0.0, 0.4, heat));
      c = mix(c, vec3(1.0, 0.68, 0.16), smoothstep(0.35, 0.7, heat));
      c = mix(c, vec3(1.0, 0.94, 0.72), smoothstep(0.68, 1.0, heat));
      c *= 0.66 + 0.34 * pow(mu, 0.45);
      c = mix(c, vec3(0.08, 0.02, 0.0), umbra * 0.85);
      gl_FragColor = vec4(c * 1.35, 1.0);
      #include <colorspace_fragment>
      return;
    #endif

    #ifdef PLUTO
      float lon = atan(-p.z, p.x);
      float lat = asin(clamp(p.y, -1.0, 1.0));
      vec3 c = vec3(0.78, 0.67, 0.55) * (0.9 + 0.2 * fbm(p * 6.0));
      // Cthulhu Macula: the long dark red band along the equator, west of the heart.
      float band = smoothstep(0.4, 0.15, abs(lat + 0.1)) * smoothstep(0.35, 0.7, cos(lon - 1.4));
      c = mix(c, vec3(0.32, 0.17, 0.11), clamp(band * (0.85 + 0.3 * fbm(p * 9.0)), 0.0, 1.0));
      // Tombaugh Regio: two bright lobes centred near 180° longitude.
      vec3 heartW = normalize(vec3(cos(0.33) * cos(3.0), sin(0.33), -cos(0.33) * sin(3.0)));
      vec3 heartE = normalize(vec3(cos(0.05) * cos(-2.65), sin(0.05), -cos(0.05) * sin(-2.65)));
      float h = smoothstep(0.86, 0.95, dot(p, heartW)) + 0.8 * smoothstep(0.88, 0.97, dot(p, heartE));
      c = mix(c, vec3(0.96, 0.92, 0.86), clamp(h, 0.0, 1.0));
      c = mix(c, vec3(0.72, 0.7, 0.68), smoothstep(0.75, 0.95, p.y) * 0.6);
      vec3 col = toLinear(c);
    #else
      vec3 col = texture2D(map, vUv).rgb;
    #endif

    #ifdef JUPITER
      // Above 72° the map gives way to Juno's view: blue-grey cloud dotted with storms and, on the
      // pole itself, a cyclone ringed by eight others (north) or five (south).
      float ay = abs(p.y);
      if (ay > 0.88) {
        vec2 q = p.xz;
        float north = step(0.0, p.y);
        // Blue-grey haze, crowded with small storms, as Juno sees it.
        float mottle = fbm(vec3(q * 22.0, north * 7.0)) * 0.5 + 0.5;
        vec3 polar = mix(vec3(0.36, 0.4, 0.46), vec3(0.66, 0.63, 0.58), mottle);
        vec2 small = cellular(vec3(q * 60.0, north * 3.0));
        polar = mix(polar, vec3(0.86, 0.83, 0.78), step(0.7, small.y) * smoothstep(0.32, 0.12, small.x) * 0.7);
        int count = north > 0.5 ? 8 : 5;
        float ring = north > 0.5 ? 0.112 : 0.125;
        float size = north > 0.5 ? 0.05 : 0.058;
        float turn = north > 0.5 ? 1.0 : -1.0;
        vec2 cy = cyclone(q, vec2(0.0), size * 1.1, turn);
        for (int k = 0; k < 8; k++) {
          if (k >= count) break;
          float a = 6.2831853 * float(k) / float(count) + (north > 0.5 ? 0.2 : 0.9);
          vec2 cc = cyclone(q + 0.006 * vec2(snoise(vec3(q * 30.0, 1.0)), snoise(vec3(q * 30.0, 5.0))), ring * vec2(cos(a), sin(a)), size, turn);
          cy = max(cy, cc);
        }
        vec3 storm = mix(vec3(0.3, 0.33, 0.38), vec3(0.88, 0.84, 0.77), 0.5 + 0.5 * cy.y);
        polar = mix(polar, storm, cy.x * 0.9);
        col = mix(col, toLinear(polar), smoothstep(0.88, 0.94, ay));
      }
    #endif

    #ifdef SATURN
      // North: the hexagonal jet stream at 78°N, with a vortex on the pole.
      if (p.y > 0.86) {
        vec2 q = p.xz;
        float r = length(q);
        float a = atan(q.y, q.x) + 0.35;
        float sector = mod(a, 1.0471976) - 0.5235988;
        float hexR = 0.208 * 0.8660254 / cos(sector);
        float inside = smoothstep(hexR + 0.006, hexR - 0.006, r);
        float streaks = fbm(vec3(r * 90.0, a * 2.0, 1.0)) * 0.5 + 0.5;
        // Inside the hexagon the clouds are bluer; along its edge runs the jet, a bright band.
        vec3 polar = col * mix(vec3(0.72, 0.82, 0.92), vec3(0.9, 0.95, 1.0), streaks);
        vec3 c2 = mix(col, polar, inside * 0.75);
        float jet = exp(-pow((r - hexR) / 0.011, 2.0));
        c2 = mix(c2, col * vec3(1.15, 1.08, 0.95) + 0.03, jet * 0.75);
        float edge = exp(-pow((r - hexR - 0.03) / 0.015, 2.0));
        c2 *= 1.0 - edge * 0.18;
        float spiral = sin(atan(q.y, q.x) * 2.0 + log(r + 0.002) * 9.0) * 0.5 + 0.5;
        c2 = mix(c2, toLinear(mix(vec3(0.42, 0.46, 0.5), vec3(0.85, 0.83, 0.78), spiral)), smoothstep(0.05, 0.012, r) * 0.7);
        c2 = mix(c2, toLinear(vec3(0.25, 0.27, 0.3)), smoothstep(0.012, 0.004, r));
        col = mix(col, c2, smoothstep(0.86, 0.92, p.y));
      }
      // South: a hurricane with a clear eye on the pole.
      if (p.y < -0.9) {
        vec2 q = p.xz;
        float r = length(q);
        float wall = exp(-pow((r - 0.035) / 0.01, 2.0));
        float spiral = sin(atan(q.y, q.x) * 2.0 - log(r + 0.002) * 8.0) * 0.5 + 0.5;
        vec3 c3 = mix(col, toLinear(mix(vec3(0.6, 0.55, 0.48), vec3(0.9, 0.84, 0.72), spiral)), smoothstep(0.14, 0.04, r) * 0.55);
        c3 = mix(c3, toLinear(vec3(0.95, 0.9, 0.8)), wall * 0.6);
        c3 = mix(c3, toLinear(vec3(0.38, 0.32, 0.26)), smoothstep(0.03, 0.015, r));
        col = mix(col, c3, smoothstep(-0.9, -0.95, p.y));
      }
      // The rings' shadow: follow the sunbeam back from this point to the ring plane.
      vec3 nn = normalize(uNorth);
      float denom = dot(l, nn);
      if (abs(denom) > 1e-4) {
        float t = dot(uCenter - vWorld, nn) / denom;
        if (t > 0.0) {
          float rr = length(vWorld + l * t - uCenter) / uRadius;
          if (rr > 1.25 && rr < 2.3) {
            float alpha = texture2D(ringMap, vec2((rr - 1.25) / 1.05, 0.5)).a;
            sun *= 1.0 - alpha * 0.85;
          }
        }
      }
    #endif

    #ifdef EARTH
      vec3 night = texture2D(nightMap, vUv).rgb;
      float ocean = clamp((col.b - col.r) * 12.0 - 0.1, 0.0, 1.0);
      vec3 h = normalize(l + v);
      float glint = pow(max(dot(n, h), 0.0), 160.0) * ocean * smoothstep(0.0, 0.2, dot(n, l));
      float dark = 1.0 - smoothstep(-0.18, 0.08, dot(n, l));
      vec3 c = col * lit(sun) + vec3(1.0, 0.92, 0.75) * glint * 0.45;
      c += night * vec3(1.0, 0.78, 0.45) * dark * 1.6;
      // Twilight: a warm tint along the terminator.
      c += vec3(0.5, 0.22, 0.08) * exp(-pow(dot(n, l) / 0.09, 2.0)) * 0.08;
      // Air seen at a slant scatters blue over the day side.
      c = mix(c, vec3(0.35, 0.55, 1.0) * sun, pow(1.0 - mu, 3.0) * 0.45);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    #endif

    #ifdef GIANT
      col *= mix(0.55, 1.0, pow(mu, 0.35));
    #endif

    gl_FragColor = vec4(col * lit(sun), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Earth's clouds: the cloud map as alpha, lit by the Sun, gone on the night side. */
export const CLOUD_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  ${LIGHT}
  void main() {
    float a = texture2D(map, vUv).r;
    vec3 n = normalize(vNormal);
    vec3 l = normalize(-vWorld);
    float s = sunlight(n, l);
    gl_FragColor = vec4(vec3(1.0) * lit(s), smoothstep(0.12, 0.9, a) * 0.92);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A thin shell of air: glows at the limb on the sunlit side. Drawn additively on a slightly larger sphere. */
export const AIR_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uStrength;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 l = normalize(-vWorld);
    float rim = pow(1.0 - max(dot(n, v), 0.0), uPower);
    float day = smoothstep(-0.35, 0.45, dot(n, l));
    float a = rim * day * uStrength;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** Rings: the fragment's place in the ring plane, so radius is exact everywhere on the disc. */
export const RING_VERTEX = /* glsl */ `
  varying vec3 vRing;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vRing = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** Faint dusty or dark rings (Jupiter, Uranus, Neptune): bands at set radii, in planet radii. */
export const THIN_RING_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec4 uBands[10];
  uniform float uInner;
  uniform float uOuter;
  varying vec3 vRing;
  varying vec3 vWorld;
  void main() {
    float r = length(vRing.xy);
    float a = 0.0;
    for (int i = 0; i < 10; i++) {
      vec4 b = uBands[i];
      if (b.z <= 0.0) continue;
      a += b.z * smoothstep(b.y, 0.0, abs(r - b.x));
    }
    vec3 l = normalize(-vWorld);
    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
  }
`;

/*
 * Moons without a map to ship, drawn after spacecraft images. uKind picks the surface:
 * 1 Phobos/Deimos, 2 Io, 3 Europa, 4 Ganymede, 5 Callisto, 6 Mimas, 7 Enceladus, 8 icy,
 * 9 Titan, 10 Iapetus, 11 Miranda, 12 dark icy, 13 Triton, 14 Charon.
 */
export const MOON_FRAGMENT = /* glsl */ `
  uniform int uKind;
  uniform vec3 uColor;
  uniform float uSeed;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  ${NOISE}
  ${LIGHT}

  float spot(vec3 p, vec3 at, float size) { return smoothstep(size, size * 0.6, distance(p, normalize(at))); }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(-vWorld);
    vec3 p = vLocal;
    vec3 q = p + uSeed;
    vec3 c = pow(uColor, vec3(1.0 / 2.2));
    float mottle = fbm(q * 3.0) * 0.5 + 0.5;

    if (uKind == 1) {
      c *= (0.8 + 0.35 * mottle) * craters(q, 5.0, 1.4) * craters(q, 11.0, 1.0);
    } else if (uKind == 2) {
      // Io: sulphur yellows and oranges, white frost, dark volcanic pits with red haloes.
      float f = fbm(q * 4.0);
      c = mix(vec3(0.93, 0.83, 0.38), vec3(0.85, 0.55, 0.22), smoothstep(-0.2, 0.5, f));
      c = mix(c, vec3(0.95, 0.94, 0.85), smoothstep(0.35, 0.6, fbm(q * 7.0 + 3.0)) * 0.6);
      vec2 v = cellular(q * 7.0);
      float vent = step(0.72, v.y);
      c = mix(c, vec3(0.6, 0.18, 0.08), vent * smoothstep(0.42, 0.2, v.x) * 0.7);
      c = mix(c, vec3(0.08, 0.06, 0.05), vent * smoothstep(0.16, 0.08, v.x));
      c = mix(c, vec3(0.62, 0.48, 0.3), smoothstep(0.7, 0.95, abs(p.y)) * 0.6);
    } else if (uKind == 3) {
      // Europa: bright ice crossed by reddish-brown cracks (lineae) and mottled chaos terrain.
      c = mix(vec3(0.93, 0.9, 0.84), vec3(0.78, 0.66, 0.52), smoothstep(0.1, 0.6, fbm(q * 2.5)));
      float lines = 0.0;
      lines = max(lines, smoothstep(0.035, 0.0, abs(snoise(q * 3.0))));
      lines = max(lines, smoothstep(0.03, 0.0, abs(snoise(q * 6.0 + 7.0))) * 0.8);
      lines = max(lines, smoothstep(0.025, 0.0, abs(snoise(q * 11.0 + 13.0))) * 0.6);
      c = mix(c, vec3(0.55, 0.32, 0.2), lines * 0.75);
    } else if (uKind == 4) {
      // Ganymede: old dark terrain broken by bright grooved bands, frosty poles.
      float dark = smoothstep(0.0, 0.25, fbm(q * 1.8));
      float grooves = sin((q.x + q.y * 0.6) * 140.0 + fbm(q * 5.0) * 8.0) * 0.5 + 0.5;
      vec3 bright = vec3(0.7, 0.67, 0.62) * (0.92 + 0.1 * grooves);
      c = mix(bright, vec3(0.47, 0.42, 0.37), dark * (0.75 + 0.25 * fbm(q * 6.0)));
      c *= craters(q, 6.0, 0.8);
      c = mix(c, vec3(0.9, 0.9, 0.92), smoothstep(0.75, 0.92, abs(p.y)) * 0.7);
    } else if (uKind == 5) {
      // Callisto: dark and saturated with craters, freckled with bright ice.
      c = vec3(0.34, 0.3, 0.25) * (0.85 + 0.3 * mottle);
      vec2 s = cellular(q * 16.0);
      c = mix(c, vec3(0.85, 0.83, 0.8), step(0.6, s.y) * smoothstep(0.22, 0.05, s.x));
      c *= craters(q, 7.0, 1.0);
    } else if (uKind == 6) {
      // Mimas: grey ice with Herschel, the giant crater on its leading side.
      c = vec3(0.68, 0.68, 0.66) * (0.85 + 0.25 * mottle) * craters(q, 6.0, 1.3) * craters(q, 13.0, 0.8);
      vec3 hz = normalize(vec3(cos(0.03) * cos(-1.95), sin(0.03), -cos(0.03) * sin(-1.95)));
      float d = acos(clamp(dot(p, hz), -1.0, 1.0));
      c *= 1.0 - smoothstep(0.5, 0.35, d) * 0.4 + smoothstep(0.42, 0.5, d) * smoothstep(0.58, 0.5, d) * 0.45 + smoothstep(0.08, 0.0, d) * 0.5;
    } else if (uKind == 7) {
      // Enceladus: almost pure white, with the blue "tiger stripes" across its south pole.
      c = vec3(0.95, 0.97, 0.99) * (0.92 + 0.1 * mottle) * craters(q, 6.0, 0.4);
      if (p.y < -0.7) {
        float stripes = smoothstep(0.08, 0.0, abs(fract((p.x * 0.8 + p.z * 0.6) * 9.0 + fbm(q * 4.0) * 0.4) - 0.5) - 0.38);
        c = mix(c, vec3(0.45, 0.62, 0.78), stripes * smoothstep(-0.7, -0.8, p.y));
      }
    } else if (uKind == 8) {
      c *= (0.85 + 0.25 * mottle) * craters(q, 5.0, 1.2) * craters(q, 12.0, 0.7);
    } else if (uKind == 9) {
      // Titan: only the haze shows, orange with faint bands.
      c = vec3(0.86, 0.6, 0.28) * (0.92 + 0.08 * sin(p.y * 9.0 + fbm(q * 2.0)));
    } else if (uKind == 10) {
      // Iapetus: the leading hemisphere (here, -x) coal-dark, the trailing side bright, a ridge on the equator.
      float darkSide = smoothstep(0.25, -0.2, p.x + 0.15 * fbm(q * 3.0));
      c = mix(vec3(0.85, 0.83, 0.78), vec3(0.2, 0.14, 0.1), darkSide);
      c *= craters(q, 6.0, 0.9);
      c *= 1.0 + smoothstep(0.03, 0.0, abs(p.y)) * 0.25;
    } else if (uKind == 11) {
      // Miranda: grey, cut by bands of parallel grooves (coronae).
      float patch1 = smoothstep(0.1, 0.3, fbm(q * 1.6));
      float grooves = sin(dot(q, vec3(1.0, 0.4, 0.2)) * 90.0) * 0.5 + 0.5;
      c = vec3(0.66, 0.66, 0.66) * mix(0.95, 0.7 + 0.45 * grooves, patch1) * craters(q, 6.0, 0.8);
    } else if (uKind == 12) {
      c *= (0.8 + 0.3 * mottle) * craters(q, 6.0, 1.2);
      vec2 s = cellular(q * 9.0);
      c = mix(c, vec3(0.8), step(0.85, s.y) * smoothstep(0.15, 0.05, s.x) * 0.6);
    } else if (uKind == 13) {
      // Triton: a pinkish southern cap streaked by dark geyser plumes; "cantaloupe" terrain to the north.
      float cap = smoothstep(-0.1, -0.35, p.y + 0.1 * fbm(q * 3.0));
      vec2 dimple = cellular(q * 14.0);
      vec3 north = vec3(0.66, 0.64, 0.58) * (0.92 + 0.12 * smoothstep(0.1, 0.4, dimple.x)) * (0.92 + 0.12 * mottle);
      vec3 south = vec3(0.92, 0.82, 0.78) * (0.92 + 0.1 * mottle);
      c = mix(north, south, cap);
      float plume = smoothstep(0.9, 1.0, snoise(vec3(q.x * 20.0, q.y * 3.0, q.z * 20.0)));
      c = mix(c, vec3(0.3, 0.25, 0.22), plume * cap * 0.7);
    } else if (uKind == 14) {
      // Charon: grey ice with a red-brown cap over its north pole, Mordor Macula.
      c = vec3(0.62, 0.61, 0.6) * (0.85 + 0.25 * mottle) * craters(q, 5.0, 1.0);
      c = mix(c, vec3(0.42, 0.24, 0.16), smoothstep(0.72, 0.9, p.y + 0.08 * fbm(q * 4.0)));
    }

    float s = sunlight(n, l);
    gl_FragColor = vec4(toLinear(c) * lit(s), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Lines drawn on a globe (Earth's plate boundaries), dimmed on the night side. */
export const LINE_VERTEX = /* glsl */ `
  attribute vec3 color;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vColor = color;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * position);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
export const LINE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    float day = 0.45 + 0.55 * smoothstep(-0.2, 0.3, dot(normalize(vNormal), normalize(-vWorld)));
    gl_FragColor = vec4(vColor * day, 0.9);
  }
`;
