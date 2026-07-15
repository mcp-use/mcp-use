import * as React from "react";

export type AsChildCompatProps = {
  asChild?: boolean;
};

/** ponytail: bridges Radix `asChild` to Base UI `render` during migration. */
export function resolveAsChildFromChildren({
  asChild,
  children,
  nativeButton,
}: {
  asChild?: boolean;
  children?: React.ReactNode;
  nativeButton?: boolean;
}): { render: React.ReactElement; nativeButton?: boolean } | null {
  if (asChild && React.isValidElement(children)) {
    return {
      render: children,
      nativeButton: nativeButton ?? false,
    };
  }

  return null;
}
