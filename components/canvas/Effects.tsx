"use client";

import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";

export default function Effects({ multisampling }: { multisampling: number }) {
  return (
    <EffectComposer multisampling={multisampling}>
      <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.85} luminanceSmoothing={0.25} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.72} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.5} />
    </EffectComposer>
  );
}
