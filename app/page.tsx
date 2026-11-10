"use client";
import { useRef } from "react";
import { Nav, Hero, HowItWorks, Logo } from "@/components/Landing";
import Demo, { type DemoHandle } from "@/components/Demo";

export default function Page() {
  const demo = useRef<DemoHandle>(null);
  const startDemo = () => demo.current?.start();
  return (
    <main className="min-h-screen bg-bg">
      <Nav onDemo={startDemo} />
      <Hero onDemo={startDemo} />
      <HowItWorks />
      <Demo ref={demo} />
      <footer className="hair-t">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row gap-6 justify-between">
          <div className="flex items-center gap-2"><Logo size={18} /><span className="text-[14px] font-semibold">VitalSwitch</span></div>
          <p className="text-[13px] text-fg3 max-w-[70ch]">
            A Clocked Build Challenge prototype. The hospital, patients, labs and procedures are synthetic, and results are simulation outputs, not clinical claims. Every plan needs human approval.{" "}
            <a className="underline underline-offset-4" href="https://github.com/shiv-aurora/clocked-build-challenge" target="_blank" rel="noreferrer">Source on GitHub</a>
          </p>
        </div>
      </footer>
    </main>
  );
}
