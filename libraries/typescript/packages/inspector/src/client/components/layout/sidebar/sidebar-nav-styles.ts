// Ported from website.mcp-use/src/components/nav-main.tsx + sidebar-provider menu button variants.
import { cn } from "@/client/lib/utils";

const sidebarNavTrailingRevealClass = cn(
  "transition-[opacity,filter] duration-200 ease-out",
  "opacity-100 blur-0",
  "group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:blur-[3px] group-data-[collapsible=icon]:pointer-events-none",
  "group-data-[collapsed=true]:opacity-0 group-data-[collapsed=true]:blur-[3px] group-data-[collapsed=true]:pointer-events-none"
);

export const sidebarNavRowTrailingPaddingClass =
  "pr-[calc(var(--sidebar-nav-trailing-right)+var(--sidebar-nav-trailing-size))]";

export const sidebarNavTrailingSlotClass = cn(
  "pointer-events-auto absolute right-(--sidebar-nav-trailing-right) top-1/2 z-10 flex h-(--sidebar-nav-trailing-size) min-w-(--sidebar-nav-trailing-size) -translate-y-1/2 items-center justify-center",
  sidebarNavTrailingRevealClass
);

export const sidebarNavLabelClass = cn(
  "truncate transition-[opacity,filter,margin] duration-200 ease-out",
  "group-data-[collapsible=icon]:hidden",
  "group-data-[collapsed=true]:hidden"
);

export const sidebarMenuButtonClass = cn(
  "peer/menu-button flex cursor-pointer items-center gap-2 overflow-hidden rounded-full py-2 text-left text-sm outline-hidden ring-sidebar-ring hover:text-sidebar-accent-foreground group-hover/menu-item:text-sidebar-accent-foreground focus-visible:ring-2 active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:font-medium data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  "transition-[width,max-width,height,padding,border-radius] duration-200 ease-out",
  "h-8 text-sm"
);
