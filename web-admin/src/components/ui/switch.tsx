import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-toggle";

import { cn } from "@/lib";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    type="button"
    role="switch"
    className={cn(
      "group peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-muted p-0.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=on]:bg-primary",
      className,
    )}
    {...props}
  >
    <span className="pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform duration-200 group-data-[state=on]:translate-x-5" />
  </SwitchPrimitive.Root>
));

Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
