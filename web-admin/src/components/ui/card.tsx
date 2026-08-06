import * as React from "react";
import { cn } from "@/lib";

const Card = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <section ref={ref} className={cn("rounded-[20px] bg-card text-card-foreground", className)} {...props} />
));
Card.displayName = "Card";

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-4 px-5 py-4", className)} {...props} />;
}

function CardTitle({ className, children, description }: React.HTMLAttributes<HTMLDivElement> & { description?: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <h2 className="text-base font-semibold leading-none tracking-normal">{children}</h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export { Card, CardContent, CardHeader, CardTitle };
