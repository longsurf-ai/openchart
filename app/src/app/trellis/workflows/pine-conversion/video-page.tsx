// Purpose: Present the approved full-window film at its original aspect ratio.
import { useReducedMotion } from "motion/react";

import type { OnboardingPageProps } from "@openchart/app/app/trellis/views";
import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";

import video from "./pine-conversion.mp4";
import captions from "./pine-conversion.vtt?url";
import poster from "./poster.png";

/**
 * Plays the Pine conversion film in the shared accessible Dialog, above the
 * surface that offered it. The browser owns playback and fullscreen; reduced
 * motion leaves the poster and manual controls. Dismissal marks the Trellis
 * step seen through `onDone`, and unmount releases the media element. A failed
 * media load leaves browser controls and dismissal available.
 * @example <PineConversionPage transport={transport} onDone={done} />
 */
export function PineConversionPage({ onDone }: OnboardingPageProps) {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent size="lg">
        <div className="space-y-2 pr-5">
          <DialogTitle>Bring your Pine indicators with you</DialogTitle>
          <DialogDescription>
            If you have existing indicators in Pinescript, you can port them
            over simply by pasting the code and asking your agent.
          </DialogDescription>
        </div>
        <video
          src={video}
          poster={poster}
          className="h-auto max-h-[60vh] w-auto max-w-full justify-self-center rounded-md bg-black object-contain"
          aria-label="Pine Script conversion demo"
          autoPlay={!reduceMotion}
          controls
          loop
          muted
          playsInline
          preload="metadata"
        >
          <track kind="captions" src={captions} srcLang="en" label="English" />
        </video>
        <div className="flex justify-end">
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
