import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib";

const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

function DialogContent({
  className,
  children,
  wide,
  topLayer,
  onInteractOutside,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { wide?: boolean; topLayer?: boolean }) {
  function handleInteractOutside(event: Parameters<NonNullable<typeof onInteractOutside>>[0]) {
    onInteractOutside?.(event);
    if (event.defaultPrevented) return;
    const target = event.target;
    if (
      document.body.hasAttribute("data-bypassproxy-select-open") ||
      document.querySelector("[data-bypassproxy-select-content]") ||
      (target instanceof Element && Boolean(target.closest("[data-bypassproxy-dialog-content]")))
    ) {
      event.preventDefault();
    }
  }

  return (
    <DialogPortal>
      <DialogPrimitive.Overlay className={cn("fixed inset-0 bg-slate-950/45", topLayer ? "z-[80]" : "z-40")} />
      <div className={cn("fixed inset-0 grid place-items-end p-2 sm:place-items-center sm:p-4", topLayer ? "z-[90]" : "z-50")}>
        <DialogPrimitive.Content
          data-bypassproxy-dialog-content
          className={cn(
            "flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-lg border bg-background sm:max-h-[calc(100dvh-2rem)]",
            wide ? "sm:max-w-[760px]" : "sm:max-w-[520px]",
            className,
          )}
          onInteractOutside={handleInteractOutside}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0 border-b px-5 py-4", className)} {...props} />;
}

function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-auto p-5", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 flex-wrap justify-end gap-2 border-t px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]", className)} {...props} />;
}

export { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle };
