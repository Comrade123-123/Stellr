import CanvasRoot from "@/components/canvas/CanvasRoot";
import Header from "@/components/Header";
import LiveChip from "@/components/LiveChip";
import Loader from "@/components/Loader";
import SmoothScroll from "@/components/SmoothScroll";
import FinalCTA from "@/components/sections/FinalCTA";
import Footer from "@/components/sections/Footer";
import Hero from "@/components/sections/Hero";
import Intro from "@/components/sections/Intro";
import Manifesto from "@/components/sections/Manifesto";
import SkyTonight from "@/components/sections/SkyTonight";
import Telemetry from "@/components/sections/Telemetry";
import Tools from "@/components/sections/Tools";

export default function Home() {
  return (
    <>
      <CanvasRoot />
      <SmoothScroll />
      <Loader />
      <Header />
      <LiveChip />
      <main className="relative z-10">
        <Intro />
        <Hero />
        <SkyTonight />
        <Manifesto />
        <Tools />
        <Telemetry />
        <FinalCTA />
      </main>
      <div className="relative z-10">
        <Footer />
      </div>
    </>
  );
}
