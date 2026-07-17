import * as React from "react";
import { cn } from "@/lib";

function Tabs({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-4", className)} {...props} />;
}

function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid rounded-md bg-muted p-1 sm:grid-cols-4", className)} {...props} />;
}

function TabsTrigger({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center justify-center rounded px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-background text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ active, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { active?: boolean }) {
  if (!active) return null;
  return <div className={cn("grid gap-3", className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
