"use client";

import { useMemo } from "react";
import { Bloom, ChromaticAberration, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, Effect, ToneMappingMode } from "postprocessing";
import * as THREE from "three";

/*
 * A film-style grade after tone mapping: a gentle S-curve, cool teal shadows
 * and warm highlights (split toning), and a touch less saturation in the
 * mid-tones so the gold accents and the flame carry the colour.
 */
const gradeFragment = /* glsl */ `
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
    c = mix(vec3(l), c, 0.92);
    vec3 shadows = vec3(0.86, 0.97, 1.08);
    vec3 highlights = vec3(1.05, 1.0, 0.92);
    c *= mix(shadows, highlights, smoothstep(0.05, 0.7, l));
    c += vec3(0.004, 0.006, 0.01) * (1.0 - l);   // blacks lifted a hair, like a film print
    outputColor = vec4(c, inputColor.a);
  }
`;

class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", gradeFragment, { blendFunction: BlendFunction.NORMAL });
  }
}

/** Camera look: bloom, filmic tone mapping, grade, a faint lens fringe at the edges, vignette and grain. */
export default function Effects({ multisampling }: { multisampling: number }) {
  const grade = useMemo(() => new GradeEffect(), []);
  const fringe = useMemo(() => new THREE.Vector2(0.0009, 0.0006), []);
  return (
    <EffectComposer multisampling={multisampling}>
      <Bloom mipmapBlur intensity={0.75} luminanceThreshold={0.8} luminanceSmoothing={0.3} radius={0.75} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <primitive object={grade} />
      {/* Real lenses fringe towards the corners only. */}
      <ChromaticAberration offset={fringe} radialModulation modulationOffset={0.35} />
      <Vignette offset={0.3} darkness={0.68} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.22} />
    </EffectComposer>
  );
}
