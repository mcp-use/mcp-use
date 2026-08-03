import { Loader2Icon } from "lucide-react";

import { cn } from "@/client/lib/utils";

function Spinner({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
