import type { Metadata } from "next";
import CosmoscopeTool from "@/components/CosmoscopeTool";

export const metadata: Metadata = {
  title: "Cosmoscope — Stellr",
  description:
    "The Sun and the eight planets exactly where they are, at any moment from 1900 to 2199: fly between them, run time forwards or back, and see which planets are up tonight where you are.",
};

export default function CosmoscopePage() {
  return <CosmoscopeTool />;
}
